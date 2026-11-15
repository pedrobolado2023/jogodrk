"""Admin panel API tests, on a disposable SQLite database (never mmorpg_dev.db).
Run: .venv/Scripts/python.exe test_admin.py
"""
from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import admin
import main
from auth import make_token
from models import Base, Character, CharacterClass, User


async def call(method: str, path: str, token: str | None = None, body: dict | None = None) -> tuple[int, dict]:
    """One HTTP request straight into the app (no network, no extra packages)."""
    raw = json.dumps(body).encode() if body is not None else b""
    path, _, query = path.partition("?")
    headers = [(b"content-type", b"application/json")]
    if token:
        headers.append((b"authorization", f"Bearer {token}".encode()))
    scope = {"type": "http", "method": method, "path": path, "raw_path": path.encode(), "query_string": query.encode(),
             "headers": headers, "client": ("test", 1), "server": ("test", 80), "scheme": "http", "http_version": "1.1",
             "root_path": "", "app": main.app}
    sent = False
    out: dict = {"status": 0, "body": b""}

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


async def run_all():
    original_factory, original_engine = main.async_session, main.engine
    admin.ADMIN_USERS.clear()
    admin.ADMIN_USERS.add("chefe")
    with tempfile.TemporaryDirectory(prefix="game-admin-") as temp:
        engine = create_async_engine("sqlite+aiosqlite:///" + (Path(temp) / "test.db").as_posix())
        main.engine = engine
        main.async_session = async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            async with main.async_session() as db:
                boss = User(username="chefe", email="chefe@x.local", password_hash="x")
                player = User(username="jogador", email="jogador@x.local", password_hash="x")
                db.add_all([boss, player])
                await db.flush()
                char = Character(user_id=player.id, name="Heroi", char_class=CharacterClass.BLADE_MASTER, map_id="forest_01")
                db.add(char)
                await db.commit()
                boss_id, player_id, cid = boss.id, player.id, char.id
            boss_t, player_t = make_token(boss_id), make_token(player_id)

            # only admins get in
            assert (await call("GET", "/admin/overview"))[0] == 401
            code, body = await call("GET", "/admin/overview", player_t)
            assert code == 403 and "administradora" in body["detail"], (code, body)
            code, body = await call("GET", "/admin/overview", boss_t)
            assert code == 200 and body["accounts"] == 2 and body["characters"] == 1 and body["online"] == 0, body
            code, body = await call("GET", "/admin/me", boss_t)
            assert code == 200 and body["username"] == "chefe" and len(body["bosses"]) == 3
            print("ok admin only")

            code, body = await call("GET", "/admin/players?q=her", boss_t)
            assert code == 200 and [p["name"] for p in body["players"]] == ["Heroi"] and not body["players"][0]["online"]
            assert (await call("GET", "/admin/players?q=ninguem", boss_t))[1]["players"] == []
            assert (await call("GET", "/admin/players?online=true", boss_t))[1]["players"] == []
            assert any(i["id"] == "pot_hp_s" for i in (await call("GET", "/admin/items", boss_t))[1]["items"])
            print("ok players and items")

            # offline hero: changed in the database
            assert (await call("POST", f"/admin/character/{cid}/gold", boss_t, {"amount": 500}))[0] == 200
            assert (await call("POST", f"/admin/character/{cid}/gold", boss_t, {"amount": -9999}))[0] == 200
            assert (await call("POST", f"/admin/character/{cid}/gems", boss_t, {"amount": 25}))[0] == 200
            code, body = await call("POST", f"/admin/character/{cid}/item", boss_t, {"item": "pot_hp_s", "qty": 3})
            assert code == 400 and "entrar no jogo" in body["detail"]  # never played yet: no bag
            async with main.async_session() as db:
                c = await db.get(Character, cid)
                assert c.gold == 0 and c.gems == 25
                c.bag = []
                await db.commit()
            assert (await call("POST", f"/admin/character/{cid}/item", boss_t, {"item": "pot_hp_s", "qty": 3}))[0] == 200
            assert (await call("POST", f"/admin/character/{cid}/item", boss_t, {"item": "sword_t1"}))[0] == 200
            assert (await call("POST", f"/admin/character/{cid}/item", boss_t, {"item": "nada"}))[0] == 400
            assert (await call("POST", f"/admin/character/{cid}/town", boss_t))[0] == 200
            async with main.async_session() as db:
                c = await db.get(Character, cid)
                assert {"id": "pot_hp_s", "qty": 3} in c.bag and any(e["id"] == "sword_t1" for e in c.bag), c.bag
                assert c.map_id == main.START_MAP
            assert (await call("POST", "/admin/character/nao-existe/gold", boss_t, {"amount": 1}))[0] == 404
            assert (await call("POST", f"/admin/character/{cid}/kick", boss_t))[0] == 400       # not online
            assert (await call("POST", f"/admin/character/{cid}/message", boss_t, {"text": "oi"}))[0] == 400
            print("ok offline edits")

            # accounts
            assert (await call("POST", f"/admin/user/{boss_id}/ban", boss_t, {"banned": True}))[0] == 400  # not yourself
            assert (await call("POST", f"/admin/user/{player_id}/ban", boss_t, {"banned": True}))[0] == 200
            assert (await call("GET", "/characters", player_t))[0] == 403
            assert (await call("POST", f"/admin/user/{player_id}/ban", boss_t, {"banned": False}))[0] == 200
            assert (await call("GET", "/characters", player_t))[0] == 200
            print("ok ban")

            code, body = await call("POST", "/admin/broadcast", boss_t, {"text": "Manutenção às 22h"})
            assert code == 200 and "0 jogador" in body["message"]
            assert (await call("POST", "/admin/broadcast", boss_t, {"text": "   "}))[0] == 400
            code, body = await call("GET", "/admin/overview", boss_t)
            assert body["log"][0]["action"] == "aviso para todos" and len(body["log"]) >= 8
            print("ok broadcast and log")
        finally:
            main.async_session, main.engine = original_factory, original_engine
            await engine.dispose()
            admin.ADMIN_USERS.clear()


def test_admin():
    asyncio.run(run_all())


if __name__ == "__main__":
    test_admin()
    print("all admin tests passed")
