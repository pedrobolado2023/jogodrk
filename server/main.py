"""
FastAPI entry point — REST (auth, characters, game metadata) + the WebSocket game connection.
All game rules live in game.py; this file only wires transport and persistence.
"""

from __future__ import annotations

import asyncio
import math
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import re
from collections import defaultdict, deque

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import inspect, select, text, func, delete
from sqlalchemy.exc import IntegrityError
from auth import current_user, hash_password, verify_password, make_token, verify_token
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import items as inv
from auto_farm import auto_farm
from config import ENV, CORS_ORIGINS, DATABASE_URL, DEV_TOOLS
from game import Game, Hero
from models import Base, Character, CharacterClass, GameState, User, VipStatus
import payments
import vip
from websocket_manager import manager
import season
import titles
from world_data import CLASS_BASE, MAPS, START_MAP, meta, normalize_story

_engine_kw: dict = {}
if "sqlite" in DATABASE_URL:
    _engine_kw["connect_args"] = {"check_same_thread": False}
else:
    _engine_kw["pool_size"] = 20
    _engine_kw["max_overflow"] = 10

engine = create_async_engine(DATABASE_URL, **_engine_kw)
async_session = async_sessionmaker(engine, expire_on_commit=False)

GAME_TICK = 0.1


async def save_hero(hero: Hero) -> None:
    s = manager.sessions.get(hero.char_id)
    async with async_session() as db:
        char = await db.get(Character, hero.char_id)
        if not char:
            return
        char.level, char.exp, char.gold = hero.level, hero.exp, hero.gold
        char.story, char.loot = dict(hero.story), dict(hero.loot)
        char.bag, char.gear = [dict(e) for e in hero.bag], dict(hero.gear)
        char.pk = {"red_left": round(hero.red_left, 1), "kills": hero.pk_kills}
        char.daily = dict(hero.daily) if hero.daily else None
        char.friends = dict(hero.friends)
        char.title = hero.title
        char.season = dict(hero.season) if hero.season else None
        char.cosmetics = dict(hero.cosmetics) if hero.cosmetics else None
        char.gems = int(hero.gems)
        char.boosts = {k: v for k, v in hero.boosts.items() if v > time.time()} or None
        char.map_id = hero.map_id
        if s:
            char.pos_x, char.pos_y = s.x, s.y
        char.hp, char.mp = max(1, hero.hp), hero.mp
        char.max_hp, char.max_mp = hero.max_hp, hero.max_mp
        char.str, char.agi, char.int_, char.vit = hero.stat("str"), hero.stat("agi"), hero.stat("int"), hero.stat("vit")
        await db.commit()


async def save_market() -> None:
    async with async_session() as db:
        row = await db.get(GameState, "market")
        data = game.market.to_json()
        if row:
            row.value = data
        else:
            db.add(GameState(key="market", value=data))
        await db.commit()


async def unfriend_offline(char_id: str, other_id: str) -> None:
    """Removes other_id from the friends list of a character who is not online."""
    async with async_session() as db:
        char = await db.get(Character, char_id)
        if char and char.friends and other_id in char.friends:
            friends = dict(char.friends)
            friends.pop(other_id, None)
            char.friends = friends
            await db.commit()


async def save_hidden_quest() -> None:
    async with async_session() as db:
        row = await db.get(GameState, "hidden_quest")
        data = game.hq.to_json()
        if row:
            row.value = data
        else:
            db.add(GameState(key="hidden_quest", value=data))
        await db.commit()


async def save_guilds() -> None:
    async with async_session() as db:
        row = await db.get(GameState, "guilds")
        data = game.guilds.to_json()
        if row:
            row.value = data
        else:
            db.add(GameState(key="guilds", value=data))
        await db.commit()


game = Game(save_hero, save_market, unfriend_offline, save_guilds)
game.save_hq = save_hidden_quest


