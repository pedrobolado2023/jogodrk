"""
Configuration — switches between PostgreSQL (production) and SQLite (dev/test).
"""

import os

ENV = os.getenv("MMORPG_ENV", "dev")

SECRET_KEY = os.getenv("SECRET_KEY", "" if ENV == "production" else "dev-only-secret-do-not-use-in-production")
if ENV == "production" and len(SECRET_KEY) < 32:
    raise ValueError("SECRET_KEY é obrigatória em produção e precisa ter pelo menos 32 caracteres")

if ENV == "production":
    DATABASE_URL = os.environ["DATABASE_URL"].strip()
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL is required in production")
    for prefix in ("postgres://", "postgresql://"):
        if DATABASE_URL.startswith(prefix):
            DATABASE_URL = "postgresql+asyncpg://" + DATABASE_URL[len(prefix):]
            break
    # Easypanel (and most hosts) give libpq-style options like ?sslmode=disable; asyncpg calls that option "ssl"
    # and fails on "sslmode", so rename it (same values: disable, require, verify-full…)
    if "?" in DATABASE_URL:
        from urllib.parse import parse_qsl, urlencode
        base, query = DATABASE_URL.split("?", 1)
        params = [("ssl" if k == "sslmode" else k, v) for k, v in parse_qsl(query, keep_blank_values=True)]
        DATABASE_URL = base + ("?" + urlencode(params) if params else "")
else:
    DATABASE_URL = "sqlite+aiosqlite:///./mmorpg_dev.db"

CORS_ORIGINS = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "" if ENV == "production" else "*").split(",") if origin.strip()]

# test helpers (e.g. starting a world boss now with /bossteste) — never on unless explicitly enabled
DEV_TOOLS = ENV == "dev" and os.getenv("GAME_DEV_TOOLS") == "1"
