"""Standard-library password hashing and signed account sessions."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time

from fastapi import Header, HTTPException
from config import SECRET_KEY
from models import User


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
    return "scrypt$16384$8$1$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def verify_password(password: str, stored: str) -> bool:
    try:
        kind, n, r, p, salt, digest = stored.split("$")
        if (kind, n, r, p) != ("scrypt", "16384", "8", "1"):
            return False
        salt = base64.b64decode(salt, validate=True)
        expected = base64.b64decode(digest, validate=True)
        if len(salt) != 16 or len(expected) != 64:
            return False
        actual = hashlib.scrypt(password.encode(), salt=salt, n=int(n), r=int(r), p=int(p))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def make_token(user_id: str, expires_in: int = 7 * 24 * 3600) -> str:
    payload = _b64(json.dumps({"uid": user_id, "exp": int(time.time()) + expires_in}, separators=(",", ":")).encode())
    signature = _b64(hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).digest())
    return payload + "." + signature


def verify_token(token: str) -> str | None:
    try:
        payload, signature = token.split(".")
        expected = _b64(hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            return None
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if not isinstance(data["uid"], str) or not data["uid"] or type(data["exp"]) is not int or data["exp"] <= time.time():
            return None
        return data["uid"]
    except (ValueError, TypeError, KeyError, UnicodeError):
        return None


async def current_user(authorization: str | None = Header(default=None)) -> User:
    # Import at call time to share the application's session factory without a cycle.
    from main import async_session
    scheme, _, token = (authorization or "").partition(" ")
    uid = verify_token(token) if scheme.lower() == "bearer" else None
    if not uid:
        raise HTTPException(401, "Sessão inválida ou vencida. Entre novamente.", headers={"WWW-Authenticate": "Bearer"})
    async with async_session() as db:
        user = await db.get(User, uid)
    if not user:
        raise HTTPException(401, "Sessão inválida ou vencida. Entre novamente.")
    if user.is_banned:
        raise HTTPException(403, "Esta conta está bloqueada")
    return user
