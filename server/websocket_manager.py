"""
WebSocket manager — handles connections, movement broadcasting,
and spatial partitioning per map.
"""

from __future__ import annotations

import asyncio
import json
import math
import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket

from spatial import CELL_SIZE, SpatialGrid

# Movement speed cap — tiles per second (server-side cheat prevention)
MAX_SPEED = 8.0
MAX_MOVE_GAP = 1.0  # seconds
# how far (tiles) purely visual map events reach (skills, hits, potions); every screen sees less than this
VIEW_RADIUS = 30.0
# monster movement reaches a bit farther, so a monster walking into view is already where it should be
MOB_VIEW_RADIUS = 40.0


def encode(msg: dict[str, Any]) -> str:
    """One message as JSON text, made once and sent to every recipient (it used to be re-made for each one)."""
    return json.dumps(msg, separators=(",", ":"), ensure_ascii=False)
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
    # messages waiting to go out together (see ConnectionManager.deliver)
    outbox: list[str] = field(default_factory=list)
    flushing: bool = False


class WebSocketManager:
    def __init__(self) -> None:
        # char_id → session
        self.sessions: dict[str, PlayerSession] = {}
        # map_id → SpatialGrid
        self.grids: dict[str, SpatialGrid] = {}
        # pending movement updates per map, flushed every tick
        self._dirty_maps: set[str] = set()
        self._running = False
        # messages to one player in the same moment go out as one (deliver); tests turn it off to read them at once
        self.batch = True

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
        changed = new_cell != session.cell
        if changed:
            session.cell = new_cell
            nearby = grid.nearby_players(target_x, target_y)
            await self._send_nearby_snapshot(session, nearby)

        self._dirty_maps.add(session.map_id)
        return {"x": target_x, "y": target_y, "cell_changed": changed}

    def around(self, map_id: str, x: float, y: float, r: float = VIEW_RADIUS) -> list["PlayerSession"]:
        """Sessions on this map within r tiles of (x, y)."""
        grid = self.grids.get(map_id)
        if not grid:
            return []
        r2 = r * r
        sessions = self.sessions
        out = []
        for cid in grid.players_within(x, y, r):
            s = sessions.get(cid)
            if s is not None and s.map_id == map_id:
                dx, dy = s.x - x, s.y - y
                if dx * dx + dy * dy <= r2:
                    out.append(s)
        return out

    async def send_text_to(self, sessions, text: str) -> None:
        for s in sessions:
            await self.deliver(s, text)

    async def deliver(self, s: "PlayerSession", text: str) -> None:
        """Queues one message for a player. Everything queued for that player in the same moment (a skill: the cast,
        each hit, the stun; a game tick: every monster step) goes out as ONE websocket message right after, in order.
        Sent one by one, compressing and framing thousands of tiny messages a second was most of the sending work."""
        if not self.batch:
            try:
                await s.ws.send_text(text)
            except Exception:
                pass
            return
        s.outbox.append(text)
        if not s.flushing:
            s.flushing = True
            asyncio.get_running_loop().create_task(self._flush_out(s))

    async def _flush_out(self, s: "PlayerSession") -> None:
        try:
            while s.outbox:
                texts, s.outbox = s.outbox, []
                frame = texts[0] if len(texts) == 1 else '{"type":"batch","m":[' + ",".join(texts) + "]}"
                try:
                    await s.ws.send_text(frame)
                except Exception:
                    s.outbox.clear()
                    break
        finally:
            s.flushing = False

    # ── Batched broadcast loop ───────────────────────────────────────────

    async def start_broadcast_loop(self) -> None:
        self._running = True
        while self._running:
            await asyncio.sleep(BROADCAST_INTERVAL)
            await self._flush_movements()

    def stop_broadcast_loop(self) -> None:
        self._running = False

    async def _flush_movements(self) -> None:
        """Every 50 ms: each player gets one message with the new positions of the players around them.
        (It used to look up neighbours once per moving player and could skip updates; now it is one lookup per
        player on a map where someone moved.)"""
        dirty_maps = self._dirty_maps.copy()
        self._dirty_maps.clear()
        if not dirty_maps:
            return
        by_map: dict[str, list[PlayerSession]] = {}
        for s in list(self.sessions.values()):
            if s.map_id in dirty_maps:
                by_map.setdefault(s.map_id, []).append(s)
        for map_id, sessions in by_map.items():
            grid = self.grids.get(map_id)
            if not grid:
                continue
            # each moved player's entry is turned into JSON once: [id, x, y] with one decimal
            updates: dict[str, tuple[float, float, str]] = {}
            for s in sessions:
                if s.dirty:
                    s.dirty = False
                    x, y = round(s.x, 1), round(s.y, 1)
                    updates[s.char_id] = (x, y, encode([s.char_id, x, y]))
            if not updates:
                continue
            r2 = VIEW_RADIUS * VIEW_RADIUS
            for s in sessions:
                # only players close enough to be on this player's screen, never itself
                # (positions were most of what every player downloaded)
                parts = []
                for c in grid.players_within(s.x, s.y, VIEW_RADIUS):
                    u = updates.get(c)
                    if u is not None and c != s.char_id:
                        dx, dy = u[0] - s.x, u[1] - s.y
                        if dx * dx + dy * dy <= r2:
                            parts.append(u[2])
                if parts:
                    await self.deliver(s, '{"type":"mv","m":[' + ",".join(parts) + "]}")

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
        await self.deliver(session, encode({"type": "nearby_snapshot", "players": players}))

    async def _broadcast_to(self, char_ids: set[str], msg: dict[str, Any], exclude: str = "") -> None:
        text = encode(msg)
        for cid in char_ids:
            if cid == exclude:
                continue
            s = self.sessions.get(cid)
            if s:
                await self.deliver(s, text)


manager = WebSocketManager()
