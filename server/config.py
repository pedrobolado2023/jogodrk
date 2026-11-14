"""
Configuration — switches between PostgreSQL (production) and SQLite (dev/test).
"""

import os

ENV = os.getenv("MMORPG_ENV", "dev")

if ENV == "production":
    DATABASE_URL = os.environ["DATABASE_URL"].strip()
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL is required in production")
    for prefix in ("postgres://", "postgresql://"):
        if DATABASE_URL.startswith(prefix):
            DATABASE_URL = "postgresql+asyncpg://" + DATABASE_URL[len(prefix):]
            break
else:
    DATABASE_URL = "sqlite+aiosqlite:///./mmorpg_dev.db"

CORS_ORIGINS = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "" if ENV == "production" else "*").split(",") if origin.strip()]

# test helpers (e.g. starting a world boss now with /bossteste) — never on unless explicitly enabled
DEV_TOOLS = ENV == "dev" and os.getenv("GAME_DEV_TOOLS") == "1"