async def _game_loop() -> None:
    tick = 0
    while True:
        await asyncio.sleep(GAME_TICK)
        tick += 1
        try:
            await game.tick(GAME_TICK, tick)
        except Exception as e:  # keep the world running even if one tick fails
            import traceback
            traceback.print_exc()
            print("game tick error:", e, flush=True)


def _add_missing_columns(conn) -> None:
    """create_all never alters existing tables: add columns introduced after a database was created."""
    have = {c["name"] for c in inspect(conn).get_columns("characters")}
    for name in ("bag", "gear", "pk", "daily", "friends", "title", "season", "cosmetics", "gems", "boosts"):
        if name not in have:
            conn.execute(text(f"ALTER TABLE characters ADD COLUMN {name} JSON"))


# columns that outgrow their first type: Postgres refuses the save of a value past the column's limit (EXP passes
# INTEGER's 2.1 billion around level 75), which silently rolled heroes back to their last good save on reconnect
WIDEN = {"exp": "BIGINT", "gold": "BIGINT", "hp": "BIGINT", "max_hp": "BIGINT", "mp": "BIGINT", "max_mp": "BIGINT",
         "str": "INTEGER", "agi": "INTEGER", "int": "INTEGER", "vit": "INTEGER"}


def _widen_number_columns(conn) -> list[str]:
    """Postgres only (SQLite stores any size): turn too-small number columns into BIGINT / INTEGER, keeping the data."""
    if conn.dialect.name != "postgresql":
        return []
    have = {c["name"]: str(c["type"]).upper() for c in inspect(conn).get_columns("characters")}
    done = []
    for name, kind in WIDEN.items():
        cur = have.get(name, "")
        if cur and cur != kind and not (kind == "INTEGER" and cur == "BIGINT"):
            conn.execute(text(f'ALTER TABLE characters ALTER COLUMN "{name}" TYPE {kind}'))
            done.append(f"{name} {cur}→{kind}")
    if done:
        print("[db] widened columns:", ", ".join(done), flush=True)
    return done


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_add_missing_columns)
        await conn.run_sync(_widen_number_columns)
    async with async_session() as db:
        import market as mk
        row = await db.get(GameState, "market")
        game.market = mk.Market.from_json(row.value if row else None)
        import guild as gd
        row = await db.get(GameState, "guilds")
        game.guilds = gd.GuildManager.from_json(row.value if row else None)
        import hidden_quest as hqm
        row = await db.get(GameState, "hidden_quest")
        game.hq = hqm.HiddenQuest(row.value if row else None)
        row = await db.get(GameState, "settings")
        game.apply_settings(row.value if row else None)
    tasks = [asyncio.create_task(manager.start_broadcast_loop()), asyncio.create_task(_game_loop())]
    yield
    manager.stop_broadcast_loop()
    for t in tasks:
        t.cancel()
    await engine.dispose()


app = FastAPI(title="Dark Fantasy MMORPG", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_credentials=CORS_ORIGINS != ["*"], allow_methods=["*"], allow_headers=["*"])

import admin  # noqa: E402  (needs `game` and the database session above)
app.include_router(admin.make_router(game, lambda: async_session(), save_hero))  # looked up per call (tests swap it)
app.include_router(payments.make_router(game, lambda: async_session(), save_hero))


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={"detail": "Dados inválidos. Confira os campos e tente novamente."})


async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/meta")
async def get_meta():
    return meta()


# One process owns the live world; these limits use the same process lifetime.
_auth_attempts: dict = defaultdict(deque)
_account_lock = asyncio.Lock()


def _rate_key(request: Request, kind: str, limit: int):
    # the LAST X-Forwarded-For entry is the one our proxy (Easypanel) added; earlier entries come from the client
    # and can be faked to dodge the limit
    ip = request.headers.get("x-forwarded-for", "").split(",")[-1].strip() or (request.client.host if request.client else "unknown")
    now = time.monotonic()
    for key in list(_auth_attempts):
        queue = _auth_attempts[key]
        age = 300 if key[0] == "login" else 3600
        while queue and queue[0] <= now - age:
            queue.popleft()
        if not queue:
            del _auth_attempts[key]
    queue = _auth_attempts[(kind, ip)]
    if len(queue) >= limit:
        raise HTTPException(429, "Muitas tentativas, espere alguns minutos")
    return queue


