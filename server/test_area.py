"""Map events reach only the players who can see them; monster deaths still reach everyone; a player moving to a
new part of the map gets the monsters around it (mob_sync); every player gets the moves of the players around it."""

from __future__ import annotations

import asyncio
import json
import time

from game import Game
from test_skills import _hero, _noop_save
from websocket_manager import VIEW_RADIUS, manager


async def run_all() -> None:
    game = Game(_noop_save)
    mm = game.mobs["forest_01"]
    wolf = next(m for m in mm.mobs.values() if m.mob_def_id == "wolf")
    near, near_ws = _hero(game, "blade_master", "forest_01", wolf.x + 1, wolf.y, level=30)
    far_x = wolf.x + VIEW_RADIUS + 30 if wolf.x + VIEW_RADIUS + 30 < 198 else wolf.x - VIEW_RADIUS - 30
    far, far_ws = _hero(game, "night_ranger", "forest_01", far_x, wolf.y, level=30)
    # _hero names sessions by class+map, so the two are different players
    assert near.char_id != far.char_id

    near_ws.sent.clear(); far_ws.sent.clear()
    wolf.hp, wolf.is_dead = wolf.max_hp * 100, False
    assert await game.use_skill(near, "bm_basic", wolf.instance_id, wolf.x, wolf.y) is None
    kinds = lambda ws: {m.get("type") for m in ws.sent}
    assert {"skill_used", "mob_damaged"} <= kinds(near_ws), kinds(near_ws)
    # (a monster next to the target may die from the splash: deaths do go to the whole map)
    assert "skill_used" not in kinds(far_ws)
    assert not [m for m in far_ws.sent if m.get("type") == "mob_damaged" and not m.get("killed")], far_ws.sent
    print("ok  golpe e dano só para quem está perto")

    near_ws.sent.clear(); far_ws.sent.clear()
    wolf.hp = 1
    near.cooldowns.clear()
    assert await game.use_skill(near, "bm_basic", wolf.instance_id, wolf.x, wolf.y) is None
    assert any(m.get("type") == "mob_damaged" and m.get("killed") for m in far_ws.sent)
    print("ok  morte do monstro chega a todos do mapa")

    # walking far enough to change cell: the monsters around arrive in a mob_sync
    far_ws.sent.clear()
    s = manager.sessions[far.char_id]
    s.last_move_ts = 0.0
    tx = wolf.x + 3
    for _ in range(40):
        step = max(-7.5, min(7.5, tx - s.x))
        s.last_move_ts = time.monotonic() - 1.0  # each step: one second of walking (8 tiles)
        await game.on_move(far, s.x + step, wolf.y)
        if abs(s.x - tx) < 0.5:
            break
    syncs = [m for m in far_ws.sent if m.get("type") == "mob_sync"]
    assert syncs and all(len(e) == 4 for e in syncs[-1]["mobs"]), far_ws.sent[-3:]
    print("ok  ao chegar perto, recebe onde estão os monstros")

    # moves: each player gets the players around it, even when several move at once
    near_ws.sent.clear(); far_ws.sent.clear()
    manager.sessions[near.char_id].dirty = True
    manager.sessions[far.char_id].dirty = True
    manager._dirty_maps.add("forest_01")
    await manager._flush_movements()
    got = {u[0] for m in near_ws.sent if m.get("type") == "mv" for u in m["m"]}
    assert got == {far.char_id}, got  # the other player's move, never its own
    assert all(len(u) == 3 for m in near_ws.sent if m.get("type") == "mv" for u in m["m"])
    print("ok  posições de quem está perto chegam todas")

    # bundling: what one player gets in the same moment goes out as one message, in order
    manager.batch = True
    try:
        near_ws.sent.clear()
        s = manager.sessions[near.char_id]
        for i in range(3):
            await manager.deliver(s, json.dumps({"type": "x", "i": i}))
        assert near_ws.sent == []  # nothing sent until the current work yields
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert near_ws.sent == [{"type": "batch", "m": [{"type": "x", "i": 0}, {"type": "x", "i": 1}, {"type": "x", "i": 2}]}]
        near_ws.sent.clear()
        await manager.deliver(s, json.dumps({"type": "solo"}))
        await asyncio.sleep(0); await asyncio.sleep(0)
        assert near_ws.sent == [{"type": "solo"}]  # a single message is sent as it is
    finally:
        manager.batch = False
    print("ok  mensagens do mesmo momento vão juntas e em ordem")

    for h in (near, far):
        manager.sessions.pop(h.char_id, None)


def test_area():
    asyncio.run(run_all())


if __name__ == "__main__":
    test_area()
    print("all area tests passed")
