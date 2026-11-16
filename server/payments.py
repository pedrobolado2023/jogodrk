"""
Real-money purchases with Mercado Pago (Checkout Pro: the player pays by Pix or card on Mercado Pago's own page,
so card data never touches this server).

Flow:
  1. POST /pay/checkout {product, character_id}: we save a Payment and ask Mercado Pago for a checkout link
     (our Payment id goes as external_reference); the client opens the link.
  2. Mercado Pago calls POST /pay/webhook when the payment changes. We check its signature (MP_WEBHOOK_SECRET) and
     never trust its body: we read the payment back from Mercado Pago with our token.
  3. Approved (and the right amount in BRL) → the purchase is delivered once: gems or the Premium pass to the hero,
     VIP to the whole account. GET /pay/check/{ref} does the same on demand (the player is back from the checkout
     before the webhook arrived, or the webhook was lost).
  4. Refunded or charged back after delivery → what is left of the purchase is taken back once (spent gems cannot
     be, and the log says how many were missing).
Player-facing text is in Portuguese.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import time
import urllib.error
import urllib.request
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select

import items as inv
import season as ssn
import vip
from auth import current_user
from config import MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET, PUBLIC_API_URL, PUBLIC_SITE_URL
from models import Character, Payment, User, VipStatus
from websocket_manager import manager

MP_API = "https://api.mercadopago.com"

# id → what it is and its price in reais (the server's price is the only one that counts)
PRODUCTS: dict[str, dict[str, Any]] = {
    "gems_500": {"kind": "gems", "gems": 500, "price": 5.00, "title": "500 Gemas"},
    "gems_1100": {"kind": "gems", "gems": 1100, "price": 10.00, "title": "1.100 Gemas"},
    "gems_3000": {"kind": "gems", "gems": 3000, "price": 25.00, "title": "3.000 Gemas"},
    "gems_6500": {"kind": "gems", "gems": 6500, "price": 50.00, "title": "6.500 Gemas"},
    "gems_14000": {"kind": "gems", "gems": 14000, "price": 100.00, "title": "14.000 Gemas"},
    "pass_premium": {"kind": "pass", "price": 19.90, "title": "Passe de Temporada Premium"},
    "vip_1": {"kind": "vip", "tier": 1, "price": 10.00, "title": "VIP 1 (30 dias)"},
    "vip_3": {"kind": "vip", "tier": 3, "price": 25.00, "title": "VIP 3 (30 dias)"},
    "vip_7": {"kind": "vip", "tier": 7, "price": 60.00, "title": "VIP 7 (30 dias)"},
}
FINAL = {"approved", "rejected", "cancelled", "refunded", "charged_back"}


def enabled() -> bool:
    return bool(MP_ACCESS_TOKEN)


def catalog() -> dict[str, Any]:
    """What the client shows (prices come from here)."""
    return {"enabled": enabled(), "products": {k: {kk: v for kk, v in p.items()} for k, p in PRODUCTS.items()},
            "vip": {"max": vip.MAX_LEVEL, "days": vip.DAYS, "bonus_per_level": vip.BONUS_PER_LEVEL,
                    "gems_per_level": vip.GEMS_PER_LEVEL, "bag_per_level": vip.BAG_PER_LEVEL,
                    "auras": [{"id": a, "name": n, "level": lv} for a, n, _, lv in vip.AURAS]}}


# ── Mercado Pago HTTP (standard library, in a worker thread) ─────────────

def _mp_call(method: str, path: str, body: dict | None = None, idempotency: str | None = None) -> dict[str, Any]:
    req = urllib.request.Request(MP_API + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Authorization", f"Bearer {MP_ACCESS_TOKEN}")
    req.add_header("Content-Type", "application/json")
    if idempotency:
        req.add_header("X-Idempotency-Key", idempotency)
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as e:
        detail = e.read()[:300].decode(errors="replace")
        print(f"[pay] Mercado Pago {method} {path} → {e.code}: {detail}", flush=True)
        raise HTTPException(502, "O Mercado Pago não respondeu como esperado. Tente de novo em instantes.")
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"[pay] Mercado Pago {method} {path} failed: {e}", flush=True)
        raise HTTPException(502, "Não foi possível falar com o Mercado Pago. Tente de novo em instantes.")


async def mp(method: str, path: str, body: dict | None = None, idempotency: str | None = None) -> dict[str, Any]:
    return await asyncio.to_thread(_mp_call, method, path, body, idempotency)


def valid_signature(headers: dict[str, str], data_id: str) -> bool:
    """Mercado Pago's x-signature: "ts=…,v1=…", an HMAC-SHA256 of "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"."""
    if not MP_WEBHOOK_SECRET:
        return True  # no secret configured: we still read the payment back from Mercado Pago before trusting it
    parts = dict(p.strip().split("=", 1) for p in headers.get("x-signature", "").split(",") if "=" in p)
    ts, v1 = parts.get("ts", ""), parts.get("v1", "")
    if not ts or not v1:
        return False
    did = data_id.lower() if data_id.isalnum() else data_id
    manifest = f"id:{did};request-id:{headers.get('x-request-id', '')};ts:{ts};"
    expected = hmac.new(MP_WEBHOOK_SECRET.encode(), manifest.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, v1)


