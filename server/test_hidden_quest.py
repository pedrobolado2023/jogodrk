"""
Hidden Wanderer tests: hidden until close, one quest at a time, 24 hours, the four kinds, the unique reward once,
and a new random place after each quest.
Run: .venv/Scripts/python.exe test_hidden_quest.py   (or -m pytest test_hidden_quest.py -q)
"""

from __future__ import annotations

import asyncio
import random
import time

import hidden_quest as hq
from game import Game
from test_skills import _hero, _noop_save
from websocket_manager import manager
from world_data import MAPS, MOBS


async def run_all() -> None:
    # places: always a hunting map (never town, the boss arena or the PvP arena), inside the map
    rng = random.Random(7)
    for _ in range(300):
        p = hq.spot(rng)
        m = MAPS[p["map"]]
        assert p["map"] in hq.ELIGIBLE and not m["safe"] and not m["pvp"] and not m.get("event")
        assert 2 <= p["x"] <= m["size"] - 2 and 2 <= p["y"] <= m["size"] - 2
        assert all(((p["x"] - q["x"]) ** 2 + (p["y"] - q["y"]) ** 2) ** 0.5 >= 8 for q in m["portals"])  # never by a portal
    assert {"town_01", "worldboss_01", "arena_01"}.isdisjoint(hq.ELIGIBLE)
    kinds = {hq.make_quest(lv, rng)["kind"] for lv in (5, 30, 90) for _ in range(40)}
    assert kinds == {"hunt", "boss", "wb", "explore"}, kinds
    q = next(q for q in (hq.make_quest(20, rng) for _ in range(200)) if q["kind"] == "hunt")
    assert abs(MOBS[q["mob"]]["level"] - 20) <= 4 and q["count"] == hq.HUNT_COUNT
    q = next(q for q in (hq.make_quest(30, rng) for _ in range(200)) if q["kind"] == "explore")
    assert len({mk["map"] for mk in q["marks"]}) == 3
    print("ok  lugares e os 4 tipos de missão")

    game = Game(_noop_save)
    game.hq = hq.HiddenQuest(seed=3)
    npc = dict(game.hq.npc)
    sent: list[tuple[str, dict]] = []
    real_send = game.send

    async def spy(cid, msg):
        sent.append((cid, msg))
        await real_send(cid, msg)
    game.send = spy
    a = _hero(game, "night_ranger", npc["map"], npc["x"] + 20, npc["y"], level=30)[0]
    b = _hero(game, "blade_master", npc["map"], npc["x"] + 20, npc["y"] + 1, level=30)[0]
    sa, sb = manager.sessions[a.char_id], manager.sessions[b.char_id]

    def got(cid, kind):
        return [m for c, m in sent if c == cid and m.get("type") == kind]

    # far away: nothing is sent (the place never reaches the client)
    await game.hq.on_move(game, a, sa.x, sa.y)
    assert not got(a.char_id, "hidden_npc")
    await game.hq.talk(game, a)
    assert not got(a.char_id, "dialog")
    # close: shown, and the dialog offers the quest
    sa.x, sa.y = npc["x"] + 2, npc["y"]
    await game.hq.on_move(game, a, sa.x, sa.y)
    assert got(a.char_id, "hidden_npc")[-1]["id"] == hq.NPC_ID
    await game.talk(a, hq.NPC_ID)
    d = got(a.char_id, "dialog")[-1]
    assert d["options"][0]["id"] == "hq_accept" and "24 horas" in d["options"][0]["label"]
    sb.x, sb.y = npc["x"] + 1, npc["y"]
    await game.hq.on_move(game, b, sb.x, sb.y)
    assert got(b.char_id, "hidden_npc")
    print("ok  escondido de longe, aparece de perto")

    # a accepts: the Wanderer vanishes for everyone, b cannot take it (one at a time)
    game.hq.offers[a.char_id] = {"kind": "hunt", "mob": "frost_wolf", "map": "frost_01", "count": 3, "n": 0, "desc": "teste"}
    await game.dialog_option(a, "hq_accept")
    assert game.hq.holder["cid"] == a.char_id and game.hq.npc is None
    assert got(b.char_id, "hidden_npc")[-1].get("gone")
    await game.hq.talk(game, b)
    await game.hq.accept(game, b)
    assert game.hq.holder["cid"] == a.char_id
    assert 23.9 * 3600 < game.hq.holder["deadline"] - time.time() <= 24 * 3600
    assert got(a.char_id, "hq")[-1]["active"] is True
    print("ok  um por vez, 24 horas")

    # kills of the right monster count; others do not; done → unique reward, new place, once per hero
    await game.quest_kill(a, "wolf")
    assert game.hq.holder["n"] == 0
    for _ in range(3):
        await game.quest_kill(a, "frost_wolf")
    assert game.hq.holder is None and game.hq.npc is not None
    assert hq.REWARD_MOUNT in a.cosmetics["mounts"] and hq.REWARD_TITLE in a.cosmetics["titles"]
    assert game.can_wear_title(a, hq.REWARD_TITLE)
    assert a.char_id in game.hq.winners
    assert any(m.get("channel") == "event" and a.name in m.get("text", "") for _, m in sent)
    s2 = game.hq.npc
    sa.x, sa.y = s2["x"], s2["y"]
    if a.map_id != s2["map"]:
        a.map_id = s2["map"]
        game.hq.forget(a.char_id)
    await game.hq.on_move(game, a, sa.x, sa.y)
    await game.hq.talk(game, a)
    assert "já provou" in got(a.char_id, "dialog")[-1]["lines"][0]
    await game.hq.accept(game, a)
    assert game.hq.holder is None
    print("ok  recompensa única, uma vez por herói, e o Andarilho muda de lugar")

    # out of time: fails, the Wanderer goes somewhere else
    game.hq.npc = None
    game.hq.holder = {"cid": b.char_id, "name": b.name, "kind": "wb", "count": 1, "n": 0, "desc": "boss",
                      "deadline": time.time() - 1, "started": time.time() - 86400}
    await game.hq.tick(game)
    assert game.hq.holder is None and game.hq.npc is not None
    assert "acabou" in [m for c, m in sent if c == b.char_id and m.get("type") == "notice"][-1]["text"]
    assert hq.REWARD_MOUNT not in (b.cosmetics or {}).get("mounts", [])
    print("ok  tempo esgotado: missão perdida e novo lugar")

    # exploration: marks only show to the holder, close by; touching all three wins
    marks = [{**hq.spot(rng), "found": False} for _ in range(3)]
    game.hq.npc = None
    game.hq.holder = {"cid": b.char_id, "name": b.name, "kind": "explore", "count": 3, "n": 0, "marks": marks, "desc": "marcas",
                      "deadline": time.time() + 999, "started": time.time()}
    for i, mk in enumerate(marks):
        b.map_id = mk["map"]
        game.hq.forget(b.char_id)
        await game.hq.on_move(game, b, mk["x"] + 4, mk["y"])
        assert got(b.char_id, "hq_mark")[-1] == {"type": "hq_mark", "id": i, "x": mk["x"], "y": mk["y"]}
        await game.hq.on_move(game, a, mk["x"] + 4, mk["y"])  # someone else: nothing
        assert not got(a.char_id, "hq_mark")
        await game.hq.on_move(game, b, mk["x"] + 0.5, mk["y"])
    assert game.hq.holder is None and hq.REWARD_MOUNT in b.cosmetics["mounts"]
    print("ok  exploração: marcas só para quem tem a missão")

    # saved and loaded back
    again = hq.HiddenQuest(game.hq.to_json())
    assert again.npc == game.hq.npc and again.winners == game.hq.winners


if __name__ == "__main__":
    asyncio.run(run_all())
    print("all hidden quest tests passed")


def test_hidden_quest() -> None:
    asyncio.run(run_all())
