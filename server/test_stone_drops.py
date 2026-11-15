"""Forge stones drop from every monster (items.roll_stones): the upgrade stone of the monster's level band at
STONE_DROP, rarely the special stones; a boss always gives an upgrade stone. Upgrading works away from the smith."""
import asyncio
import random

import items as inv
from game import Game
from test_enchant_teleport import _hero, _noop_save


def drops() -> None:
    random.seed(1)
    assert inv.stone_of_level(5) == "stone_up_1" and inv.stone_of_level(20) == "stone_up_2" and inv.stone_of_level(60) == "stone_up_3"
    n = 20000
    got = [s for _ in range(n) for s in inv.roll_loot("wolf", "blade_master", 5, False)]
    rate = got.count("stone_up_1") / n
    assert abs(rate - inv.STONE_DROP) < 0.01, rate
    assert 0 < got.count("stone_protect") < n * 0.01
    for _ in range(50):
        assert "stone_up_2" in inv.roll_loot("swamp_witch", "night_ranger", 18, True)


async def upgrade_anywhere() -> None:
    game = Game(_noop_save)
    hero, _ws = _hero(game, "blade_master", "forest_01", 40, 40, level=10)
    hero.bag[:] = []
    hero.gold = 1000
    inv.add_piece(hero.bag, "sword_t1")
    assert "Pedra de Aprimoramento Menor" in await game.forge_upgrade(hero, "bag", 0, "sword_t1", False)
    inv.add_item(hero.bag, "stone_up_1", 1)
    assert await game.forge_upgrade(hero, "bag", 0, "sword_t1", False) is None
    sword = next(e for e in hero.bag if e["id"] == "sword_t1")
    assert sword["plus"] == 1 and inv.count(hero.bag, "stone_up_1") == 0 and hero.gold == 1000 - 100


drops()
asyncio.run(upgrade_anywhere())
print("ok")
