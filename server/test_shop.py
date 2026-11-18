"""
Gem shop test: the shop only sells looks and the pass Premium track (never power); buying needs enough gems,
takes them, gives the item once (no buying twice); bought titles and auras can be worn; the Premium pass
unlocks the Premium rewards.
Run: .venv/Scripts/python.exe test_shop.py   (or -m pytest test_shop.py -q)
"""

from __future__ import annotations

import asyncio

import season as ssn
import shop
from game import Game
from test_skills import _hero, _noop_save
from websocket_manager import manager


async def run_all() -> None:
    # looks and time savers only: no gear, stones, stats or combat buffs
    assert {o["kind"] for o in shop.OFFERS} <= {"premium_pass", "aura", "title", "pet", "mount", "skin", "boost", "pass_level", "quest_skip"}
    assert all(o["ref"] in ("exp", "gold") for o in shop.OFFERS if o["kind"] == "boost")
    for o in shop.OFFERS:
        assert o["price"] > 0
        if o["kind"] == "aura":
            assert o["ref"] in ssn.AURAS
        if o["kind"] == "title":
            assert o["ref"] in ssn.TITLE_BY_ID
    print("ok  a loja só vende visual, Passe Premium e tempo (nada de força)")

    game = Game(_noop_save)
    game.night = False  # rewards below are the daytime ones (night gives more)
    h = _hero(game, "grand_sorcerer", "town_01", 20, 20, level=40)[0]
    gold0, gear0 = h.gold, dict(h.gear)
    assert "Faltam 600" in await game.shop_buy(h, "aura_sangue")
    h.gems = 2000
    assert await game.shop_buy(h, "aura_sangue") is None and h.gems == 1400
    assert "aura_sangue" in h.cosmetics["auras"]
    assert "já tem" in await game.shop_buy(h, "aura_sangue") and h.gems == 1400
    assert await game.set_aura(h, "aura_sangue") is None and h.cosmetics["aura"] == "aura_sangue"
    assert await game.shop_buy(h, "title_nobre") is None and h.gems == 1000
    assert await game.set_title(h, "nobre") is None and h.title == "nobre"
    assert "não está na loja" in await game.shop_buy(h, "sword_t6")
    assert h.gold == gold0 and h.gear == gear0            # gems never turn into gold or gear
    print("ok  comprar gasta gemas, dá o item uma vez só, e dá para usar o visual comprado")

    # the Premium pass from the shop unlocks the Premium track
    st = game.season_state(h)
    st["xp"] = ssn.XP_PER_LEVEL * 10
    assert "Premium" in await game.pass_claim(h, "prem", 1)
    assert await game.shop_buy(h, "pass_premium") is None and h.gems == 50 and st["premium"]
    assert await game.pass_claim(h, "prem", 1) is None and "s1_brasa" in h.cosmetics["titles"]
    assert "já tem" in await game.shop_buy(h, "pass_premium")
    assert h.public()["gems"] == 50
    print("ok  Passe Premium comprado na loja libera a trilha Premium")

    # boosts: +50% monster EXP and gold while active, buying again adds time
    h2 = _hero(game, "blade_master", "forest_01", 10, 10, level=30)[0]
    h2.gems = 10_000
    res = {"exp": 100, "gold": 40, "def_id": "wolf", "mob_id": "x"}
    exp0, gold0 = h2.exp, h2.gold
    await game.on_mob_killed(h2, res, [h2.char_id])
    base_exp, base_gold = h2.exp - exp0, h2.gold - gold0
    assert (base_exp, base_gold) == (100, 40)
    assert await game.shop_buy(h2, "boost_exp_1h") is None and await game.shop_buy(h2, "boost_gold_1h") is None
    exp0, gold0 = h2.exp, h2.gold
    await game.on_mob_killed(h2, res, [h2.char_id])
    assert (h2.exp - exp0, h2.gold - gold0) == (150, 60)
    end = h2.boosts["exp"]
    assert await game.shop_buy(h2, "boost_exp_1h") is None and abs(h2.boosts["exp"] - end - 3600) < 2
    assert 0 < h2.public()["boosts"]["exp"] <= 7200
    h2.boosts["gold"] = 0  # expired
    assert h2.boost("gold") == 0
    print("ok  bônus de EXP e ouro (+50% dos monstros) por tempo, comprar de novo soma")

    # pass levels: expensive, never past the last level
    st2 = game.season_state(h2)
    gems = h2.gems
    assert await game.shop_buy(h2, "pass_level_5") is None and ssn.level_of(st2["xp"]) == 5 and h2.gems == gems - 1900
    st2["xp"] = 48 * ssn.XP_PER_LEVEL
    assert "Faltam só 2" in await game.shop_buy(h2, "pass_level_5")
    assert await game.shop_buy(h2, "pass_level_1") is None and ssn.level_of(st2["xp"]) == 49
    print("ok  acelerar o passe: compra níveis (caro), sem passar do 50")

    # finishing a story quest: only one in progress; costs more for later quests
    h2.story = {"q": 3, "st": "offer", "n": 0}
    assert "em andamento" in await game.shop_buy(h2, "quest_skip")
    h2.story = {"q": 3, "st": "active", "n": 1}
    gems = h2.gems
    assert await game.shop_buy(h2, "quest_skip") is None and h2.story["st"] == "ready"
    assert h2.gems == gems - shop.price(shop.BY_ID["quest_skip"], 3) == gems - (600 + 3 * 40)
    print("ok  concluir a missão da história com gemas (mais cara a cada missão)")

    # mascots: bought once, the first one comes out at once, can be swapped or put away; no stats change
    h3 = _hero(game, "night_ranger", "town_01", 22, 22, level=20)[0]
    h3.gems = 5000
    atk0, def0, hp0 = h3.atk, h3.defense, h3.max_hp
    assert await game.shop_buy(h3, "pet_dog") is None and h3.cosmetics["pet"] == "pet_dog" and h3.gems == 4100
    assert "já tem" in await game.shop_buy(h3, "pet_dog")
    assert await game.shop_buy(h3, "pet_void_drake") is None and h3.cosmetics["pet"] == "pet_dog"  # keeps the one out
    assert await game.set_pet(h3, "pet_void_drake") is None and h3.public()["cosmetics"]["pet"] == "pet_void_drake"
    assert "ainda não tem" in await game.set_pet(h3, "pet_snow_wolf")
    assert await game.set_pet(h3, "") is None and h3.cosmetics["pet"] == ""
    assert (h3.atk, h3.defense, h3.max_hp) == (atk0, def0, hp0)
    # every mascot sold has its 3D model in the render list (art-source/units.json)
    import json
    import pathlib
    units = json.loads((pathlib.Path(__file__).resolve().parent.parent / "art-source" / "units.json").read_text(encoding="utf-8"))
    for o in shop.OFFERS:
        if o["kind"] == "pet":
            assert ssn.PETS[o["ref"]][1] in units, o["ref"]
        if o["kind"] == "mount":
            assert ssn.MOUNTS[o["ref"]][1] in units, o["ref"]
    # ... and its sprite sheet is rendered (client/public/sprites/manifest.json), with 20 of each on sale
    manifest = json.loads((pathlib.Path(__file__).resolve().parent.parent / "client" / "public" / "sprites" / "manifest.json")
                          .read_text(encoding="utf-8"))
    sheets = [ssn.PETS[o["ref"]][1] if o["kind"] == "pet" else ssn.MOUNTS[o["ref"]][1] for o in shop.OFFERS if o["kind"] in ("pet", "mount")]
    assert all(s in manifest for s in sheets), [s for s in sheets if s not in manifest]
    assert sum(o["kind"] == "pet" for o in shop.OFFERS) >= 20 and sum(o["kind"] == "mount" for o in shop.OFFERS) >= 20
    print("ok  mascotes: compra uma vez, troca ou guarda, sem mudar atributos")

    # mounts: looks only — bought once, ridden at once, M gets off and back on the last one; no stat changes
    h4 = _hero(game, "grand_sorcerer", "town_01", 24, 24, level=20)[0]
    h4.gems = 6000
    stats0 = (h4.atk, h4.defense, h4.max_hp, h4.mod("speed"))
    assert "não tem montaria" in await game.toggle_mount(h4)
    assert await game.shop_buy(h4, "mount_white") is None and h4.cosmetics["mount"] == "mount_white" and h4.gems == 4400
    assert "já tem" in await game.shop_buy(h4, "mount_white")
    assert await game.toggle_mount(h4) is None and h4.cosmetics["mount"] == ""
    assert await game.toggle_mount(h4) is None and h4.cosmetics["mount"] == "mount_white"
    assert "ainda não tem" in await game.set_mount(h4, "mount_shadow")
    assert h4.public()["cosmetics"]["mount"] == "mount_white"
    assert (h4.atk, h4.defense, h4.max_hp, h4.mod("speed")) == stats0
    print("ok  montarias: só visual, compra uma vez, tecla M monta e desmonta")

    # skins: looks only — bought once, worn at once, everyone on the map is told; back to the class look with ""
    h6, ws6 = _hero(game, "blade_master", "town_01", 28, 28, level=20)
    h6.gems = 5000
    stats0 = (h6.atk, h6.defense, h6.max_hp, h6.mod("speed"))
    assert "ainda não tem" in await game.set_skin(h6, "skin_real")
    ws6.sent.clear()
    assert await game.shop_buy(h6, "skin_carmesim") is None and h6.cosmetics["skin"] == "skin_carmesim" and h6.gems == 3500
    assert any(m.get("type") == "skin" and m["skin"] == "skin_carmesim" for m in ws6.sent)
    assert "já tem" in await game.shop_buy(h6, "skin_carmesim")
    assert await game.set_skin(h6, "") is None and h6.public()["cosmetics"]["skin"] == ""
    assert await game.set_skin(h6, "skin_carmesim") is None
    assert manager.sessions[h6.char_id].info["skin"] == "skin_carmesim"
    assert (h6.atk, h6.defense, h6.max_hp, h6.mod("speed")) == stats0
    assert all(s["id"] in ssn.SKINS and ("grade" in s) != ("sheet" in s) for s in ssn.skins_meta())  # a recolour or a model
    print("ok  skins: só visual, compra uma vez, veste na hora e todos no mapa veem")

    # with the Premium pass, buying one item gives that item only and takes its price once
    h5 = _hero(game, "night_ranger", "town_01", 26, 26, level=20)[0]
    h5.gems = 50000
    game.season_state(h5)["premium"] = True
    assert await game.shop_buy(h5, "mount_horse") is None
    price = next(o for o in shop.OFFERS if o["id"] == "mount_horse")["price"]
    assert h5.gems == 50000 - price, h5.gems
    c = ssn.cosmetics(h5.cosmetics)
    assert c["mounts"] == ["mount_horse"] and c["pets"] == [] and c["auras"] == [] and c["titles"] == [] and c["skins"] == []
    st = game.season_state(h5)
    still = [o["id"] for o in shop.OFFERS if o["kind"] in ("pet", "mount", "skin", "aura", "title") and o["id"] != "mount_horse"
             and shop.owned(o, c, st)]
    assert not still, still
    print("ok  com o Passe Premium, comprar 1 item dá só esse item e cobra uma vez")


if __name__ == "__main__":
    asyncio.run(run_all())


def test_shop() -> None:
    asyncio.run(run_all())