def _user_info(user):
    return {"id": user.id, "username": user.username}


def _char_info(char):
    return {"character_id": char.id, "name": char.name, "class": char.char_class.value,
            "level": char.level, "map": MAPS.get(char.map_id, {}).get("name", char.map_id)}


class RegisterRequest(BaseModel):
    username: str
    password: str
    email: str | None = None


@app.post("/auth/register", status_code=201)
async def register(req: RegisterRequest, request: Request, db: AsyncSession = Depends(get_db)):
    async with _account_lock:
        attempts = _rate_key(request, "register", 5)
        attempts.append(time.monotonic())
        if not re.fullmatch(r"[a-zA-Z0-9_]{3,20}", req.username):
            raise HTTPException(400, "Use de 3 a 20 letras, números ou sublinhado no usuário")
        if len(req.password) < 8:
            raise HTTPException(400, "A senha precisa ter pelo menos 8 caracteres")
        if await db.scalar(select(User.id).where(func.lower(User.username) == req.username.lower())):
            raise HTTPException(409, "Este usuário já existe")
        user = User(username=req.username.lower(), email=(req.email or "").strip() or f"{req.username.lower()}@sem-email.local",
                    password_hash=hash_password(req.password))
        db.add(user)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(409, "Usuário ou e-mail já existe")
    return {"token": make_token(user.id), "user": _user_info(user)}


class LoginRequest(BaseModel):
    username: str
    password: str


