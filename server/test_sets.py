"""
Sets test: the set catalog, bonuses at 2/4/6 pieces, the hero's look (what the Unreal client draws) and its
broadcast, the look collection and skins, and set drops.
Run: .venv/Scripts/python.exe test_sets.py   (or -m pytest test_sets.py -q)
"""

from __future__ import annotations

import asyncio
import json
import random

import items as inv
from game import Game
from test_skills import _hero, _noop_save
from websocket_manager import manager


async def run_all() -> None:
    # catalog: every class has a Raro (4 pieces) and an Épico (6 pieces) set; pieces know their set and look
    for cls in ("blade_master", "grand_sorcerer", "night_ranger"):
        for rarity, size in (("raro", 4), ("epico", 6)):
            sid = inv.class_set(cls, rarity)
            assert sid, (cls, rarity)
            pieces = inv.SETS[sid]["pieces"]
            assert len(pieces) == size, (sid, pieces)
            for slot, iid in pieces.items():
                it = inv.ITEMS[iid]
                assert it["set"] == sid and it["slot"] == slot and it["rarity"] == rarity and it["cls"] == [cls]
                assert ("look" in it) == (slot in inv.LOOK_SLOTS), iid
    cat = json.loads(json.dumps(inv.catalog()))
    assert "sets" in cat and cat["look_slots"] == list(inv.LOOK_SLOTS)
    print("ok  catálogo: 1 set Raro (4 peças) e 1 Épico (6) por classe, no /meta")

    # random tier pools never give set pieces; the listed mobs drop a piece of the killer's set
    random.seed(1)
    assert not any(inv.ITEMS[inv.pool_item(t, "blade_master") or "sword_t1"].get("set") for t in (3, 5) for _ in range(300))
    got = [i for _ in range(400) for i in inv.roll_loot("lich_king", "night_ranger", 24, boss=True) if inv.ITEMS[i].get("set")]
    assert got and all(inv.ITEMS[i]["set"] == "set_blizzard_howl" for i in got), got
    print("ok  drop: peça de set só dos monstros da lista, sempre do set da classe de quem matou")

    # bonuses: 1 piece nothing, 2 and 4 pieces add up; another class's piece does not count
    game = Game(_noop_save)
    hero, ws = _hero(game, "blade_master", "town_01", 20, 20, level=25)
    hero.bag, hero.gear = inv.starter_kit("blade_master")
    oath = inv.SETS["set_winter_oath"]["pieces"]
    def_before, atk_mod = hero.defense, hero.mod("atk_pct")
    for slot in ("armor",):
        inv.add_item(hero.bag, oath[slot])
        assert await game.equip(hero, len(hero.bag) - 1, oath[slot]) is None
    assert inv.set_bonus(hero.gear) == {}
    inv.add_item(hero.bag, oath["legs"])
    assert await game.equip(hero, len(hero.bag) - 1, oath["legs"]) is None
    assert inv.set_bonus(hero.gear) == {"def_pct": 0.08}
    for slot in ("boots", "weapon"):
        inv.add_item(hero.bag, oath[slot])
        assert await game.equip(hero, len(hero.bag) - 1, oath[slot]) is None
    b4 = inv.set_bonus(hero.gear)
    assert b4 == {"def_pct": 0.08, "max_hp_pct": 0.10, "atk_pct": 0.06}, b4
    assert abs(hero.mod("atk_pct") - (atk_mod + 0.06)) < 1e-9 and hero.defense > def_before
    inv.add_item(hero.bag, oath["ring"]); inv.add_item(hero.bag, oath["necklace"])
    for slot in ("ring", "necklace"):
        idx = next(i for i, e in enumerate(hero.bag) if e["id"] == oath[slot])
        assert await game.equip(hero, idx, oath[slot]) is None
    b6 = inv.set_bonus(hero.gear)
    assert abs(b6["atk_pct"] - 0.16) < 1e-9 and b6["crit_dmg"] == 0.15, b6
    assert hero.public()["sets"] == {"set_winter_oath": 6}
    other = inv.SETS["set_frost_crown"]["pieces"]["ring"]   # a sorcerer piece: the class cannot even wear it
    inv.add_item(hero.bag, other)
    assert await game.equip(hero, len(hero.bag) - 1, other) == "Sua classe não pode usar esse item."
    print("ok  bônus: nada com 1 peça, soma com 2/4/6; peça de outra classe não entra")

    # look: what the hero wears, sent to the map when it changes, kept in the session info
    assert hero.look == {s: "winter_oath" for s in inv.LOOK_SLOTS}, hero.look
    sent = [m for m in ws.sent if m.get("type") == "look"]
    assert sent and sent[-1]["look"] == hero.look and manager.sessions[hero.char_id].info["look"] == hero.look
    assert "winter_oath" in hero.cosmetics["looks_owned"]
    assert await game.unequip(hero, "legs") is None
    assert "legs" not in hero.look and [m for m in ws.sent if m.get("type") == "look"][-1]["look"] == hero.look
    print("ok  visual: o herói mostra o set, o mapa recebe 'look' quando muda, a coleção guarda o visual")

    # skins: a collected look chosen for a slot wins over the worn piece; an uncollected one is ignored
    hero.cosmetics["looks"] = {"armor": "vigil_iron", "weapon": "winter_oath"}
    assert hero.look["armor"] == "winter_oath"          # vigil_iron not collected yet
    hero.cosmetics["looks_owned"].append("vigil_iron")
    assert hero.look["armor"] == "vigil_iron" and hero.look["weapon"] == "winter_oath"
    print("ok  skin: visual escolhido só vale se já foi coletado; não muda atributos")


if __name__ == "__main__":
    asyncio.run(run_all())


def test_sets() -> None:
    asyncio.run(run_all())
