"""
Story NPC test: the Elder waits at the entrance of every map that has a story mission, so the hero turns a mission
in and takes the next one on the same map, without walking back to town.
Run: .venv/Scripts/python.exe test_story_npc.py   (or -m pytest test_story_npc.py -q)
"""

from __future__ import annotations

import asyncio

from game import Game
from test_skills import _hero, _noop_save
from websocket_manager import manager
from world_data import MAPS, QUESTS, SPAWNS


async def run_all() -> None:
    mob_map = {}
    for sp in SPAWNS:
        mob_map.setdefault(sp["mob"], sp["map"])
    quest_maps = {mob_map[q["goal"]["mob"]] for q in QUESTS}
    for m in quest_maps | {"town_01"}:
        elders = [n for n in MAPS[m]["npcs"] if n["role"] == "story"]
        assert len(elders) == 1, m
        sx, sy = MAPS[m]["spawn"]
        if m != "town_01":  # in town he keeps his own house; elsewhere he waits by the entrance
            assert abs(elders[0]["x"] - sx) < 4 and abs(elders[0]["y"] - sy) < 4, m
    print(f"ok  o Ancião está na entrada de todos os {len(quest_maps)} mapas com missão")

    # in the swamp: finish the swamp quest, turn it in to the Elder there and take the next one, all on the same map
    game = Game(_noop_save)
    q = next(i for i, x in enumerate(QUESTS) if mob_map[x["goal"]["mob"]] == "swamp_01")
    elder = next(n for n in MAPS["swamp_01"]["npcs"] if n["role"] == "story")
    h = _hero(game, "night_ranger", "swamp_01", elder["x"] + 1, elder["y"], level=20)[0]
    s = manager.sessions[h.char_id]
    s.x, s.y = elder["x"] + 1, elder["y"]
    h.story = {"q": q, "st": "ready", "n": QUESTS[q]["goal"]["count"]}
    sent = []
    real_send = game.send

    async def spy(cid, msg):
        sent.append(msg)
        await real_send(cid, msg)
    game.send = spy
    await game.talk(h, "elder")
    dialog = next(m for m in sent if m.get("type") == "dialog")
    assert dialog["options"][0]["id"] == "turnin", dialog
    await game.dialog_option(h, "turnin")
    assert h.story["q"] == q + 1 and h.story["st"] == "offer" and h.map_id == "swamp_01"
    await game.dialog_option(h, "accept")
    assert h.story["st"] == "active"
    print("ok  entrega e pega a próxima missão com o Ancião do próprio mapa")


if __name__ == "__main__":
    asyncio.run(run_all())


def test_story_npc() -> None:
    asyncio.run(run_all())