@app.post("/auth/login")
async def login(req: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    async with _account_lock:
        attempts = _rate_key(request, "login", 10)
        user = await db.scalar(select(User).where(func.lower(User.username) == req.username.lower()))
        if not user or not verify_password(req.password, user.password_hash):
            attempts.append(time.monotonic())
            raise HTTPException(401, "Usuário ou senha incorretos")
        if user.is_banned:
            raise HTTPException(403, "Esta conta está bloqueada")
        user.last_login = datetime.now(timezone.utc)
        await db.commit()
    return {"token": make_token(user.id), "user": _user_info(user)}


@app.get("/characters")
async def list_characters(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    chars = (await db.scalars(select(Character).where(Character.user_id == user.id).order_by(Character.name))).all()
    return [_char_info(char) for char in chars]


@app.get("/auth/me")
async def me(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return {"user": _user_info(user), "characters": await list_characters(user, db)}


class ClaimRequest(BaseModel):
    character_id: str


@app.post("/auth/claim")
async def claim(req: ClaimRequest, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    # Old anonymous heroes exist only in local dev databases. Character ids are visible to other players in the game,
    # so in production (a fresh database) claiming is switched off: nobody could take someone else's hero.
    if ENV == "production":
        raise HTTPException(404, "Não disponível")
    async with _account_lock:
        char = await db.get(Character, req.character_id)
        if not char:
            raise HTTPException(404, "Personagem não encontrado")
        owner = await db.get(User, char.user_id)
        # New real accounts may also start with u_; only legacy hashes can be claimed.
        if not owner or not owner.username.startswith("u_") or not re.fullmatch(r"[0-9a-f]{64}", owner.password_hash):
            raise HTTPException(403, "Este herói não pertence a uma conta antiga")
        if await db.scalar(select(func.count()).select_from(Character).where(Character.user_id == user.id)) >= 4:
            raise HTTPException(400, "Cada conta pode ter até 4 heróis")
        char.user_id = user.id
        await db.flush()
        if not await db.scalar(select(Character.id).where(Character.user_id == owner.id)):
            await db.execute(delete(User).where(User.id == owner.id))
        await db.commit()
    return _char_info(char)


class CreateCharRequest(BaseModel):
    name: str
    char_class: str


@app.post("/characters", status_code=201)
async def create_character(req: CreateCharRequest, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    async with _account_lock:
        return await _create_character(req, user, db)


async def _create_character(req, user, db):
    if await db.scalar(select(func.count()).select_from(Character).where(Character.user_id == user.id)) >= 4:
        raise HTTPException(400, "Cada conta pode ter até 4 heróis")
    if req.char_class not in CLASS_BASE:
        raise HTTPException(400, "Classe inválida")
    name = req.name.strip()[:16]
    if len(name) < 3:
        raise HTTPException(400, "O nome precisa ter pelo menos 3 letras")
    b = CLASS_BASE[req.char_class]
    sx, sy = MAPS[START_MAP]["spawn"]
    bag, gear = inv.starter_kit(req.char_class)
    char = Character(
        user_id=user.id, name=name, char_class=CharacterClass(req.char_class),
        str=b["str"], agi=b["agi"], int_=b["int"], vit=b["vit"],
        hp=0, max_hp=b["hp"], mp=0, max_mp=b["mp"],
        map_id=START_MAP, pos_x=sx, pos_y=sy, story={"q": 0, "st": "offer", "n": 0}, loot={}, bag=bag, gear=gear,
    )
    db.add(char)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(409, "Esse nome já está em uso")
    return {"character_id": str(char.id), "name": char.name, "class": req.char_class}


@app.get("/characters/{character_id}")
async def get_character(character_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    char = await db.get(Character, character_id)
    if not char or char.user_id != user.id:
        raise HTTPException(404, "Personagem não encontrado")
    return {"character_id": char.id, "name": char.name, "class": char.char_class.value, "level": char.level,
            "map": MAPS.get(char.map_id, {}).get("name", "")}


def _num(v) -> float | None:
    """A normal number from the client, or None (text, NaN and infinity are refused)."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    v = float(v)
    return v if math.isfinite(v) else None


# messages one connection may send: a burst of WS_BURST, refilled at WS_RATE per second; the rest is ignored
# (the game sends a few per second; a cheat flooding the server with thousands would slow everyone down)
WS_RATE, WS_BURST = 25.0, 60.0
WS_KICK_DROPS = 500  # ignored messages within a minute that close the connection


def _int(v, default: int = 0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


async def _dev_gems(hero, amount: int) -> str | None:
    """Test helper: /gemasteste N gives N gems. Only with GAME_DEV_TOOLS=1 (real gems will be bought with money later)."""
    if not DEV_TOOLS:
        return "Comando desconhecido."
    hero.gems = max(0, hero.gems + amount)
    await game.notice(hero.char_id, f"Teste: +{amount} gemas (total {hero.gems}).", "info")
    await game.push_hero(hero)
    await game.save_hero(hero)
    return None


async def _dev_pass(hero, cmd: str, amount: int) -> str | None:
    """Test helper: /passeteste premium | /passeteste xp N. Only with GAME_DEV_TOOLS=1 (real Premium comes from the shop)."""
    if not DEV_TOOLS:
        return "Comando desconhecido."
    state = game.season_state(hero)
    if cmd == "premium":
        state["premium"] = True
    elif cmd == "xp":
        await game.pass_xp(hero, max(0, amount))
    await game.push_season(hero)
    await game.save_hero(hero)
    return None


async def _dev_start_boss(n: int) -> str | None:
    """Test helper: start world boss n (1-3) now. Only with GAME_DEV_TOOLS=1."""
    import world_boss as wbm
    if not DEV_TOOLS:
        return "Comando desconhecido."
    if n == 0:  # /bossteste 0: drop the active boss to 2% health, to see the ending quickly
        mob = game.wb.boss_mob(game)
        if not mob or game.wb.state != "active":
            return "Nenhum Boss Global ativo."
        mob.hp = max(1, mob.max_hp // 50)
        await game.to_map(wbm.EVENT_MAP, {"type": "mob_hp", "id": mob.instance_id, "hp": mob.hp, "max_hp": mob.max_hp})
        return None
    if game.wb.state != "idle":
        return "Já existe um Boss Global ativo."
    await game.wb.start(game, wbm.BOSSES[max(1, min(3, n)) - 1])
    return None


INVENTORY_ACTIONS = {
    "buy": lambda h, d: game.buy(h, str(d.get("item", "")), _int(d.get("qty"), 1)),
    "sell": lambda h, d: game.sell(h, _int(d.get("index"), -1), str(d.get("item", "")), _int(d.get("qty"), 1)),
    "equip": lambda h, d: game.equip(h, _int(d.get("index"), -1), str(d.get("item", ""))),
    "unequip": lambda h, d: game.unequip(h, str(d.get("slot", ""))),
    "auto_equip": lambda h, d: game.auto_equip(h),
    "discard": lambda h, d: game.discard(h, _int(d.get("index"), -1), str(d.get("item", ""))),
    "use_potion": lambda h, d: game.use_potion(h, str(d.get("kind", ""))),
    "close_shop": lambda h, d: game.close_shop(h),
    "chat": lambda h, d: game.chat(h, str(d.get("channel", "map")), str(d.get("text", "")), str(d.get("to", ""))),
    "party_invite": lambda h, d: game.party_invite(h, str(d.get("name", ""))),
    "friend_add": lambda h, d: game.friend_add(h, str(d.get("name", ""))),
    "set_title": lambda h, d: game.set_title(h, str(d.get("title", ""))),
    "set_aura": lambda h, d: game.set_aura(h, str(d.get("aura", ""))),
    "set_pet": lambda h, d: game.set_pet(h, str(d.get("pet", ""))),
    "set_mount": lambda h, d: game.set_mount(h, str(d.get("mount", ""))),
    "set_skin": lambda h, d: game.set_skin(h, str(d.get("skin", ""))),
    "toggle_mount": lambda h, d: game.toggle_mount(h),
    "pass_claim": lambda h, d: game.pass_claim(h, str(d.get("track", "")), _int(d.get("level"), 0)),
    "pass_claim_all": lambda h, d: game.pass_claim_all(h),
    "shop_buy": lambda h, d: game.shop_buy(h, str(d.get("id", ""))),
    "gems_dev": lambda h, d: _dev_gems(h, _int(d.get("amount"), 0)),
    "pass_dev": lambda h, d: _dev_pass(h, str(d.get("cmd", "")), _int(d.get("amount"), 0)),
    "guild_create": lambda h, d: game.guild_create(h, str(d.get("name", ""))),
    "guild_invite": lambda h, d: game.guild_invite(h, str(d.get("name", ""))),
    "guild_leave": lambda h, d: game.guild_leave(h),
    "guild_kick": lambda h, d: game.guild_kick(h, str(d.get("id", ""))),
    "guild_promote": lambda h, d: game.guild_set_rank(h, str(d.get("id", "")), "officer"),
    "guild_demote": lambda h, d: game.guild_set_rank(h, str(d.get("id", "")), "member"),
    "guild_transfer": lambda h, d: game.guild_set_rank(h, str(d.get("id", "")), "leader"),
    "guild_disband": lambda h, d: game.guild_disband(h),
    "guild_war": lambda h, d: game.guild_war(h, str(d.get("name", ""))),
    "friend_remove": lambda h, d: game.friend_remove(h, str(d.get("id", ""))),
    "party_leave": lambda h, d: game.party_leave(h),
    "party_kick": lambda h, d: game.party_kick(h, str(d.get("name", ""))),
    "wb_join": lambda h, d: game.wb.join(game, h),
    "world_map": lambda h, d: game.world_map(h),
    "teleport": lambda h, d: game.teleport(h, str(d.get("map", ""))),
    "mine": lambda h, d: game.mine_start(h, str(d.get("vein", ""))),
    "market_query": lambda h, d: game.market_view(h, d.get("cat"), d.get("sort"),
                                                  None if d.get("page") is None else max(0, _int(d.get("page")))),
    "market_sell": lambda h, d: game.market_sell(h, _int(d.get("index"), -1), str(d.get("item", "")), _int(d.get("qty"), 1),
                                                 _int(d.get("price"), 0)),
    "market_buy": lambda h, d: game.market_buy(h, _int(d.get("id"), -1)),
    "market_cancel": lambda h, d: game.market_cancel(h, _int(d.get("id"), -1)),
    "market_collect": lambda h, d: game.market_collect(h),
    "forge_craft": lambda h, d: game.forge_craft(h, str(d.get("stone", "")), _int(d.get("qty"), 1)),
    "forge_upgrade": lambda h, d: game.forge_upgrade(h, str(d.get("where", "bag")), d.get("ref"), str(d.get("item", "")),
                                                    bool(d.get("protect"))),
    "forge_refine": lambda h, d: game.forge_refine(h, str(d.get("where", "bag")), d.get("ref"), str(d.get("item", ""))),
    "forge_enchant": lambda h, d: game.forge_enchant(h, str(d.get("where", "bag")), d.get("ref"), str(d.get("item", "")),
                                                    str(d.get("element", ""))),
    "wb_dev_start": lambda h, d: _dev_start_boss(_int(d.get("boss"), 1)),
}


REPLACED_CODE = 4001  # the client does not auto-reconnect after this close code


async def _take_over(cid: str) -> None:
    """A hero is online once: a new connection (page reload, second tab) replaces the old one.
    The old handler saves and leaves when its socket closes; if it never answers, drop it here."""
    old = manager.sessions.get(cid)
    if old:
        try:
            await old.ws.close(code=REPLACED_CODE)
        except Exception:
            pass
    for _ in range(30):
        if cid not in game.heroes and cid not in manager.sessions:
            return
        await asyncio.sleep(0.1)
    left = await game.leave(cid)
    if left:
        await save_hero(left)
    await manager.disconnect(cid)


@app.websocket("/ws/{character_id}")
async def game_ws(ws: WebSocket, character_id: str):
    uid = verify_token(ws.query_params.get("token", ""))
    async with async_session() as db:
        user = await db.get(User, uid) if uid else None
        owner_id = await db.scalar(select(Character.user_id).where(Character.id == character_id)) if user and not user.is_banned else None
    if not user or user.is_banned or owner_id != user.id:
        # accept only to send a clean 1008 close (the browser reports 1006 for a refused handshake, and the client
        # would keep reconnecting instead of asking the player to log in again); nothing is read or sent
        await ws.accept()
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    if character_id in game.heroes or character_id in manager.sessions:
        await _take_over(character_id)  # before loading, so we read what the old session saved
    async with async_session() as db:
        char = await db.get(Character, character_id)
    if not char:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    map_id = char.map_id if char.map_id in MAPS else START_MAP
    x, y = (char.pos_x, char.pos_y) if char.map_id in MAPS else MAPS[START_MAP]["spawn"]
    size = MAPS[map_id]["size"]
    if not (0 < x < size and 0 < y < size):
        x, y = MAPS[map_id]["spawn"]
    cls = char.char_class.value
    if char.bag is None:  # character from before the inventory system
        bag, gear = inv.migrate_legacy(cls, char.loot or {})
        loot = {}
    else:
        bag, gear = inv.clean(char.bag, char.gear)
        loot = dict(char.loot or {})
    story = normalize_story(char.story)
    hero = Hero(char_id=char.id, name=char.name, cls=cls, level=char.level, exp=char.exp,
                gold=char.gold, story=story, map_id=map_id,
                hp=char.hp, mp=char.mp, loot=loot, bag=inv.Bag(bag), gear=gear)
    pk_saved = char.pk or {}
    hero.red_left = max(0.0, float(pk_saved.get("red_left", 0)))  # the red time does not run out while offline
    hero.pk_kills = int(pk_saved.get("kills", 0))
    hero.pk_shown = hero.pk_status()
    hero.daily = dict(char.daily or {})
    hero.friends = dict(char.friends or {})
    hero.season = dict(char.season or {})
    hero.cosmetics = season.cosmetics(char.cosmetics)
    hero.gems = max(0, int(char.gems or 0))
    hero.boosts = {k: float(v) for k, v in (char.boosts or {}).items() if k in ("exp", "gold")}
    # the account's VIP (bonus, bag spaces, title, auras) and its gems of the day
    daily = 0
    async with async_session() as db:
        vrow = await db.get(VipStatus, user.id)
        vlevel, vuntil = (vrow.level, vrow.until) if vrow else (0, 0.0)
        if vrow and vip.active_level(vlevel, vuntil) and vrow.last_daily != vip.today():
            daily = vip.daily_gems(vlevel)
            vrow.last_daily = vip.today()
            await db.commit()
    await payments.apply_vip(game, hero, vlevel, vuntil, push=False)
    hero.gems += daily
    hero.title = char.title if isinstance(char.title, str) and game.can_wear_title(hero, char.title) else titles.best(hero.level)

    await manager.connect(ws, char.id, char.name, map_id, x, y,
                          info={"cls": hero.cls, "level": hero.level, "pk": hero.pk_status(), "title": hero.title, "aura": hero.cosmetics["aura"], "pet": hero.cosmetics["pet"], "mount": hero.cosmetics["mount"],
                                "skin": hero.cosmetics["skin"],
                                "guild": game.guild_name(hero.char_id)})
    await game.join(hero, x, y)
    if daily:
        await game.notice(hero.char_id, f"VIP {vip.active_level(vlevel, vuntil)}: +{daily} gemas do dia!", "quest")
        await game.save_hero(hero)

    tokens, last_refill, drops, drops_since = WS_BURST, time.monotonic(), 0, time.monotonic()
    try:
        while True:
            data = await ws.receive_json()
            now = time.monotonic()
            tokens = min(WS_BURST, tokens + (now - last_refill) * WS_RATE)
            last_refill = now
            if tokens < 1:
                if now - drops_since > 60:
                    drops, drops_since = 0, now
                drops += 1
                if drops >= WS_KICK_DROPS:
                    print(f"[ws] {hero.name} ({hero.char_id}) sent too many messages: disconnected", flush=True)
                    await ws.close(code=status.WS_1008_POLICY_VIOLATION)
                    break
                continue
            tokens -= 1
            if not isinstance(data, dict):
                continue
            t = data.get("type")
            if t == "move":
                x, y = _num(data.get("x")), _num(data.get("y"))
                if x is not None and y is not None:
                    await game.on_move(hero, x, y)
            elif t == "skill":
                tx, ty = _num(data.get("tx")), _num(data.get("ty"))
                if tx is None or ty is None:
                    tx = ty = None
                tid = data.get("target_id")
                err = await game.use_skill(hero, str(data.get("skill_id", "")), tid if isinstance(tid, str) else None,
                                           tx, ty)
                if err:
                    await ws.send_json({"type": "skill_error", "skill_id": data.get("skill_id"), "error": err})
            elif t == "talk":
                await game.talk(hero, str(data.get("npc", "")))
            elif t == "dialog_option":
                await game.dialog_option(hero, str(data.get("option", "")))
            elif t == "auto_farm":
                enabled = auto_farm.toggle(hero.char_id, data.get("config", {}))
                await ws.send_json({"type": "auto_farm_status", "enabled": enabled})
            elif t in INVENTORY_ACTIONS:
                err = await INVENTORY_ACTIONS[t](hero, data)
                if err:
                    await ws.send_json({"type": "notice", "text": err, "kind": "warn"})
            elif t == "ping":
                await ws.send_json({"type": "pong", "ts": data.get("ts", 0)})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print("ws error:", e, flush=True)
    finally:
        current = manager.sessions.get(hero.char_id)
        if current is None or current.ws is ws:  # skip if a newer connection already took this hero over
            left = await game.leave(hero.char_id)
            if left:
                try:
                    await save_hero(left)
                except Exception as e:  # never lose the disconnect itself; the error shows in the log
                    print(f"[save] could not save {left.name} ({left.char_id}) on leaving: {e!r}", flush=True)
            await manager.disconnect(hero.char_id)
