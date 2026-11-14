"""
Swamp test: every portal lands outside the destination's portals and inside the map, spawns fit
their maps, the forest→swamp portal opens with chapter II, chapter ends are announced, heroes who
finished chapter I before it existed get the new quest, and the swamp monsters drop their loot.
Run: .venv/Scripts/python.exe test_swamp.py   (or -m pytest test_swamp.py -q)
"""

from __future__ import annotations

import asyncio
import math

import items as inv
from game import PORTAL_RADIUS, Game
from test_skills import _hero, _noop_save
from world_data import MAPS, MOBS, QUESTS, SPAWNS, normalize_story


async def run_all() -> None:
    # portals never drop you on top of another portal (which would bounce you back) and stay in bounds
    for mid, m in MAPS.items():
        for p in m["portals"]:
            dest = MAPS[p["to"]]
            assert 1 <= p["dx"] < dest["size"] - 1 and 1 <= p["dy"] < dest["size"] - 1, (mid, p["id"])
            for q in dest["portals"]:
                assert math.hypot(p["dx"] - q["x"], p["dy"] - q["y"]) > PORTAL_RADIUS + 1, (mid, p["id"], q["id"])
    for sp in SPAWNS:
        size = MAPS[sp["map"]]["size"]
        assert sp["mob"] in MOBS and 0 < sp["x"] < size and 0 < sp["y"] < size, sp
    print("ok  portais e spawns dentro dos mapas")

    game = Game(_noop_save)
    to_swamp = next(p for p in MAPS["forest_01"]["portals"] if p["to"] == "swamp_01")
    hero, ws = _hero(game, "night_ranger", "town_01", 20, 18, level=12)
    hero.story = {"q": 4, "st": "ready", "n": 1}
    assert not game.portal_open(hero, to_swamp)
    await game.dialog_option(hero, "turnin")
    end = next(m for m in ws.sent if m["type"] == "story_end")
    assert end["chapter"] == "I" and hero.story == {"q": 5, "st": "offer", "n": 0}
    assert not game.portal_open(hero, to_swamp)
    await game.dialog_option(hero, "accept")
    assert game.portal_open(hero, to_swamp) and QUESTS[hero.story["q"]]["goal"]["mob"] == "swamp_ghoul"
    print("ok  fim do capítulo I e portal do pântano abre com a missão nova")

    assert normalize_story({"q": 5, "st": "done", "n": 0}) == {"q": 5, "st": "offer", "n": 0}
    assert normalize_story({"q": len(QUESTS), "st": "done", "n": 0})["st"] == "done"
    print("ok  quem já tinha terminado a história recebe o capítulo II")

    # swamp monsters exist and the quest counts them
    ghoul = next(m for m in game.mobs["swamp_01"].mobs.values() if m.mob_def_id == "swamp_ghoul")
    assert any(m.boss for m in game.mobs["swamp_01"].mobs.values())
    await game.quest_kill(hero, "swamp_ghoul")
    assert hero.story["n"] == 1
    print(f"ok  pântano com {len(game.mobs['swamp_01'].mobs)} monstros e missão contando ({ghoul.level=})")

    # loot: the witch always gives a legendary of the killer's class, Vorthas never gives Morgana's ring
    rings = 0
    for _ in range(60):
        drops = inv.roll_loot("swamp_witch", "night_ranger")
        assert "bow_t4" in drops
        rings += "ring_witch" in drops
        assert "ring_witch" not in inv.roll_loot("death_knight", "night_ranger")
    assert 10 < rings < 50
    print("ok  loot da bruxa e o Anel de Morgana só dela")


if __name__ == "__main__":
    asyncio.run(run_all())


def test_swamp() -> None:
    asyncio.run(run_all())
