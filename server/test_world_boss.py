"""
World boss test: the 3-a-day schedule, the room opens only during the event and has no PvP, the boss's
health multiplies by the number of players who entered (10 players → 10×, never shrinking), the
deadly area skill kills only those still inside it (with KILL_CHANCE), the other skills hurt by % of
max HP, dying in the room costs nothing, and the top 3 in damage plus the last hit get the prizes.
Run: .venv/Scripts/python.exe test_world_boss.py   (or -m pytest test_world_boss.py -q)
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime

import world_boss as wb
from game import Game
from test_skills import _hero, _noop_save
from websocket_manager import manager
from world_data import MAPS


def place(h, x: float, y: float) -> None:
    s = manager.sessions[h.char_id]
    s.x, s.y = x, y


async def run_all() -> None:
    # schedule: three slots a day, one boss each
    assert wb.EVENT_TIMES == [(10, 0), (16, 0), (22, 0)]
    assert wb.next_slot(datetime(2026, 1, 1, 9, 30)) == (datetime(2026, 1, 1, 10, 0), 0)
    assert wb.next_slot(datetime(2026, 1, 1, 10, 0, 30))[1] == 0
    assert wb.next_slot(datetime(2026, 1, 1, 12, 0)) == (datetime(2026, 1, 1, 16, 0), 1)
    assert wb.next_slot(datetime(2026, 1, 1, 20, 0)) == (datetime(2026, 1, 1, 22, 0), 2)
    assert wb.next_slot(datetime(2026, 1, 1, 23, 0)) == (datetime(2026, 1, 2, 10, 0), 0)
    assert len(wb.BOSSES) == 3 == len(wb.EVENT_TIMES)
    for b in wb.BOSSES:
        assert sum(s["kind"] == "deadly" for s in b["skills"]) == 1, b["id"]  # exactly one hit-kill skill
    assert [b["level"] for b in wb.BOSSES] == [50, 70, 100]
    assert wb.BOSSES[0]["hp"] < wb.BOSSES[1]["hp"] < wb.BOSSES[2]["hp"] and wb.BOSSES[0]["hp"] > 500_000
    print("ok  3 bosses (nível 50, 70, 100), 3 horários por dia, uma skill mortal por boss")

    game = Game(_noop_save)
    heroes = [_hero(game, cls, "town_01", 20, 30, level=20)[0] for cls in ("blade_master", "grand_sorcerer", "night_ranger")]
    extra = [_hero(game, "blade_master", f"town_{i}", 20, 30, level=20)[0] for i in range(7)]
    for i, h in enumerate(extra):  # distinct heroes in town for the 10-player check
        h.map_id = "town_01"
        manager.sessions[h.char_id].map_id = "town_01"
    a, b, c = heroes
    portal = next(p for p in MAPS["town_01"]["portals"] if p.get("event"))
    assert not game.portal_open(a, portal)
    assert "Próximo" in await game.wb.join(game, a)
    print("ok  sala fechada fora do horário")

    await game.wb.start(game, wb.BOSSES[0])
    boss = game.wb.boss_mob(game)
    base = wb.BOSSES[0]["hp"]
    assert game.portal_open(a, portal) and boss.max_hp == base
    for h in heroes:
        assert await game.wb.join(game, h) is None and h.map_id == wb.EVENT_MAP
    assert boss.max_hp == base * 3 and boss.hp == base * 3
    boss.hp = boss.max_hp // 2
    for h in extra:
        await game.wb.join(game, h)
    assert len(game.wb.participants) == 10 and boss.max_hp == base * 10 and boss.hp == base * 5
    await game.change_map(extra[0], "town_01", 20, 30)  # leaving does not shrink the boss
    assert boss.max_hp == base * 10
    print("ok  vida do boss multiplica pelos jogadores (10 → 10×) e não diminui")

    # no PvP in the room, even aimed on purpose
    for i, h in enumerate(heroes):
        place(h, 10 + i, 20)
    a.cooldowns.clear()
    assert await game.use_skill(a, "bm_slash", b.char_id, None, None) == "no_target" and b.hp == b.max_hp
    print("ok  sem PvP na sala do evento")

    # deadly skill: only who is inside the circle, with KILL_CHANCE
    deadly = next(s for s in wb.BOSSES[0]["skills"] if s["kind"] == "deadly")
    for h in heroes:
        h.hp = h.max_hp
    place(a, 10, 20)
    place(b, 11, 20)
    place(c, 25, 5)          # ran away
    circle = {"skill": deadly, "circles": [[10.0, 20.0, deadly["radius"]]], "at": 0, "mob_id": boss.instance_id}
    old = wb.KILL_CHANCE
    try:
        wb.KILL_CHANCE = 1.0
        await game.wb.land(game, circle)
        assert a.is_dead and b.is_dead and not c.is_dead and c.hp == c.max_hp
        wb.KILL_CHANCE = 0.0
        a.is_dead = b.is_dead = False
        a.hp, b.hp = a.max_hp, b.max_hp
        await game.wb.land(game, circle)
        assert not a.is_dead and a.hp == a.max_hp - int(a.max_hp * deadly["damage"])
    finally:
        wb.KILL_CHANCE = old
    print("ok  golpe mortal em área: mata só quem fica dentro (10%), quem saiu não sofre nada")

    # other skills hurt by % of max HP, ignoring defense
    roar = next(s for s in wb.BOSSES[0]["skills"] if s["kind"] == "all")
    c.hp = c.max_hp
    await game.wb.land(game, {"skill": roar, "circles": [], "at": 0, "mob_id": boss.instance_id})
    assert c.hp == c.max_hp - int(c.max_hp * roar["damage"])
    print("ok  skills de dano tiram % da vida de todos")

    # dying costs nothing: back on your feet at the room entrance with your gear
    a.hp = 1
    a.gear = {"weapon": "sword_t2"}
    await game.wb.land(game, {"skill": roar, "circles": [], "at": 0, "mob_id": boss.instance_id})
    assert a.is_dead and a.gear == {"weapon": "sword_t2"} and a.red_left == 0
    a.respawn_at = 0
    await game.tick(0.1, 1)
    assert not a.is_dead and a.map_id == wb.EVENT_MAP and a.hp == a.max_hp
    print("ok  morrer no evento não tem perda: renasce na entrada da sala")

    # rewards: top 3 in damage and the last hit
    for h in heroes + extra:
        h.is_dead, h.hp = False, h.max_hp
    boss.damage_by.clear()
    boss.damage_by.update({b.char_id: 9000, c.char_id: 7000, extra[1].char_id: 5000, extra[2].char_id: 100})
    gold = {h.char_id: h.gold for h in heroes + extra}
    boss.hp = 1
    await game.hurt_mob(a, boss.instance_id, 50)          # a lands the last hit with little damage
    assert game.wb.state == "over" and boss.is_dead
    gain = {cid: game.heroes[cid].gold - g for cid, g in gold.items()}
    R = wb.REWARDS
    assert gain[b.char_id] == R["all"]["gold"] + R["1"]["gold"]
    assert gain[c.char_id] == R["all"]["gold"] + R["2"]["gold"]
    assert gain[extra[1].char_id] == R["all"]["gold"] + R["3"]["gold"]
    assert gain[a.char_id] == R["all"]["gold"] + R["last"]["gold"]
    assert gain[extra[2].char_id] == R["all"]["gold"]
    assert gain[extra[3].char_id] == 0  # entered but never hit the boss
    result = next(m for m in manager.sessions[b.char_id].ws.sent if m["type"] == "wb_result")
    assert result["places"] == ["1º lugar em dano"] and result["last_hit"] == a.name and result["top"][0]["name"] == b.name
    print("ok  prêmios: top 3 de dano + último golpe + participação")

    # after the results everyone goes back to town and the boss is gone
    game.wb.ends_at = time.monotonic() - 1
    await game.wb.tick_schedule(game)
    assert game.wb.state == "idle" and not game.mobs[wb.EVENT_MAP].mobs
    assert all(h.map_id == "town_01" for h in heroes)
    print("ok  depois do resultado todos voltam para a vila")

    # the boss stays in its arena: it chases someone standing at the entrance but stops at its tether,
    # keeping its target and the damage ranking (whoever gets back up at the entrance is out of its reach)
    await game.wb.start(game, wb.BOSSES[1])
    boss = game.wb.boss_mob(game)
    boss.aggro_target, boss.damage_by = "far_one", {"far_one": 123}
    spawn = MAPS[wb.EVENT_MAP]["spawn"]
    for _ in range(200):
        game.mobs[wb.EVENT_MAP].tick({"far_one": spawn}, 0.1)
    d = ((boss.x - wb.BOSS_POS[0]) ** 2 + (boss.y - wb.BOSS_POS[1]) ** 2) ** 0.5
    assert d <= wb.BOSS_TETHER + 0.3 and boss.aggro_target == "far_one" and boss.damage_by == {"far_one": 123}, d
    await game.wb.close(game)
    print("ok  o boss não sai da arena (não acampa na entrada onde se renasce)")

    # a boss nobody defeats leaves when time is up
    await game.wb.start(game, wb.BOSSES[2])
    game.wb.ends_at = time.monotonic() - 1
    await game.wb.tick_schedule(game)
    assert game.wb.state == "idle"
    print("ok  boss vai embora se o tempo acabar")


if __name__ == "__main__":
    asyncio.run(run_all())


def test_world_boss() -> None:
    asyncio.run(run_all())
