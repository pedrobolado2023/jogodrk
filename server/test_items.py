"""
Inventory test: shop buy/sell near the merchant, equip rules and stat bonuses, potions, loot drops,
and migration of characters saved before the inventory existed.
Run: .venv/Scripts/python.exe test_items.py   (or -m pytest test_items.py -q)
"""

from __future__ import annotations

import asyncio

import items as inv
from game import Game
from test_skills import _hero, _noop_save
from websocket_manager import manager
from world_data import MAPS


async def run_all() -> None:
    game = Game(_noop_save)
    merchant = next(n for n in MAPS["town_01"]["npcs"] if n["id"] == "merchant")
    hero, ws = _hero(game, "blade_master", "town_01", merchant["x"] + 1, merchant["y"], level=6)
    hero.bag, hero.gear = inv.starter_kit("blade_master")
    hero.gold = 1000

    # shop only works next to the NPC
    await game.dialog_option(hero, "shop:merchant")
    assert hero.shop == "merchant" and any(m["type"] == "shop" for m in ws.sent), "shop did not open"
    assert await game.buy(hero, "sword_t2", 1) is None
    assert hero.gold == 1000 - inv.ITEMS["sword_t2"]["price"]
    assert await game.buy(hero, "sword_t4", 1) == "Esse item não está à venda aqui."
    manager.sessions[hero.char_id].x += 20
    assert await game.buy(hero, "pot_hp_s", 1) == "Chegue mais perto do vendedor."
    manager.sessions[hero.char_id].x -= 20
    print("ok  loja: compra perto do mercador, recusa item fora do estoque e de longe")

    # equipping changes stats and swaps the old weapon back into the bag
    atk_before, str_before = hero.atk, hero.stat("str")
    idx = next(i for i, e in enumerate(hero.bag) if e["id"] == "sword_t2")
    assert await game.equip(hero, idx, "sword_t2") is None
    assert inv.item_id(hero.gear["weapon"]) == "sword_t2" and inv.count(hero.bag, "sword_t1") == 1
    assert hero.atk > atk_before and hero.stat("str") == str_before - 2 + 5
    idx = next(i for i, e in enumerate(hero.bag) if e["id"] == "sword_t1")
    inv.add_item(hero.bag, "staff_t1")
    sidx = next(i for i, e in enumerate(hero.bag) if e["id"] == "staff_t1")
    assert await game.equip(hero, sidx, "staff_t1") == "Sua classe não pode usar esse item."
    inv.add_item(hero.bag, "sword_t3")
    tidx = next(i for i, e in enumerate(hero.bag) if e["id"] == "sword_t3")
    assert await game.equip(hero, tidx, "sword_t3") == "Precisa do nível 9."
    print("ok  equipar: bônus de atributos, troca de arma, trava de classe e de nível")

    # selling
    gold = hero.gold
    assert await game.sell(hero, idx, "sword_t1", 1) is None
    assert hero.gold == gold + inv.ITEMS["sword_t1"]["sell"] and inv.count(hero.bag, "sword_t1") == 0
    assert await game.sell(hero, 0, "bone_shard", 1) == "Esse item não está mais na bolsa."
    print("ok  venda e checagem do item na bolsa")

    # potions: heal, cooldown, consume
    hero.hp = 10
    before = inv.count(hero.bag, "pot_hp_s")
    assert await game.use_potion(hero, "hp") is None
    assert hero.hp > 10 and inv.count(hero.bag, "pot_hp_s") == before - 1
    assert await game.use_potion(hero, "hp") == "Aguarde para beber outra poção."
    print("ok  poções curam, gastam a poção e têm recarga")

    # stacking and bag limits
    bag: list[dict] = []
    assert inv.add_item(bag, "pot_hp_s", 150) == 150 and len(bag) == 2 and bag[0]["qty"] == inv.STACK_MAX
    full = [{"id": "sword_t1", "qty": 1} for _ in range(inv.BAG_SLOTS)]
    assert not inv.can_add(full, "ring_t1") and inv.add_item(full, "ring_t1") == 0
    print(f"ok  pilhas de até 99 e limite de {inv.BAG_SLOTS} espaços")

    # loot: the boss always drops a legendary for the killer's class
    for cls, wpn in inv.STARTER_WEAPON.items():
        drops = inv.roll_loot("death_knight", cls)
        legend = [d for d in drops if inv.ITEMS[d].get("tier") == 4]
        assert legend and all(inv.usable_by(d, cls) for d in legend), (cls, drops)
    print("ok  chefe sempre derruba um lendário da classe de quem matou")

    # old saves: loot names become items, plus the starting kit
    bag, gear = inv.migrate_legacy("night_ranger", {"Pele de Lobo": 4, "Lâmina de Vorthas": 1, "???": 2})
    assert inv.count(bag, "wolf_pelt") == 4 and inv.count(bag, "sword_t4") == 1 and gear == {"weapon": {"id": "bow_t1"}}
    bag, gear = inv.clean([{"id": "nope"}, {"id": "pot_mp_s", "qty": 2}], {"weapon": "ring_t1", "armor": "plate_t1"})
    assert bag == [{"id": "pot_mp_s", "qty": 2}] and gear == {"armor": {"id": "plate_t1", "plus": 0, "ref": {}}}
    print("ok  personagens antigos ganham o kit inicial e os itens coletados")

    # six slots: weapon, chest, legs, boots, ring, necklace; every class has legs and boots at every chest tier
    assert inv.GEAR_SLOTS == ("weapon", "armor", "legs", "boots", "ring", "necklace")
    gear_items = [v for v in inv.ITEMS.values() if v["type"] == "gear"]
    assert {v["slot"] for v in gear_items} == set(inv.GEAR_SLOTS)
    for chest in [k for k, v in inv.ITEMS.items() if v.get("slot") == "armor" and not v.get("set")]:  # sets: own pieces
        kind, tier = inv.ITEMS[chest]["icon"], inv.ITEMS[chest]["tier"]
        for slot in ("legs", "boots"):
            piece = inv.ITEMS[f"{kind}_{slot}_t{tier}"]
            assert piece["slot"] == slot and piece["cls"] == inv.ITEMS[chest]["cls"] and piece["lvl"] == inv.ITEMS[chest]["lvl"]
            assert piece["stats"]["def"] < inv.ITEMS[chest]["stats"]["def"], (chest, slot)
    # the old single accessory slot moves to the ring or necklace slot, keeping its upgrade
    _, gear = inv.clean([], {"accessory": {"id": "amulet_t2", "plus": 3}})
    assert gear == {"necklace": {"id": "amulet_t2", "plus": 3, "ref": {}}}
    _, gear = inv.clean([], {"accessory": "ring_t1"})
    assert gear == {"ring": {"id": "ring_t1", "plus": 0, "ref": {}}}
    # equipping pants and boots fills their own slots and adds their defense
    game = Game(_noop_save)
    h = _hero(game, "blade_master", "town_01", 10, 10, level=10)[0]
    base_def = h.defense
    h.bag = [{"id": "plate_legs_t2", "qty": 1}, {"id": "plate_boots_t2", "qty": 1}, {"id": "ring_t1", "qty": 1}]
    assert await game.equip(h, 0, "plate_legs_t2") is None
    assert await game.equip(h, 0, "plate_boots_t2") is None
    assert await game.equip(h, 0, "ring_t1") is None
    assert {"legs", "boots", "ring"} <= set(h.gear) and not h.bag, (h.gear, h.bag)
    assert h.defense > base_def
    print("ok  6 espaços: arma, peito, calça, bota, anel e colar (acessório antigo vai para anel ou colar)")

    # auto-equip: the best usable piece of each slot goes on; other classes' pieces, too-high levels and
    # worse pieces stay in the bag; what was worn goes back to the bag
    h2 = _hero(game, "blade_master", "town_01", 12, 12, level=20)[0]
    h2.gear = {"weapon": {"id": "sword_t1", "plus": 0, "ref": {}}, "ring": {"id": "ring_t3", "plus": 0, "ref": {}}}
    h2.bag = [{"id": "plate_t1", "qty": 1}, {"id": "plate_t3", "qty": 1}, {"id": "robe_t5", "qty": 1},
              {"id": "sword_t2", "qty": 1, "plus": 4}, {"id": "sword_t6", "qty": 1}, {"id": "plate_legs_t2", "qty": 1},
              {"id": "ring_t1", "qty": 1}, {"id": "pot_hp_s", "qty": 3}]
    assert await game.auto_equip(h2) is None
    worn = {s: p["id"] for s, p in h2.gear.items()}
    assert worn == {"weapon": "sword_t2", "armor": "plate_t3", "legs": "plate_legs_t2", "ring": "ring_t3"}, worn
    ids = sorted(e["id"] for e in h2.bag)
    assert ids == sorted(["plate_t1", "robe_t5", "sword_t1", "sword_t6", "ring_t1", "pot_hp_s"]), ids  # sword_t6 needs level 24
    assert "melhores" in await game.auto_equip(h2)
    print("ok  auto equipar veste o melhor de cada espaço (classe e nível certos)")


if __name__ == "__main__":
    asyncio.run(run_all())


def test_items() -> None:
    asyncio.run(run_all())
