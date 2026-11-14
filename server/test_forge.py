"""
Mining + forge test: mining needs a pickaxe and standing at the vein, moving cancels, veins run out
and grow back; the forge turns ores + gold into stones; upgrades go +0 → +15 with the failure rules
(and the protection stone), raise the item's stats, and survive the bag shifting while stones are
spent; refinement adds up to 3 bonus lines (then rerolls) that count once equipped.
Run: .venv/Scripts/python.exe test_forge.py   (or -m pytest test_forge.py -q)
"""

from __future__ import annotations

import asyncio
import time

import forge
import items as inv
import mining
from game import Game
from test_skills import _hero, _noop_save
from websocket_manager import manager
from world_data import MAPS


def place(h, x: float, y: float) -> None:
    s = manager.sessions[h.char_id]
    s.x, s.y = x, y


async def run_all() -> None:
    game = Game(_noop_save)
    vein = next(v for v in game.mine.veins.values() if v.kind == "iron")
    miner, ws = _hero(game, "night_ranger", mining.MINE_MAP, vein.x + 1, vein.y, level=10)
    miner.bag = []

    # mining: pickaxe, distance, timing, moving cancels
    assert "Picareta" in await game.mine_start(miner, vein.id)
    inv.add_item(miner.bag, "pickaxe")
    place(miner, vein.x + 6, vein.y)
    assert await game.mine_start(miner, vein.id) == "Chegue mais perto do veio."
    place(miner, vein.x + 1, vein.y)
    assert await game.mine_start(miner, vein.id) is None
    await game.tick_mining()
    assert inv.count(miner.bag, "ore_iron") == 0  # still digging
    game.mine.digs[miner.char_id].until = time.monotonic() - 0.1
    await game.tick_mining()
    got = inv.count(miner.bag, "ore_iron")
    assert got in (1, 2) and vein.charges == mining.KINDS["iron"]["charges"] - 1
    assert await game.mine_start(miner, vein.id) is None
    place(miner, vein.x + 3, vein.y)  # walked away
    await game.tick_mining()
    assert miner.char_id not in game.mine.digs and inv.count(miner.bag, "ore_iron") == got
    print("ok  minerar: precisa de picareta, ficar no veio, e andar cancela")

    # veins run out and grow back
    place(miner, vein.x + 1, vein.y)
    while vein.ready:
        assert await game.mine_start(miner, vein.id) is None
        game.mine.digs[miner.char_id].until = 0
        await game.tick_mining()
    assert "esgotado" in await game.mine_start(miner, vein.id)
    vein.ready_at = time.monotonic() - 1
    await game.tick_mining()
    assert vein.ready and any(m["type"] == "vein" and m["id"] == vein.id and m["ready"] for m in ws.sent)
    kinds = {v.kind for v in game.mine.veins.values()}
    assert kinds == {"iron", "silver", "gold", "arcane"}
    print("ok  veios esgotam e voltam a crescer; 4 tipos de minério")

    # forge: crafting stones costs ores and gold, only next to the smith
    smith = next(n for n in MAPS["town_01"]["npcs"] if n["id"] == "smith")
    hero, hws = _hero(game, "blade_master", "town_01", smith["x"] + 1, smith["y"], level=20)
    hero.bag, hero.gold = [], 100000
    assert await game.forge_craft(hero, "stone_up_1", 1) == "Fale com o ferreiro para usar a forja."
    await game.dialog_option(hero, "shop:forge")
    assert hero.shop == "forge" and any(m["type"] == "forge" for m in hws.sent)
    assert "Faltam materiais" in await game.forge_craft(hero, "stone_up_1", 2)
    inv.add_item(hero.bag, "ore_iron", 7)
    assert await game.forge_craft(hero, "stone_up_1", 2) is None
    assert inv.count(hero.bag, "stone_up_1") == 2 and inv.count(hero.bag, "ore_iron") == 1
    assert hero.gold == 100000 - 2 * forge.RECIPES["stone_up_1"]["gold"]
    print("ok  forja cria pedras gastando minério e ouro")

    # upgrade: +1 always works; the piece keeps its changes even when stone stacks vanish before it
    hero.bag = [{"id": "stone_up_1", "qty": 1}, {"id": "sword_t2", "qty": 1}]
    gold = hero.gold
    assert await game.forge_upgrade(hero, "bag", 1, "sword_t2", False) is None
    assert hero.bag == [{"id": "sword_t2", "qty": 1, "plus": 1}] and hero.gold == gold - forge.up_fee(1)
    print("ok  aprimorar +0 → +1 (e o item certo, mesmo com a bolsa mudando)")

    # failure rules and the protection stone
    old = dict(forge.UP_CHANCE)
    try:
        for k in forge.UP_CHANCE:
            forge.UP_CHANCE[k] = 0.0
        def setup(plus: int, stone: str, protect: int = 0) -> None:
            hero.bag = [{"id": "sword_t2", "qty": 1, "plus": plus}, {"id": stone, "qty": 3}]
            if protect:
                hero.bag.append({"id": "stone_protect", "qty": protect})
        setup(4, "stone_up_1")
        await game.forge_upgrade(hero, "bag", 0, "sword_t2", False)
        assert hero.bag[0]["plus"] == 4                       # +5 fails: nothing lost
        setup(7, "stone_up_2")
        await game.forge_upgrade(hero, "bag", 0, "sword_t2", False)
        assert hero.bag[0]["plus"] == 6                       # +8 fails: one level down
        setup(13, "stone_up_3")
        await game.forge_upgrade(hero, "bag", 0, "sword_t2", False)
        assert hero.bag[0]["plus"] == 10                      # +14 fails: back to +10
        setup(13, "stone_up_3", protect=1)
        await game.forge_upgrade(hero, "bag", 0, "sword_t2", True)
        assert hero.bag[0]["plus"] == 13 and inv.count(hero.bag, "stone_protect") == 0
        setup(7, "stone_up_1")
        assert "Pedra de Aprimoramento" in await game.forge_upgrade(hero, "bag", 0, "sword_t2", False)
    finally:
        forge.UP_CHANCE.update(old)
    hero.bag = [{"id": "sword_t2", "qty": 1, "plus": 15}, {"id": "stone_up_3", "qty": 1}]
    assert "máximo" in await game.forge_upgrade(hero, "bag", 0, "sword_t2", False)
    print("ok  falhas: até +5 nada se perde, +6~+10 cai 1, +11~+15 volta a +10; Proteção segura o nível")

    # upgraded gear is stronger and sells for more
    base_atk = (hero.gear.clear(), hero.atk)[1]
    hero.gear["weapon"] = {"id": "sword_t2", "plus": 0, "ref": {}}
    atk0 = hero.atk
    hero.gear["weapon"]["plus"] = 10
    atk10 = hero.atk
    assert base_atk < atk0 < atk10
    assert inv.sell_price({"id": "sword_t2", "plus": 4}) == 2 * inv.ITEMS["sword_t2"]["sell"]
    print("ok  item aprimorado dá mais atributo e vende mais caro")

    # refinement: up to 3 lines, then rerolls; equipped lines count in the hero's stats
    hero.bag = [{"id": "stone_refine", "qty": 5}]
    for n in (1, 2, 3):
        assert await game.forge_refine(hero, "gear", "weapon", "sword_t2") is None
        assert len(hero.gear["weapon"]["ref"]) == n
    before = dict(hero.gear["weapon"]["ref"])
    assert await game.forge_refine(hero, "gear", "weapon", "sword_t2") is None
    after = hero.gear["weapon"]["ref"]
    assert len(after) == 3 and after != before
    hero.gear["weapon"]["ref"] = {"dodge": 0.03}
    assert abs(hero.mod("dodge") - (hero.passive.get("dodge", 0) + 0.03)) < 1e-9
    print("ok  refino: até 3 bônus, depois sorteia de novo; bônus valem quando equipado")


if __name__ == "__main__":
    asyncio.run(run_all())


def test_forge() -> None:
    asyncio.run(run_all())
