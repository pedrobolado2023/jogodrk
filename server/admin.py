"""
Admin panel API (/admin/...): only for the accounts named in ADMIN_USERS (config.py).

Online heroes are changed in memory (and saved); offline heroes straight in the database. Every action is logged
(server output + the last actions, shown on the panel).
"""

from __future__ import annotations

import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, or_, select

import items as inv
from auth import current_user
from config import ADMIN_USERS
from models import Character, GameState, User
from websocket_manager import manager
from world_data import MAPS, START_MAP

KICKED_CODE = 4002  # the client shows "you were disconnected" and does not reconnect by itself
MAX_GOLD = 2_000_000_000
STARTED = time.time()


def is_admin(user: User) -> bool:
    return user.username.lower() in ADMIN_USERS


async def admin_user(user: User = Depends(current_user)) -> User:
    if not is_admin(user):
        raise HTTPException(403, "Esta conta não é administradora.")
    return user


class Amount(BaseModel):
    amount: int


class GiveItem(BaseModel):
    item: str
    qty: int = 1


class Text(BaseModel):
    text: str


class Ban(BaseModel):
    banned: bool


class BossStart(BaseModel):
    boss: int


class PvpDamage(BaseModel):
    percent: int  # 100 = the same damage as against monsters


class PotionHeal(BaseModel):
    item: str
    percent: int  # of the max life / mana


