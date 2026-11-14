"""
PK test: area damage never hits innocents, attacking an innocent flags the attacker, fighting back is
free, killing an innocent turns the killer red, NPCs refuse reds, killing a red pays a bounty and can
take its gear, the red time counts down, and the arena stays penalty-free.
Run: .venv/Scripts/python.exe test_pk.py   (or -m pytest test_pk.py -q)
"""

from __future__ import annotations

import asyncio

import items as inv
import pk_system as pk
from game import Game, Hero
from test_skills import FakeWS, _hero, _noop_save
from websocket_manager import manager
from world_data import MAPS


def _place(h: Hero, x: float, y: float) -> None:
    s = manager.sessions[h.char_id]
    s.x, s.y = x, y


async def _hit(game: Game, attacker: Hero, sid: str, target: Hero | None) -> str | None:
    attacker.cooldowns.clear()
    attacker.mp = attacker.max_mp
    if target:
        return await game.use_skill(attacker, sid, target.char_id, None, None)
    s = manager.sessions[attacker.char_id]  # area skills without a target are aimed at the caster's own spot
    return await game.use_skill(attacker, sid, None, s.x, s.y)


async def run_all() -> None:
    game = Game(_noop_save)
    a, aws = _hero(game, "blade_master", "forest_01", 150, 150)
    b, _ = _hero(game, "night_ranger", "forest_01", 151, 150)
    c, _ = _hero(game, "grand_sorcerer", "forest_01", 150, 151)

    # area damage never touches innocents
    assert await _hit(game, a, "bm_twisting_slash", None) is None
    assert b.hp == b.max_hp and c.hp == c.max_hp and a.pk_status() == "white"
    print("ok  golpe em área não acerta inocentes")

    # attacking an innocent on purpose flags the attacker, and the map is told
    aws.sent.clear()
    assert await _hit(game, a, "bm_slash", b) is None
    assert b.hp < b.max_hp and a.pk_status() == "aggressor"
    assert any(m["type"] == "pk_status" and m["status"] == "aggressor" for m in aws.sent)
    print("ok  atacar inocente de propósito deixa Agressor")

    # fighting back is free, and an aggressor is hit by area damage
    assert await _hit(game, b, first_target_skill("night_ranger"), a) is None
    assert b.pk_status() == "white"
    hp = a.hp
    assert await _hit(game, c, first_aoe_skill("grand_sorcerer"), None) is None
    assert a.hp < hp and c.pk_status() == "white"
    print("ok  revidar contra Agressor não pune, e golpe em área acerta o Agressor")

    # killing an innocent makes the killer red
    a.stun_until = 0.0  # the sorcerer's area spell may have frozen the aggressor
    b.hp = 1
    assert await _hit(game, a, "bm_slash", b) is None
    assert b.is_dead and a.pk_status() == "red" and a.red_left == pk.RED_PER_KILL and a.pk_kills == 1
    print("ok  matar inocente deixa Assassino (nome vermelho)")

    # town NPCs and shops refuse reds
    town = MAPS["town_01"]
    merchant = next(n for n in town["npcs"] if n["id"] == "merchant")
    a.map_id = "town_01"
    manager.sessions[a.char_id].map_id = "town_01"
    _place(a, merchant["x"] + 1, merchant["y"])
    aws.sent.clear()
    await game.talk(a, "merchant")
    dialog = next(m for m in aws.sent if m["type"] == "dialog")
    assert dialog["options"] == [] and "assassino" in dialog["lines"][0].lower()
    a.gold = 999
    await game.dialog_option(a, "shop:merchant")
    assert a.shop is None and await game.buy(a, "pot_hp_s", 1) == "Os mercadores não atendem assassinos."
    print("ok  NPCs e lojas recusam assassinos")

    # killing a red pays a bounty and may take its gear
    a.map_id = "forest_01"
    manager.sessions[a.char_id].map_id = "forest_01"
    _place(a, 150, 150)
    a.gear = {"weapon": "sword_t2", "armor": "plate_t2"}
    a.hp = 1
    exp_before, lvl_before = c.exp, c.level
    old_drop, pk.RED_GEAR_DROP = pk.RED_GEAR_DROP, 1.0
    try:
        assert await _hit(game, c, first_target_skill("grand_sorcerer"), a) is None
    finally:
        pk.RED_GEAR_DROP = old_drop
    assert a.is_dead and a.gear == {} and c.pk_status() == "white"
    assert inv.count(c.bag, "sword_t2") == 1 and inv.count(c.bag, "plate_t2") == 1
    assert (c.level, c.exp) != (lvl_before, exp_before)
    print("ok  matar Assassino dá recompensa e pode tomar o equipamento dele")

    # the red time counts down while online (once per second of game ticks)
    a.is_dead, a.hp = False, a.max_hp
    left = a.red_left
    await game.tick(0.1, 10)
    assert a.red_left == left - 1
    a.red_left = 0.5
    await game.tick(0.1, 20)
    assert a.pk_status() == "white"
    print("ok  tempo de Assassino diminui e o nome volta ao normal")

    # the arena never flags
    x, _ = _hero(game, "blade_master", "arena_01", 15, 15)
    y, _ = _hero(game, "night_ranger", "arena_01", 16, 15)
    y.hp = 1
    assert await _hit(game, x, "bm_slash", y) is None
    assert y.is_dead and x.pk_status() == "white" and x.red_left == 0
    print("ok  arena continua sem punição")


def first_target_skill(cls: str) -> str:
    from skills_data import skills_for
    return next(s["id"] for s in skills_for(cls) if s["kind"] in ("melee", "projectile") and s["lvl"] <= 12)


def first_aoe_skill(cls: str) -> str:
    from skills_data import skills_for
    return next(s["id"] for s in skills_for(cls) if s["kind"] in ("aoe_self", "aoe_target") and s["lvl"] <= 12)


if __name__ == "__main__":
    asyncio.run(run_all())


def test_pk() -> None:
    asyncio.run(run_all())
