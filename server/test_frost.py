"""
Frozen peaks (chapter III) test: the swamp→peaks portal opens with the first chapter III quest,
heroes who had finished chapter II get it offered, the peaks' monsters and the Lich spawn and count
for the quests, the chapter ends are announced, and the new loot rolls the right pieces.
Run: .venv/Scripts/python.exe test_frost.py   (or -m pytest test_frost.py -q)
"""

from __future__ import annotations

import asyncio

import items as inv
from game import Game
from test_skills import _hero, _noop_save
from world_data import MAPS, MOBS, QUESTS, SPAWNS, normalize_story


async def run_all() -> None:
    frost = MAPS["frost_01"]
    to_frost = next(p for p in MAPS["swamp_01"]["portals"] if p["to"] == "frost_01")
    back = next(p for p in frost["portals"] if p["to"] == "swamp_01")
    first = next(i for i, q in enumerate(QUESTS) if q["id"] == "q9")
    assert to_frost["story"] == first and back["dx"] < MAPS["swamp_01"]["size"]
    kinds = {sp["mob"] for sp in SPAWNS if sp["map"] == "frost_01"}
    assert kinds == {"frost_wolf", "frost_sentinel", "ice_troll", "lich_king"}
    assert [MOBS[k]["level"] for k in ("frost_wolf", "frost_sentinel", "ice_troll", "lich_king")] == sorted(
        MOBS[k]["level"] for k in ("frost_wolf", "frost_sentinel", "ice_troll", "lich_king"))
    print("ok  Picos Congelados ligados ao pântano, com 3 monstros e o chefe")

    game = Game(_noop_save)
    hero, ws = _hero(game, "grand_sorcerer", "town_01", 20, 18, level=18)
    hero.story = {"q": first - 1, "st": "ready", "n": 1}
    assert not game.portal_open(hero, to_frost)
    await game.dialog_option(hero, "turnin")
    end = next(m for m in ws.sent if m["type"] == "story_end")
    assert end["chapter"] == "II" and hero.story == {"q": first, "st": "offer", "n": 0}
    assert not game.portal_open(hero, to_frost)
    await game.dialog_option(hero, "accept")
    assert game.portal_open(hero, to_frost) and QUESTS[hero.story["q"]]["goal"]["mob"] == "frost_wolf"
    print("ok  fim do capítulo II e portal dos Picos abre com a missão nova")

    assert normalize_story({"q": first, "st": "done", "n": 0}) == {"q": first, "st": "offer", "n": 0}
    print("ok  quem já tinha terminado o capítulo II recebe o capítulo III")

    mobs = game.mobs["frost_01"].mobs.values()
    boss = [m for m in mobs if m.mob_def_id == "lich_king"]
    assert len(boss) == 1 and boss[0].boss and boss[0].slam
    await game.quest_kill(hero, "frost_wolf")
    assert hero.story["n"] == 1
    print(f"ok  {len(game.mobs['frost_01'].mobs)} monstros nos Picos e a missão contando")

    # the last quest closes chapter III
    last = next(i for i, q in enumerate(QUESTS) if q["id"] == "q12")
    hero.story = {"q": last, "st": "ready", "n": 1}
    ws.sent.clear()
    await game.dialog_option(hero, "turnin")
    assert next(m for m in ws.sent if m["type"] == "story_end")["chapter"] == "III"
    assert hero.story == {"q": last + 1, "st": "offer", "n": 0}  # chapter IV follows
    print("ok  fim do capítulo III anunciado")

    # loot: Valdrek always gives a tier-6 weapon of the killer's class; an extra tier-5 piece only now and then
    # (gear drops are 10% of what they were); Morgana's ring is unique and never comes out of a pool
    extra = 0
    for _ in range(400):
        drops = inv.roll_loot("lich_king", "grand_sorcerer")
        assert "staff_t6" in drops
        extra += any(inv.ITEMS[d].get("tier") == 5 and not inv.ITEMS[d].get("set") for d in drops)  # set drops: test_sets
        assert "ring_witch" not in drops
        assert inv.pool_item(5, "blade_master") != "ring_witch"
    assert 10 <= extra <= 90, extra  # ~10% of 400
    for d in ("frost_pelt", "frozen_core", "troll_tusk", "sword_t6", "bow_t6", "plate_t5", "robe_t5", "leather_t5", "amulet_t5"):
        assert d in inv.ITEMS
    print("ok  loot do Rei Lich e itens novos")


if __name__ == "__main__":
    asyncio.run(run_all())


def test_frost() -> None:
    asyncio.run(run_all())
