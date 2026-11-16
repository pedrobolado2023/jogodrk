"""Anti-cheat checks: no long jump after standing still, odd numbers (NaN, infinity, text) refused."""

from __future__ import annotations

import asyncio
import time

import main
from game import Game
from test_skills import _hero, _noop_save
from websocket_manager import MAX_MOVE_GAP, MAX_SPEED, manager


async def run_all() -> None:
    game = Game(_noop_save)
    hero, _ = _hero(game, "blade_master", "forest_01", 20.0, 20.0)
    s = manager.sessions[hero.char_id]

    # standing still for a minute, then asking to be 100 tiles away: only MAX_MOVE_GAP seconds of walking count
    s.last_move_ts = time.monotonic() - 60
    await manager.handle_move(hero.char_id, 20.0, 120.0)
    assert s.y - 20.0 <= MAX_SPEED * MAX_MOVE_GAP + 0.01, s.y
    print("ok  sem pulo longo depois de ficar parado")

    # NaN / infinity never move the hero (they used to put it at the map's corner, past the speed check)
    before = (s.x, s.y)
    for bad in (float("nan"), float("inf")):
        await manager.handle_move(hero.char_id, bad, bad)
        assert (s.x, s.y) == before
    assert main._num(float("nan")) is None and main._num(float("inf")) is None
    assert main._num("12") is None and main._num(True) is None and main._num(None) is None
    assert main._num(3) == 3.0 and main._num(2.5) == 2.5
    print("ok  números inválidos recusados")

    manager.sessions.pop(hero.char_id, None)


def test_anticheat():
    asyncio.run(run_all())


if __name__ == "__main__":
    test_anticheat()
    print("all anti-cheat tests passed")
