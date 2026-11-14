"""
Market test: listing takes the item out of the bag and charges the fee; buying moves the gold (with
the sales tax) and the item (keeping +N and refinement) — never duplicating or losing anything; the
seller is paid through the collection box even when offline; cancel and expiry give items back; limits;
and the market survives a save/load round trip.
Run: .venv/Scripts/python.exe test_market.py   (or -m pytest test_market.py -q)
"""

from __future__ import annotations

import asyncio
import time

import items as inv
import market as mk
from game import Game
from test_skills import _hero, _noop_save
from websocket_manager import manager
from world_data import MAPS


async def run_all() -> None:
    saved = {}

    async def save_market() -> None:
        saved["market"] = game.market.to_json()

    game = Game(_noop_save, save_market)
    dorian = next(n for n in MAPS["town_01"]["npcs"] if n["id"] == "merchant")
    seller, sws = _hero(game, "blade_master", "town_01", dorian["x"] + 1, dorian["y"])
    buyer, bws = _hero(game, "night_ranger", "town_01", dorian["x"] - 1, dorian["y"])
    seller.name, buyer.name = "Arthur", "Lyra"
    seller.bag = [{"id": "sword_t2", "qty": 1, "plus": 7, "ref": {"crit": 0.02}}, {"id": "ore_gold", "qty": 10}]
    seller.gold, buyer.gold = 1000, 5000
    buyer.bag = []

    # the market only works next to Dorian, opened from his dialog
    assert await game.market_sell(seller, 0, "sword_t2", 1, 2000) == "Fale com Dorian para usar o Mercado."
    await game.talk(seller, "merchant")
    assert any(o["id"] == "market" for o in next(m for m in sws.sent if m["type"] == "dialog")["options"])
    for h in (seller, buyer):
        await game.dialog_option(h, "market")
    assert seller.shop == "market" and any(m["type"] == "market" for m in sws.sent)
    print("ok  mercado abre pelo Dorian")

    # listing: item leaves the bag, fee is charged, limits apply
    assert await game.market_sell(seller, 0, "sword_t2", 1, 0) is not None          # price too low
    assert await game.market_sell(seller, 0, "sword_t2", 1, 2000) is None
    assert inv.count(seller.bag, "sword_t2") == 0 and seller.gold == 1000 - mk.listing_fee(2000)
    assert await game.market_sell(seller, 0, "ore_gold", 4, 400) is None            # part of a stack
    assert inv.count(seller.bag, "ore_gold") == 6 and len(game.market.mine(seller.char_id)) == 2
    print("ok  anunciar tira o item da bolsa e cobra a taxa de 2%")

    # buying: gold and item move once; +N and refinement are kept; the seller is paid with tax
    sword = next(l for l in game.market.listings.values() if l.item["id"] == "sword_t2")
    assert await game.market_buy(seller, sword.id) is not None                      # own listing
    buyer.gold = 100
    assert await game.market_buy(buyer, sword.id) == "Ouro insuficiente."
    buyer.gold = 5000
    assert await game.market_buy(buyer, sword.id) is None
    assert buyer.gold == 3000 and buyer.bag == [{"id": "sword_t2", "qty": 1, "plus": 7, "ref": {"crit": 0.02}}]
    assert game.market.box(seller.char_id)["gold"] == mk.seller_gets(2000) == 1840
    assert await game.market_buy(buyer, sword.id) is not None                       # already sold
    assert any(m["type"] == "notice" and "Vendido no Mercado" in m["text"] for m in sws.sent)
    print("ok  comprar: ouro e item mudam de dono uma vez só, com +7 e refino, e o vendedor recebe com 8% de imposto")

    # the seller can be offline: payment waits in the collection box
    ore = next(l for l in game.market.listings.values() if l.item["id"] == "ore_gold")
    game.heroes.pop(seller.char_id)
    assert await game.market_buy(buyer, ore.id) is None and inv.count(buyer.bag, "ore_gold") == 4
    game.heroes[seller.char_id] = seller
    gold = seller.gold
    assert await game.market_collect(seller) is None
    assert seller.gold == gold + 1840 + mk.seller_gets(400) and game.market.box(seller.char_id)["gold"] == 0
    print("ok  vendedor offline recebe pela caixa de coleta")

    # cancel gives the item back; expiry sends it to the collection box
    assert await game.market_sell(seller, 0, "ore_gold", 6, 900) is None
    lid = game.market.mine(seller.char_id)[0].id
    assert await game.market_cancel(buyer, lid) is not None
    assert await game.market_cancel(seller, lid) is None and inv.count(seller.bag, "ore_gold") == 6
    assert await game.market_sell(seller, 0, "ore_gold", 6, 900) is None
    gone = game.market.expire(time.time() + mk.LISTING_HOURS * 3600 + 1)
    assert len(gone) == 1 and game.market.box(seller.char_id)["items"][0]["qty"] == 6
    seller.bag = [{"id": "sword_t1", "qty": 1}] * inv.BAG_SLOTS                     # full bag
    assert await game.market_collect(seller) is None and game.market.box(seller.char_id)["items"]  # kept, not lost
    seller.bag = []
    assert await game.market_collect(seller) is None and inv.count(seller.bag, "ore_gold") == 6
    print("ok  cancelar devolve; expirar e bolsa cheia vão para a caixa de coleta, nada se perde")

    # at most MAX_LISTINGS per player
    seller.bag, seller.gold = [{"id": "ore_iron", "qty": 50}], 10000
    for _ in range(mk.MAX_LISTINGS):
        assert await game.market_sell(seller, 0, "ore_iron", 1, 10) is None
    assert "anúncios" in await game.market_sell(seller, 0, "ore_iron", 1, 10)
    print(f"ok  limite de {mk.MAX_LISTINGS} anúncios por jogador")

    # search pages / categories, and the saved market comes back the same
    rows, pages = game.market.search("mining", "price", 0)
    assert len(rows) == mk.PAGE_SIZE and pages == 2 and all(mk.category(l.item["id"]) == "mining" for l in rows)
    assert game.market.search("gear")[0] == []
    copy = mk.Market.from_json(saved["market"])
    assert copy.to_json() == game.market.to_json()
    print("ok  busca por categoria e páginas; mercado salvo e carregado igual")


if __name__ == "__main__":
    asyncio.run(run_all())


def test_market() -> None:
    asyncio.run(run_all())
