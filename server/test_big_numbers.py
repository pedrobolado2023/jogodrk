"""Big numbers: EXP passes 2.1 billion (INTEGER's limit in Postgres) around level 75. A save past a column's limit used
to fail and roll the hero back on reconnect. Run: .venv/Scripts/python.exe test_big_numbers.py
"""
from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import BigInteger
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import main
from game import Hero
from models import Base, Character, CharacterClass, User
from world_data import exp_to_next


def columns() -> None:
    c = Character.__table__.c
    for name in ("exp", "gold", "hp", "max_hp", "mp", "max_mp"):
        assert isinstance(c[name].type, BigInteger), name
    assert exp_to_next(80) > 2**31 - 1  # the reason for all this
    print("ok  colunas grandes são BIGINT")


def migration() -> None:
    """The Postgres migration widens only what is too small (simulated: there is no Postgres here)."""
    ran: list[str] = []
    conn = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"), execute=lambda sql: ran.append(str(sql)))
    have = [{"name": "exp", "type": "INTEGER"}, {"name": "gold", "type": "INTEGER"}, {"name": "hp", "type": "BIGINT"},
            {"name": "max_hp", "type": "INTEGER"}, {"name": "mp", "type": "INTEGER"}, {"name": "max_mp", "type": "INTEGER"},
            {"name": "str", "type": "SMALLINT"}, {"name": "agi", "type": "SMALLINT"}, {"name": "int", "type": "SMALLINT"},
            {"name": "vit", "type": "INTEGER"}]
    real_inspect = main.inspect
    main.inspect = lambda _c: SimpleNamespace(get_columns=lambda _t: have)
    try:
        done = main._widen_number_columns(conn)
    finally:
        main.inspect = real_inspect
    assert 'ALTER TABLE characters ALTER COLUMN "exp" TYPE BIGINT' in ran
    assert 'ALTER TABLE characters ALTER COLUMN "int" TYPE INTEGER' in ran
    assert not any('"hp"' in s for s in ran) and not any('"vit"' in s for s in ran)  # already big enough
    assert len(done) == 8, done
    # SQLite: nothing to do
    assert main._widen_number_columns(SimpleNamespace(dialect=SimpleNamespace(name="sqlite"))) == []
    print("ok  migração do Postgres alarga só o que precisa")


async def save_roundtrip() -> None:
    saved = main.async_session, main.engine
    with tempfile.TemporaryDirectory(prefix="game-big-") as temp:
        engine = create_async_engine("sqlite+aiosqlite:///" + (Path(temp) / "test.db").as_posix())
        main.engine, main.async_session = engine, async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            async with main.async_session() as db:
                u = User(username="grande", email="g@x.local", password_hash="x")
                db.add(u)
                await db.flush()
                ch = Character(user_id=u.id, name="Lendario", char_class=CharacterClass.GRAND_SORCERER)
                db.add(ch)
                await db.commit()
                cid = ch.id
            h = Hero(char_id=cid, name="Lendario", cls="grand_sorcerer", level=105, exp=2_687_160_573_696, gold=9_000_000_000,
                     story={"q": 23, "st": "offer", "n": 0}, map_id="ghost_01", hp=3_000_000_000, mp=18_000)
            await main.save_hero(h)
            async with main.async_session() as db:
                c = await db.get(Character, cid)
                assert c.exp == 2_687_160_573_696 and c.gold == 9_000_000_000 and c.story["q"] == 23
            print("ok  herói com 2,6 trilhões de EXP salva e volta igual")
        finally:
            main.async_session, main.engine = saved
            await engine.dispose()


def test_big_numbers() -> None:
    columns()
    migration()
    asyncio.run(save_roundtrip())


if __name__ == "__main__":
    test_big_numbers()
    print("all big number tests passed")
