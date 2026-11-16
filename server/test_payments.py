"""Payments and VIP tests, with a fake Mercado Pago (nothing is charged) and a disposable SQLite database.
Run: .venv/Scripts/python.exe test_payments.py
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import tempfile
import time
from pathlib import Path

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import main
import payments
import vip
from auth import make_token
from models import Base, Character, CharacterClass, Payment, User, VipStatus


async def call(method: str, path: str, token: str | None = None, body: dict | None = None,
               headers: dict[str, str] | None = None) -> tuple[int, dict]:
    raw = json.dumps(body).encode() if body is not None else b""
    path, _, query = path.partition("?")
    hs = [(b"content-type", b"application/json")] + [(k.encode(), v.encode()) for k, v in (headers or {}).items()]
    if token:
        hs.append((b"authorization", f"Bearer {token}".encode()))
    scope = {"type": "http", "method": method, "path": path, "raw_path": path.encode(), "query_string": query.encode(),
             "headers": hs, "client": ("test", 1), "server": ("test", 80), "scheme": "http", "http_version": "1.1",
             "root_path": "", "app": main.app}
    out: dict = {"status": 0, "body": b""}
    sent = False

    async def receive():
        nonlocal sent
        if sent:
            return {"type": "http.disconnect"}
        sent = True
        return {"type": "http.request", "body": raw, "more_body": False}

    async def send(msg):
        if msg["type"] == "http.response.start":
            out["status"] = msg["status"]
        elif msg["type"] == "http.response.body":
            out["body"] += msg.get("body", b"")

    await main.app(scope, receive, send)
    return out["status"], json.loads(out["body"] or b"{}")


class FakeMP:
    """Answers like Mercado Pago: preferences, payments by id and payment search."""

    def __init__(self):
        self.payments: dict[str, dict] = {}
        self.calls: list[tuple[str, str, dict | None]] = []

    async def __call__(self, method, path, body=None, idempotency=None):
        self.calls.append((method, path, body))
        if path == "/checkout/preferences":
            return {"id": "pref-1", "init_point": "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-1"}
        if path.startswith("/v1/payments/search"):
            ref = path.split("external_reference=")[1].split("&")[0]
            return {"results": [p for p in self.payments.values() if p["external_reference"] == ref]}
        if path.startswith("/v1/payments/"):
            return self.payments[path.rsplit("/", 1)[1]]
        raise AssertionError(path)

    def pay(self, pid: str, ref: str, amount: float, status: str = "approved", currency: str = "BRL"):
        self.payments[pid] = {"id": int(pid), "external_reference": ref, "status": status,
                              "transaction_amount": amount, "currency_id": currency}


def signed(pid: str, secret: str, request_id: str = "req-1") -> dict[str, str]:
    ts = str(int(time.time()))
    v1 = hmac.new(secret.encode(), f"id:{pid};request-id:{request_id};ts:{ts};".encode(), hashlib.sha256).hexdigest()
    return {"x-signature": f"ts={ts},v1={v1}", "x-request-id": request_id}


def vip_rules():
    now = 1_000_000.0
    day = 86400
    assert vip.after_purchase(0, 0, 3, now) == (3, now + 30 * day)                 # first purchase: the level bought
    assert vip.after_purchase(3, now + 10 * day, 1, now) == (4, now + 40 * day)    # renewing while VIP: +1 level, +30 days
    assert vip.after_purchase(4, now + 5 * day, 7, now) == (7, now + 35 * day)     # buying a higher tier jumps to it
    assert vip.after_purchase(7, now + 5 * day, 1, now) == (7, now + 35 * day)     # never above 7
    assert vip.after_purchase(6, now - 1, 1, now) == (1, now + 30 * day)           # expired: starts again from the tier
    assert vip.active_level(5, now - 1, now) == 0 and vip.active_level(5, now + 1, now) == 5
    assert vip.bonus(7) == 0.35 and vip.daily_gems(3) == 30 and vip.bag_extra(2) == 20
    cos = vip.sync_cosmetics({"titles": ["nobre", "vip_2"], "auras": ["aura_sangue", "aura_vip_7"], "aura": "aura_vip_7"}, 5)
    assert cos["titles"] == ["nobre", "vip_5"] and cos["auras"] == ["aura_sangue", "aura_vip_3", "aura_vip_5"] and cos["aura"] == ""
    cos = vip.sync_cosmetics(cos, 0)
    assert cos["titles"] == ["nobre"] and cos["auras"] == ["aura_sangue"]
    print("ok vip rules")


async def run_all():
    vip_rules()
    fake = FakeMP()
    saved = (main.async_session, main.engine, payments.mp, payments.MP_ACCESS_TOKEN, payments.MP_WEBHOOK_SECRET)
    with tempfile.TemporaryDirectory(prefix="game-pay-") as temp:
        engine = create_async_engine("sqlite+aiosqlite:///" + (Path(temp) / "test.db").as_posix())
        main.engine, main.async_session = engine, async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            async with main.async_session() as db:
                buyer = User(username="comprador", email="c@x.local", password_hash="x")
                other = User(username="outro", email="o@x.local", password_hash="x")
                db.add_all([buyer, other])
                await db.flush()
                hero = Character(user_id=buyer.id, name="Comprador", char_class=CharacterClass.NIGHT_RANGER, gems=10)
                alt = Character(user_id=buyer.id, name="Segundo", char_class=CharacterClass.BLADE_MASTER)
                theirs = Character(user_id=other.id, name="Alheio", char_class=CharacterClass.BLADE_MASTER)
                db.add_all([hero, alt, theirs])
                await db.commit()
                uid, cid, theirs_id = buyer.id, hero.id, theirs.id
            tok = make_token(uid)

            # closed until the token is set
            payments.MP_ACCESS_TOKEN = ""
            assert (await call("POST", "/pay/checkout", tok, {"product": "gems_1100", "character_id": cid}))[0] == 503
            assert (await call("GET", "/pay/catalog"))[1]["enabled"] is False
            payments.MP_ACCESS_TOKEN, payments.mp, payments.MP_WEBHOOK_SECRET = "TEST-TOKEN", fake, "segredo"
            assert (await call("POST", "/pay/checkout", tok, {"product": "nada", "character_id": cid}))[0] == 400
            assert (await call("POST", "/pay/checkout", tok, {"product": "gems_1100", "character_id": theirs_id}))[0] == 404
            assert (await call("POST", "/pay/checkout", None, {"product": "gems_1100", "character_id": cid}))[0] == 401
            code, body = await call("POST", "/pay/checkout", tok, {"product": "gems_1100", "character_id": cid})
            assert code == 200 and body["url"].startswith("https://www.mercadopago.com.br/"), body
            ref = body["ref"]
            pref = fake.calls[-1][2]
            assert pref["items"][0]["unit_price"] == 10.0 and pref["items"][0]["currency_id"] == "BRL"
            assert pref["external_reference"] == ref
            assert {"id": "ticket"} in pref["payment_methods"]["excluded_payment_types"]  # Pix and cards only
            print("ok checkout")

            # webhook: bad signature refused; the body is never trusted, the payment is read back
            fake.pay("111", ref, 10.0)
            assert (await call("POST", "/pay/webhook?data.id=111&type=payment", body={"type": "payment"},
                               headers={"x-signature": "ts=1,v1=errado", "x-request-id": "r"}))[0] == 401
            async with main.async_session() as db:
                assert (await db.get(Character, cid)).gems == 10
            for _ in range(3):  # Mercado Pago retries: delivered only once
                code, _ = await call("POST", "/pay/webhook?data.id=111&type=payment", body={"type": "payment", "data": {"id": "111"}},
                                     headers=signed("111", "segredo"))
                assert code == 200
            async with main.async_session() as db:
                assert (await db.get(Character, cid)).gems == 1110
                pay = await db.get(Payment, ref)
                assert pay.status == "approved" and pay.delivered and pay.mp_payment_id == "111"
            code, body = await call("GET", f"/pay/check/{ref}", tok)
            assert code == 200 and body["status"] == "approved"
            assert (await call("GET", f"/pay/check/{ref}", make_token(other.id)))[0] == 404
            print("ok webhook delivers once")

            # paid less than the price: not delivered
            _, body = await call("POST", "/pay/checkout", tok, {"product": "gems_14000", "character_id": cid})
            fake.pay("222", body["ref"], 1.0)
            await call("POST", "/pay/webhook?data.id=222&type=payment", headers=signed("222", "segredo"))
            async with main.async_session() as db:
                assert (await db.get(Character, cid)).gems == 1110
                assert (await db.get(Payment, body["ref"])).status == "wrong_amount"
            print("ok wrong amount refused")

            # Pix still pending, then the player checks after paying (no webhook)
            _, body = await call("POST", "/pay/checkout", tok, {"product": "pass_premium", "character_id": cid})
            pref_ref = body["ref"]
            fake.pay("333", pref_ref, 19.9, status="pending")
            assert (await call("GET", f"/pay/check/{pref_ref}", tok))[1]["status"] == "pending"
            fake.pay("333", pref_ref, 19.9)
            assert (await call("GET", f"/pay/check/{pref_ref}", tok))[1]["status"] == "approved"
            async with main.async_session() as db:
                assert (await db.get(Character, cid)).season["premium"] is True
            print("ok pass via check")

            # VIP: the whole account, up one level when renewed
            for n, (product, amount) in enumerate((("vip_3", 25.0), ("vip_1", 10.0))):
                _, body = await call("POST", "/pay/checkout", tok, {"product": product, "character_id": cid})
                fake.pay(str(400 + n), body["ref"], amount)
                await call("POST", f"/pay/webhook?data.id={400 + n}&type=payment", headers=signed(str(400 + n), "segredo"))
                body_vip_ref = body["ref"]
            async with main.async_session() as db:
                row = await db.get(VipStatus, uid)
                assert row.level == 4 and 59 * 86400 < row.until - time.time() <= 60 * 86400, (row.level, row.until)
            code, body = await call("GET", "/pay/vip", tok)
            assert body["level"] == 4 and body["bonus_pct"] == 20 and body["daily_gems"] == 40 and body["bag_extra"] == 40
            print("ok vip purchase")

            # refund / chargeback: what is left is taken back, once (Mercado Pago retries the notification)
            async with main.async_session() as db:
                (await db.get(Character, cid)).gems = 600  # 500 of the 1100 gems were already spent
                await db.commit()
            fake.pay("111", ref, 10.0, status="refunded")
            for _ in range(2):
                await call("POST", "/pay/webhook?data.id=111&type=payment", headers=signed("111", "segredo"))
            async with main.async_session() as db:
                assert (await db.get(Character, cid)).gems == 0
                pay = await db.get(Payment, ref)
                assert pay.status == "refunded" and not pay.delivered
            fake.pay("333", pref_ref, 19.9, status="charged_back")
            await call("POST", "/pay/webhook?data.id=333&type=payment", headers=signed("333", "segredo"))
            fake.pay("401", body_vip_ref, 10.0, status="refunded")
            await call("POST", "/pay/webhook?data.id=401&type=payment", headers=signed("401", "segredo"))
            async with main.async_session() as db:
                assert (await db.get(Character, cid)).season["premium"] is False
                row = await db.get(VipStatus, uid)
                assert 29 * 86400 < row.until - time.time() <= 30 * 86400, row.until
            print("ok refund and chargeback taken back")
        finally:
            main.async_session, main.engine, payments.mp, payments.MP_ACCESS_TOKEN, payments.MP_WEBHOOK_SECRET = saved
            await engine.dispose()


def test_payments():
    asyncio.run(run_all())


if __name__ == "__main__":
    test_payments()
    print("all payment tests passed")