# ── VIP on heroes ─────────────────────────────────────────────────────────

async def apply_vip(game, hero, level: int, until: float, push: bool = True) -> None:
    """Puts the account's VIP on a live hero: bonus, bag spaces, VIP title and auras."""
    hero.vip_level, hero.vip_until = level, until
    lv = vip.active_level(level, until)
    if isinstance(hero.bag, inv.Bag):
        hero.bag.cap = inv.BAG_SLOTS + vip.bag_extra(lv)
    hero.cosmetics = vip.sync_cosmetics(ssn.cosmetics(hero.cosmetics), lv)
    if hero.title.startswith("vip_") and not game.can_wear_title(hero, hero.title):
        hero.title = f"vip_{lv}" if lv else ""
        await game.sync_title(hero)
    if push:
        await game.push_hero(hero)
        await game.push_inventory(hero)
        await game.send(hero.char_id, {"type": "vip", **vip.public(level, until)})


class Checkout(BaseModel):
    product: str
    character_id: str


def make_router(game, session_factory: Callable[[], Any], save_hero: Callable[[Any], Awaitable[None]]) -> APIRouter:
    router = APIRouter(prefix="/pay")
    lock = asyncio.Lock()  # one delivery at a time (the server runs as a single process)

    async def deliver(pay: Payment) -> str:
        """Gives what was bought. Called once per payment, inside the lock, after it was marked approved."""
        prod = PRODUCTS[pay.product]
        hero = game.heroes.get(pay.character_id)
        if prod["kind"] == "gems":
            if hero:
                hero.gems += prod["gems"]
                await game.push_hero(hero)
                await save_hero(hero)
            else:
                async with session_factory() as db:
                    char = await db.get(Character, pay.character_id)
                    if char:
                        char.gems = int(char.gems or 0) + prod["gems"]
                        await db.commit()
            return f"+{prod['gems']} gemas"
        if prod["kind"] == "pass":
            if hero:
                game.season_state(hero)["premium"] = True
                await game.push_season(hero)
                await save_hero(hero)
            else:
                async with session_factory() as db:
                    char = await db.get(Character, pay.character_id)
                    if char:
                        state = dict(ssn.fresh(char.season))
                        state["premium"] = True
                        char.season = state
                        await db.commit()
            return "Passe Premium liberado"
        # VIP: the whole account
        async with session_factory() as db:
            row = await db.get(VipStatus, pay.user_id)
            if not row:
                row = VipStatus(user_id=pay.user_id, level=0, until=0.0)
                db.add(row)
            row.level, row.until = vip.after_purchase(row.level or 0, row.until or 0.0, prod["tier"])
            level, until = row.level, row.until
            ids = (await db.scalars(select(Character.id).where(Character.user_id == pay.user_id))).all()
            await db.commit()
        for cid in ids:
            h = game.heroes.get(cid)
            if h:
                await apply_vip(game, h, level, until)
                await save_hero(h)
        return f"VIP {level} ativo por {vip.DAYS} dias"

    async def take_back(pay: Payment) -> str:
        """Refund or chargeback of a delivered purchase: takes back what is left of it. Gems already spent cannot be
        taken (the shortfall goes to the log for the admin to review); the Premium pass is switched off; VIP loses
        its 30 days."""
        prod = PRODUCTS[pay.product]
        hero = game.heroes.get(pay.character_id)
        if prod["kind"] == "gems":
            want = prod["gems"]
            if hero:
                took = min(want, max(0, hero.gems))
                hero.gems -= took
                await game.push_hero(hero)
                await save_hero(hero)
            else:
                took = 0
                async with session_factory() as db:
                    char = await db.get(Character, pay.character_id)
                    if char:
                        took = min(want, max(0, int(char.gems or 0)))
                        char.gems = int(char.gems or 0) - took
                        await db.commit()
            return f"-{took} gemas" + (f" (faltaram {want - took}, já gastas)" if took < want else "")
        if prod["kind"] == "pass":
            if hero:
                game.season_state(hero)["premium"] = False
                await game.push_season(hero)
                await save_hero(hero)
            else:
                async with session_factory() as db:
                    char = await db.get(Character, pay.character_id)
                    if char:
                        state = dict(ssn.fresh(char.season))
                        state["premium"] = False
                        char.season = state
                        await db.commit()
            return "Passe Premium removido"
        async with session_factory() as db:
            row = await db.get(VipStatus, pay.user_id)
            if not row:
                return "VIP já não existia"
            row.until = max(0.0, (row.until or 0.0) - vip.DAYS * 86400)
            level, until = row.level or 0, row.until
            ids = (await db.scalars(select(Character.id).where(Character.user_id == pay.user_id))).all()
            await db.commit()
        for cid in ids:
            h = game.heroes.get(cid)
            if h:
                await apply_vip(game, h, level, until)
                await save_hero(h)
        return f"VIP perdeu {vip.DAYS} dias"

    async def sync(mp_payment: dict[str, Any]) -> Payment | None:
        """Brings our Payment up to date with Mercado Pago's payment, and delivers it when approved."""
        ref = str(mp_payment.get("external_reference") or "")
        status = str(mp_payment.get("status") or "")
        async with lock:
            async with session_factory() as db:
                pay = await db.get(Payment, ref) if ref else None
                if not pay:
                    return None
                pay.mp_payment_id = str(mp_payment.get("id") or pay.mp_payment_id or "") or None
                if status == "approved":
                    amount = float(mp_payment.get("transaction_amount") or 0)
                    if mp_payment.get("currency_id") != "BRL" or amount + 0.001 < pay.amount:
                        print(f"[pay] {pay.id}: approved with a wrong amount ({amount} {mp_payment.get('currency_id')})", flush=True)
                        pay.status = "wrong_amount"
                        await db.commit()
                        return pay
                if not (pay.status == "approved" and status != "approved" and status not in ("refunded", "charged_back")):
                    pay.status = status or pay.status
                give = pay.status == "approved" and not pay.delivered
                if give:
                    pay.delivered = True
                undo = pay.status in ("refunded", "charged_back") and pay.delivered
                if undo:
                    pay.delivered = False  # taken back once
                await db.commit()
            if undo:
                what = await take_back(pay)
                print(f"[pay] {pay.id} {pay.status}: {pay.product} taken back → {what}", flush=True)
                if pay.character_id in game.heroes:
                    await game.notice(pay.character_id, f"Uma compra foi estornada no Mercado Pago, então ela foi retirada: {what}.", "warn")
                return pay
            if give:
                what = await deliver(pay)
                print(f"[pay] {pay.id} approved: {pay.product} → {what}", flush=True)
                if pay.character_id in game.heroes:
                    await game.notice(pay.character_id, f"Pagamento aprovado! {what}. Obrigado pelo apoio!", "quest")
            return pay

    @router.get("/catalog")
    async def get_catalog():
        return catalog()

    @router.get("/vip")
    async def my_vip(user: User = Depends(current_user)):
        async with session_factory() as db:
            row = await db.get(VipStatus, user.id)
        return vip.public(row.level, row.until) if row else vip.public(0, 0)

    @router.post("/checkout")
    async def checkout(req: Checkout, user: User = Depends(current_user)):
        if not enabled():
            raise HTTPException(503, "As compras ainda não estão abertas.")
        prod = PRODUCTS.get(req.product)
        if not prod:
            raise HTTPException(400, "Produto inválido.")
        async with session_factory() as db:
            char = await db.get(Character, req.character_id)
            if not char or char.user_id != user.id:
                raise HTTPException(404, "Herói não encontrado.")
            pay = Payment(user_id=user.id, character_id=char.id, product=req.product, amount=prod["price"], status="created")
            db.add(pay)
            await db.commit()
            ref, hero_name = pay.id, char.name
        site = PUBLIC_SITE_URL.rstrip("/")
        body: dict[str, Any] = {
            "items": [{"id": req.product, "title": f"Dark Fantasy — {prod['title']}", "description": f"Para o herói {hero_name}",
                       "quantity": 1, "currency_id": "BRL", "unit_price": prod["price"]}],
            "external_reference": ref,
            "statement_descriptor": "DARKFANTASY",
            # Pix and cards only (no boleto / lottery payment)
            "payment_methods": {"excluded_payment_types": [{"id": "ticket"}, {"id": "atm"}]},
            "metadata": {"user_id": user.id, "character_id": req.character_id, "product": req.product},
        }
        if site:
            body["back_urls"] = {k: f"{site}/?pagamento={v}&ref={ref}" for k, v in
                                 (("success", "aprovado"), ("pending", "pendente"), ("failure", "falhou"))}
            body["auto_return"] = "approved"
        if PUBLIC_API_URL:
            body["notification_url"] = f"{PUBLIC_API_URL.rstrip('/')}/pay/webhook"
        pref = await mp("POST", "/checkout/preferences", body, idempotency=ref)
        url = pref.get("init_point")
        if not url:
            raise HTTPException(502, "O Mercado Pago não devolveu o link de pagamento.")
        print(f"[pay] checkout {ref}: {user.username} → {req.product} ({prod['price']:.2f})", flush=True)
        return {"ref": ref, "url": url}

    @router.post("/webhook")
    async def webhook(request: Request):
        q = request.query_params
        try:
            body = await request.json()
        except Exception:
            body = {}
        kind = q.get("type") or q.get("topic") or body.get("type") or body.get("topic") or ""
        data_id = q.get("data.id") or q.get("id") or str((body.get("data") or {}).get("id") or "")
        if kind != "payment" or not data_id.isdigit():
            return {"ok": True}  # other notifications (merchant orders, tests) are not needed
        headers = {k.lower(): v for k, v in request.headers.items()}
        if not valid_signature(headers, data_id):
            print(f"[pay] webhook with an invalid signature for payment {data_id}", flush=True)
            raise HTTPException(401, "assinatura inválida")
        if enabled():
            await sync(await mp("GET", f"/v1/payments/{data_id}"))
        return {"ok": True}

    @router.get("/check/{ref}")
    async def check(ref: str, user: User = Depends(current_user)):
        """The player came back from the checkout: look the payment up now (and deliver it if approved)."""
        async with session_factory() as db:
            pay = await db.get(Payment, ref)
            if not pay or pay.user_id != user.id:
                raise HTTPException(404, "Compra não encontrada.")
            status, product = pay.status, pay.product
        if status not in FINAL and enabled():
            found = await mp("GET", f"/v1/payments/search?external_reference={ref}&sort=date_created&criteria=desc")
            results = found.get("results") or []
            approved = next((r for r in results if r.get("status") == "approved"), None)
            if approved or results:
                pay2 = await sync(approved or results[0])
                status = pay2.status if pay2 else status
        messages = {"approved": "Pagamento aprovado! Sua compra já foi entregue.",
                    "pending": "Pagamento em análise. Assim que o Mercado Pago confirmar, a compra chega sozinha.",
                    "in_process": "Pagamento em análise. Assim que o Mercado Pago confirmar, a compra chega sozinha.",
                    "created": "Ainda não recebemos o pagamento. Se você pagou com Pix, ele chega em instantes.",
                    "rejected": "O pagamento foi recusado. Tente outro cartão ou pague com Pix.",
                    "cancelled": "O pagamento foi cancelado."}
        return {"status": status, "product": product, "message": messages.get(status, "Situação: " + status)}

    return router
