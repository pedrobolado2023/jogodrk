"""
Skill area test: areas and lines are bigger, chains reach more enemies, and single-target attacks splash
onto monsters right next to the target for less damage (without stuns/poisons), while monsters farther
away are left alone. The skill_used event lists every enemy hit so the client can spark each one.
Run: .venv/Scripts/python.exe test_skill_area.py   (or -m pytest test_skill_area.py -q)
"""

from __future__ import annotations

import asyncio
import random

import time

from game import GCD_SECS, SPLASH_DAMAGE, Game
from skills_data import CHAIN_BONUS, MELEE_SPLASH_RADIUS, SKILLS, SPLASH_RADIUS, skills_for
from test_skills import _hero, _noop_save
from websocket_manager import manager


async def run_all() -> None:
    for s in SKILLS.values():
        if s["kind"] in ("melee", "projectile", "dash"):
            assert s["splash"] == (MELEE_SPLASH_RADIUS if s["cls"] == "blade_master" else SPLASH_RADIUS), s["id"]
        if s["kind"] == "chain":
            assert s["chain"] >= 3 + CHAIN_BONUS, s["id"]
    print("ok  áreas maiores, correntes mais longas e respingo nos golpes de alvo único")

    # the warrior fights up close (the charge runs to the target first); mage and archer from afar
    for s in skills_for("blade_master"):
        if s["kind"] in ("buff", "heal"):
            continue
        assert s["kind"] in ("melee", "aoe_self", "aoe_target", "dash"), s["id"]
        if s["kind"] in ("melee", "aoe_target"):
            assert s["range"] <= 1.8, s["id"]
        if s["kind"] in ("aoe_self", "aoe_target"):
            assert s["radius"] <= 3.0, s["id"]  # the tank stands in the pack: no big areas for him
    for cls in ("grand_sorcerer", "night_ranger"):
        for s in skills_for(cls):
            if s["kind"] in ("buff", "heal", "blink"):
                continue
            assert s["kind"] != "aoe_self" and s["range"] >= 9, s["id"]
    print("ok  guerreiro só de perto; mago e arqueiro só de longe")

    random.seed(7)  # damage rolls (and critical hits) are random; fix them so the comparison is stable
    game = Game(_noop_save)
    mm = game.mobs["forest_01"]
    wolves = [m for m in mm.mobs.values() if m.mob_def_id == "wolf"][:3]
    main, near, far = wolves
    for m in wolves:
        m.hp = m.max_hp = 10 ** 6
    for m in mm.mobs.values():           # the spots are crowded now: keep the other monsters out of the way
        if m not in wolves:
            m.x, m.y = 150.0, 150.0
    main.x, main.y = 50.0, 50.0
    near.x, near.y = 51.0, 50.5          # inside the splash
    far.x, far.y = 55.0, 50.0            # outside
    hero, ws = _hero(game, "blade_master", "forest_01", 49.0, 50.0, level=30)
    melee = next(s for s in skills_for("blade_master") if s["kind"] == "melee")
    hero.mp = hero.max_mp
    manager.sessions[hero.char_id].x, manager.sessions[hero.char_id].y = 49.0, 50.0
    random.seed(7)  # again here: how many monsters the map spawned changes how many numbers were drawn before
    assert await game.use_skill(hero, melee["id"], main.instance_id, main.x, main.y) is None
    used = next(m for m in ws.sent if m["type"] == "skill_used")
    assert used["splash"] == [near.instance_id] and set(used["hits"]) == {main.instance_id, near.instance_id}
    lost_main, lost_near = main.max_hp - main.hp, near.max_hp - near.hp
    assert far.hp == far.max_hp and 0 < lost_near < lost_main
    print(f"ok  golpe de alvo único respinga no vizinho ({lost_near} de {lost_main}, ~{int(SPLASH_DAMAGE * 100)}%) e não no distante")

    # the warrior's basic attack must touch the monster: 1.4 tiles plus a small tolerance
    s = manager.sessions[hero.char_id]
    hero.cooldowns.clear()
    s.x, s.y = main.x - 2.2, main.y
    assert await game.use_skill(hero, "bm_basic", main.instance_id, None, None) == "too_far"
    s.x, s.y = main.x - 1.6, main.y
    assert await game.use_skill(hero, "bm_basic", main.instance_id, None, None) is None
    print("ok  ataque básico do guerreiro só de perto")

    # global cooldown: after a skill every other skill waits GCD_SECS, the basic attack does not
    hero.cooldowns.clear()
    hero.gcd_until = 0.0
    hero.mp = hero.max_mp
    assert await game.use_skill(hero, "bm_slash", main.instance_id, None, None) is None
    assert hero.gcd_until > time.monotonic() + GCD_SECS - 0.2
    assert await game.use_skill(hero, "bm_rend", main.instance_id, None, None) == "gcd"
    assert await game.use_skill(hero, "bm_basic", main.instance_id, None, None) is None
    hero.gcd_until = 0.0
    assert await game.use_skill(hero, "bm_rend", main.instance_id, None, None) is None
    print("ok  recarga global entre skills (o ataque básico não espera)")

    # taunt: the spin pulls the monsters onto the warrior, even ones already chasing someone else
    other, _ = _hero(game, "grand_sorcerer", "forest_01", 40.0, 50.0, level=30)
    for m in (main, near):
        m.aggro_target = other.char_id
    hero.gcd_until = 0.0
    hero.cooldowns.clear()
    s.x, s.y = main.x - 1.0, main.y  # both wolves inside the 2.5-tile spin, the far one outside
    assert await game.use_skill(hero, "bm_twisting_slash", None, None, None) is None
    assert main.aggro_target == near.aggro_target == hero.char_id and main.taunt_until > time.monotonic() + 3
    assert far.aggro_target != hero.char_id
    print("ok  Corte Giratório provoca os monstros atingidos")

    # Iron Skin: the warrior takes less damage from the same monster hit than a sorcerer with the same defense
    tank_before = hero.hp = hero.max_hp
    mage_before = other.hp = other.max_hp
    game.night = False
    other_def = other.defense
    hero_def_save = type(hero).defense
    try:
        type(hero).defense = property(lambda h: other_def)  # same armor for both: only the passive differs
        hero.stun_until = other.stun_until = 0.0
        await game.hurt_hero(hero, 10000, None, source="x", true_damage=False)
        await game.hurt_hero(other, 10000, None, source="x", true_damage=False)
    finally:
        type(hero).defense = hero_def_save
    lost_tank, lost_mage = tank_before - hero.hp, mage_before - other.hp
    assert lost_tank == 0 or lost_mage == 0 or lost_tank < lost_mage, (lost_tank, lost_mage)
    print(f"ok  Pele de Ferro reduz o dano recebido ({lost_tank} contra {lost_mage})")


if __name__ == "__main__":
    asyncio.run(run_all())


def test_skill_area() -> None:
    asyncio.run(run_all())
