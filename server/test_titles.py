"""
Titles test: one title every 100 levels up to 1000, reaching a level announces the title to everyone and
equips it, jumping several milestones at once grants each, only earned titles can be chosen (or none),
and the title travels with chat messages and to the other players on the map.
Run: .venv/Scripts/python.exe test_titles.py   (or -m pytest test_titles.py -q)
"""

from __future__ import annotations

import asyncio

import titles
from game import Game
from test_skills import _hero, _noop_save
from websocket_manager import manager
from world_data import exp_to_next, meta


async def run_all() -> None:
    assert [t[0] for t in titles.TITLES] == list(range(100, 1001, 100))
    assert titles.best(99) == "" and titles.best(100) == "desbravador" and titles.best(1000) == "eterno"
    assert len([t for t in meta()["titles"] if not t.get("pass")]) == 10  # level titles (the season pass adds its own)
    print("ok  10 títulos, do nível 100 ao 1000")

    game = Game(_noop_save)
    hero, ws = _hero(game, "blade_master", "town_01", 20, 20, level=99)
    other, wo = _hero(game, "night_ranger", "town_01", 22, 20, level=5)
    hero.name = "Arn"
    hero.exp = 0
    await game.add_exp(hero, exp_to_next(99))
    assert hero.level == 100 and hero.title == "desbravador"
    assert any(m["type"] == "chat" and "conquistou o título Desbravador" in m["text"] for m in wo.sent)
    assert any(m["type"] == "title" and m["char_id"] == hero.char_id for m in wo.sent)
    assert manager.sessions[hero.char_id].info["title"] == "desbravador"
    print("ok  nível 100: título anunciado para todos e equipado")

    # several milestones in one go (e.g. a big quest reward at 199 → 301)
    hero.level, hero.exp = 199, 0
    wo.sent.clear()
    await game.add_exp(hero, sum(exp_to_next(lv) for lv in range(199, 301)))
    assert hero.level == 301 and hero.title == "campeao"
    got = [m["text"] for m in wo.sent if m["type"] == "chat"]
    assert len(got) == 2 and "Veterano" in got[0] and "Campeão" in got[1]
    print("ok  pular vários marcos dá cada título")

    assert await game.set_title(hero, "veterano") is None and hero.title == "veterano"
    assert await game.set_title(hero, "") is None and hero.title == ""
    assert await game.set_title(hero, "eterno")  # not earned yet
    assert await game.set_title(other, "desbravador")
    await game.set_title(hero, "campeao")
    await game.chat(hero, "map", "olá")
    assert next(m for m in wo.sent if m["type"] == "chat" and m.get("text") == "olá")["title"] == "campeao"
    print("ok  escolher título (só os conquistados) e título no chat")


if __name__ == "__main__":
    asyncio.run(run_all())


def test_titles() -> None:
    asyncio.run(run_all())
