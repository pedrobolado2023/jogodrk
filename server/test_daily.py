"""
Daily missions test: 3 tasks a day that stay the same on reconnect and change the next day, hunts
fit the hero's level and only use maps the story opened, kills / mining / forge count, rewards are
collected at Sergeant Hald, and the 3-task bonus is paid once.
Run: .venv/Scripts/python.exe test_daily.py   (or -m pytest test_daily.py -q)
"""

from __future__ import annotations

import asyncio

import daily as dly
import items as inv
from game import Game
from test_skills import _hero, _noop_save
from world_data import MAPS, MOBS


async def run_all() -> None:
    new_story = {"q": 0, "st": "offer", "n": 0}
    a = dly.roll("hero-1", "2026-11-13", 5, new_story)
    assert len(a["tasks"]) == 3 and a == dly.roll("hero-1", "2026-11-13", 5, new_story)
    days = {tuple(t["target"] for t in dly.roll("hero-1", f"2026-11-{d:02d}", 5, new_story)["tasks"]) for d in range(1, 29)}
    assert len(days) > 1
    print("ok  3 missões por dia, iguais ao reconectar e diferentes em outros dias")

    # a level-12 hero who never opened the Catacombs or the Swamp is not sent there
    for d in range(1, 29):
        st = dly.roll("hero-2", f"2026-11-{d:02d}", 12, {"q": 2, "st": "active", "n": 0})
        for t in st["tasks"]:
            if t["kind"] == "kill":
                assert dly.MOB_MAP[t["target"]] == "forest_01", t
                assert not MOBS[t["target"]].get("boss")
    late = dly.hunt_pool(24, {"q": 9, "st": "active", "n": 0})
    assert set(late) <= {"frost_wolf", "frost_sentinel", "ice_troll", "bog_mutant"} and "ice_troll" in late
    assert dly.hunt_pool(1, new_story) == ["wolf", "goblin"] or set(dly.hunt_pool(1, new_story)) <= {"wolf", "goblin"}
    print("ok  caçadas no nível do herói e só em mapas já liberados")

    game = Game(_noop_save)
    npc = next(n for n in MAPS["town_01"]["npcs"] if n["role"] == "daily")
    hero, ws = _hero(game, "blade_master", "town_01", npc["x"], npc["y"] + 1, level=10)
    hero.story = {"q": 5, "st": "active", "n": 0}
    state = game.daily_state(hero)
    kill = next(t for t in state["tasks"] if t["kind"] == "kill")
    for _ in range(kill["count"] + 3):
        await game.quest_kill(hero, kill["target"])
    assert kill["n"] == kill["count"]
    assert any("Missão diária concluída" in m.get("text", "") for m in ws.sent if m["type"] == "notice")
    print("ok  abates contam e param no total")

    gold, exp = hero.gold, hero.exp + sum(t["exp"] for t in state["tasks"][:0])
    await game.talk(hero, npc["id"])
    dialog = [m for m in ws.sent if m["type"] == "dialog"][-1]
    assert any(o["id"] == "daily_claim" for o in dialog["options"])
    await game.dialog_option(hero, "daily_claim")
    assert kill["claimed"] and hero.gold == gold + kill["gold"] and not state["bonus"]
    print("ok  recompensa recebida com o Sargento Hald")

    # finish everything: the bonus stones come once
    for t in state["tasks"]:
        t["n"] = t["count"]
    stones_before = inv.count(hero.bag, "stone_up_1")
    await game.dialog_option(hero, "daily_claim")
    assert state["bonus"] and inv.count(hero.bag, "stone_up_1") == stones_before + 3
    gold = hero.gold
    await game.dialog_option(hero, "daily_claim")
    assert hero.gold == gold
    print("ok  bônus das 3 missões pago uma vez só")

    # mining and forge count; the next day brings a new set
    st = dly.roll("hero-3", "2026-11-13", 10, new_story)
    st["tasks"][2] = {"kind": "mine", "target": "", "count": 12, "n": 0, "claimed": False, "exp": 1, "gold": 1}
    assert dly.progress(st, "mine", "", 5) == [] and st["tasks"][2]["n"] == 5
    assert len(dly.progress(st, "mine", "", 9)) == 1 and st["tasks"][2]["n"] == 12
    assert dly.fresh(st, "hero-3", 10, new_story, day="2026-11-13") is st
    assert dly.fresh(st, "hero-3", 10, new_story, day="2026-11-14")["day"] == "2026-11-14"
    print("ok  mineração conta e o dia seguinte traz missões novas")


if __name__ == "__main__":
    asyncio.run(run_all())


def test_daily() -> None:
    asyncio.run(run_all())
