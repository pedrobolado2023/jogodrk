"""
Other players' life for the Unreal client: once a second, players who can see a hero get "player_hp" when its life
changed (healing, potions and regeneration included), never twice for the same value, and far players get nothing.
Run: .venv/Scripts/python.exe test_player_hp.py   (or -m pytest test_player_hp.py -q)
"""

from __future__ import annotations

import asyncio

from game import Game
from test_skills import _hero, _noop_save


def hp_msgs(ws, cid: str) -> list[dict]:
    return [m for m in ws.sent if m["type"] == "player_hp" and m["char_id"] == cid]


async def run_all() -> None:
    game = Game(_noop_save)
    a, aws = _hero(game, "blade_master", "forest_01", 150, 150)
    b, bws = _hero(game, "night_ranger", "forest_01", 152, 151)
    c, cws = _hero(game, "grand_sorcerer", "forest_01", 20, 20)

    await game.sync_player_hp()
    first = hp_msgs(bws, a.char_id)
    assert first and first[-1]["hp"] == a.max_hp and first[-1]["max_hp"] == a.max_hp
    assert not hp_msgs(cws, a.char_id), "far players must not get it"
    print("ok  quem vê o herói recebe a vida dele")

    for w in (aws, bws, cws):
        w.sent.clear()
    await game.sync_player_hp()
    assert not hp_msgs(bws, a.char_id)
    print("ok  sem mudança, nada é mandado")

    a.hp = a.max_hp // 2
    await game.sync_player_hp()
    assert hp_msgs(bws, a.char_id)[-1]["hp"] == a.max_hp // 2
    print("ok  a vida nova chega (cura, poção ou regeneração também)")

    from websocket_manager import manager
    assert manager.sessions[a.char_id].info["hp"] == a.max_hp // 2
    print("ok  quem chegar perto depois recebe a vida no player_spawn/nearby_snapshot")


if __name__ == "__main__":
    asyncio.run(run_all())


def test_player_hp() -> None:
    asyncio.run(run_all())
