"""
Player market (at Dorian, in town): players list bag items at a fixed price; anyone can buy them,
even while the seller is offline.

  • Listing takes the item out of the seller's bag and costs LISTING_FEE of the price (not refunded).
  • A sale pays the seller price − SALES_TAX into their collection box; both fees are gold sinks.
  • Listings last LISTING_HOURS; expired or cancelled items go back (bag, or the collection box if full).
  • The collection box (gold + items) is emptied at the market; nothing is ever lost to a full bag.

Pure bookkeeping — game.py checks distance, gold and bag space and moves things in and out of bags.
The whole market is saved as one JSON document (to_json/from_json).
"""

from __future__ import annotations

import math
import time
from dataclasses import asdict, dataclass, field
from typing import Any

import items as inv

MAX_LISTINGS = 10
LISTING_HOURS = 48
LISTING_FEE = 0.02
SALES_TAX = 0.08
MIN_PRICE, MAX_PRICE = 1, 10_000_000
PAGE_SIZE = 7

CATEGORIES = {
    "all": "Tudo",
    "gear": "Equipamentos",
    "mining": "Mineração",
    "potion": "Poções",
    "material": "Materiais",
}


def category(item_id: str) -> str:
    it = inv.ITEMS[item_id]
    if it["type"] == "gear":
        return "gear"
    if item_id == "pickaxe" or item_id.startswith(("ore_", "stone_")):
        return "mining"
    if it["type"] == "potion":
        return "potion"
    return "material"


def listing_fee(price: int) -> int:
    return max(1, math.ceil(price * LISTING_FEE))


def seller_gets(price: int) -> int:
    return price - math.ceil(price * SALES_TAX)


@dataclass
class Listing:
    id: int
    seller: str
    seller_name: str
    item: dict[str, Any]     # {"id", "qty", "plus"?, "ref"?}
    price: int
    created: float
    expires: float

    def public(self, now: float) -> dict[str, Any]:
        return {"id": self.id, "seller": self.seller_name, "item": self.item, "price": self.price,
                "left": max(0, int(self.expires - now))}


@dataclass
class Market:
    listings: dict[int, Listing] = field(default_factory=dict)
    claims: dict[str, dict[str, Any]] = field(default_factory=dict)  # char_id → {"gold": n, "items": [...]}
    next_id: int = 1
    dirty: bool = False

    # ── queries ──────────────────────────────────────────────────────────

    def mine(self, cid: str) -> list[Listing]:
        return sorted((l for l in self.listings.values() if l.seller == cid), key=lambda l: l.expires)

    def search(self, cat: str = "all", sort: str = "price", page: int = 0) -> tuple[list[Listing], int]:
        rows = [l for l in self.listings.values() if cat == "all" or category(l.item["id"]) == cat]
        if sort == "new":
            rows.sort(key=lambda l: -l.created)
        else:  # cheapest per unit first
            rows.sort(key=lambda l: (l.price / max(1, l.item["qty"]), l.id))
        pages = max(1, math.ceil(len(rows) / PAGE_SIZE))
        page = max(0, min(page, pages - 1))
        return rows[page * PAGE_SIZE:(page + 1) * PAGE_SIZE], pages

    def box(self, cid: str) -> dict[str, Any]:
        return self.claims.get(cid) or {"gold": 0, "items": []}

    # ── changes ──────────────────────────────────────────────────────────

    def check_listing(self, cid: str, item: dict[str, Any], price: int) -> str | None:
        if not (MIN_PRICE <= price <= MAX_PRICE):
            return f"O preço precisa ficar entre {MIN_PRICE} e {MAX_PRICE} ouro."
        if len(self.mine(cid)) >= MAX_LISTINGS:
            return f"Você já tem {MAX_LISTINGS} anúncios. Cancele um ou espere vender."
        return None

    def add(self, cid: str, name: str, item: dict[str, Any], price: int) -> Listing:
        now = time.time()
        listing = Listing(self.next_id, cid, name, item, price, now, now + LISTING_HOURS * 3600)
        self.listings[listing.id] = listing
        self.next_id += 1
        self.dirty = True
        return listing

    def take(self, listing_id: int) -> Listing | None:
        listing = self.listings.pop(listing_id, None)
        if listing:
            self.dirty = True
        return listing

    def credit(self, cid: str, gold: int = 0, item: dict[str, Any] | None = None) -> None:
        box = self.claims.setdefault(cid, {"gold": 0, "items": []})
        box["gold"] += gold
        if item:
            box["items"].append(item)
        self.dirty = True

    def expire(self, now: float | None = None) -> list[Listing]:
        """Moves expired listings' items into their sellers' collection boxes."""
        now = time.time() if now is None else now
        gone = [l for l in self.listings.values() if l.expires <= now]
        for l in gone:
            del self.listings[l.id]
            self.credit(l.seller, item=l.item)
        return gone

    # ── persistence ──────────────────────────────────────────────────────

    def to_json(self) -> dict[str, Any]:
        return {"listings": [asdict(l) for l in self.listings.values()], "claims": self.claims, "next_id": self.next_id}

    @classmethod
    def from_json(cls, data: dict[str, Any] | None) -> Market:
        m = cls()
        if not data:
            return m
        for d in data.get("listings", []):
            if d.get("item", {}).get("id") in inv.ITEMS:  # an item removed from the catalog is dropped
                m.listings[int(d["id"])] = Listing(**{**d, "id": int(d["id"])})
        m.claims = {cid: {"gold": int(b.get("gold", 0)), "items": [i for i in b.get("items", []) if i.get("id") in inv.ITEMS]}
                    for cid, b in (data.get("claims") or {}).items()}
        m.next_id = max([int(data.get("next_id", 1))] + [l.id + 1 for l in m.listings.values()])
        return m
