"""
Weapon enchantment (fire, ice, lightning, poison) at the forge, and the world map teleport.
Run: .venv/Scripts/python.exe test_enchant_teleport.py   (or -m pytest test_enchant_teleport.py -q)
"""

from __future__ import annotations

import asyncio
import random

import forge
import items as inv
from game import Game
from test_skills import _hero, _noop_save
from websocket_manager import manager
from world_data import MAPS


async def enchant() -> None:
    game = Game(_noop_save)
    smith = next(n for n in MAPS["town_01"]["npcs"] if n["id"] == "smith")
    hero, ws = _hero(game, "blade_master", "town_01", smith["x"] + 1, smith["y"], level=20)
    hero.bag[:] = []
    hero.gold = 100000
    inv.add_piece(hero.bag, {"id": "sword_t1", "plus": 7, "ref": {"crit": 0.02}})
    inv.add_piece(hero.bag, "plate_t1")
    # enchanting works anywhere (opened from the item); only the stone is missing
    assert "Pedra de Encantamento" in await game.forge_enchant(hero, "bag", 0, "sword_t1", "fire")
    assert await game.forge_craft(hero, "stone_enchant", 1) == "Fale com o ferreiro para usar a forja."  # crafting: at the smith
    await game.dialog_option(hero, "shop:forge")
    inv.add_item(hero.bag, "ore_arcane", 2)
    inv.add_item(hero.bag, "ore_silver", 3)
    assert await game.forge_craft(hero, "stone_enchant", 1) is None and inv.count(hero.bag, "stone_enchant") == 1
    assert await game.forge_enchant(hero, "bag", 1, "plate_t1", "fire") == "Só armas podem ser encantadas."
    assert await game.forge_enchant(hero, "bag", 0, "sword_t1", "nada") == "Escolha um elemento."
    gold = hero.gold
    assert await game.forge_enchant(hero, "bag", 0, "sword_t1", "fire") is None
    sword = next(e for e in hero.bag if e["id"] == "sword_t1")
    assert sword["ench"] == "fire" and sword["plus"] == 7 and sword["ref"] == {"crit": 0.02}  # keeps +7 and refine
    assert hero.gold == gold - forge.enchant_fee(inv.ITEMS["sword_t1"].get("tier", 1))
    assert inv.count(hero.bag, "stone_enchant") == 0
    assert "já está encantada" in await game.forge_enchant(hero, "bag", hero.bag.index(sword), "sword_t1", "fire")
    # the element survives equipping, saving (clean) and the market's copy
    i = hero.bag.index(sword)
    assert await game.equip(hero, i, "sword_t1") is None
    assert hero.gear["weapon"]["ench"] == "fire" and game.weapon_enchant(hero)["name"] == "Fogo"
    bag, gear = inv.clean([dict(e) for e in hero.bag] + [{"id": "sword_t1", "qty": 1, "ench": "ice"}], dict(hero.gear))
    assert gear["weapon"]["ench"] == "fire" and bag[-1]["ench"] == "ice"
    print("ok  encantar: só arma, com pedra e ouro, mantém +N e refino, sobrevive ao salvar")

    # in combat: extra damage, and the effect on a direct hit
    mm = game.mobs["forest_01"]
    wolf = next(m for m in mm.mobs.values() if m.mob_def_id == "wolf")
    hero.map_id = "forest_01"
    s = manager.sessions[hero.char_id]
    s.map_id, s.x, s.y = "forest_01", wolf.x + 1, wolf.y
    manager.get_grid("forest_01").add(hero.char_id, s.x, s.y)  # as change_map does: nearby messages use the grid
    random.seed(1)
    hits = []
    for element, check in (("fire", lambda: any(d.kind == "burn" for d in game.dots)),
                           ("poison", lambda: any(d.kind == "poison" for d in game.dots))):
        hero.gear["weapon"]["ench"] = element
        game.dots.clear()
        for _ in range(60):
            wolf.hp, wolf.is_dead = wolf.max_hp * 100, False
            hero.cooldowns.clear()
            hero.mp = hero.max_mp
            ws.sent.clear()
            assert await game.use_skill(hero, "bm_basic", wolf.instance_id, wolf.x, wolf.y) is None
            hits += [m for m in ws.sent if m.get("type") == "enchant_proc"]
            if check():
                break
        assert check(), element
    assert hits
    print("ok  em combate: fogo queima, veneno envenena")


async def teleport() -> None:
    game = Game(_noop_save)
    hero, ws = _hero(game, "night_ranger", "town_01", 20, 25, level=10)
    hero.gold = 1000
    hero.story = {"q": 0, "st": "offer", "n": 0}
    assert game.unlocked_maps(hero) == {"town_01", "forest_01", "arena_01", "mine_01"}  # start of the story
    await game.world_map(hero)
    wm = next(m for m in ws.sent if m["type"] == "world_map")
    by_id = {m["id"]: m for m in wm["maps"]}
    assert "worldboss_01" not in by_id and by_id["forest_01"]["unlocked"] and not by_id["void_01"]["unlocked"]
    assert ["forest_01", "town_01"] in wm["links"] or ["town_01", "forest_01"] in wm["links"]
    assert "selado" in await game.teleport(hero, "void_01")
    assert await game.teleport(hero, "forest_01") is None
    assert hero.map_id == "forest_01" and hero.gold == 1000 - game.teleport_cost("forest_01")
    assert "Espere" in await game.teleport(hero, "town_01")  # a short pause between jumps
    game.tp_last.clear()
    assert await game.teleport(hero, "forest_01") == "Você já está aqui."
    hero.gold = 5
    assert "Ouro insuficiente" in await game.teleport(hero, "town_01")
    hero.gold, hero.story = 10000, {"q": 13, "st": "active", "n": 0}  # further in the story: more maps open
    assert {"swamp_01", "frost_01", "ash_01"} <= game.unlocked_maps(hero) and "crimson_01" not in game.unlocked_maps(hero)
    assert await game.teleport(hero, "ash_01") is None and hero.map_id == "ash_01"
    s = manager.sessions[hero.char_id]
    assert (s.x, s.y) == tuple(MAPS["ash_01"]["spawn"])
    hero.is_dead = True
    game.tp_last.clear()
    assert "morto" in await game.teleport(hero, "town_01")
    print("ok  teleporte: só mapas liberados, custa ouro, pausa curta, chega na entrada do mapa")


def test_enchant_teleport() -> None:
    asyncio.run(enchant())
    asyncio.run(teleport())


if __name__ == "__main__":
    test_enchant_teleport()
    print("all enchant/teleport tests passed")
