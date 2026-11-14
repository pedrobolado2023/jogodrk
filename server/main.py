"""
FastAPI entry point — REST (auth, characters, game metadata) + the WebSocket game connection.
All game rules live in game.py; this file only wires transport and persistence.
"""

from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager
from hashlib import sha256

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import inspect, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import items as inv
from auto_farm import auto_farm
from config import CORS_ORIGINS, DATABASE_URL, DEV_TOOLS
from game import Game, Hero
from models import Base, Character, CharacterClass, GameState, User
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_add_missing_columns)
    async with async_session() as db:
        import market as mk
        row = await db.get(GameState, "market")
        game.market = mk.Market.from_json(row.value if row else None)
        import guild as gd
        row = await db.get(GameState, "guilds")
        game.guilds = gd.GuildManager.from_json(row.value if row else None)
    tasks = [asyncio.create_task(manager.start_broadcast_loop()), asyncio.create_task(_game_loop())]
    yield
    manager.stop_broadcast_loop()
    for t in tasks:
        t.cancel()
    await engine.dispose()


app = FastAPI(title="Dark Fantasy MMORPG", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_credentials=CORS_ORIGINS != ["*"], allow_methods=["*"], allow_headers=["*"])


async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/meta")
async def get_meta():
    return meta()


class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str


@app.post("/auth/register", status_code=201)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    user = User(username=req.username, email=req.email, password_hash=sha256(req.password.encode()).hexdigest())
    db.add(user)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Usuário ou e-mail já existe")
    return {"user_id": str(user.id)}


class CreateCharRequest(BaseModel):
    user_id: str
    name: str
    char_class: str


@app.post("/characters", status_code=201)
async def create_character(req: CreateCharRequest, db: AsyncSession = Depends(get_db)):
    if req.char_class not in CLASS_BASE:
        raise HTTPException(400, "Classe inválida")
    name = req.name.strip()[:16]
    if len(name) < 3:
        raise HTTPException(400, "O nome precisa ter pelo menos 3 letras")
    b = CLASS_BASE[req.char_class]
    sx, sy = MAPS[START_MAP]["spawn"]
    bag, gear = inv.starter_kit(req.char_class)
    char = Character(
        user_id=req.user_id, name=name, char_class=CharacterClass(req.char_class),
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
async def get_character(character_id: str, db: AsyncSession = Depends(get_db)):
    char = await db.get(Character, character_id)
    if not char:
        raise HTTPException(404, "Personagem não encontrado")
    return {"character_id": char.id, "name": char.name, "class": char.char_class.value, "level": char.level,
            "map": MAPS.get(char.map_id, {}).get("name", "")}


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
                hp=char.hp, mp=char.mp, loot=loot, bag=bag, gear=gear)
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
    hero.title = char.title if isinstance(char.title, str) and game.can_wear_title(hero, char.title) else titles.best(hero.level)

    await manager.connect(ws, char.id, char.name, map_id, x, y,
                          info={"cls": hero.cls, "level": hero.level, "pk": hero.pk_status(), "title": hero.title, "aura": hero.cosmetics["aura"], "pet": hero.cosmetics["pet"], "mount": hero.cosmetics["mount"],
                                "guild": game.guild_name(hero.char_id)})
    await game.join(hero, x, y)

    try:
        while True:
            data = await ws.receive_json()
            t = data.get("type")
            if t == "move":
                await game.on_move(hero, float(data["x"]), float(data["y"]))
            elif t == "skill":
                err = await game.use_skill(hero, str(data.get("skill_id", "")), data.get("target_id"),
                                           data.get("tx"), data.get("ty"))
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
                await save_hero(left)
            await manager.disconnect(hero.char_id)
