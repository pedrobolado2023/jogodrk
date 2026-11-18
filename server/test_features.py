"""
First steps, login calendar, achievements, weekly counters, night, town invasion, duels and the Arena tournament.
Run: .venv/Scripts/python.exe test_features.py
"""

from __future__ import annotations

import asyncio
import time

import daynight
import duel as dm
import invasion as invm
import progress as prog
from game import Game, Hero
from test_skills import FakeWS, _noop_save
from websocket_manager import PlayerSession, manager
from world_data import MAPS, MOBS, SPAWNS


def mk(game: Game, name: str, map_id: str, x: float, y: float, level: int = 30, cls: str = "blade_master") -> tuple[Hero, FakeWS]:
    manager.batch = False
    ws = FakeWS()
    cid = f"t_{name}"
    manager.sessions[cid] = PlayerSession(ws=ws, char_id=cid, char_name=name, map_id=map_id, x=x, y=y)
    manager.get_grid(map_id).add(cid, x, y)
    h = Hero(char_id=cid, name=name, cls=cls, level=level, exp=0, gold=0, story={"q": 0, "st": "offer", "n": 0}, map_id=map_id)
    h.refresh_passives()
    h.hp, h.mp = h.max_hp, h.max_mp
    game.heroes[cid] = h
    return h, ws


def got(ws: FakeWS, kind: str) -> list[dict]:
    return [m for m in ws.sent if m.get("type") == kind]


