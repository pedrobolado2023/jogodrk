"""Account tests use only a disposable SQLite database, never mmorpg_dev.db.
Run: .venv/Scripts/python.exe test_auth.py
"""
from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import tempfile
from pathlib import Path

from fastapi import HTTPException
from starlette.requests import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import main
from auth import current_user, hash_password, make_token, verify_password, verify_token
from models import Base, Character, CharacterClass, User


def request(ip="auth-test"):
    # like behind Easypanel's proxy: the client may send anything first; the proxy appends the real address last
    return Request({"type": "http", "headers": [(b"x-forwarded-for", ("6.6.6.6, " + ip).encode())], "client": ("socket-ip", 1)})


async def fails(code, call):
    try:
        await call
    except HTTPException as err:
        assert err.status_code == code, (err.status_code, err.detail)
        return err.detail
    raise AssertionError(f"Expected HTTP {code}")


async def run_all():
    hashed = hash_password("senha-segura")
    assert hashed.startswith("scrypt$16384$8$1$")
    assert hashed != hash_password("senha-segura")
    assert verify_password("senha-segura", hashed)
    assert not verify_password("errada", hashed)
    assert not verify_password("senha-segura", hashlib.sha256(b"senha-segura").hexdigest())
    assert not verify_password("senha-segura", "scrypt$bad")
    token = make_token("user-1")
    assert verify_token(token) == "user-1"
    assert verify_token(make_token("user-1", -1)) is None
    assert verify_token(token + "x") is None
    assert verify_token("x" + token) is None
    assert verify_token("invalid") is None
    print("ok passwords and tokens")

    original_factory = main.async_session
    original_engine = main.engine
    with tempfile.TemporaryDirectory(prefix="game-auth-") as temp:
        engine = create_async_engine("sqlite+aiosqlite:///" + (Path(temp) / "test.db").as_posix())
        main.engine = engine
        main.async_session = async_sessionmaker(engine, expire_on_commit=False)
        main._auth_attempts.clear()
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            async with main.async_session() as db:
                first = await main.register(main.RegisterRequest(username="PlayerOne", password="password1"), request(), db)
                user = await db.get(User, first["user"]["id"])
                assert user.email == "playerone@sem-email.local"
                assert verify_token(first["token"]) == user.id
                await fails(409, main.register(main.RegisterRequest(username="PLAYERONE", password="password1"), request(), db))
                await fails(400, main.register(main.RegisterRequest(username="ab", password="password1"), request(), db))
                await fails(400, main.register(main.RegisterRequest(username="short", password="short"), request(), db))
                logged = await main.login(main.LoginRequest(username="PLAYERONE", password="password1"), request(), db)
                assert logged["user"]["id"] == user.id and user.last_login is not None
                wrong = await fails(401, main.login(main.LoginRequest(username="playerone", password="wrong"), request(), db))
                missing = await fails(401, main.login(main.LoginRequest(username="missing", password="wrong"), request(), db))
                assert wrong == missing == "Usuário ou senha incorretos"
                assert (await current_user("Bearer " + first["token"])).id == user.id
                await fails(401, current_user(None))
                await fails(401, current_user("Bearer " + make_token(user.id, -1)))
                other_data = await main.register(main.RegisterRequest(username="u_real", password="password2"), request("other"), db)
                other = await db.get(User, other_data["user"]["id"])
                char = await main.create_character(main.CreateCharRequest(name="Herói Um", char_class="blade_master"), user, db)
                cid = char["character_id"]
                assert (await main.get_character(cid, user, db))["name"] == "Herói Um"
                assert len(await main.list_characters(user, db)) == 1
                assert await main.list_characters(other, db) == []
                assert len((await main.me(user, db))["characters"]) == 1
                await fails(404, main.get_character(cid, other, db))
                await fails(403, main.claim(main.ClaimRequest(character_id=cid), other, db))
                real_char = await main.create_character(main.CreateCharRequest(name="Real", char_class="night_ranger"), other, db)
                await fails(403, main.claim(main.ClaimRequest(character_id=real_char["character_id"]), user, db))
                anonymous = User(username="u_old", email="old@dev.local", password_hash=hashlib.sha256(b"random").hexdigest())
                db.add(anonymous)
                await db.flush()
                old_id = anonymous.id
                legacy = Character(user_id=old_id, name="Antigo", char_class=CharacterClass.BLADE_MASTER, gold=1234, level=12)
                db.add(legacy)
                await db.commit()
                claimed = await main.claim(main.ClaimRequest(character_id=legacy.id), user, db)
                assert claimed["level"] == 12 and legacy.gold == 1234 and legacy.user_id == user.id
                assert await db.scalar(select(User.id).where(User.id == old_id)) is None
                await fails(404, main.claim(main.ClaimRequest(character_id="missing"), user, db))
                for name in ("Terceiro", "Quarto"):
                    await main.create_character(main.CreateCharRequest(name=name, char_class="blade_master"), user, db)
                await fails(400, main.create_character(main.CreateCharRequest(name="Quinto", char_class="blade_master"), user, db))
                user.is_banned = True
                await db.commit()
                await fails(403, current_user("Bearer " + first["token"]))
                await fails(403, main.login(main.LoginRequest(username=user.username, password="password1"), request(), db))
                user.is_banned = False
                await db.commit()
                for _ in range(10):
                    await fails(401, main.login(main.LoginRequest(username="missing", password="wrong"), request("limited"), db))
                await fails(429, main.login(main.LoginRequest(username=user.username, password="password1"), request("limited"), db))
                for i in range(5):
                    await main.register(main.RegisterRequest(username=f"limit{i}", password="password1"), request("registration-limit"), db)
                await fails(429, main.register(main.RegisterRequest(username="limit6", password="password1"), request("registration-limit"), db))
                # The window expires without sleeping.
                for key, queue in main._auth_attempts.items():
                    if key[1] == "limited":
                        for i in range(len(queue)):
                            queue[i] -= 301
                assert (await main.login(main.LoginRequest(username=user.username, password="password1"), request("limited"), db))["token"]

                class DeniedSocket:
                    def __init__(self, token):
                        self.query_params = {"token": token}
                        self.code = None

                    async def accept(self):
                        pass  # accepted only to send a clean 1008 close

                    async def close(self, code):
                        self.code = code

                # An unauthorized connection must not even call takeover.
                original_takeover = main._take_over
                async def forbidden_takeover(_):
                    raise AssertionError("Unauthorized takeover")
                main._take_over = forbidden_takeover
                main.game.heroes[cid] = object()
                try:
                    for bad_token in ("", make_token(other.id), make_token(user.id, -1), first["token"] + "x"):
                        socket = DeniedSocket(bad_token)
                        await main.game_ws(socket, cid)
                        assert socket.code == 1008
                    user.is_banned = True
                    await db.commit()
                    socket = DeniedSocket(first["token"])
                    await main.game_ws(socket, cid)
                    assert socket.code == 1008
                    user.is_banned = False
                    await db.commit()
                finally:
                    main.game.heroes.pop(cid, None)
                    main._take_over = original_takeover
            print("ok accounts, ownership, legacy claim, limits, bans and WebSocket rejection")

            if importlib.util.find_spec("httpx"):
                from fastapi.testclient import TestClient
                # No lifespan: tables already exist; do not start the game loop.
                client = TestClient(main.app)
                response = client.post("/auth/register", json={"username": "httpuser", "password": "password1"})
                assert response.status_code == 201
                headers = {"Authorization": "Bearer " + response.json()["token"]}
                assert client.post("/auth/login", json={"username": "HTTPUSER", "password": "password1"}).status_code == 200
                assert client.post("/auth/login", json={"username": "httpuser", "password": "wrong"}).status_code == 401
                assert client.post("/auth/register", json={"username": "HTTPUSER", "password": "password1"}).status_code == 409
                created = client.post("/characters", headers=headers, json={"name": "HTTP Hero", "char_class": "blade_master", "user_id": "ignored"})
                assert created.status_code == 201
                assert len(client.get("/characters", headers=headers).json()) == 1
                assert client.get("/characters/" + cid, headers=headers).status_code == 404
                assert client.get("/auth/me").status_code == 401
                async with main.async_session() as db:
                    old = User(username="u_http_old", email="http_old@dev.local", password_hash="a" * 64)
                    db.add(old)
                    await db.flush()
                    hero = Character(user_id=old.id, name="HTTP Antigo", char_class=CharacterClass.BLADE_MASTER)
                    db.add(hero)
                    await db.commit()
                    claim_id = hero.id
                assert client.post("/auth/claim", headers=headers, json={"character_id": claim_id}).status_code == 200
                client.close()
                print("ok TestClient HTTP routes")
            else:
                print("httpx not installed: endpoint functions tested directly")
        finally:
            main.async_session = original_factory
            main.engine = original_engine
            main._auth_attempts.clear()
            await engine.dispose()
    print("All auth tests passed")


def test_auth():
    asyncio.run(run_all())


if __name__ == "__main__":
    test_auth()
