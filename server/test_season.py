"""
Season pass test: pass XP from monsters (with the daily cap), daily missions, story quests and the Global Boss;
50 levels; free rewards for everybody, Premium rewards only with Premium and only looks (titles, auras,
potions — never gear, stones or gold); cosmetics stay owned and can be worn; a new season starts a new pass.
Run: .venv/Scripts/python.exe test_season.py   (or -m pytest test_season.py -q)
"""

from __future__ import annotations

import asyncio

import items as inv
import season as ssn
from game import Game
from test_skills import _hero, _noop_save


async def run_all() -> None:
    # the table: 50 levels, Premium never gives power
    assert ssn.MAX_LEVEL == 50
    for lv in range(1, ssn.MAX_LEVEL + 1):
        for r in ssn.rewards(lv, "prem"):
            assert "gold" not in r, lv
            if "item" in r:
                assert inv.ITEMS[r["item"]]["type"] == "potion", (lv, r)
        assert ssn.rewards(lv, "free")
    prem_looks = [r for lv in range(1, 51) for r in ssn.rewards(lv, "prem") if "title" in r or "aura" in r]
    assert len(prem_looks) >= 8
    print("ok  50 níveis; o Premium só dá visual (títulos, auras) e poções — nada de poder")

    game = Game(_noop_save)
    h = _hero(game, "night_ranger", "forest_01", 10, 10, level=30)[0]
    st = game.season_state(h)
    assert st["xp"] == 0 and not st["premium"]

    # monsters give pass XP up to the daily cap
    for _ in range(10):
        await game.quest_kill(h, "wolf")
    assert st["xp"] == 10 * ssn.KILL_XP
    st["kxp"] = ssn.KILL_XP_DAY_CAP - 1
    await game.quest_kill(h, "wolf")
    await game.quest_kill(h, "wolf")
    assert st["xp"] == 10 * ssn.KILL_XP + 1 and st["kxp"] == ssn.KILL_XP_DAY_CAP
    st["kday"] = "2000-01-01"   # a new day: monsters count again
    await game.quest_kill(h, "wolf")
    assert st["xp"] == 10 * ssn.KILL_XP + 1 + ssn.KILL_XP
    print("ok  monstros dão XP do passe até o limite do dia")

    # story quests and the Global Boss
    xp0 = st["xp"]
    h.story = {"q": 0, "st": "ready", "n": 0}
    await game.dialog_option(h, "turnin")
    assert st["xp"] == xp0 + ssn.QUEST_XP
    await game.wb.give(game, h, ["all", "1", "last"])
    assert st["xp"] == xp0 + ssn.QUEST_XP + ssn.WB_JOIN_XP + 2 * ssn.WB_PLACE_XP
    print("ok  missão da história e Boss Global dão XP do passe")

    # claiming: only reached levels, Premium only with Premium, once each
    st["xp"] = 10 * ssn.XP_PER_LEVEL + 5
    assert ssn.level_of(st["xp"]) == 10
    assert "nível 11" in await game.pass_claim(h, "free", 11)
    assert "Premium" in await game.pass_claim(h, "prem", 10)
    gold0 = h.gold
    assert await game.pass_claim(h, "free", 1) is None and h.gold == gold0 + ssn.rewards(1, "free")[0]["gold"]
    assert "já pegou" in await game.pass_claim(h, "free", 1)
    h.bag = []
    assert await game.pass_claim_all(h) is None
    assert st["free"] == list(range(1, 11)) and st["prem"] == []
    assert inv.count(h.bag, "stone_up_1") == 5 and inv.count(h.bag, "pot_hp_l") == 10
    print("ok  recompensas grátis por nível; Premium bloqueado sem o passe; cada uma só uma vez")

    # Premium: looks are kept, the title can be worn, the aura shows
    st["premium"] = True
    assert await game.pass_claim_all(h) is None
    c = h.cosmetics
    assert "s1_brasa" in c["titles"] and "aura_brasa" in c["auras"] and st["prem"] == list(range(1, 11))
    assert await game.set_title(h, "s1_brasa") is None and h.title == "s1_brasa"
    assert "ainda não tem" in await game.set_aura(h, "aura_fenix")
    assert await game.set_aura(h, "aura_brasa") is None and h.cosmetics["aura"] == "aura_brasa"
    assert h.public()["cosmetics"]["aura"] == "aura_brasa"
    print("ok  Premium: títulos e auras ficam com o herói e podem ser usados")

    # level 50 is the end of the track
    st["xp"] = 10 ** 7
    assert ssn.level_of(st["xp"]) == 50 and ssn.add_xp(st, 100) == 0
    # a new season: a new, empty pass — the cosmetics stay
    st["id"] = "s0"
    st2 = game.season_state(h)
    assert st2["id"] == ssn.SEASON["id"] and st2["xp"] == 0 and not st2["premium"] and st2["free"] == []
    assert "s1_brasa" in h.cosmetics["titles"]
    print("ok  nível 50 é o fim; temporada nova zera o passe e mantém os visuais")


if __name__ == "__main__":
    asyncio.run(run_all())


def test_season() -> None:
    asyncio.run(run_all())
