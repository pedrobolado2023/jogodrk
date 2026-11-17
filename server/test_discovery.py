"""
Hidden places: every place sits inside its map and away from portals and the hunting spots, walking up to one finds
it once with its bonus, a finished map pays gold, all of them give the title, and the saved list is cleaned.
Also checks the doubled hunting spots.
Run: .venv/Scripts/python.exe test_discovery.py
"""

from __future__ import annotations

import asyncio
import math

import discovery as disc
from game import Game
from test_skills import _hero, _noop_save
from websocket_manager import manager
from world_data import MAPS, MOBS, SPAWNS, SPOT_MULT, meta


async def run_all() -> None:
    # places: on real maps, inside them, not on a portal, not in the middle of a hunting spot, unique ids
    ids = [p["id"] for ps in disc.PLACES.values() for p in ps]
    assert len(ids) == len(set(ids)) == disc.TOTAL
    for map_id, ps in disc.PLACES.items():
        m = MAPS[map_id]
        assert sum(p["landmark"] for p in ps) <= 1, map_id
        for p in ps:
            assert 2 <= p["x"] <= m["size"] - 2 and 2 <= p["y"] <= m["size"] - 2, p["id"]
            assert all(math.hypot(p["x"] - q["x"], p["y"] - q["y"]) >= 5 for q in m["portals"]), p["id"]
            for sp in SPAWNS:
                if sp["map"] == map_id:
                    gap = 6 if m["size"] >= 100 else 4  # the crypt and the mine are small: every room has monsters
                    assert math.hypot(p["x"] - sp["x"], p["y"] - sp["y"]) >= gap, (p["id"], sp["mob"])
            assert p["bonus"][0] in disc.BONUS_TEXT and 0 < p["bonus"][1] <= 0.02
            assert p["lore"] and p["hint"] and p["name"]
    for map_id in ("forest_01", "dungeon_01", "mine_01", "swamp_01", "frost_01", "ash_01", "crimson_01", "ghost_01", "void_01"):
        assert any(p["landmark"] for p in disc.PLACES[map_id]), map_id
    assert "discovery" in meta() and meta()["discovery"]["total"] == disc.TOTAL
    print(f"ok  {disc.TOTAL} lugares bem colocados, um marco gigante por região")

    # spots: four times the monsters written in the world data, bosses still one
    for sp in SPAWNS:
        if MOBS[sp["mob"]].get("boss"):
            assert sp["count"] == 1
        else:
            assert sp["count"] % SPOT_MULT == 0 and sp["count"] >= 8, sp
    assert SPOT_MULT == 4
    print("ok  spots com o dobro de monstros (chefes continuam 1)")

    game = Game(_noop_save)
    sent: list[tuple[str, dict]] = []
    real_send = game.send

    async def spy(cid, msg):
        sent.append((cid, msg))
        await real_send(cid, msg)
    game.send = spy
    hero = _hero(game, "blade_master", "town_01", 5, 5, level=10)[0]
    s = manager.sessions[hero.char_id]
    hp0, atk0 = hero.max_hp, hero.atk

    def got(kind):
        return [m for c, m in sent if c == hero.char_id and m.get("type") == kind]

    # far: nothing; close: found, with the bonus applied
    await game.on_move(hero, 6, 6)
    assert not got("discovered") and hero.found == []
    founder = disc.BY_ID["t_founder"][1]
    s.x, s.y = founder["x"] + 3, founder["y"]
    await game.check_discovery(hero, founder["x"] + 3, founder["y"])
    d = got("discovered")[-1]
    assert d["id"] == "t_founder" and d["bonus"] == "+1% de vida" and d["map_n"] == 1 and d["map_total"] == 2
    assert hero.found == ["t_founder"] and hero.max_hp > hp0 and hero.atk == atk0
    # the same place never counts twice
    await game.check_discovery(hero, founder["x"], founder["y"])
    assert len(got("discovered")) == 1
    print("ok  achar um lugar dá o bônus uma vez só")

    # the last place of the map pays the map's gold
    gold0 = hero.gold
    garden = disc.BY_ID["t_garden"][1]
    await game.check_discovery(hero, garden["x"], garden["y"] + 1)
    d = got("discovered")[-1]
    assert d["map_n"] == d["map_total"] == 2 and d["map_gold"] == disc.MAP_GOLD["town_01"]
    assert hero.gold == gold0 + disc.MAP_GOLD["town_01"]
    print("ok  mapa completo paga ouro")

    # a dead hero finds nothing
    hero.is_dead = True
    lm = disc.BY_ID["f_mother"][1]
    hero.map_id = "forest_01"
    await game.check_discovery(hero, lm["x"], lm["y"])
    assert "f_mother" not in hero.found
    hero.is_dead = False
    # the landmark is found from its foot (a wider touch)
    await game.check_discovery(hero, lm["x"] + disc.LANDMARK_TOUCH - 0.3, lm["y"])
    assert "f_mother" in hero.found and got("discovered")[-1]["landmark"]
    print("ok  marco gigante de mais longe, morto não descobre")

    # every place: the title, once
    for pid, (map_id, p) in disc.BY_ID.items():
        if pid in hero.found:
            continue
        hero.map_id = map_id
        await game.check_discovery(hero, p["x"], p["y"])
    assert len(hero.found) == disc.TOTAL
    assert got("discovered")[-1]["title"] and disc.TITLE in hero.cosmetics["titles"]
    assert hero.cosmetics["titles"].count(disc.TITLE) == 1 and game.can_wear_title(hero, disc.TITLE)
    total = disc.mods(hero.found)
    assert all(v <= 0.2 for v in total.values()), total
    print("ok  todos os lugares: título Cartógrafo, bônus total", {k: f"{v:.1%}" for k, v in total.items()})

    # the saved list is cleaned (unknown ids, repeats, junk)
    assert disc.clean(["t_founder", "t_founder", "nope", 3, None]) == ["t_founder"]
    assert disc.clean(None) == []
    assert hero.public()["found"] == hero.found
    print("ok  lista salva limpa")


if __name__ == "__main__":
    manager.batch = False
    asyncio.run(run_all())
    print("tudo certo")
