"""
Levels and chapters IV-VII test: cap 1000 with EXP ×10 every 10 levels, monster and quest EXP following
the curve (more kills per level as you climb), level-ups that carry over correctly, the new regions linked
in a chain with their story gates, every monster spawning on a map, and the chapter gear and loot.
Run: .venv/Scripts/python.exe test_levels.py   (or -m pytest test_levels.py -q)
"""

from __future__ import annotations

import asyncio
import math

import items as inv
from game import PORTAL_RADIUS, Game
from test_skills import _hero, _noop_save
from world_data import (CHAPTER_ENDS, MAPS, MAX_LEVEL, MOBS, QUESTS, REGIONS, SPAWNS, exp_to_next, kills_per_level, meta)


async def run_all() -> None:
    assert MAX_LEVEL == 1000
    for lv in range(10, 990, 10):
        assert math.isclose(exp_to_next(lv + 10) / exp_to_next(lv), 10, rel_tol=1e-3), lv
    assert exp_to_next(1000) > 10 ** 100 and len(meta()["exp_table"]) == 1000
    assert all(exp_to_next(lv + 1) > exp_to_next(lv) for lv in range(1, 1000))
    print("ok  nível máximo 1000 e EXP ×10 a cada 10 níveis")

    # regular monsters: kills per level of their own level grow with the level
    regular = sorted((m for m in MOBS.values() if not m.get("boss")), key=lambda m: m["level"])
    for m in regular:
        kills = exp_to_next(m["level"]) / m["exp"]
        assert 1.5 < kills < 3 * kills_per_level(m["level"]), (m["name"], kills)
    assert kills_per_level(100) > 2 * kills_per_level(1)
    for q in QUESTS:
        assert q["reward"]["exp"] >= exp_to_next(MOBS[q["goal"]["mob"]]["level"]) * 0.6 * 0.99, q["id"]
    print("ok  EXP dos monstros e das missões acompanha a curva")

    game = Game(_noop_save)
    hero, ws = _hero(game, "blade_master", "town_01", 20, 20, level=49)
    hero.exp = 0
    await game.add_exp(hero, exp_to_next(49) + exp_to_next(50) + 5)
    assert hero.level == 51 and hero.exp == 5
    hero.level = MAX_LEVEL
    await game.add_exp(hero, 10 ** 120)
    assert hero.level == MAX_LEVEL
    print("ok  subir de nível com números grandes")

    # the chain frost → ash → crimson → ghost → void, each portal gated by its chapter's first quest
    chain = ["frost_01"] + [r[0] for r in REGIONS]
    for a, b in zip(chain, chain[1:]):
        fwd = next(p for p in MAPS[a]["portals"] if p["to"] == b)
        back = next(p for p in MAPS[b]["portals"] if p["to"] == a)
        assert QUESTS[fwd["story"]]["goal"]["mob"] in {sp["mob"] for sp in SPAWNS if sp["map"] == b}, (a, b)
        assert math.hypot(back["dx"] - fwd["x"], back["dy"] - fwd["y"]) > PORTAL_RADIUS + 1
    for r in REGIONS:
        kinds = {sp["mob"] for sp in SPAWNS if sp["map"] == r[0]}
        assert len(kinds) == 4 and sum(MOBS[k].get("boss", False) for k in kinds) == 1, r[0]
    assert [q.get("chapter_end") for q in QUESTS if q.get("chapter_end")] == list(CHAPTER_ENDS)
    assert MOBS["void_dragon"]["level"] == 100
    print("ok  4 regiões novas ligadas em sequência, com missões e chefes")

    # each region's boss drops the class weapon of its tier; weapons never come out of pools
    for boss, tier in (("ash_dragon", 7), ("blood_queen", 8), ("ghost_king", 9), ("void_dragon", 10)):
        for cls, wid in (("blade_master", "sword"), ("grand_sorcerer", "staff"), ("night_ranger", "bow")):
            assert f"{wid}_t{tier}" in inv.roll_loot(boss, cls)
        assert inv.pool_item(tier, "blade_master") not in {f"sword_t{tier}", f"staff_t{tier}", f"bow_t{tier}"}
    assert inv.ITEMS["sword_t10"]["stats"]["atk"] > inv.ITEMS["sword_t7"]["stats"]["atk"] > inv.ITEMS["sword_t6"]["stats"]["atk"]
    print("ok  equipamentos dos capítulos IV a VII e loot dos chefes")

    # critical hits: chance stops at 100%, critical damage keeps growing with agility and gear
    from game import Hero
    r = Hero(char_id="c", name="c", cls="night_ranger", level=100, exp=0, gold=0, story={}, map_id="town_01")
    r.refresh_passives()
    assert r.crit == 1.0 and r.crit_dmg > 0.5 + 0.25
    bare = r.crit_dmg
    r.gear = {"weapon": {"id": "bow_t10", "plus": 5, "ref": {"crit_dmg": 0.1}}}
    assert r.crit == 1.0 and r.crit_dmg > bare + 0.1
    low = Hero(char_id="d", name="d", cls="grand_sorcerer", level=1, exp=0, gold=0, story={}, map_id="town_01")
    assert low.crit < 0.2 and abs(low.crit_dmg - (0.5 + low.stat("agi") * 0.001)) < 1e-9
    assert "crit_dmg" in __import__("forge").REFINE_LINES
    print("ok  chance de crítico até 100% e dano crítico sem teto")

    # story quests: 10× the monsters, bosses twice, and the Elder's lines say the new numbers
    import re
    for q in QUESTS:
        mob = MOBS[q["goal"]["mob"]]
        if mob.get("boss"):
            assert q["goal"]["count"] == 2 and "2 vezes" in q["offer"][-1], q["id"]
        else:
            assert q["goal"]["count"] >= 20 and q["goal"]["count"] % 10 == 0, q["id"]
            nums = {int(n) for line in q["offer"] for n in re.findall(r"\b\d+\b", line)}
            assert q["goal"]["count"] in nums, (q["id"], nums)
    assert QUESTS[0]["goal"]["count"] == 50
    print("ok  missões com 10x mais monstros e chefes 2 vezes")

    # level growth: +100 life and mana per level for everyone, vitality and intelligence for every class,
    # evasion from level (capped)
    from world_data import CLASS_GROWTH, DODGE_CAP, LEVEL_HP, LEVEL_MP
    for cls in CLASS_GROWTH:
        assert CLASS_GROWTH[cls]["vit"] >= 2 and CLASS_GROWTH[cls]["int"] >= 1, cls
        a = Hero(char_id="g", name="g", cls=cls, level=40, exp=0, gold=0, story={}, map_id="town_01")
        b = Hero(char_id="g", name="g", cls=cls, level=41, exp=0, gold=0, story={}, map_id="town_01")
        assert b.max_hp - a.max_hp >= LEVEL_HP and b.max_mp - a.max_mp >= LEVEL_MP, cls
        assert b.dodge > a.dodge > 0
    top = Hero(char_id="g", name="g", cls="night_ranger", level=1000, exp=0, gold=0, story={}, map_id="town_01")
    top.refresh_passives()
    assert top.dodge == DODGE_CAP
    print("ok  +100 de vida e mana por nível, vitalidade, inteligência e evasão crescendo")


if __name__ == "__main__":
    asyncio.run(run_all())


def test_levels() -> None:
    asyncio.run(run_all())
