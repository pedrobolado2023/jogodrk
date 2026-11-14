"""
Skill area test: areas and lines are bigger, chains reach more enemies, and single-target attacks splash
onto monsters right next to the target for less damage (without stuns/poisons), while monsters farther
away are left alone. The skill_used event lists every enemy hit so the client can spark each one.
Run: .venv/Scripts/python.exe test_skill_area.py   (or -m pytest test_skill_area.py -q)
"""

from __future__ import annotations

import asyncio
import random

from game import SPLASH_DAMAGE, Game
from skills_data import CHAIN_BONUS, SKILLS, SPLASH_RADIUS, skills_for
from test_skills import _hero, _noop_save
from websocket_manager import manager


async def run_all() -> None:
    for s in SKILLS.values():
        if s["kind"] in ("melee", "projectile", "dash"):
            assert s["splash"] == SPLASH_RADIUS, s["id"]
        if s["kind"] == "chain":
            assert s["chain"] >= 3 + CHAIN_BONUS, s["id"]
    print("ok  áreas maiores, correntes mais longas e respingo nos golpes de alvo único")

    # the warrior fights up close (the charge runs to the target first); mage and archer from afar
    for s in skills_for("blade_master"):
        if s["kind"] in ("buff", "heal"):
            continue
        assert s["kind"] in ("melee", "aoe_self", "aoe_target", "dash"), s["id"]
        if s["kind"] in ("melee", "aoe_target"):
            assert s["range"] <= 2.5, s["id"]
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
    main.x, main.y = 50.0, 50.0
    near.x, near.y = 51.0, 50.5          # inside the splash
    far.x, far.y = 55.0, 50.0            # outside
    hero, ws = _hero(game, "blade_master", "forest_01", 49.0, 50.0, level=30)
    melee = next(s for s in skills_for("blade_master") if s["kind"] == "melee")
    hero.mp = hero.max_mp
    manager.sessions[hero.char_id].x, manager.sessions[hero.char_id].y = 49.0, 50.0
    assert await game.use_skill(hero, melee["id"], main.instance_id, main.x, main.y) is None
    used = next(m for m in ws.sent if m["type"] == "skill_used")
    assert used["splash"] == [near.instance_id] and set(used["hits"]) == {main.instance_id, near.instance_id}
    lost_main, lost_near = main.max_hp - main.hp, near.max_hp - near.hp
    assert far.hp == far.max_hp and 0 < lost_near < lost_main
    print(f"ok  golpe de alvo único respinga no vizinho ({lost_near} de {lost_main}, ~{int(SPLASH_DAMAGE * 100)}%) e não no distante")


if __name__ == "__main__":
    asyncio.run(run_all())


def test_skill_area() -> None:
    asyncio.run(run_all())