def make_router(game, async_session, save_hero: Callable[[Any], Awaitable[None]]) -> APIRouter:
    router = APIRouter(prefix="/admin", dependencies=[Depends(admin_user)])
    log: deque[dict[str, Any]] = deque(maxlen=100)

    def record(admin: User, action: str, target: str = "") -> None:
        entry = {"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "admin": admin.username,
                 "action": action, "target": target}
        log.appendleft(entry)
        print(f"[admin] {admin.username}: {action} {target}".rstrip(), flush=True)

    def clean_text(text: str, limit: int = 300) -> str:
        text = "".join(ch for ch in str(text) if ch.isprintable()).strip()[:limit]
        if not text:
            raise HTTPException(400, "Escreva uma mensagem.")
        return text

    async def kick(cid: str, reason: str) -> bool:
        s = manager.sessions.get(cid)
        if not s:
            return False
        try:
            await s.ws.send_json({"type": "notice", "text": reason, "kind": "warn"})
            await s.ws.close(code=KICKED_CODE)
        except Exception:
            pass
        return True

    def row(char: Character, user: User | None) -> dict[str, Any]:
        hero = game.heroes.get(char.id)
        s = manager.sessions.get(char.id)
        map_id = hero.map_id if hero else char.map_id
        return {
            "id": char.id, "name": char.name, "class": char.char_class.value,
            "level": hero.level if hero else char.level,
            "gold": hero.gold if hero else char.gold,
            "gems": int(hero.gems if hero else (char.gems or 0)),
            "map": MAPS.get(map_id, {}).get("name", map_id),
            "online": bool(hero and s),
            "user_id": char.user_id, "username": user.username if user else "?",
            "banned": bool(user and user.is_banned),
            "created_at": char.created_at.isoformat() if char.created_at else None,
        }

    async def edit(cid: str, online_fn, offline_fn) -> str:
        """Runs the change on the live hero (then pushes and saves) or on the saved character."""
        hero = game.heroes.get(cid)
        if hero:
            msg = await online_fn(hero)
            await game.push_hero(hero)
            await game.push_inventory(hero)
            await save_hero(hero)
            return msg
        async with async_session() as db:
            char = await db.get(Character, cid)
            if not char:
                raise HTTPException(404, "Personagem não encontrado.")
            msg = offline_fn(char)
            await db.commit()
            return msg

    # ── overview ─────────────────────────────────────────────────────────

    @router.get("/overview")
    async def overview():
        async with async_session() as db:
            accounts = await db.scalar(select(func.count()).select_from(User))
            characters = await db.scalar(select(func.count()).select_from(Character))
            banned = await db.scalar(select(func.count()).select_from(User).where(User.is_banned.is_(True)))
        maps: dict[str, int] = {}
        for h in game.heroes.values():
            name = MAPS.get(h.map_id, {}).get("name", h.map_id)
            maps[name] = maps.get(name, 0) + 1
        boss = game.wb.status()
        return {
            "online": len(game.heroes), "accounts": accounts, "characters": characters, "banned": banned,
            "uptime": int(time.time() - STARTED), "maps": sorted(maps.items(), key=lambda kv: -kv[1]),
            "boss": {"state": boss.get("state"), "name": (game.wb.boss or {}).get("name") if game.wb.state != "idle" else None},
            "log": list(log)[:30],
        }

    @router.get("/players")
    async def players(q: str = "", online: bool = False):
        q = q.strip()[:32]
        async with async_session() as db:
            stmt = select(Character, User).join(User, User.id == Character.user_id)
            if online:
                ids = list(game.heroes)
                if not ids:
                    return {"players": []}
                stmt = stmt.where(Character.id.in_(ids))
            if q:
                like = f"%{q.lower()}%"
                stmt = stmt.where(or_(func.lower(Character.name).like(like), func.lower(User.username).like(like)))
            rows = (await db.execute(stmt.order_by(Character.level.desc()).limit(200))).all()
        out = [row(c, u) for c, u in rows]
        out.sort(key=lambda r: (not r["online"], -r["level"]))
        return {"players": out}

    @router.get("/items")
    async def items_list():
        return {"items": sorted(({"id": k, "name": v.get("name", k), "type": v.get("type", "")} for k, v in inv.ITEMS.items()),
                                key=lambda i: (i["type"], i["name"]))}

    # ── one character ────────────────────────────────────────────────────

    @router.post("/character/{cid}/gold")
    async def gold(cid: str, req: Amount, admin: User = Depends(admin_user)):
        def change(cur: int) -> int:
            return max(0, min(MAX_GOLD, cur + req.amount))

        async def on(h):
            h.gold = change(h.gold)
            await game.notice(h.char_id, f"Um administrador {'deu' if req.amount >= 0 else 'tirou'} {abs(req.amount)} de ouro.", "quest")
            return f"Ouro agora: {h.gold}"

        def off(c):
            c.gold = change(c.gold)
            return f"Ouro agora: {c.gold}"

        msg = await edit(cid, on, off)
        record(admin, f"ouro {req.amount:+d}", cid)
        return {"ok": True, "message": msg}

    @router.post("/character/{cid}/gems")
    async def gems(cid: str, req: Amount, admin: User = Depends(admin_user)):
        async def on(h):
            h.gems = max(0, int(h.gems) + req.amount)
            await game.notice(h.char_id, f"Um administrador {'deu' if req.amount >= 0 else 'tirou'} {abs(req.amount)} gemas.", "quest")
            return f"Gemas agora: {h.gems}"

        def off(c):
            c.gems = max(0, int(c.gems or 0) + req.amount)
            return f"Gemas agora: {c.gems}"

        msg = await edit(cid, on, off)
        record(admin, f"gemas {req.amount:+d}", cid)
        return {"ok": True, "message": msg}

    @router.post("/character/{cid}/item")
    async def give(cid: str, req: GiveItem, admin: User = Depends(admin_user)):
        if req.item not in inv.ITEMS:
            raise HTTPException(400, "Item não existe.")
        qty = max(1, min(999, req.qty))
        gear = inv.ITEMS[req.item]["type"] == "gear"
        name = inv.ITEMS[req.item].get("name", req.item)

        def put(bag) -> bool:
            if gear:
                return all(inv.add_piece(bag, req.item) for _ in range(min(qty, 20)))
            if not inv.can_add(bag, req.item, qty):
                return False
            inv.add_item(bag, req.item, qty)
            return True

        async def on(h):
            if not put(h.bag):
                raise HTTPException(400, "A bolsa do herói está cheia.")
            await game.notice(h.char_id, f"Um administrador te deu: {name} ×{qty}.", "quest")
            return f"{name} ×{qty} entregue."

        def off(c):
            if c.bag is None:
                raise HTTPException(400, "Esse herói precisa entrar no jogo uma vez antes de receber itens.")
            bag = [dict(e) for e in c.bag]
            if not put(bag):
                raise HTTPException(400, "A bolsa do herói está cheia.")
            c.bag = bag
            return f"{name} ×{qty} entregue."

        msg = await edit(cid, on, off)
        record(admin, f"item {req.item} ×{qty}", cid)
        return {"ok": True, "message": msg}

    @router.post("/character/{cid}/message")
    async def message(cid: str, req: Text, admin: User = Depends(admin_user)):
        text = clean_text(req.text)
        if cid not in game.heroes:
            raise HTTPException(400, "O herói não está online.")
        await game.notice(cid, f"Administrador: {text}", "warn")
        await game.send(cid, {"type": "chat", "channel": "event", "text": f"Administrador: {text}"})
        record(admin, "mensagem", cid)
        return {"ok": True, "message": "Mensagem enviada."}

    @router.post("/character/{cid}/kick")
    async def kick_one(cid: str, admin: User = Depends(admin_user)):
        if not await kick(cid, "Você foi desconectado por um administrador."):
            raise HTTPException(400, "O herói não está online.")
        record(admin, "desconectar", cid)
        return {"ok": True, "message": "Herói desconectado."}

    @router.post("/character/{cid}/town")
    async def to_town(cid: str, admin: User = Depends(admin_user)):
        """Sends a hero back to town (stuck somewhere, or in trouble)."""
        hero = game.heroes.get(cid)
        x, y = MAPS[START_MAP]["spawn"]
        if hero:
            await game.change_map(hero, START_MAP, x, y)
            await game.notice(cid, "Um administrador te levou para a vila.", "quest")
            await save_hero(hero)
        else:
            async with async_session() as db:
                char = await db.get(Character, cid)
                if not char:
                    raise HTTPException(404, "Personagem não encontrado.")
                char.map_id, char.pos_x, char.pos_y = START_MAP, x, y
                await db.commit()
        record(admin, "levar para a vila", cid)
        return {"ok": True, "message": "Herói levado para a vila."}

    # ── accounts ─────────────────────────────────────────────────────────

    @router.post("/user/{uid}/ban")
    async def ban(uid: str, req: Ban, admin: User = Depends(admin_user)):
        if uid == admin.id:
            raise HTTPException(400, "Você não pode bloquear a sua própria conta.")
        async with async_session() as db:
            user = await db.get(User, uid)
            if not user:
                raise HTTPException(404, "Conta não encontrada.")
            if is_admin(user) and req.banned:
                raise HTTPException(400, "Não é possível bloquear outro administrador.")
            user.is_banned = req.banned
            await db.commit()
            ids = (await db.scalars(select(Character.id).where(Character.user_id == uid))).all()
        if req.banned:
            for cid in ids:
                await kick(cid, "Sua conta foi bloqueada por um administrador.")
        record(admin, "bloquear conta" if req.banned else "desbloquear conta", user.username)
        return {"ok": True, "message": "Conta bloqueada." if req.banned else "Conta desbloqueada."}

    # ── whole server ─────────────────────────────────────────────────────

    @router.post("/broadcast")
    async def broadcast(req: Text, admin: User = Depends(admin_user)):
        text = clean_text(req.text)
        for cid in list(game.heroes):
            await game.notice(cid, text, "quest")
            await game.send(cid, {"type": "chat", "channel": "event", "text": f"[Aviso] {text}"})
        record(admin, "aviso para todos", text[:60])
        return {"ok": True, "message": f"Aviso enviado para {len(game.heroes)} jogador(es)."}

    @router.post("/boss/start")
    async def boss_start(req: BossStart, admin: User = Depends(admin_user)):
        import world_boss as wbm
        if game.wb.state != "idle":
            raise HTTPException(400, "Já existe um Boss Global ativo.")
        boss = wbm.BOSSES[max(1, min(len(wbm.BOSSES), req.boss)) - 1]
        await game.wb.start(game, boss)
        record(admin, "iniciar Boss Global", boss["name"])
        return {"ok": True, "message": f"{boss['name']} começou."}

    # ── the Hidden Wanderer (hidden_quest.py) ────────────────────────────

    @router.get("/hidden")
    async def hidden():
        return game.hq.admin_view()

    @router.post("/hidden/move")
    async def hidden_move(admin: User = Depends(admin_user)):
        if game.hq.holder:
            raise HTTPException(400, "Alguém está com a Missão Oculta agora. Cancele a missão para mover o Andarilho.")
        await game.hq._hide_from_all(game)
        game.hq.relocate()
        record(admin, "mover o Andarilho Oculto", game.hq.npc["map"])
        return {"ok": True, "message": "O Andarilho foi para outro lugar.", **game.hq.admin_view()}

    @router.post("/hidden/cancel")
    async def hidden_cancel(admin: User = Depends(admin_user)):
        if not game.hq.holder:
            raise HTTPException(400, "Ninguém está com a Missão Oculta.")
        name = game.hq.holder["name"]
        await game.hq.fail(game)
        record(admin, "cancelar a Missão Oculta", name)
        return {"ok": True, "message": f"Missão de {name} cancelada. O Andarilho voltou a se esconder.", **game.hq.admin_view()}

    # ── game settings ───────────────────────────────────────────────────

    async def save_settings() -> None:
        async with async_session() as db:
            row = await db.get(GameState, "settings")
            if row:
                row.value = game.settings()
            else:
                db.add(GameState(key="settings", value=game.settings()))
            await db.commit()

    def settings_view() -> dict[str, Any]:
        import game as gm
        return {"pvp_percent": round(game.pvp_damage * 100), "pvp_default": round(gm.PVP_DAMAGE * 100),
                "pvp_min": round(gm.PVP_DAMAGE_MIN * 100), "pvp_max": round(gm.PVP_DAMAGE_MAX * 100),
                "potions": [{"id": pid, "name": inv.ITEMS[pid]["name"], "kind": inv.ITEMS[pid]["kind"],
                             "percent": round(inv.ITEMS[pid]["amount"] * 100), "default": round(d * 100)}
                            for pid, d in inv.POTION_DEFAULTS.items()],
                "potion_min": round(inv.POTION_MIN * 100), "potion_max": round(inv.POTION_MAX * 100)}

    @router.get("/settings")
    async def get_settings():
        return settings_view()

    @router.post("/settings/pvp")
    async def set_pvp(req: PvpDamage, admin: User = Depends(admin_user)):
        import game as gm
        lo, hi = round(gm.PVP_DAMAGE_MIN * 100), round(gm.PVP_DAMAGE_MAX * 100)
        if not lo <= req.percent <= hi:
            raise HTTPException(400, f"Escolha um valor entre {lo}% e {hi}%.")
        old = round(game.pvp_damage * 100)
        game.apply_settings({"pvp_damage": req.percent / 100})
        await save_settings()
        record(admin, "dano no PvP", f"{old}% → {req.percent}%")
        return {"ok": True, "message": f"Dano no PvP agora é {req.percent}% do dano normal (antes: {old}%).", **settings_view()}

    @router.post("/settings/potion")
    async def set_potion(req: PotionHeal, admin: User = Depends(admin_user)):
        if req.item not in inv.POTION_DEFAULTS:
            raise HTTPException(400, "Poção desconhecida.")
        lo, hi = round(inv.POTION_MIN * 100), round(inv.POTION_MAX * 100)
        if not lo <= req.percent <= hi:
            raise HTTPException(400, f"Escolha um valor entre {lo}% e {hi}%.")
        it = inv.ITEMS[req.item]
        old = round(it["amount"] * 100)
        inv.set_potion_amount(req.item, req.percent / 100)
        await save_settings()
        what = "vida" if it["kind"] == "hp" else "mana"
        record(admin, f"cura da {it['name']}", f"{old}% → {req.percent}%")
        return {"ok": True, "message": f"{it['name']} agora recupera {req.percent}% da {what} (antes: {old}%). "
                                       "Quem já está jogando vê o texto novo ao recarregar a página.", **settings_view()}

    @router.get("/me")
    async def me(admin: User = Depends(admin_user)):
        import world_boss as wbm
        return {"username": admin.username, "bosses": [{"n": i + 1, "name": b["name"], "level": b["level"]} for i, b in enumerate(wbm.BOSSES)]}

    return router
