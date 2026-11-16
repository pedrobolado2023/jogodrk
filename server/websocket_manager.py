"""
WebSocket manager — handles connections, movement broadcasting,
and spatial partitioning per map.
"""

from __future__ import annotations

import asyncio
import math
import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket

from spatial import CELL_SIZE, SpatialGrid

# Movement speed cap — tiles per second (server-side cheat prevention)
MAX_SPEED = 8.0
MAX_MOVE_GAP = 1.0  # seconds
# Tick rate for batched broadcasts (ms)
BROADCAST_INTERVAL = 0.05  # 50ms = 20 ticks/sec


@dataclass
class PlayerSession:
    ws: WebSocket
    char_id: str
    char_name: str
    map_id: str
    x: float
    y: float
    last_move_ts: float = 0.0
    cell: tuple[int, int] = (0, 0)
    dirty: bool = False  # position changed since last broadcast
    info: dict[str, Any] = field(default_factory=dict)  # class, level — shown to other players


class WebSocketManager:
    def __init__(self) -> None:
        # char_id → session
        self.sessions: dict[str, PlayerSession] = {}
        # map_id → SpatialGrid
        self.grids: dict[str, SpatialGrid] = {}
        # pending movement updates per map, flushed every tick
        self._dirty_maps: set[str] = set()
        self._running = False

    # ── Grid management ──────────────────────────────────────────────────

    def get_grid(self, map_id: str) -> SpatialGrid:
        if map_id not in self.grids:
            self.grids[map_id] = SpatialGrid(map_id)
        return self.grids[map_id]

    # ── Connection lifecycle ─────────────────────────────────────────────

    async def connect(self, ws: WebSocket, char_id: str, char_name: str, map_id: str, x: float, y: float,
                      info: dict[str, Any] | None = None) -> None:
        await ws.accept()
        session = PlayerSession(ws=ws, char_id=char_id, char_name=char_name, map_id=map_id, x=x, y=y, info=info or {})
        self.sessions[char_id] = session
        await self._enter(session)

    async def _enter(self, session: PlayerSession) -> None:
        grid = self.get_grid(session.map_id)
        session.cell = grid.add(session.char_id, session.x, session.y)
        nearby = grid.nearby_players(session.x, session.y)
        await self._broadcast_to(nearby, {
            "type": "player_spawn", "char_id": session.char_id, "name": session.char_name,
            "x": session.x, "y": session.y, "map": session.map_id, **session.info,
        }, exclude=session.char_id)
        await self._send_nearby_snapshot(session, nearby)

    async def change_map(self, char_id: str, map_id: str, x: float, y: float) -> None:
        session = self.sessions.get(char_id)
        if not session:
            return
        grid = self.get_grid(session.map_id)
        nearby = grid.nearby_players(session.x, session.y)
        grid.remove(char_id, session.x, session.y)
        await self._broadcast_to(nearby, {"type": "player_despawn", "char_id": char_id}, exclude=char_id)
        session.map_id, session.x, session.y = map_id, x, y
        session.last_move_ts = 0.0
        await self._enter(session)

    async def disconnect(self, char_id: str) -> None:
        session = self.sessions.pop(char_id, None)
        if not session:
            return
        grid = self.get_grid(session.map_id)
        nearby = grid.nearby_players(session.x, session.y)
        grid.remove(char_id, session.x, session.y)
        await self._broadcast_to(nearby, {
            "type": "player_despawn",
            "char_id": char_id,
        })

    # ── Movement (server-authoritative) ──────────────────────────────────

    async def handle_move(self, char_id: str, target_x: float, target_y: float, force: bool = False) -> dict[str, Any] | None:
        session = self.sessions.get(char_id)
        if not session or not (math.isfinite(target_x) and math.isfinite(target_y)):
            return None

        now = time.monotonic()
        # at most MAX_MOVE_GAP seconds of walking count for one move: standing still for a while must not allow a
        # single long jump (a teleport) on the next move
        dt = min(now - session.last_move_ts, MAX_MOVE_GAP) if session.last_move_ts else 0.1

        # validate speed
        dx = target_x - session.x
        dy = target_y - session.y
        dist = (dx * dx + dy * dy) ** 0.5
        if not force and dt > 0 and dist / dt > MAX_SPEED:
            # clamp to max speed in the requested direction
            ratio = (MAX_SPEED * dt) / dist
            target_x = session.x + dx * ratio
            target_y = session.y + dy * ratio

        grid = self.get_grid(session.map_id)
        old_x, old_y = session.x, session.y
        session.x = target_x
        session.y = target_y
        session.last_move_ts = now
        session.dirty = True

        new_cell = grid.move(char_id, old_x, old_y, target_x, target_y)

        # cell change → send snapshot of new neighbors
        if new_cell != session.cell:
            session.cell = new_cell
            nearby = grid.nearby_players(target_x, target_y)
            await self._send_nearby_snapshot(session, nearby)

        self._dirty_maps.add(session.map_id)
        return {"x": target_x, "y": target_y}

    # ── Batched broadcast loop ───────────────────────────────────────────

    async def start_broadcast_loop(self) -> None:
        self._running = True
        while self._running:
            await asyncio.sleep(BROADCAST_INTERVAL)
            await self._flush_movements()

    def stop_broadcast_loop(self) -> None:
        self._running = False

    async def _flush_movements(self) -> None:
        dirty_maps = self._dirty_maps.copy()
        self._dirty_maps.clear()

        for map_id in dirty_maps:
            grid = self.grids.get(map_id)
            if not grid:
                continue

            # collect all dirty players on this map
            updates: list[dict[str, Any]] = []
            dirty_sessions: list[PlayerSession] = []
            for char_id in list(self.sessions):
                s = self.sessions.get(char_id)
                if s and s.map_id == map_id and s.dirty:
                    s.dirty = False
                    dirty_sessions.append(s)
                    updates.append({
                        "char_id": s.char_id,
                        "x": round(s.x, 2),
                        "y": round(s.y, 2),
                    })

            if not updates:
                continue

            # for each dirty player, broadcast to their neighbors
            notified: set[str] = set()
            for s in dirty_sessions:
                nearby = grid.nearby_players(s.x, s.y)
                for cid in nearby:
                    if cid not in notified:
                        notified.add(cid)
                        target = self.sessions.get(cid)
                        if target:
                            # send only the updates relevant to this player's view
                            relevant = [u for u in updates if u["char_id"] in nearby]
                            try:
                                await target.ws.send_json({
                                    "type": "move_batch",
                                    "moves": relevant,
                                })
                            except Exception:
                                pass

    # ── Helpers ──────────────────────────────────────────────────────────

    async def _send_nearby_snapshot(self, session: PlayerSession, nearby: set[str]) -> None:
        players = []
        for cid in nearby:
            if cid == session.char_id:
                continue
            other = self.sessions.get(cid)
            if other:
                players.append({
                    "char_id": other.char_id,
                    "name": other.char_name,
                    "x": round(other.x, 2),
                    "y": round(other.y, 2),
                    **other.info,
                })
        try:
            await session.ws.send_json({
                "type": "nearby_snapshot",
                "players": players,
            })
        except Exception:
            pass

    async def _broadcast_to(self, char_ids: set[str], msg: dict[str, Any], exclude: str = "") -> None:
        for cid in char_ids:
            if cid == exclude:
                continue
            s = self.sessions.get(cid)
            if s:
                try:
                    await s.ws.send_json(msg)
                except Exception:
                    pass


manager = WebSocketManager()