async def run_all() -> None:
    game = Game(_noop_save)

    # ── first steps ──
    new, ws = mk(game, "Novato", "town_01", 20, 25, level=1)
    await game.join_progress(new)
    assert got(ws, "tutorial")[-1]["step"] == 1
    await game.track(new, "move", amount=8.5)
    assert got(ws, "tutorial")[-1]["step"] == 2 and new.gold == 200
    await game.track(new, "talk", "healer")          # the wrong NPC does not count
    assert got(ws, "tutorial")[-1]["step"] == 2
    await game.track(new, "talk", "elder")
    for _ in range(3):
        await game.track(new, "kill", "wolf")
    await game.track(new, "skill", "x")
    assert got(ws, "tutorial")[-1]["step"] == 5
    new.level = 5
    await game.track(new, "level", value=5)
    last = got(ws, "tutorial")[-1]
    assert last["done"] and last["gift"] and new.boosts.get("exp", 0) > time.time()
    vet, _ = mk(game, "Veterano", "town_01", 20, 25, level=40)
    prog.tutorial(vet.progress, vet.level, 0)
    assert prog.tutorial_public(vet.progress)["done"]
    print("ok  primeiros passos, presente no fim e veteranos pulam")

    # ── login calendar ──
    gold0 = vet.gold
    assert await game.login_claim(vet) is None and vet.gold > gold0
    assert await game.login_claim(vet) is not None          # once a day
    lg = prog.login(vet.progress)
    assert lg["day"] == 1 and lg["total"] == 1
    lg["last"] = "2000-01-01"
    for _ in range(6):
        lg["last"] = "2000-01-01"
        assert await game.login_claim(vet) is None
    assert prog.LOGIN_TITLE in vet.cosmetics["titles"] and vet.gems >= 50 and lg["day"] == 0
    print("ok  calendário: um presente por dia, 7º dia com título e gemas")

    # ── achievements and the week ──
    hunter, hws = mk(game, "Caçador", "forest_01", 30, 50)
    for _ in range(100):
        await game.track(hunter, "kill", "wolf")
    assert "kill_100" in prog.ach(hunter.progress)["got"] and got(hws, "achievement")[-1]["id"] == "kill_100"
    boss = next(k for k, v in MOBS.items() if v.get("boss"))
    await game.track(hunter, "kill", boss)
    assert "boss_1" in prog.ach(hunter.progress)["got"]
    assert prog.week(hunter.progress)["kills"] == 101
    await game.track(hunter, "level", value=60)
    assert "level_50" in prog.ach(hunter.progress)["got"]
    n = len(got(hws, "achievement"))
    await game.track(hunter, "level", value=61)
    assert len(got(hws, "achievement")) == n                 # never twice
    print("ok  conquistas e contadores da semana")

    # ── night ──
    night_t = daynight.CYCLE * 1000 + daynight.CYCLE - 60
    assert daynight.is_night(night_t) and not daynight.is_night(daynight.CYCLE * 1000 + 10)
    wolf = next(m for m in game.mobs["forest_01"].mobs.values() if m.mob_def_id == "wolf")
    for night in (False, True):
        game.night = night
        hunter.exp = 0
        hunter.gold = 0
        await game.on_mob_killed(hunter, {"def_id": "wolf", "exp": 100, "gold": 100, "mob_id": wolf.instance_id, "level": 2}, [hunter.char_id])
        if not night:
            day_gold = hunter.gold
    assert hunter.gold == int(day_gold * daynight.NIGHT_REWARD)
    game.night = False
    print("ok  noite: prêmios 50% maiores")

    # ── town invasion ──
    d1, w1 = mk(game, "Defensor", "town_01", 20, 21, level=40)
    d2, _ = mk(game, "Outro", "town_01", 21, 21, level=40, cls="night_ranger")
    assert await game.inv.start(game) is None and not MAPS["town_01"]["safe"]
    assert game.inv.wave == 1 and game.inv.alive
    assert all(e[0] == "mob" for e in game.enemies(d1, d2.char_id))       # still no PvP in town
    some = next(iter(game.inv.alive))
    await game.hurt_hero(d2, 10 ** 12, None, source=some)                 # an invader's hit is capped
    assert d2.hp >= d2.max_hp * (1 - invm.MAX_HIT) - 1 and not d2.is_dead
    for wave in range(invm.WAVES):
        for mid in list(game.inv.alive):
            res = game.mobs["town_01"].damage_mob(mid, 10 ** 15, d1.char_id)
            contributors = res.pop("contributors")
            await game.on_mob_killed(d1, res, contributors)
        await game.inv.tick(game)
    assert game.inv.state == "idle" and MAPS["town_01"]["safe"]
    assert "inv_1" in prog.ach(d1.progress)["got"] and d1.gold > 0
    assert d1.story.get("n", 0) == 0                          # invaders never count for quests
    print("ok  invasão: 3 ondas, vila volta a ser segura, defensores premiados")

    # ── duels ──
    a, aw = mk(game, "Duelista", "forest_01", 60, 60, level=50)
    b, bw = mk(game, "Rival", "forest_01", 61, 60, level=50, cls="grand_sorcerer")
    assert await game.duels.invite(game, a, b.char_id) is None
    assert got(bw, "dialog")[-1]["options"][0]["id"] == "duel_accept"
    await game.dialog_option(b, "duel_accept")
    assert game.duels.dueling(a.char_id, b.char_id)
    assert any(e[1] == b.char_id for e in game.enemies(a))
    await game.hurt_hero(b, b.hp * 10, a)                     # the knockout hit
    assert not b.is_dead and b.hp == b.max_hp and not game.duels.partner(a.char_id)
    assert a.pk_status() == "white" and got(aw, "duel")[-1]["winner"] == a.char_id
    assert prog.ach(a.progress)["c"].get("duel_win") == 1
    assert await game.duels.invite(game, d1, d2.char_id) is not None  # not in town
    print("ok  duelo: ninguém morre, sem status de assassino, vitória contada")

    # ── tournament ──
    k1, _ = mk(game, "Gladiador", "arena_01", 15, 15, level=50)
    k2, _ = mk(game, "Vitima", "arena_01", 16, 15, level=50, cls="night_ranger")
    await game.tourney.start(game, minutes=1)
    for _ in range(3):
        k2.is_dead, k2.hp = False, k2.max_hp
        await game.hurt_hero(k2, k2.hp * 10, k1)
    assert game.tourney.rows()[0]["kills"] == 3
    gems0 = k1.gems
    await game.tourney.finish(game)
    assert k1.gems == gems0 + 100 + 50 and "campeao_torneio" in k1.cosmetics["titles"]  # prize + the podium achievement
    assert "tourney_1" in prog.ach(k1.progress)["got"]
    assert dm.next_tourney(dm.dt.datetime(2026, 11, 17, 12, 0, tzinfo=prog.BR)).weekday() == dm.TOURNEY_DAY
    print("ok  torneio: pontos na Arena, top 3 premiado com título")

    # ── prizes for someone offline ──
    await game.give_prize("t_ausente", [{"gems": 30}], "Ranking semanal de PvP: 3º lugar")
    assert game.pending_prizes["t_ausente"]
    late, lws = mk(game, "ausente", "town_01", 20, 25, level=30)
    await game.join_progress(late)
    assert late.gems == 30 and "t_ausente" not in game.pending_prizes
    print("ok  prêmio de quem estava offline chega quando ele entra")


if __name__ == "__main__":
    asyncio.run(run_all())
    print("tudo certo")
