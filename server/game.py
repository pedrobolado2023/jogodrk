"""
Game core: heroes, the data-driven skill engine, damage, crowd control, DoTs, leveling,
story quests, portals, the PvP arena and persistence. Server-authoritative.
"""

from __future__ import annotations

import json
import math
import random
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

import items as inv
import party as pt
import pk_system as pk
import daily as dly
import guild as gd
import season as ssn
import shop as gshop
import vip
import titles
import forge
import market as mk
import mining
import world_boss as wb
import hidden_quest as hq
import discovery as disc
from auto_farm import auto_farm
from mob_manager import MobManager
from skills_data import SKILLS, passive_effects, passives_for, skills_for
from websocket_manager import MOB_VIEW_RADIUS, VIEW_RADIUS, encode, manager
from world_data import power
from world_data import (CHAPTER_ENDS, CLASS_BASE, CLASS_GROWTH, DODGE_CAP, LEVEL_DODGE, LEVEL_HP, LEVEL_MP, MAPS, MAX_LEVEL, MOBS, NPC_LINES, QUESTS, SPAWNS,
                        exp_to_next, fmt_big)

PVP_DAMAGE = 0.6  # default share of the normal damage a hero deals to another hero (the admin panel changes it)
PVP_DAMAGE_MIN, PVP_DAMAGE_MAX = 0.1, 5.0
ENEMY_RADIUS = 40.0  # tiles around a caster where targets are looked for (skills and chain jumps reach less)
CHAT_MAX_LEN = 160
CHAT_BURST = 5          # at most this many messages…
CHAT_WINDOW = 6.0       # …in this many seconds
RESPAWN_SECS = 5.0
ARENA_RESPAWN_SECS = 3.0
PORTAL_RADIUS = 1.3
CHAIN_JUMP = 5.0       # how far a chain skill can jump between enemies
SPLASH_DAMAGE = 0.6    # damage share of the splash around single-target attacks
MAX_FRIENDS = 50
FRIEND_REQ_TTL = 60.0  # seconds a friend request waits for an answer
SAVE_EVERY = 30.0
TELEPORT_MIN_COST = 20     # world map teleport: gold, by the map's lowest monster level
TELEPORT_PER_LEVEL = 15
TELEPORT_COOLDOWN = 5.0


@dataclass
class Buff:
    id: str
    until: float
    fx: dict[str, float]


@dataclass
class Dot:
    source: str
    target: str
    map_id: str
    damage: int
    every: float
    ticks: int
    next_at: float
    kind: str


@dataclass
class Hero:
    char_id: str
    name: str
    cls: str
    level: int
    exp: int
    gold: int
    story: dict[str, Any]
    map_id: str
    hp: int = 0
    mp: int = 0
    cooldowns: dict[str, float] = field(default_factory=dict)
    buffs: list[Buff] = field(default_factory=list)
    is_dead: bool = False
    respawn_at: float = 0.0
    stun_until: float = 0.0
    pvp_kills: int = 0
    pvp_deaths: int = 0
    loot: dict[str, int] = field(default_factory=dict)
    last_portal_notice: float = 0.0
    passive: dict[str, float] = field(default_factory=dict)
    bag: list[dict[str, Any]] = field(default_factory=list)
    gear: dict[str, dict[str, Any]] = field(default_factory=dict)
    potion_cd: dict[str, float] = field(default_factory=dict)
    shop: str | None = None
    chat_times: list[float] = field(default_factory=list)
    market_q: dict[str, Any] = field(default_factory=lambda: {"cat": "all", "sort": "price", "page": 0})
    last_whisper_from: str = ""
    aggressor_until: float = 0.0
    red_left: float = 0.0
    pk_kills: int = 0
    pk_shown: str = "white"
    friends: dict[str, str] = field(default_factory=dict)  # friend's char id → name
    title: str = ""  # level title shown above the name ("" = none)
    daily: dict[str, Any] = field(default_factory=dict)
    season: dict[str, Any] = field(default_factory=dict)     # this season's pass (see season.py)
    cosmetics: dict[str, Any] = field(default_factory=dict)  # titles and auras owned for good, and the aura worn
    gems: int = 0                                             # premium currency (shop.py)
    boosts: dict[str, float] = field(default_factory=dict)   # shop boost → when it ends (unix time)
    vip_level: int = 0                                        # the account's VIP (vip.py), set when the hero joins
    vip_until: float = 0.0
    found: list[str] = field(default_factory=list)            # hidden places discovered (discovery.py)
    disc: dict[str, float] = field(default_factory=dict)      # their permanent bonus, as mod() keys

    def boost(self, kind: str) -> float:
        """Extra share from an active shop boost (0.5 = +50%) plus the VIP bonus, 0 when none."""
        shop = gshop.BOOSTS[kind][1] if self.boosts.get(kind, 0) > time.time() else 0.0
        return shop + vip.bonus(vip.active_level(self.vip_level, self.vip_until))

    def pk_status(self) -> str:
        if self.red_left > 0:
            return "red"
        return "aggressor" if time.monotonic() < self.aggressor_until else "white"

    def refresh_passives(self) -> None:
        self.passive = passive_effects(self.cls, self.level)

    def stat(self, name: str) -> int:
        base = CLASS_BASE[self.cls][name] + CLASS_GROWTH[self.cls][name] * (self.level - 1)
        return base + int(inv.gear_bonus(self.gear, name))

    def mod(self, key: str) -> float:
        now = time.monotonic()
        return (self.passive.get(key, 0.0) + sum(b.fx.get(key, 0.0) for b in self.buffs if b.until > now)
                + inv.gear_mod(self.gear, key) + self.disc.get(key, 0.0))

    @property
    def max_hp(self) -> int:
        base = self.stat("hp") + self.stat("vit") * 4 + LEVEL_HP * (self.level - 1)
        return int(base * (1 + self.mod("max_hp_pct")) * power(self.level))

    @property
    def max_mp(self) -> int:
        base = self.stat("mp") + self.stat("int") * 2 + LEVEL_MP * (self.level - 1)
        return int(base * (1 + self.mod("max_mp_pct")))

    @property
    def atk(self) -> float:
        return (self.stat("str") * 2 + self.level * 2 + inv.gear_bonus(self.gear, "atk")) * (1 + self.mod("atk_pct"))

    @property
    def defense(self) -> int:
        return int((self.stat("vit") * 2 + self.level + inv.gear_bonus(self.gear, "def")) * (1 + self.mod("def_pct")))

    @property
    def crit(self) -> float:
        """Chance that a hit is critical (agility, gear, refining, passives, buffs), at most 100%."""
        return min(1.0, 0.05 + self.stat("agi") * 0.004 + self.mod("crit") + inv.gear_bonus(self.gear, "crit"))

    @property
    def dodge(self) -> float:
        """Chance to dodge a monster's hit: grows with level, plus passives and refining, at most DODGE_CAP."""
        return min(DODGE_CAP, LEVEL_DODGE * self.level + self.mod("dodge"))

    @property
    def crit_dmg(self) -> float:
        """Extra damage of a critical hit over a normal one: +50% base, more from agility, gear and refining (no cap)."""
        return 0.5 + self.stat("agi") * 0.001 + self.mod("crit_dmg") + inv.gear_bonus(self.gear, "crit_dmg")

    def public(self) -> dict[str, Any]:
        return {
            "char_id": self.char_id, "name": self.name, "cls": self.cls, "level": self.level,
            "exp": self.exp, "exp_next": exp_to_next(self.level), "gold": self.gold, "title": self.title,
            "cosmetics": ssn.cosmetics(self.cosmetics), "gems": self.gems,
            "boosts": {k: int(v - time.time()) for k, v in self.boosts.items() if v > time.time()},
            "vip": vip.active_level(self.vip_level, self.vip_until),
            "hp": self.hp, "mp": self.mp, "max_hp": self.max_hp, "max_mp": self.max_mp,
            "atk": int(self.atk), "def": self.defense, "crit": round(self.crit, 3), "crit_dmg": round(self.crit_dmg, 3), "dodge": round(self.dodge, 3),
            "str": self.stat("str"), "agi": self.stat("agi"), "int": self.stat("int"), "vit": self.stat("vit"),
            "speed": self.mod("speed"), "buffs": [b.id for b in self.buffs if b.until > time.monotonic()],
            "story": self.story, "loot": self.loot, "found": self.found, "pvp": {"kills": self.pvp_kills, "deaths": self.pvp_deaths},
            "pk": {"status": self.pk_status(), "red_left": int(self.red_left), "kills": self.pk_kills,
                   "aggressor_left": max(0, int(self.aggressor_until - time.monotonic()))},
        }


def _dist(ax: float, ay: float, bx: float, by: float) -> float:
    return math.hypot(bx - ax, by - ay)


class Game:
    def __init__(self, save_hero: Callable[[Hero], Awaitable[None]],
                 save_market: Callable[[], Awaitable[None]] | None = None,
                 unfriend_offline: Callable[[str, str], Awaitable[None]] | None = None,
                 save_guilds: Callable[[], Awaitable[None]] | None = None):
        self.heroes: dict[str, Hero] = {}
        self.pvp_damage = PVP_DAMAGE  # saved in GameState "settings"; changed on the admin panel
        self.guilds = gd.GuildManager()
        self.save_guilds = save_guilds
        self.guild_sent: dict[str, str] = {}  # last guild window state sent to each hero
        self.unfriend_offline = unfriend_offline
        self.friend_reqs: dict[str, tuple[str, float]] = {}  # target → (asker, when)
        self.friends_sent: dict[str, str] = {}  # last list sent to each hero, to skip repeats
        self.mobs: dict[str, MobManager] = {m: MobManager(m) for m in MAPS}
        self.dots: list[Dot] = []
        self.save_hero = save_hero
        self.last_save = time.monotonic()
        self.parties = pt.PartyManager()
        self.wb = wb.WorldBossEvent()
        self.hq = hq.HiddenQuest()  # replaced by the saved one at start (main.py)
        self.tp_last: dict[str, float] = {}  # world map teleport cooldown
        self.save_hq = None
        self.mine = mining.Mine()
        self.market = mk.Market()
        self.save_market = save_market
        self.party_names: dict[str, str] = {}  # last known names, for members who are offline
        for sp in SPAWNS:
            self.mobs[sp["map"]].spawn(sp["mob"], MOBS[sp["mob"]], sp["x"], sp["y"], sp["count"], sp["wander"])

    # ── messaging ────────────────────────────────────────────────────────

    async def send(self, cid: str, msg: dict[str, Any]) -> None:
        s = manager.sessions.get(cid)
        if s:
            await manager.deliver(s, encode(msg))

    async def to_map(self, map_id: str, msg: dict[str, Any]) -> None:
        """Everyone on the map: for things all of them must know (a monster dies or appears, a level up...)."""
        await manager.send_text_to([s for s in list(manager.sessions.values()) if s.map_id == map_id], encode(msg))

    async def to_area(self, map_id: str, x: float, y: float, msg: dict[str, Any], r: float = VIEW_RADIUS) -> None:
        """Only the players who can see (x, y): skills, hits, potions. With many players on a map, sending every
        effect to everyone was most of the server's work and of each player's download."""
        await manager.send_text_to(manager.around(map_id, x, y, r), encode(msg))

    def mob_pos(self, map_id: str, mob_id: str) -> tuple[float, float] | None:
        m = self.mobs[map_id].mobs.get(mob_id)
        return (m.x, m.y) if m else None

    async def to_target(self, map_id: str, target_id: str, msg: dict[str, Any], fallback: tuple[float, float]) -> None:
        """To the players around a monster or hero (by id), or around `fallback` when it is gone."""
        pos = self.mob_pos(map_id, target_id)
        if pos is None:
            s = manager.sessions.get(target_id)
            pos = (s.x, s.y) if s else fallback
        await self.to_area(map_id, pos[0], pos[1], msg)

    async def notice(self, cid: str, text: str, kind: str = "info") -> None:
        await self.send(cid, {"type": "notice", "text": text, "kind": kind})

    async def push_hero(self, hero: Hero) -> None:
        await self.send(hero.char_id, {"type": "hero", **hero.public()})

    async def push_inventory(self, hero: Hero) -> None:
        await self.send(hero.char_id, {"type": "inventory", "bag": hero.bag, "gear": hero.gear, "gold": hero.gold,
                                       "shop": hero.shop, "cap": getattr(hero.bag, "cap", inv.BAG_SLOTS)})

    # ── session lifecycle ────────────────────────────────────────────────

    def map_info(self, hero: Hero) -> dict[str, Any]:
        m = MAPS[hero.map_id]
        portals = [{**p, "locked": not self.portal_open(hero, p)} for p in m["portals"]]
        return {"type": "map_info", "map_id": hero.map_id, "name": m["name"], "theme": m["theme"], "size": m["size"],
                "safe": m["safe"], "pvp": m["pvp"], "event": m.get("event", False), "level": m["level"],
                "portals": portals, "npcs": m["npcs"],
                "clearings": m["clearings"]}

    async def join(self, hero: Hero, x: float, y: float) -> None:
        hero.refresh_passives()
        hero.hp = max(min(hero.hp or hero.max_hp, hero.max_hp), hero.max_hp // 2)
        hero.mp = max(min(hero.mp or hero.max_mp, hero.max_mp), hero.max_mp // 2)
        self.heroes[hero.char_id] = hero
        await self.send(hero.char_id, {**self.map_info(hero), "type": "welcome", "hero": hero.public(), "x": x, "y": y})
        await self.push_inventory(hero)
        if self.parties.set_online(hero.char_id, True):
            await self.push_party(hero.char_id)
        await self.send(hero.char_id, self.wb.status())
        await self.push_daily(hero)
        await self.push_season(hero)
        await self.hq.push(self, hero)
        await self.friends_online(hero, True)
        await self.guild_online(hero)
        if hero.map_id == wb.EVENT_MAP:
            await self.wb.on_enter(self, hero)
        await self.send_map_state(hero)
        await self.hq.on_move(self, hero, x, y)  # standing next to the Hidden Wanderer already
        await self.check_discovery(hero, x, y)

    async def mob_sync(self, hero: Hero, x: float, y: float) -> None:
        """Where the monsters around a player are now: monster moves only reach players in range, so one coming
        closer gets the current positions (and life) of the monsters it is about to see."""
        r2 = (MOB_VIEW_RADIUS + 16) ** 2
        mobs = [[m.instance_id, round(m.x, 2), round(m.y, 2), m.hp] for m in self.mobs[hero.map_id].mobs.values()
                if not m.is_dead and (m.x - x) ** 2 + (m.y - y) ** 2 <= r2]
        if mobs:
            await self.send(hero.char_id, {"type": "mob_sync", "mobs": mobs})

    async def send_map_state(self, hero: Hero) -> None:
        if hero.map_id == mining.MINE_MAP:
            await self.send(hero.char_id, self.mine.state())
        for mob in self.mobs[hero.map_id].mobs.values():
            if not mob.is_dead:
                await self.send(hero.char_id, mob.snapshot())
        if MAPS[hero.map_id]["pvp"]:
            await self.broadcast_scores(hero.map_id)

    async def leave(self, cid: str) -> Hero | None:
        auto_farm.states.pop(cid, None)
        self.parties.invites.pop(cid, None)
        self.friend_reqs.pop(cid, None)
        self.friends_sent.pop(cid, None)
        self.guild_sent.pop(cid, None)
        self.guilds.invites.pop(cid, None)
        hero = self.heroes.pop(cid, None)
        self.hq.forget(cid)
        self.hq.offers.pop(cid, None)
        if hero:
            await self.friends_online(hero, False)
            await self.guild_online(hero)
        if hero and self.parties.set_online(cid, False):
            await self.push_party(cid)
        if hero and MAPS[hero.map_id]["pvp"]:
            await self.broadcast_scores(hero.map_id)
        return hero

    async def change_map(self, hero: Hero, map_id: str, x: float, y: float) -> None:
        old = hero.map_id
        self.hq.forget(hero.char_id)
        hero.map_id = map_id
        hero.shop = None
        for mob in self.mobs[old].mobs.values():
            if mob.aggro_target == hero.char_id:
                mob.aggro_target = None
        await manager.change_map(hero.char_id, map_id, x, y)
        await self.send(hero.char_id, {**self.map_info(hero), "type": "map_change", "x": x, "y": y})
        await self.hq.on_move(self, hero, x, y)
        await self.check_discovery(hero, x, y)
        if map_id == wb.EVENT_MAP:
            await self.wb.on_enter(self, hero)
        await self.send_map_state(hero)
        if MAPS[old]["pvp"]:
            await self.broadcast_scores(old)
        await self.save_hero(hero)

    # ── hidden places (discovery.py) ─────────────────────────────────────

    async def check_discovery(self, hero: Hero, x: float, y: float) -> None:
        """Walking up to a hidden place for the first time: diary, story, permanent bonus; a map done gives gold."""
        place = disc.near(hero.map_id, x, y, hero.found)
        if not place or hero.is_dead:
            return
        hero.found.append(place["id"])
        hero.disc = disc.mods(hero.found)
        done = disc.map_done(hero.map_id, hero.found)
        gold = disc.MAP_GOLD.get(hero.map_id, 0) if done else 0
        hero.gold += gold
        title = len(hero.found) >= disc.TOTAL and disc.TITLE not in hero.cosmetics.setdefault("titles", [])
        if title:
            hero.cosmetics["titles"].append(disc.TITLE)
        n_map = sum(1 for p in disc.PLACES.get(hero.map_id, ()) if p["id"] in hero.found)
        await self.send(hero.char_id, {
            "type": "discovered", "id": place["id"], "name": place["name"], "lore": place["lore"],
            "bonus": disc.bonus_text(*place["bonus"]), "landmark": place["landmark"],
            "map_n": n_map, "map_total": len(disc.PLACES.get(hero.map_id, ())), "map_gold": gold,
            "n": len(hero.found), "total": disc.TOTAL, "title": "Cartógrafo de Ravencrest" if title else "",
        })
        if title:
            await self.to_map(hero.map_id, {"type": "notice", "kind": "quest",
                                            "text": f"{hero.name} encontrou todos os lugares escondidos do mundo e virou Cartógrafo de Ravencrest!"})
        await self.push_hero(hero)
        await self.save_hero(hero)

    # ── world map teleport ───────────────────────────────────────────────

    def teleport_cost(self, map_id: str) -> int:
        """A little gold, more for higher maps (the town is cheap)."""
        levels = [MOBS[s["mob"]]["level"] for s in SPAWNS if s["map"] == map_id]
        return max(TELEPORT_MIN_COST, min(levels) * TELEPORT_PER_LEVEL) if levels else TELEPORT_MIN_COST

    def unlocked_maps(self, hero: Hero) -> set[str]:
        """Maps reachable on foot from town through open portals (the story unlocks them); never the event room."""
        seen, todo = {"town_01"}, ["town_01"]
        while todo:
            for p in MAPS[todo.pop()]["portals"]:
                if p["to"] not in seen and not p.get("event") and self.portal_open(hero, p):
                    seen.add(p["to"])
                    todo.append(p["to"])
        return seen

    async def world_map(self, hero: Hero) -> str | None:
        open_ = self.unlocked_maps(hero)
        maps = [{"id": k, "name": m["name"], "theme": m["theme"], "level": m["level"], "unlocked": k in open_,
                 "cost": self.teleport_cost(k)} for k, m in MAPS.items() if not m.get("event")]
        links = sorted({tuple(sorted((k, p["to"]))) for k, m in MAPS.items() for p in m["portals"] if not p.get("event")})
        await self.send(hero.char_id, {"type": "world_map", "current": hero.map_id, "gold": hero.gold, "maps": maps,
                                       "links": [list(l) for l in links]})
        return None

    async def teleport(self, hero: Hero, map_id: str) -> str | None:
        if map_id not in MAPS or MAPS[map_id].get("event"):
            return "Esse lugar não existe no mapa."
        if hero.is_dead:
            return "Você não pode se teleportar morto."
        if map_id == hero.map_id:
            return "Você já está aqui."
        if hero.map_id == wb.EVENT_MAP and self.wb.state == "active":
            return "Não dá para se teleportar no meio da luta contra o Boss Global. Saia pelo portal."
        if map_id not in self.unlocked_maps(hero):
            return "Esse lugar ainda está selado. Avance na história com o Ancião Aldric para liberá-lo."
        now = time.monotonic()
        if now - self.tp_last.get(hero.char_id, -999) < TELEPORT_COOLDOWN:
            return "Espere um pouco antes de se teleportar de novo."
        cost = self.teleport_cost(map_id)
        if hero.gold < cost:
            return f"Ouro insuficiente: o teleporte custa {cost}."
        hero.gold -= cost
        self.tp_last[hero.char_id] = now
        x, y = MAPS[map_id]["spawn"]
        await self.change_map(hero, map_id, x, y)
        await self.push_inventory(hero)
        await self.push_hero(hero)
        await self.notice(hero.char_id, f"Teleportado para {MAPS[map_id]['name']} (-{cost} ouro).", "info")
        await self.save_hero(hero)
        return None

    def portal_open(self, hero: Hero, portal: dict[str, Any]) -> bool:
        if portal.get("event"):
            return self.wb.is_open()
        need = portal.get("story")
        if need is None:
            return True
        q, st = hero.story.get("q", 0), hero.story.get("st", "offer")
        return q > need or (q == need and st != "offer")

    def apply_settings(self, data: dict[str, Any] | None) -> None:
        """Game settings the admin panel changes (saved in GameState "settings")."""
        try:
            pvp = float((data or {}).get("pvp_damage", PVP_DAMAGE))
        except (TypeError, ValueError):
            pvp = PVP_DAMAGE
        self.pvp_damage = max(PVP_DAMAGE_MIN, min(PVP_DAMAGE_MAX, pvp)) if math.isfinite(pvp) else PVP_DAMAGE
        saved = (data or {}).get("potions")
        saved = saved if isinstance(saved, dict) else {}
        for pid, default in inv.POTION_DEFAULTS.items():
            try:
                amount = float(saved.get(pid, default))
            except (TypeError, ValueError):
                amount = default
            inv.set_potion_amount(pid, amount if math.isfinite(amount) else default)

    def settings(self) -> dict[str, Any]:
        return {"pvp_damage": self.pvp_damage,
                "potions": {pid: inv.ITEMS[pid]["amount"] for pid in inv.POTION_DEFAULTS}}

    async def on_move(self, hero: Hero, x: float, y: float) -> None:
        if hero.is_dead or time.monotonic() < hero.stun_until:
            return
        size = MAPS[hero.map_id]["size"]
        x, y = max(0.5, min(size - 1.5, x)), max(0.5, min(size - 1.5, y))
        moved = await manager.handle_move(hero.char_id, x, y)
        s = manager.sessions.get(hero.char_id)
        if not s:
            return
        if moved and moved.get("cell_changed"):
            await self.mob_sync(hero, s.x, s.y)
        await self.hq.on_move(self, hero, s.x, s.y)
        await self.check_discovery(hero, s.x, s.y)
        for p in MAPS[hero.map_id]["portals"]:
            if _dist(s.x, s.y, p["x"], p["y"]) < PORTAL_RADIUS:
                if self.portal_open(hero, p):
                    await self.change_map(hero, p["to"], p["dx"], p["dy"])
                elif time.monotonic() - hero.last_portal_notice > 3:
                    hero.last_portal_notice = time.monotonic()
                    if p.get("event"):
                        st = self.wb.status()
                        text = f"O portal abre quando o Boss Global surgir. Próximo: {st['next_boss']} às {st['next_at']}."
                    else:
                        text = "O portal está selado. Avance na história com o Ancião Aldric."
                    await self.notice(hero.char_id, text, "warn")
                return

    # ── skills ───────────────────────────────────────────────────────────

    def enemies(self, hero: Hero, aimed_at: str | None = None) -> list[tuple[str, str, float, float]]:
        """(kind, id, x, y) of everything this hero may hit around it (ENEMY_RADIUS tiles: farther than any skill
        reaches). In the open world an innocent player is only hittable when aimed at on purpose; aggressors and
        reds are always fair game. Only nearby players are checked: going through every player of the map (party,
        guild, war, PK) on every skill was a third of the server's work with a hundred players."""
        me = manager.sessions.get(hero.char_id)
        if not me:
            return []
        r2 = ENEMY_RADIUS * ENEMY_RADIUS
        out = [("mob", m.instance_id, m.x, m.y) for m in self.mobs[hero.map_id].mobs.values()
               if not m.is_dead and (m.x - me.x) ** 2 + (m.y - me.y) ** 2 <= r2]
        m = MAPS[hero.map_id]
        if m["safe"] or m.get("event"):
            return out
        # the hero's own party, guild and guild wars, looked up once (not once per nearby player)
        party_of, guild_of = self.parties.of, self.guilds.of
        my_party = party_of.get(hero.char_id)
        my_gid = guild_of.get(hero.char_id)
        my_guild = self.guilds.guilds.get(my_gid) if my_gid is not None else None
        now_t = time.time()
        war_ids = {int(k) for k, until in my_guild.wars.items() if until > now_t} if my_guild else set()
        pvp = m["pvp"]
        for s in manager.around(hero.map_id, me.x, me.y, ENEMY_RADIUS):
            cid = s.char_id
            if cid == hero.char_id:
                continue
            other = self.heroes.get(cid)
            if not other or other.map_id != hero.map_id or other.is_dead:
                continue
            if my_party is not None and party_of.get(cid) == my_party:
                continue
            gid = guild_of.get(cid)
            if my_gid is not None and gid == my_gid:
                continue
            if pvp or cid == aimed_at or (gid is not None and gid in war_ids) or other.pk_status() != "white":
                out.append(("hero", cid, s.x, s.y))
        return out
        for other in self.heroes.values():
            s = manager.sessions.get(other.char_id)
            if other.char_id == hero.char_id or other.map_id != hero.map_id or other.is_dead or not s:
                continue
            if self.parties.same_party(hero.char_id, other.char_id) or self.guilds.same_guild(hero.char_id, other.char_id):
                continue
            if (m["pvp"] or other.char_id == aimed_at or other.pk_status() != "white"
                    or self.guilds.at_war(hero.char_id, other.char_id)):
                out.append(("hero", other.char_id, s.x, s.y))
        return out

    async def use_skill(self, hero: Hero, sid: str, target_id: str | None, tx: float | None, ty: float | None) -> str | None:
        sk = SKILLS.get(sid)
        if not sk or sk["cls"] != hero.cls:
            return "unknown"
        if hero.level < sk["lvl"]:
            return "locked"
        if hero.is_dead:
            return "dead"
        now = time.monotonic()
        if now < hero.stun_until:
            return "stunned"
        if MAPS[hero.map_id]["safe"] and sk["kind"] not in ("buff", "heal", "blink"):
            return "safe_zone"
        if now < hero.cooldowns.get(sid, 0):
            return "on_cooldown"
        cost = max(0, int(sk["mp"] * (1 + hero.mod("mp_cost"))))
        if hero.mp < cost:
            return "not_enough_mp"
        s = manager.sessions.get(hero.char_id)
        if not s:
            return "unavailable"
        cx, cy = s.x, s.y

        enemies = self.enemies(hero, target_id)
        by_id = {e[1]: e for e in enemies}
        target = by_id.get(target_id) if target_id else None
        kind = sk["kind"]
        needs_target = kind in ("melee", "projectile", "dash", "chain")
        if needs_target and not target:
            return "no_target"
        reach = sk["range"] + hero.mod("range") + 0.9
        if target and kind != "aoe_self" and _dist(cx, cy, target[2], target[3]) > reach:
            return "too_far"
        if kind in ("aoe_target", "line") and not target and (tx is None or ty is None):
            return "no_target"
        if kind == "aoe_target" and not target and _dist(cx, cy, tx, ty) > reach:
            return "too_far"

        hero.mp -= cost
        hero.cooldowns[sid] = now + sk["cd"] / 1000 * (1 - hero.mod("cdr"))
        center = (target[2], target[3]) if target else ((tx, ty) if tx is not None else (cx, cy))
        hits: list[tuple[str, str, float, float]] = []
        event: dict[str, Any] = {"type": "skill_used", "char_id": hero.char_id, "skill_id": sid, "x": cx, "y": cy,
                                 "tx": center[0], "ty": center[1], "target": target[1] if target else None}

        if kind in ("melee", "projectile"):
            hits = [target]
        elif kind == "aoe_self":
            hits = [e for e in enemies if _dist(cx, cy, e[2], e[3]) <= sk["radius"]]
        elif kind == "aoe_target":
            hits = [e for e in enemies if _dist(center[0], center[1], e[2], e[3]) <= sk["radius"]]
        elif kind == "line":
            dx, dy = center[0] - cx, center[1] - cy
            ln = math.hypot(dx, dy) or 1.0
            ux, uy = dx / ln, dy / ln
            for e in enemies:
                ex, ey = e[2] - cx, e[3] - cy
                along = ex * ux + ey * uy
                if 0 <= along <= sk["range"] and abs(ex * uy - ey * ux) <= sk.get("width", 1.2):
                    hits.append(e)
            event["tx"], event["ty"] = cx + ux * sk["range"], cy + uy * sk["range"]
        elif kind == "chain":
            hits = [target]
            last = target
            while len(hits) < sk.get("chain", 3) + 1:
                rest = [e for e in enemies if e not in hits and _dist(last[2], last[3], e[2], e[3]) <= CHAIN_JUMP]
                if not rest:
                    break
                last = min(rest, key=lambda e: _dist(last[2], last[3], e[2], e[3]))
                hits.append(last)
            event["chain"] = [h[1] for h in hits]
        elif kind == "dash":
            d = _dist(cx, cy, target[2], target[3])
            k = max(0.0, (d - 1.0) / d) if d > 0 else 0.0
            nx, ny = cx + (target[2] - cx) * k, cy + (target[3] - cy) * k
            await manager.handle_move(hero.char_id, nx, ny, force=True)
            event["dash"] = {"x": nx, "y": ny}
            hits = [target]
        elif kind == "blink":
            ref = (target[2], target[3]) if target else (tx, ty) if tx is not None else None
            dx, dy = (cx - ref[0], cy - ref[1]) if ref else (0.0, 1.0)
            ln = math.hypot(dx, dy) or 1.0
            size = MAPS[hero.map_id]["size"]
            nx = max(1.0, min(size - 2.0, cx + dx / ln * sk["blink"]))
            ny = max(1.0, min(size - 2.0, cy + dy / ln * sk["blink"]))
            await manager.handle_move(hero.char_id, nx, ny, force=True)
            event["blink"] = {"x": nx, "y": ny}
            if sk["radius"]:
                hits = [e for e in enemies if _dist(cx, cy, e[2], e[3]) <= sk["radius"]]
        elif kind == "buff":
            fx = {k: v for k, v in sk["buff"].items() if k != "dur"}
            hero.buffs = [b for b in hero.buffs if b.id != sid]
            hero.buffs.append(Buff(sid, now + sk["buff"]["dur"], fx))
            hero.hp = min(hero.hp, hero.max_hp)
        elif kind == "heal":
            hero.hp = min(hero.max_hp, hero.hp + int(hero.max_hp * sk.get("heal", 0.3)))

        # single-target attacks also catch what stands right next to the target, for less damage
        splash: set[str] = set()
        if sk.get("splash") and target:
            for e in enemies:
                if e[1] != target[1] and _dist(target[2], target[3], e[2], e[3]) <= sk["splash"]:
                    hits.append(e)
                    splash.add(e[1])
            if splash:
                event["splash"] = sorted(splash)
        if hits:
            event["hits"] = [h[1] for h in hits[:40]]
        await self.to_area(hero.map_id, cx, cy, event)
        stat = hero.stat(sk.get("stat", "str")) if sk.get("stat") else 0
        ench = self.weapon_enchant(hero)
        for e in hits:
            weak = (SPLASH_DAMAGE if e[1] in splash else 1.0) * (1 + ench["dmg"] if ench else 1.0)
            last_hit = 0
            for _ in range(sk["hits"]):
                if e[0] == "mob":
                    mob = self.mobs[hero.map_id].mobs.get(e[1])
                    if not mob or mob.is_dead:
                        break
                    dmg, crit = self.roll_damage(hero, sk, stat, mob.def_, mob.hp / mob.max_hp)
                    last_hit = max(1, int(dmg * weak))
                    await self.hurt_mob(hero, e[1], last_hit, crit)
                else:
                    victim = self.heroes.get(e[1])
                    if not victim or victim.is_dead:
                        break
                    await self.flag_attack(hero, victim)
                    dmg, crit = self.roll_damage(hero, sk, stat, victim.defense, victim.hp / victim.max_hp)
                    await self.hurt_hero(victim, max(1, int(dmg * self.pvp_damage * weak)), hero, crit)
            if e[1] not in splash:  # stuns, slows and poisons stay on the real targets
                await self.apply_effects(hero, sk, e)
                if ench and last_hit and e[0] == "mob" and random.random() < ench["proc"]:
                    await self.enchant_proc(hero, ench, e[1], last_hit)
        await self.push_hero(hero)
        return None

    def roll_damage(self, hero: Hero, sk: dict[str, Any], stat: int, defense: int, hp_frac: float) -> tuple[int, bool]:
        raw = (sk["power"] + stat * sk["scale"] + hero.atk * 0.3) * (1 + hero.mod("atk_pct") * 0.5)
        if sk.get("execute") and hp_frac <= sk["execute"]:
            raw *= 2
        crit = bool(sk.get("crit")) or random.random() < hero.crit
        if crit:
            raw *= 1 + hero.crit_dmg
        raw *= random.uniform(0.92, 1.08) * power(hero.level)
        return max(1, int(raw * 100 / (100 + defense))), crit

    async def apply_effects(self, hero: Hero, sk: dict[str, Any], e: tuple[str, str, float, float]) -> None:
        now = time.monotonic()
        if sk.get("cc"):
            cc = sk["cc"]
            if e[0] == "mob":
                self.mobs[hero.map_id].apply_cc(e[1], cc["t"], cc["d"])
            else:
                victim = self.heroes.get(e[1])
                if victim and cc["t"] in ("stun", "freeze"):
                    victim.stun_until = max(victim.stun_until, now + cc["d"] * 0.6)
            await self.to_area(hero.map_id, e[2], e[3], {"type": "cc", "target": e[1], "kind": cc["t"], "dur": cc["d"]})
        if sk.get("dot"):
            d = sk["dot"]
            stat = hero.stat(sk.get("stat", "str"))
            per = int((sk["power"] + stat * sk["scale"]) * d["pct"] * (1 + hero.mod("dot_pct")) * power(hero.level) / max(1, d["ticks"])) + 1
            self.dots.append(Dot(hero.char_id, e[1], hero.map_id, per, d["every"], d["ticks"], now + d["every"], d["kind"]))

    async def hurt_mob(self, hero: Hero | None, mob_id: str, dmg: int, crit: bool = False, dot: str | None = None) -> None:
        if not hero:
            return
        mm = self.mobs[hero.map_id]
        res = mm.damage_mob(mob_id, dmg, hero.char_id)
        if not res:
            return
        res["crit"] = crit
        if dot:
            res["dot"] = dot
        ls = hero.mod("lifesteal")
        if ls > 0 and not hero.is_dead:
            hero.hp = min(hero.max_hp, hero.hp + max(1, int(dmg * ls)))
        killed = res.pop("contributors", None)
        if res.get("killed"):
            await self.to_map(hero.map_id, res)  # everyone must drop the dead monster
        else:
            s = manager.sessions.get(hero.char_id)
            await self.to_target(hero.map_id, mob_id, res, (s.x, s.y) if s else (0.0, 0.0))
        if killed is not None:
            await self.on_mob_killed(hero, res, killed)

    def party_nearby(self, hero: Hero) -> list[Hero]:
        """Party members (hero included) alive on the same map within sharing range."""
        p = self.parties.party_of(hero.char_id)
        me = manager.sessions.get(hero.char_id)
        if not p or not me:
            return [hero]
        out = []
        for cid in p.members:
            h, s = self.heroes.get(cid), manager.sessions.get(cid)
            if h and s and h.map_id == hero.map_id and not h.is_dead and _dist(s.x, s.y, me.x, me.y) <= pt.SHARE_RADIUS:
                out.append(h)
        return out or [hero]

    async def on_mob_killed(self, killer: Hero, res: dict[str, Any], contributors: list[str]) -> None:
        if self.wb.state == "active" and res.get("mob_id") == self.wb.mob_id:
            await self.wb.on_boss_killed(self, killer)
            return
        group = self.party_nearby(killer)
        bonus = 1 + pt.EXP_BONUS_PER_MEMBER * (len(group) - 1)
        recipients = list(dict.fromkeys(contributors + [h.char_id for h in group]))
        for cid in recipients:
            h = self.heroes.get(cid)
            if not h or h.map_id != killer.map_id:
                continue
            exp = int(res["exp"] * (bonus if h in group else 1) * (1 + h.boost("exp")))
            await self.add_exp(h, exp)
            gold = int(res["gold"] * (1 + h.boost("gold"))) if cid == killer.char_id else 0
            names: list[str] = []
            if cid == killer.char_id:
                h.gold += gold
                if h.red_left > 0:
                    h.red_left = max(0.0, h.red_left - pk.RED_MOB_RELIEF)
                lost = False
                for item in inv.roll_loot(res["def_id"], h.cls, res.get("level", 1), res.get("boss", False)):
                    if inv.add_item(h.bag, item):
                        names.append(inv.ITEMS[item]["name"])
                    else:
                        lost = True
                if lost:
                    await self.notice(cid, "Sua bolsa está cheia! Venda ou descarte itens.", "warn")
                await self.push_inventory(h)
            await self.quest_kill(h, res["def_id"])
            await self.send(cid, {"type": "reward", "exp": exp, "gold": gold,
                                  "loot": names, "party": len(group) > 1 and h in group})
            await self.push_hero(h)

    async def hurt_hero(self, victim: Hero, dmg: int, attacker: Hero | None, crit: bool = False,
                        source: str | None = None, dot: str | None = None, true_damage: bool = False) -> None:
        if victim.is_dead:
            return
        if attacker is None and not dot and not true_damage and random.random() < victim.dodge:
            vs = manager.sessions.get(victim.char_id)
            await self.to_area(victim.map_id, vs.x if vs else 0.0, vs.y if vs else 0.0,
                               {"type": "damage", "target_id": victim.char_id, "dodge": True, "source": source})
            return
        if attacker is None and not dot and not true_damage:
            dmg = max(1, dmg * 100 // (100 + victim.defense))
        shield = victim.mod("mana_shield")
        if shield > 0 and victim.mp > 0:
            # mana is not power-scaled: one point of mana stops power(level) points of damage
            k = power(victim.level)
            absorbed = min(int(dmg * shield), int(victim.mp * k))
            victim.mp -= max(1, -(-absorbed // int(k)))
            victim.mp = max(0, victim.mp)
            dmg -= absorbed
        victim.hp = max(0, victim.hp - dmg)
        if attacker:
            ls = attacker.mod("lifesteal")
            if ls > 0:
                attacker.hp = min(attacker.max_hp, attacker.hp + int(dmg * ls))
        msg: dict[str, Any] = {"type": "damage", "target_id": victim.char_id, "damage": dmg, "crit": crit,
                               "hp_remaining": victim.hp, "mp_remaining": victim.mp, "max_hp": victim.max_hp,
                               "source": source or (attacker.char_id if attacker else None)}
        if dot:
            msg["dot"] = dot
        if victim.hp <= 0:
            pvp = MAPS[victim.map_id]["pvp"]
            status_at_death = victim.pk_status()
            victim.is_dead = True
            victim.aggressor_until = 0.0
            victim.respawn_at = time.monotonic() + (ARENA_RESPAWN_SECS if pvp else RESPAWN_SECS)
            msg["killed"] = True
            msg["respawn_in"] = ARENA_RESPAWN_SECS if pvp else RESPAWN_SECS
            for mob in self.mobs[victim.map_id].mobs.values():
                if mob.aggro_target == victim.char_id:
                    mob.aggro_target = None
            if pvp:
                victim.pvp_deaths += 1
                if attacker:
                    attacker.pvp_kills += 1
                    msg["killer_name"] = attacker.name
                    await self.add_exp(attacker, 40 + victim.level * 10)
                    await self.push_hero(attacker)
            elif attacker and attacker.char_id != victim.char_id:
                msg["killer_name"] = attacker.name
                await self.on_player_kill(attacker, victim, status_at_death)
        if msg.get("killed"):
            await self.to_map(victim.map_id, msg)
        else:
            vs = manager.sessions.get(victim.char_id)
            await self.to_area(victim.map_id, vs.x if vs else 0.0, vs.y if vs else 0.0, msg)
        if msg.get("killed") and MAPS[victim.map_id]["pvp"]:
            await self.broadcast_scores(victim.map_id)

    async def broadcast_scores(self, map_id: str) -> None:
        rows = sorted(({"name": h.name, "cls": h.cls, "level": h.level, "kills": h.pvp_kills, "deaths": h.pvp_deaths}
                       for h in self.heroes.values() if h.map_id == map_id), key=lambda r: (-r["kills"], r["deaths"]))
        await self.to_map(map_id, {"type": "arena_scores", "rows": rows})

    # ── progression ──────────────────────────────────────────────────────

    async def add_exp(self, hero: Hero, amount: int) -> None:
        if hero.level >= MAX_LEVEL:
            return
        hero.exp += amount
        leveled = False
        before = hero.level
        while hero.level < MAX_LEVEL and hero.exp >= exp_to_next(hero.level):
            hero.exp -= exp_to_next(hero.level)
            hero.level += 1
            leveled = True
            unlocked = [s["name"] for s in skills_for(hero.cls) if s["lvl"] == hero.level]
            unlocked += [p["name"] + " (passiva)" for p in passives_for(hero.cls) if p["lvl"] == hero.level]
            hero.refresh_passives()
            hero.hp, hero.mp = hero.max_hp, hero.max_mp
            await self.to_map(hero.map_id, {"type": "level_up", "char_id": hero.char_id, "level": hero.level,
                                            "unlocked": unlocked})
            s = manager.sessions.get(hero.char_id)
            if s:
                s.info["level"] = hero.level
        for lv, tid, tname, _ in titles.crossed(before, hero.level):
            hero.title = tid
            for cid in list(self.heroes):
                await self.send(cid, {"type": "chat", "channel": "event",
                                      "text": f"{hero.name} alcançou o nível {lv} e conquistou o título {tname}!"})
            await self.notice(hero.char_id, f"Novo título: {tname}! Troque o título na janela do Personagem (C).", "quest")
        if titles.crossed(before, hero.level):
            await self.sync_title(hero)
        if leveled:
            await self.save_hero(hero)

    def current_quest(self, hero: Hero) -> dict[str, Any] | None:
        q = hero.story.get("q", 0)
        return QUESTS[q] if q < len(QUESTS) else None

    # ── daily missions ─────────────────────────────────────────────────

    def daily_state(self, hero: Hero) -> dict[str, Any]:
        """Today's missions for the hero (a new set once the day has turned)."""
        hero.daily = dly.fresh(hero.daily, hero.char_id, hero.level, hero.story)
        return hero.daily

    async def push_daily(self, hero: Hero) -> None:
        await self.send(hero.char_id, {"type": "daily", **dly.public(self.daily_state(hero))})

    async def daily_progress(self, hero: Hero, kind: str, target: str = "", amount: int = 1) -> None:
        state = self.daily_state(hero)
        done = dly.progress(state, kind, target, amount)
        if not any(t["kind"] == kind and (not t["target"] or t["target"] == target) for t in state["tasks"]):
            return
        for t in done:
            await self.notice(hero.char_id, f"Missão diária concluída: {dly.task_text(t)}! Fale com o Sargento Hald.", "quest")
        await self.push_daily(hero)

    async def daily_claim(self, hero: Hero) -> None:
        state = self.daily_state(hero)
        ready = dly.claimable(state)
        if not ready:
            return
        exp = gold = 0
        await self.pass_xp(hero, ssn.DAILY_TASK_XP * len(ready))
        for t in ready:
            t["claimed"] = True
            exp += t["exp"]
            gold += t["gold"]
        hero.gold += gold
        text = f"Recompensa diária: +{fmt_big(exp)} EXP e +{fmt_big(gold)} ouro."
        if dly.all_claimed(state) and not state["bonus"]:
            state["bonus"] = True
            await self.pass_xp(hero, ssn.DAILY_BONUS_XP)
            b = dly.bonus_reward(state["level"])
            hero.gold += b["gold"]
            got, boxed = [], False
            for item, qty in b["items"]:
                n = inv.add_item(hero.bag, item, qty)
                if n < qty:
                    self.market.credit(hero.char_id, item={"id": item, "qty": qty - n})
                    boxed = True
                got.append(f"{qty}× {inv.ITEMS[item]['name']}")
            text += f" Bônus das 3 missões: +{b['gold']} ouro e {', '.join(got)}!"
            if boxed:
                text += " (Bolsa cheia: as pedras foram para a sua caixa de coleta, com o Dorian.)"
            await self.push_inventory(hero)
        await self.notice(hero.char_id, text, "quest")
        await self.add_exp(hero, exp)
        await self.push_daily(hero)

    async def quest_kill(self, hero: Hero, def_id: str) -> None:
        await self.daily_progress(hero, "kill", def_id)
        await self.hq.on_kill(self, hero, def_id)
        await self.pass_xp(hero, ssn.BOSS_KILL_XP if MOBS.get(def_id, {}).get("boss") else ssn.KILL_XP, "kill")
        quest = self.current_quest(hero)
        if not quest or hero.story.get("st") != "active" or quest["goal"].get("mob") != def_id:
            return
        hero.story["n"] = hero.story.get("n", 0) + 1
        if hero.story["n"] >= quest["goal"]["count"]:
            hero.story["st"] = "ready"
            await self.notice(hero.char_id, f"Missão concluída: {quest['title']}! Fale com o Ancião Aldric, ele espera na entrada deste mapa.", "quest")
        await self.send(hero.char_id, {"type": "story", "story": hero.story})

    async def talk(self, hero: Hero, npc_id: str) -> None:
        if npc_id == hq.NPC_ID:
            await self.hq.talk(self, hero)
            return
        npc = next((n for n in MAPS[hero.map_id]["npcs"] if n["id"] == npc_id), None)
        s = manager.sessions.get(hero.char_id)
        if not npc or not s or _dist(s.x, s.y, npc["x"], npc["y"]) > 6.0:
            return
        dialog: dict[str, Any] = {"type": "dialog", "npc": npc_id, "name": npc["name"], "lines": [], "options": []}
        if hero.pk_status() == "red":
            dialog["lines"] = pk.NPC_REFUSAL + [f"Volte quando seu nome estiver limpo (faltam {pk.minutes_left(hero.red_left)} min)."]
            await self.send(hero.char_id, dialog)
            return
        if npc["role"] == "story":
            quest = self.current_quest(hero)
            st = hero.story.get("st", "offer")
            if not quest:
                dialog["lines"] = NPC_LINES["elder_idle"]
            elif st == "offer":
                dialog["title"] = quest["title"]
                dialog["lines"] = quest["offer"]
                dialog["options"] = [{"id": "accept", "label": "Aceitar missão"}]
            elif st == "active":
                dialog["title"] = quest["title"]
                n, total = hero.story.get("n", 0), quest["goal"]["count"]
                dialog["lines"] = [f"Ainda falta: {quest['goal_text']} ({n}/{total})."]
            elif st == "ready":
                dialog["title"] = quest["title"]
                dialog["lines"] = quest["done"]
                r = quest["reward"]
                dialog["options"] = [{"id": "turnin", "label": f"Concluir (+{fmt_big(r['exp'])} EXP, +{fmt_big(r['gold'])} ouro)"}]
        elif npc["role"] == "healer":
            hero.hp, hero.mp = hero.max_hp, hero.max_mp
            dialog["lines"] = NPC_LINES["healer"]
            dialog["options"] = [{"id": "shop:healer", "label": "Ver poções"}]
            await self.push_hero(hero)
        elif npc["role"] == "shop":
            dialog["lines"] = NPC_LINES.get(npc["id"], ["O que deseja?"])
            dialog["options"] = [{"id": f"shop:{npc['shop']}", "label": "Comprar e vender"}]
            if npc["shop"] == "merchant":
                dialog["options"].append({"id": "market", "label": "Mercado entre jogadores"})
        elif npc["role"] == "forge":
            dialog["lines"] = NPC_LINES.get(npc["id"], ["O que deseja forjar?"])
            dialog["options"] = [{"id": "shop:forge", "label": "Abrir a forja"}]
        elif npc["role"] == "daily":
            state = self.daily_state(hero)
            dialog["title"] = "Missões diárias"
            dialog["lines"] = [f"{'✔' if t['claimed'] else '•'} {dly.task_text(t)} ({t['n']}/{t['count']})"
                               for t in state["tasks"]]
            dialog["lines"].append("Você já fez tudo hoje. Volte amanhã!" if state["bonus"] else NPC_LINES["sergeant"][1])
            ready = dly.claimable(state)
            if ready:
                exp, gold = sum(t["exp"] for t in ready), sum(t["gold"] for t in ready)
                dialog["options"] = [{"id": "daily_claim", "label": f"Receber (+{fmt_big(exp)} EXP, +{fmt_big(gold)} ouro)"}]
        elif npc["role"] == "arena":
            dialog["lines"] = NPC_LINES["arena"]
            dialog["options"] = [{"id": "go_arena", "label": "Me leve para a Arena"}]
        await self.send(hero.char_id, dialog)

    async def dialog_option(self, hero: Hero, option: str) -> None:
        quest = self.current_quest(hero)
        if option == "accept" and quest and hero.story.get("st") == "offer":
            hero.story.update(st="active", n=0)
            await self.notice(hero.char_id, f"Nova missão: {quest['title']}", "quest")
        elif option == "turnin" and quest and hero.story.get("st") == "ready":
            r = quest["reward"]
            hero.gold += r["gold"]
            await self.add_exp(hero, r["exp"])
            await self.pass_xp(hero, ssn.QUEST_XP)
            nxt = hero.story.get("q", 0) + 1
            hero.story = {"q": nxt, "st": "offer" if nxt < len(QUESTS) else "done", "n": 0}
            chapter = quest.get("chapter_end")
            if chapter:
                title, text = CHAPTER_ENDS[chapter]
                await self.send(hero.char_id, {"type": "story_end", "chapter": chapter, "title": title, "text": text})
        elif option == "market":
            await self.market_open(hero)
            return
        elif option == "hq_accept":
            await self.hq.accept(self, hero)
            return
        elif option == "daily_claim":
            await self.daily_claim(hero)
            await self.push_hero(hero)
            await self.save_hero(hero)
            return
        elif option in ("guild_accept", "guild_decline"):
            await (self.guild_accept(hero) if option == "guild_accept" else self.guild_decline(hero))
            return
        elif option in ("friend_accept", "friend_decline"):
            await (self.friend_accept(hero) if option == "friend_accept" else self.friend_decline(hero))
            return
        elif option in ("party_accept", "party_decline"):
            await (self.party_accept(hero) if option == "party_accept" else self.party_decline(hero))
            return
        elif option.startswith("shop:"):
            await self.open_shop(hero, option[5:])
            return
        elif option == "go_arena":
            dest = MAPS["town_01"]["portals"][1]
            await self.change_map(hero, dest["to"], dest["dx"], dest["dy"])
            return
        else:
            return
        await self.send(hero.char_id, {"type": "story", "story": hero.story})
        await self.send(hero.char_id, {**self.map_info(hero), "type": "portals"})
        await self.push_hero(hero)
        await self.save_hero(hero)

    # ── tick ─────────────────────────────────────────────────────────────

    async def tick(self, dt: float, tick: int) -> None:
        now = time.monotonic()
        for hero in list(self.heroes.values()):
            if hero.is_dead and now >= hero.respawn_at:
                await self.respawn(hero)

        for map_id, mm in self.mobs.items():
            players: dict[str, tuple[float, float]] = {}
            for h in self.heroes.values():
                s = manager.sessions.get(h.char_id)
                if h.map_id == map_id and not h.is_dead and s and not MAPS[map_id]["safe"]:
                    players[h.char_id] = (s.x, s.y)
            if not players and not any(m.is_dead for m in mm.mobs.values()):
                continue
            for ev in mm.tick(players, dt):
                if ev["type"] == "mob_attack":
                    victim = self.heroes.get(ev["target_id"])
                    if victim:
                        await self.hurt_hero(victim, ev["damage"], None, source=ev["mob_id"])
                elif ev["type"] == "boss_slam":
                    await self.to_map(map_id, ev)
                    for h in list(self.heroes.values()):
                        s = manager.sessions.get(h.char_id)
                        if h.map_id == map_id and s and _dist(s.x, s.y, ev["x"], ev["y"]) <= ev["radius"]:
                            await self.hurt_hero(h, ev["damage"], None, source=ev["mob_id"])
                elif ev["type"] == "mob_move":
                    if players:  # nobody to see it otherwise (the next player in range gets a mob_sync)
                        await self.to_area(map_id, ev["x"], ev["y"], ev, MOB_VIEW_RADIUS)
                else:
                    await self.to_map(map_id, ev)

        await self.tick_dots(now)
        await self.wb.tick_fight(self)
        await self.tick_mining()
        if tick % 10 == 0:
            await self.wb.tick_schedule(self)
            await self.hq.tick(self)
            if self.hq.dirty and self.save_hq:
                self.hq.dirty = False
                await self.save_hq()
        if tick % 50 == 0:  # friends' and guildmates' levels and maps change as they play
            for h in list(self.heroes.values()):
                if h.friends:
                    await self.push_friends(h, only_if_changed=True)
                if h.char_id in self.guilds.of:
                    await self.push_guild(h.char_id, only_if_changed=True)

        for hero in self.heroes.values():
            before = len(hero.buffs)
            hero.buffs = [b for b in hero.buffs if b.until > now]
            if len(hero.buffs) != before:
                hero.hp, hero.mp = min(hero.hp, hero.max_hp), min(hero.mp, hero.max_mp)
                await self.push_hero(hero)

        if tick % 10 == 0:
            for hero in list(self.heroes.values()):
                if hero.red_left > 0 and not hero.is_dead:
                    hero.red_left = max(0.0, hero.red_left - 1.0)
                await self.sync_pk(hero)
            if tick % 600 == 0:
                day = dly.today()
                for h in list(self.heroes.values()):
                    if h.daily and h.daily.get("day") != day:  # midnight: new missions
                        await self.push_daily(h)
                        await self.notice(h.char_id, "Novas missões diárias! Fale com o Sargento Hald na vila.", "quest")
                for l in self.market.expire():
                    await self.notice(l.seller, f"Seu anúncio de {inv.ITEMS[l.item['id']]['name']} expirou. "
                                                "O item está na sua caixa de coleta, no Mercado (Dorian).")
            if self.market.dirty:
                await self.persist_market()
            if self.guilds.dirty and self.save_guilds:
                await self.save_guilds()
            for ga, gb, score in self.guilds.ended_wars():
                await self.guild_notice(ga, f"[Guerra] A guerra contra {gb.name} terminou: {score[0]} x {score[1]}.")
                await self.guild_notice(gb, f"[Guerra] A guerra contra {ga.name} terminou: {score[1]} x {score[0]}.")
                await self.push_guild_all(ga)
                await self.push_guild_all(gb)
            for cid in self.parties.expired_offline():
                await self.party_remove(cid, f"{self.member_name(cid)} saiu do grupo (desconectado).")
            for p in list(self.parties.parties.values()):
                await self.push_party(p.leader, only_if_changed=True)
            for hero in self.heroes.values():
                if hero.is_dead or (hero.hp >= hero.max_hp and hero.mp >= hero.max_mp):
                    continue
                hero.hp = min(hero.max_hp, hero.hp + max(1, int(hero.max_hp * 0.015 * (1 + hero.mod("hp_regen_pct")))))
                hero.mp = min(hero.max_mp, hero.mp + max(1, int(hero.max_mp * 0.04 * (1 + hero.mod("mp_regen_pct")))))
                await self.send(hero.char_id, {"type": "stats", "hp": hero.hp, "mp": hero.mp,
                                               "max_hp": hero.max_hp, "max_mp": hero.max_mp})

        await self.tick_autofarm()

        if now - self.last_save > SAVE_EVERY:
            self.last_save = now
            for hero in list(self.heroes.values()):
                # one hero that cannot be saved must not stop the others (and must show in the log)
                try:
                    await self.save_hero(hero)
                except Exception as e:
                    print(f"[save] could not save {hero.name} ({hero.char_id}): {e!r}", flush=True)

    async def tick_dots(self, now: float) -> None:
        keep: list[Dot] = []
        for d in self.dots:
            if now >= d.next_at:
                d.ticks -= 1
                d.next_at = now + d.every
                src = self.heroes.get(d.source)
                if d.target in self.heroes:
                    victim = self.heroes[d.target]
                    if victim.map_id == d.map_id and not victim.is_dead:
                        await self.hurt_hero(victim, int(d.damage * self.pvp_damage), src, dot=d.kind)
                elif src and src.map_id == d.map_id:
                    await self.hurt_mob(src, d.target, d.damage, dot=d.kind)
            if d.ticks > 0:
                keep.append(d)
        self.dots = keep

    async def tick_autofarm(self) -> None:
        for cid in list(auto_farm.states):
            hero = self.heroes.get(cid)
            s = manager.sessions.get(cid)
            if not hero or not s or hero.is_dead or MAPS[hero.map_id]["safe"]:
                continue
            mobs = [{"id": m.instance_id, "x": m.x, "y": m.y, "is_dead": m.is_dead}
                    for m in self.mobs[hero.map_id].mobs.values()]
            for act in auto_farm.tick(cid, s.x, s.y, hero.hp, hero.max_hp, hero.mp, hero.max_mp, mobs):
                if act["action"] == "use_pot":
                    await self.use_potion(hero, act["pot_type"], quiet=True)
                elif act["action"] == "move":
                    await manager.handle_move(cid, act["x"], act["y"])
                elif act["action"] == "use_skill":
                    if await self.use_skill(hero, act["skill_id"], act.get("target_id"), None, None) is None:
                        break

    async def respawn(self, hero: Hero) -> None:
        hero.is_dead = False
        hero.hp, hero.mp = hero.max_hp, hero.max_mp
        m = MAPS[hero.map_id]
        x, y = m["spawn"]
        if m["pvp"]:
            x, y = random.uniform(6, m["size"] - 7), random.uniform(6, m["size"] - 7)
        await manager.handle_move(hero.char_id, x, y, force=True)
        await self.send(hero.char_id, {"type": "player_respawn", "x": x, "y": y, "hp": hero.hp, "mp": hero.mp})
        await self.to_map(hero.map_id, {"type": "hero_respawn", "char_id": hero.char_id, "x": x, "y": y})

    # ── inventory & shops ────────────────────────────────────────────────

    def shop_npc(self, hero: Hero, shop: str) -> dict[str, Any] | None:
        """The NPC running `shop` on the hero's map, if the hero is standing near it."""
        s = manager.sessions.get(hero.char_id)
        if not s:
            return None
        for n in MAPS[hero.map_id]["npcs"]:
            runs = n.get("shop") == shop or (shop == "healer" and n["role"] == "healer")
            if runs and _dist(s.x, s.y, n["x"], n["y"]) <= 7.0:
                return n
        return None

    async def open_shop(self, hero: Hero, shop: str) -> None:
        npc = self.shop_npc(hero, shop)
        if shop not in inv.SHOPS or not npc or hero.pk_status() == "red":
            return
        hero.shop = shop
        kind = "forge" if shop == "forge" else "shop"
        await self.send(hero.char_id, {"type": kind, "shop": shop, "name": npc["name"], "items": inv.SHOPS[shop]})
        await self.push_inventory(hero)

    async def close_shop(self, hero: Hero) -> None:
        if hero.shop:
            hero.shop = None
            await self.push_inventory(hero)

    async def buy(self, hero: Hero, item_id: str, qty: int) -> str | None:
        qty = max(1, min(qty, 20))
        if hero.pk_status() == "red":
            return "Os mercadores não atendem assassinos."
        if not hero.shop or not self.shop_npc(hero, hero.shop):
            return "Chegue mais perto do vendedor."
        if item_id not in inv.SHOPS[hero.shop]:
            return "Esse item não está à venda aqui."
        cost = inv.ITEMS[item_id]["price"] * qty
        if hero.gold < cost:
            return "Ouro insuficiente."
        if not inv.can_add(hero.bag, item_id, qty):
            return "Sua bolsa está cheia."
        hero.gold -= cost
        inv.add_item(hero.bag, item_id, qty)
        await self.notice(hero.char_id, f"Comprou {qty}× {inv.ITEMS[item_id]['name']} por {cost} ouro.")
        await self.after_inventory(hero)
        return None

    async def sell(self, hero: Hero, index: int, item_id: str, qty: int) -> str | None:
        if hero.pk_status() == "red":
            return "Os mercadores não atendem assassinos."
        if not hero.shop or not self.shop_npc(hero, hero.shop):
            return "Chegue mais perto do vendedor."
        if item_id not in inv.ITEMS:
            return "Item desconhecido."
        qty = max(1, min(qty, inv.STACK_MAX))
        taken = inv.take_at(hero.bag, index, item_id, qty)
        if not taken:
            return "Esse item não está mais na bolsa."
        gain = inv.sell_price(taken) * qty
        hero.gold += gain
        await self.notice(hero.char_id, f"Vendeu {qty}× {inv.ITEMS[item_id]['name']} por {gain} ouro.")
        await self.after_inventory(hero)
        return None

    async def equip(self, hero: Hero, index: int, item_id: str) -> str | None:
        it = inv.ITEMS.get(item_id)
        if not it or it["type"] != "gear":
            return "Esse item não pode ser equipado."
        if not inv.usable_by(item_id, hero.cls):
            return "Sua classe não pode usar esse item."
        if hero.level < it["lvl"]:
            return f"Precisa do nível {it['lvl']}."
        taken = inv.take_at(hero.bag, index, item_id)
        if not taken:
            return "Esse item não está mais na bolsa."
        old = hero.gear.get(it["slot"])
        hero.gear[it["slot"]] = inv.strip(taken)
        if old:
            inv.add_piece(hero.bag, old, index)
        await self.after_inventory(hero, stats=True)
        return None

    async def auto_equip(self, hero: Hero) -> str | None:
        """Wears the best piece of the bag in every slot (the class can use it, the level allows it and it scores
        higher than what is worn); replaced pieces go back to the bag."""
        changed: list[str] = []
        for slot in inv.GEAR_SLOTS:
            worn = hero.gear.get(slot)
            best, best_score = -1, inv.piece_score(worn) if worn else -1.0
            for i, e in enumerate(hero.bag):
                it = inv.ITEMS[e["id"]]
                if it["type"] != "gear" or it["slot"] != slot or hero.level < it["lvl"] or not inv.usable_by(e["id"], hero.cls):
                    continue
                s = inv.piece_score(e)
                if s > best_score + 1e-6:
                    best, best_score = i, s
            if best < 0:
                continue
            taken = inv.take_at(hero.bag, best, hero.bag[best]["id"])
            hero.gear[slot] = inv.strip(taken)
            if worn:
                inv.add_piece(hero.bag, worn, best)
            changed.append(inv.ITEMS[taken["id"]]["name"] + (f" +{taken['plus']}" if taken.get("plus") else ""))
        if not changed:
            return "Você já está usando os melhores itens da bolsa."
        await self.notice(hero.char_id, f"Equipado: {', '.join(changed)}.", "quest")
        await self.after_inventory(hero, stats=True)
        return None

    async def unequip(self, hero: Hero, slot: str) -> str | None:
        if not hero.gear.get(slot):
            return None
        if inv.free_slots(hero.bag) < 1:
            return "Sua bolsa está cheia."
        inv.add_piece(hero.bag, hero.gear.pop(slot))
        await self.after_inventory(hero, stats=True)
        return None

    async def discard(self, hero: Hero, index: int, item_id: str) -> str | None:
        if not (0 <= index < len(hero.bag)) or hero.bag[index]["id"] != item_id:
            return "Esse item não está mais na bolsa."
        hero.bag.pop(index)
        await self.after_inventory(hero)
        return None

    async def use_potion(self, hero: Hero, kind: str, quiet: bool = False) -> str | None:
        """Drinks the potion of this kind that best fits what is missing (the small one when it is enough)."""
        if hero.is_dead or kind not in ("hp", "mp"):
            return None
        now = time.monotonic()
        if now < hero.potion_cd.get(kind, 0):
            return None if quiet else "Aguarde para beber outra poção."
        cur, top = (hero.hp, hero.max_hp) if kind == "hp" else (hero.mp, hero.max_mp)
        if cur >= top:
            return None if quiet else ("A vida já está cheia." if kind == "hp" else "A mana já está cheia.")
        owned = sorted((k for k, v in inv.ITEMS.items() if v["type"] == "potion" and v["kind"] == kind
                        and inv.count(hero.bag, k) > 0), key=lambda k: inv.ITEMS[k]["amount"])
        if not owned:
            return None if quiet else ("Sem poções de vida." if kind == "hp" else "Sem poções de mana.")
        missing = (top - cur) / top
        pick = next((k for k in owned if inv.ITEMS[k]["amount"] >= missing), owned[-1])
        idx = next(i for i, e in enumerate(hero.bag) if e["id"] == pick)
        inv.take_at(hero.bag, idx, pick)
        gain = int(top * inv.ITEMS[pick]["amount"])
        if kind == "hp":
            hero.hp = min(hero.max_hp, hero.hp + gain)
        else:
            hero.mp = min(hero.max_mp, hero.mp + gain)
        hero.potion_cd[kind] = now + inv.POTION_COOLDOWN
        ps = manager.sessions.get(hero.char_id)
        await self.to_area(hero.map_id, ps.x if ps else 0.0, ps.y if ps else 0.0,
                           {"type": "potion", "char_id": hero.char_id, "kind": kind, "amount": gain})
        await self.send(hero.char_id, {"type": "stats", "hp": hero.hp, "mp": hero.mp, "max_hp": hero.max_hp,
                                       "max_mp": hero.max_mp})
        await self.push_inventory(hero)
        return None

    async def after_inventory(self, hero: Hero, stats: bool = False) -> None:
        if stats:
            hero.hp, hero.mp = min(hero.hp, hero.max_hp), min(hero.mp, hero.max_mp)
            await self.push_hero(hero)
        await self.push_inventory(hero)
        await self.save_hero(hero)

    # ── PK (open-world player kills) ─────────────────────────────────────

    def open_world(self, map_id: str) -> bool:
        m = MAPS[map_id]
        return not m["safe"] and not m["pvp"] and not m.get("event")

    async def sync_pk(self, hero: Hero) -> None:
        """Tell the map when a hero's name color changes (and the hero itself, with a notice)."""
        st = hero.pk_status()
        if st == hero.pk_shown:
            return
        before, hero.pk_shown = hero.pk_shown, st
        s = manager.sessions.get(hero.char_id)
        if s:
            s.info["pk"] = st
        await self.to_map(hero.map_id, {"type": "pk_status", "char_id": hero.char_id, "status": st})
        if st == "white" and before == "red":
            await self.notice(hero.char_id, "Seu nome está limpo de novo. Os NPCs voltaram a te atender.", "quest")
        elif st == "white":
            await self.notice(hero.char_id, "Você não é mais Agressor.")
        await self.push_hero(hero)

    async def flag_attack(self, attacker: Hero, victim: Hero) -> None:
        if not self.open_world(attacker.map_id) or victim.pk_status() != "white":
            return
        if self.guilds.at_war(attacker.char_id, victim.char_id):  # war: no Aggressor flag
            return
        was = attacker.pk_status()
        attacker.aggressor_until = time.monotonic() + pk.AGGRESSOR_SECS
        if was == "white":
            await self.notice(attacker.char_id, f"Você atacou um inocente: agora é AGRESSOR por {int(pk.AGGRESSOR_SECS)} s. "
                                                "Qualquer um pode te atacar sem punição.", "warn")
        await self.sync_pk(attacker)

    async def on_player_kill(self, killer: Hero, victim: Hero, victim_status: str) -> None:
        if not self.open_world(victim.map_id):
            return
        war = self.guilds.war_kill(killer.char_id, victim.char_id)
        if war:  # guild war: the kill scores for the guild, no Assassin status
            gk, gv = war
            us, them = gk.score[str(gv.id)]
            await self.guild_notice(gk, f"[Guerra] {killer.name} derrotou {victim.name} de {gv.name}! Placar: {us} x {them}.")
            await self.guild_notice(gv, f"[Guerra] {victim.name} caiu para {killer.name} de {gk.name}. Placar: {them} x {us}.")
            await self.push_guild_all(gk)
            await self.push_guild_all(gv)
            return
        if victim_status == "white":
            killer.red_left = min(pk.RED_MAX, killer.red_left + pk.RED_PER_KILL)
            killer.pk_kills += 1
            await self.notice(killer.char_id, f"Você matou um inocente e virou ASSASSINO por {pk.minutes_left(killer.red_left)} min. "
                                              "Os NPCs não vão te atender e você pode perder equipamentos.", "warn")
            await self.to_map(victim.map_id, {"type": "kill_feed", "text": f"{killer.name} assassinou {victim.name}!"})
        elif victim_status == "red":
            bonus = pk.bounty_exp(victim.level)
            await self.add_exp(killer, bonus)
            await self.notice(killer.char_id, f"Você derrotou o assassino {victim.name}! +{fmt_big(bonus)} EXP de recompensa.", "quest")
            await self.to_map(victim.map_id, {"type": "kill_feed", "text": f"{killer.name} derrotou o assassino {victim.name}!"})
            await self.drop_gear(victim, killer)
        await self.sync_pk(killer)
        await self.push_hero(killer)
        await self.save_hero(killer)

    async def drop_gear(self, victim: Hero, killer: Hero) -> None:
        """A red hero killed by a player may lose each equipped item to the killer."""
        lost: list[str] = []
        for slot in list(victim.gear):
            if random.random() >= pk.RED_GEAR_DROP:
                continue
            taken = inv.piece(victim.gear.pop(slot))
            name = inv.ITEMS[taken["id"]]["name"] + (f" +{taken['plus']}" if taken.get("plus") else "")
            lost.append(name)
            if inv.add_piece(killer.bag, taken):
                await self.notice(killer.char_id, f"Você tomou {name} de {victim.name}!", "quest")
            else:
                await self.notice(killer.char_id, f"{name} se perdeu: sua bolsa está cheia.", "warn")
        if not lost:
            return
        await self.notice(victim.char_id, f"Você perdeu {', '.join(lost)} ao morrer como assassino.", "warn")
        victim.hp = min(victim.hp, victim.max_hp)
        for h in (victim, killer):
            await self.push_hero(h)
            await self.push_inventory(h)
            await self.save_hero(h)

    # ── chat ─────────────────────────────────────────────────────────────

    def hero_by_name(self, name: str) -> Hero | None:
        key = name.strip().lower()
        return next((h for h in self.heroes.values() if h.name.lower() == key), None)

    async def chat(self, hero: Hero, channel: str, text: str, to: str = "") -> str | None:
        """channel: "map" (everyone on the same map), "global" (everyone online) or "whisper" (one player)."""
        text = "".join(ch for ch in str(text) if ch.isprintable()).strip()[:CHAT_MAX_LEN]
        if not text:
            return None
        now = time.monotonic()
        hero.chat_times = [t for t in hero.chat_times if now - t < CHAT_WINDOW]
        if len(hero.chat_times) >= CHAT_BURST:
            return "Calma! Você está mandando mensagens rápido demais."
        hero.chat_times.append(now)
        msg: dict[str, Any] = {"type": "chat", "channel": channel, "from": hero.name, "from_id": hero.char_id,
                               "text": text, "pk": hero.pk_status(), "title": hero.title}
        if channel == "map":
            await self.to_map(hero.map_id, msg)
        elif channel == "global":
            for cid in list(self.heroes):
                await self.send(cid, msg)
        elif channel == "party":
            p = self.parties.party_of(hero.char_id)
            if not p:
                return "Você não está em um grupo. Convide alguém com /convidar Nome."
            for cid in p.members:
                await self.send(cid, msg)
        elif channel == "guild":
            gg = self.guilds.guild_of(hero.char_id)
            if not gg:
                return "Você não está em uma guilda. Abra a janela da guilda com a tecla G."
            for cid in gg.members:
                if cid in self.heroes:
                    await self.send(cid, msg)
        elif channel == "whisper":
            target = self.hero_by_name(to)
            if not target:
                return f"{to.strip() or 'Esse jogador'} não está online."
            if target.char_id == hero.char_id:
                return "Você não pode sussurrar para si mesmo."
            target.last_whisper_from = hero.name
            await self.send(target.char_id, msg)
            await self.send(hero.char_id, {**msg, "to": target.name})
        else:
            return None
        return None

    # ── season pass ──────────────────────────────────────────────────────

    def season_state(self, hero: Hero) -> dict[str, Any]:
        hero.season = ssn.fresh(hero.season)
        return hero.season

    async def push_season(self, hero: Hero) -> None:
        await self.send(hero.char_id, ssn.public(self.season_state(hero)))

    async def pass_xp(self, hero: Hero, amount: int, kind: str = "other") -> None:
        state = self.season_state(hero)
        before = ssn.level_of(state["xp"])
        if not ssn.add_xp(state, amount, kind):
            return
        after = ssn.level_of(state["xp"])
        if after > before:
            await self.notice(hero.char_id, f"Passe de temporada: nível {after}! Abra o Passe (P) para pegar a recompensa.", "quest")
        await self.push_season(hero)

    async def pass_claim(self, hero: Hero, track: str, level: int) -> str | None:
        state = self.season_state(hero)
        why = ssn.can_claim(state, track, level)
        if why:
            return why
        got = await self.give_pass_rewards(hero, ssn.rewards(level, track))
        state[track].append(level)
        await self.notice(hero.char_id, f"Passe nível {level}: {', '.join(got)}.", "quest")
        await self.after_pass(hero)
        return None

    async def pass_claim_all(self, hero: Hero) -> str | None:
        state = self.season_state(hero)
        todo = ssn.claimable(state)
        if not todo:
            return "Nenhuma recompensa para pegar agora."
        given: list[dict[str, Any]] = []
        for track, level in todo:
            rewards = ssn.rewards(level, track)
            await self.give_pass_rewards(hero, rewards)
            given += rewards
            state[track].append(level)
        await self.notice(hero.char_id, f"Recompensas do passe: {ssn.summary(given, lambda i: inv.ITEMS[i]['name'])}.", "quest")
        await self.after_pass(hero)
        return None

    async def give_pass_rewards(self, hero: Hero, rewards: list[dict[str, Any]]) -> list[str]:
        """Gold, items (to the collection box if the bag is full), titles and auras."""
        hero.cosmetics = ssn.cosmetics(hero.cosmetics)
        got: list[str] = []
        for r in rewards:
            if "gold" in r:
                hero.gold += r["gold"]
            elif "item" in r:
                n = inv.add_item(hero.bag, r["item"], r["qty"])
                if n < r["qty"]:
                    self.market.credit(hero.char_id, item={"id": r["item"], "qty": r["qty"] - n})
            elif "title" in r and r["title"] not in hero.cosmetics["titles"]:
                hero.cosmetics["titles"].append(r["title"])
            elif "aura" in r and r["aura"] not in hero.cosmetics["auras"]:
                hero.cosmetics["auras"].append(r["aura"])
            got.append(ssn.reward_text(r, lambda i: inv.ITEMS[i]["name"]))
        return got

    async def after_pass(self, hero: Hero) -> None:
        await self.push_season(hero)
        await self.push_inventory(hero)
        await self.push_hero(hero)
        await self.save_hero(hero)

    async def set_aura(self, hero: Hero, aura_id: str) -> str | None:
        hero.cosmetics = ssn.cosmetics(hero.cosmetics)
        if aura_id and aura_id not in hero.cosmetics["auras"]:
            return "Você ainda não tem essa aura."
        hero.cosmetics["aura"] = aura_id
        s = manager.sessions.get(hero.char_id)
        if s:
            s.info["aura"] = aura_id
        await self.to_map(hero.map_id, {"type": "aura", "char_id": hero.char_id, "aura": aura_id})
        await self.push_hero(hero)
        await self.save_hero(hero)
        return None

    async def shop_buy(self, hero: Hero, offer_id: str) -> str | None:
        """Buys a gem shop offer: looks or the pass Premium track — never power."""
        o = gshop.BY_ID.get(offer_id)
        if not o:
            return "Esse item não está na loja."
        hero.cosmetics = ssn.cosmetics(hero.cosmetics)
        state = self.season_state(hero)
        if gshop.owned(o, hero.cosmetics, state):
            return "Você já tem esse item."
        kind = o["kind"]
        # check that the offer makes sense right now, before taking any gems
        if kind == "pass_level" and ssn.level_of(state["xp"]) + o["levels"] > ssn.MAX_LEVEL:
            left = ssn.MAX_LEVEL - ssn.level_of(state["xp"])
            return "Seu passe já está no nível máximo." if left <= 0 else f"Faltam só {left} nível(is) no passe."
        quest = self.current_quest(hero)
        if kind == "quest_skip" and (not quest or hero.story.get("st") != "active"):
            return "Você não tem uma missão da história em andamento."
        cost = gshop.price(o, hero.story.get("q", 0))
        if hero.gems < cost:
            return f"Faltam {cost - hero.gems} {gshop.CURRENCY.lower()}."
        hero.gems -= cost
        tip = ""
        if kind == "premium_pass":
            state["premium"] = True
            tip = " Abra o Passe (P) para pegar as recompensas Premium."
        elif kind == "aura":
            hero.cosmetics["auras"].append(o["ref"])
            tip = " Use na janela do personagem (C)."
        elif kind == "title":
            hero.cosmetics["titles"].append(o["ref"])
            tip = " Use na janela do personagem (C)."
        elif kind == "mount":
            hero.cosmetics["mounts"].append(o["ref"])
            if not hero.cosmetics["mount"]:  # the first horse is saddled right away
                await self.set_mount(hero, o["ref"])
            tip = " Você já está montado! Troque ou desmonte na janela do personagem (C) ou com a tecla M."
        elif kind == "skin":
            hero.cosmetics["skins"].append(o["ref"])
            await self.set_skin(hero, o["ref"])  # worn right away
            tip = " Você já está com ela! Troque na janela do personagem (C)."
        elif kind == "pet":
            hero.cosmetics["pets"].append(o["ref"])
            if not hero.cosmetics["pet"]:  # the first mascot comes out right away
                await self.set_pet(hero, o["ref"])
            tip = " Ele já está com você! Troque na janela do personagem (C)."
        elif kind == "boost":
            hero.boosts[o["ref"]] = max(hero.boosts.get(o["ref"], 0), time.time()) + o["minutes"] * 60
            tip = f" Ativo por mais {int((hero.boosts[o['ref']] - time.time()) // 60)} min."
        elif kind == "pass_level":
            lv = ssn.level_of(state["xp"]) + o["levels"]
            state["xp"] = min(ssn.MAX_LEVEL * ssn.XP_PER_LEVEL, lv * ssn.XP_PER_LEVEL + state["xp"] % ssn.XP_PER_LEVEL)
            tip = f" Passe no nível {ssn.level_of(state['xp'])}: abra o Passe (P) para pegar as recompensas."
        elif kind == "quest_skip":
            hero.story["n"] = quest["goal"]["count"]
            hero.story["st"] = "ready"
            tip = f" «{quest['title']}» concluída: entregue ao Ancião Aldric."
        await self.notice(hero.char_id, f"Compra feita: {gshop.offer_name(o)}!{tip}", "quest")
        await self.push_season(hero)
        await self.push_hero(hero)
        await self.save_hero(hero)
        return None

    async def set_mount(self, hero: Hero, mount_id: str) -> str | None:
        """Rides one owned horse (or none); everyone on the map sees it. Looks only: the pace never changes."""
        hero.cosmetics = ssn.cosmetics(hero.cosmetics)
        if mount_id and mount_id not in hero.cosmetics["mounts"]:
            return "Você ainda não tem essa montaria."
        if mount_id:
            hero.cosmetics["last_mount"] = mount_id
        hero.cosmetics["mount"] = mount_id
        s = manager.sessions.get(hero.char_id)
        if s:
            s.info["mount"] = mount_id
        await self.to_map(hero.map_id, {"type": "mount", "char_id": hero.char_id, "mount": mount_id})
        await self.push_hero(hero)
        await self.save_hero(hero)
        return None

    async def toggle_mount(self, hero: Hero) -> str | None:
        """Key M: get off the horse, or back on the last one ridden."""
        hero.cosmetics = ssn.cosmetics(hero.cosmetics)
        if hero.cosmetics["mount"]:
            return await self.set_mount(hero, "")
        last = hero.cosmetics.get("last_mount") or next(iter(hero.cosmetics["mounts"]), "")
        if not last or last not in hero.cosmetics["mounts"]:
            return "Você ainda não tem montaria. Veja na Loja (L)."
        return await self.set_mount(hero, last)

    async def set_skin(self, hero: Hero, skin_id: str) -> str | None:
        """Wears one owned skin (or the class's own look); everyone on the map sees it. Looks only."""
        hero.cosmetics = ssn.cosmetics(hero.cosmetics)
        if skin_id and skin_id not in hero.cosmetics["skins"]:
            return "Você ainda não tem essa skin."
        hero.cosmetics["skin"] = skin_id
        s = manager.sessions.get(hero.char_id)
        if s:
            s.info["skin"] = skin_id
        await self.to_map(hero.map_id, {"type": "skin", "char_id": hero.char_id, "skin": skin_id})
        await self.push_hero(hero)
        await self.save_hero(hero)
        return None

    async def set_pet(self, hero: Hero, pet_id: str) -> str | None:
        """Shows one owned mascot following the hero (or none); everyone on the map sees it."""
        hero.cosmetics = ssn.cosmetics(hero.cosmetics)
        if pet_id and pet_id not in hero.cosmetics["pets"]:
            return "Você ainda não tem esse mascote."
        hero.cosmetics["pet"] = pet_id
        s = manager.sessions.get(hero.char_id)
        if s:
            s.info["pet"] = pet_id
        await self.to_map(hero.map_id, {"type": "pet", "char_id": hero.char_id, "pet": pet_id})
        await self.push_hero(hero)
        await self.save_hero(hero)
        return None

    def can_wear_title(self, hero: Hero, title_id: str) -> bool:
        if title_id.startswith("vip_"):
            return title_id == f"vip_{vip.active_level(hero.vip_level, hero.vip_until)}"
        return titles.can_use(hero.level, title_id) or title_id in ssn.cosmetics(hero.cosmetics)["titles"]

    # ── titles ───────────────────────────────────────────────────────────

    async def sync_title(self, hero: Hero) -> None:
        s = manager.sessions.get(hero.char_id)
        if s:
            s.info["title"] = hero.title
        await self.to_map(hero.map_id, {"type": "title", "char_id": hero.char_id, "title": hero.title})
        await self.push_hero(hero)

    async def set_title(self, hero: Hero, title_id: str) -> str | None:
        if not self.can_wear_title(hero, title_id):
            return "Você ainda não conquistou esse título."
        hero.title = title_id
        await self.sync_title(hero)
        await self.save_hero(hero)
        return None

    # ── guilds ───────────────────────────────────────────────────────────

    def guild_name(self, cid: str) -> str:
        gg = self.guilds.guild_of(cid)
        return gg.name if gg else ""

    def guild_state(self, cid: str) -> dict[str, Any]:
        gg = self.guilds.guild_of(cid)
        if not gg:
            return {"type": "guild", "guild": None, "cost": gd.CREATE_COST, "min_level": gd.CREATE_LEVEL}
        rows = []
        for mid, d in gg.members.items():
            h = self.heroes.get(mid)
            rows.append({"id": mid, "name": h.name if h else d["name"], "rank": d["rank"], "rank_name": gd.RANKS[d["rank"]],
                         "online": h is not None, "level": h.level if h else 0, "map": h.map_id if h else ""})
        order = {"leader": 0, "officer": 1, "member": 2}
        rows.sort(key=lambda r: (not r["online"], order[r["rank"]], r["name"].lower()))
        now = time.time()
        wars = []
        for oid, end in gg.wars.items():
            other = self.guilds.guilds.get(int(oid))
            if other and end > now:
                us, them = gg.score.get(oid, [0, 0])
                wars.append({"name": other.name, "minutes": max(1, int((end - now) // 60)), "us": us, "them": them})
        return {"type": "guild", "guild": {"name": gg.name, "my_rank": gg.rank(cid), "members": rows, "max": gd.MAX_MEMBERS,
                                           "wars": wars, "enemies": [w["name"] for w in wars]}}

    async def push_guild(self, cid: str, only_if_changed: bool = False) -> None:
        state = self.guild_state(cid)
        key = json.dumps(state, sort_keys=True)
        if only_if_changed and self.guild_sent.get(cid) == key:
            return
        self.guild_sent[cid] = key
        await self.send(cid, state)

    async def push_guild_all(self, gg: gd.Guild) -> None:
        for mid in gg.members:
            if mid in self.heroes:
                await self.push_guild(mid)

    async def guild_notice(self, gg: gd.Guild, text: str) -> None:
        for mid in gg.members:
            if mid in self.heroes:
                await self.send(mid, {"type": "chat", "channel": "guild_info", "text": text})

    async def sync_guild_tag(self, cid: str) -> None:
        """Puts the guild name over the hero's head for everyone on the map."""
        h = self.heroes.get(cid)
        s = manager.sessions.get(cid)
        name = self.guild_name(cid)
        if s:
            s.info["guild"] = name
        if h:
            await self.to_map(h.map_id, {"type": "guild_tag", "char_id": cid, "guild": name})

    async def guild_online(self, hero: Hero) -> None:
        """A member logged in or out: refresh everyone's member list."""
        gg = self.guilds.guild_of(hero.char_id)
        if gg:
            gg.members[hero.char_id]["name"] = hero.name
            await self.push_guild_all(gg)
        elif hero.char_id in self.heroes:
            await self.push_guild(hero.char_id)

    async def guild_create(self, hero: Hero, name: str) -> str | None:
        if hero.level < gd.CREATE_LEVEL:
            return f"Você precisa estar no nível {gd.CREATE_LEVEL} para criar uma guilda."
        if hero.gold < gd.CREATE_COST:
            return f"Criar uma guilda custa {fmt_big(gd.CREATE_COST)} de ouro."
        gg, err = self.guilds.create(hero.char_id, hero.name, name)
        if err:
            return err
        hero.gold -= gd.CREATE_COST
        await self.notice(hero.char_id, f"Guilda {gg.name} criada! Convide jogadores na janela da guilda (G).", "quest")
        await self.sync_guild_tag(hero.char_id)
        await self.push_guild(hero.char_id)
        await self.push_hero(hero)
        await self.push_inventory(hero)
        await self.save_hero(hero)
        return None

    async def guild_invite(self, hero: Hero, name: str) -> str | None:
        target = self.hero_by_name(name)
        if not target:
            return f"{name.strip() or 'Esse jogador'} não está online."
        if target.char_id == hero.char_id:
            return "Você já está na sua guilda."
        err = self.guilds.invite(hero.char_id, target.char_id)
        if err:
            return err
        gg = self.guilds.guild_of(hero.char_id)
        await self.send(target.char_id, {"type": "dialog", "npc": "guild", "name": "Convite de guilda",
                                         "lines": [f"{hero.name} convidou você para a guilda {gg.name} ({len(gg.members)} membros).",
                                                   "Membros da guilda têm chat próprio, não se atacam e lutam juntos nas guerras."],
                                         "options": [{"id": "guild_decline", "label": "Recusar"},
                                                     {"id": "guild_accept", "label": "Entrar"}]})
        await self.notice(hero.char_id, f"Convite de guilda enviado para {target.name}.")
        return None

    async def guild_accept(self, hero: Hero) -> None:
        gg, err = self.guilds.accept(hero.char_id, hero.name)
        if err:
            await self.notice(hero.char_id, err, "warn")
            return
        await self.guild_notice(gg, f"{hero.name} entrou na guilda!")
        await self.sync_guild_tag(hero.char_id)
        await self.push_guild_all(gg)

    async def guild_decline(self, hero: Hero) -> None:
        inviter = self.guilds.decline(hero.char_id)
        if inviter and inviter in self.heroes:
            await self.notice(inviter, f"{hero.name} recusou o convite para a guilda.")

    async def guild_leave(self, hero: Hero) -> str | None:
        gg = self.guilds.guild_of(hero.char_id)
        if not gg:
            return "Você não está em uma guilda."
        self.guilds.remove(hero.char_id)
        await self.notice(hero.char_id, f"Você saiu da guilda {gg.name}.")
        if gg.id in self.guilds.guilds:
            await self.guild_notice(gg, f"{hero.name} saiu da guilda.")
            await self.push_guild_all(gg)
        await self.sync_guild_tag(hero.char_id)
        await self.push_guild(hero.char_id)
        return None

    async def guild_kick(self, hero: Hero, cid: str) -> str | None:
        err = self.guilds.can_kick(hero.char_id, cid)
        if err:
            return err
        gg = self.guilds.guild_of(hero.char_id)
        name = gg.members[cid]["name"]
        self.guilds.remove(cid)
        await self.guild_notice(gg, f"{name} foi expulso da guilda por {hero.name}.")
        if cid in self.heroes:
            await self.notice(cid, f"Você foi expulso da guilda {gg.name}.", "warn")
            await self.sync_guild_tag(cid)
            await self.push_guild(cid)
        await self.push_guild_all(gg)
        return None

    async def guild_set_rank(self, hero: Hero, cid: str, rank: str) -> str | None:
        err = self.guilds.set_rank(hero.char_id, cid, rank)
        if err:
            return err
        gg = self.guilds.guild_of(hero.char_id)
        name = gg.members[cid]["name"]
        text = {"leader": f"{name} agora é o líder da guilda!", "officer": f"{name} agora é Oficial.",
                "member": f"{name} agora é Membro."}[rank]
        await self.guild_notice(gg, text)
        await self.push_guild_all(gg)
        return None

    async def guild_disband(self, hero: Hero) -> str | None:
        gg = self.guilds.guild_of(hero.char_id)
        if not gg or gg.leader != hero.char_id:
            return "Só o líder pode desfazer a guilda."
        await self.guild_notice(gg, f"A guilda {gg.name} foi desfeita pelo líder.")
        members = list(gg.members)
        self.guilds.disband(gg)
        for mid in members:
            if mid in self.heroes:
                await self.sync_guild_tag(mid)
                await self.push_guild(mid)
        return None

    async def guild_war(self, hero: Hero, name: str) -> str | None:
        other, err = self.guilds.declare_war(hero.char_id, name)
        if err:
            return err
        gg = self.guilds.guild_of(hero.char_id)
        minutes = int(gd.WAR_SECS // 60)
        await self.guild_notice(gg, f"[Guerra] {hero.name} declarou guerra contra {other.name} por {minutes} minutos!")
        await self.guild_notice(other, f"[Guerra] A guilda {gg.name} declarou guerra contra vocês por {minutes} minutos! "
                                       "Fora das zonas seguras vocês podem lutar sem virar Assassino.")
        for cid in list(self.heroes):
            await self.send(cid, {"type": "chat", "channel": "event", "text": f"A guilda {gg.name} declarou guerra contra {other.name}!"})
        await self.push_guild_all(gg)
        await self.push_guild_all(other)
        return None

    # ── friends ──────────────────────────────────────────────────────────

    def friends_state(self, hero: Hero) -> dict[str, Any]:
        rows = []
        for cid, name in hero.friends.items():
            f = self.heroes.get(cid)
            rows.append({"id": cid, "name": f.name if f else name, "online": f is not None, "level": f.level if f else 0,
                         "cls": f.cls if f else "", "map": f.map_id if f else ""})
        rows.sort(key=lambda r: (not r["online"], r["name"].lower()))
        return {"type": "friends", "friends": rows, "max": MAX_FRIENDS}

    async def push_friends(self, hero: Hero, only_if_changed: bool = False) -> None:
        state = self.friends_state(hero)
        key = json.dumps(state, sort_keys=True)
        if only_if_changed and self.friends_sent.get(hero.char_id) == key:
            return
        self.friends_sent[hero.char_id] = key
        await self.send(hero.char_id, state)

    async def friends_online(self, hero: Hero, online: bool) -> None:
        """Tells online friends that the hero logged in or out, and refreshes their lists."""
        if online:
            await self.push_friends(hero)
        for cid in hero.friends:
            f = self.heroes.get(cid)
            if not f:
                continue
            if hero.char_id not in f.friends:  # they removed us while we were away
                continue
            await self.notice(cid, f"Seu amigo {hero.name} {'entrou no' if online else 'saiu do'} jogo.")
            await self.push_friends(f)

    async def friend_add(self, hero: Hero, name: str) -> str | None:
        target = self.hero_by_name(name)
        if not target:
            return f"{name.strip() or 'Esse jogador'} não está online. O pedido de amizade só vai para quem está jogando."
        if target.char_id == hero.char_id:
            return "Você não pode adicionar a si mesmo."
        if target.char_id in hero.friends:
            return f"{target.name} já é seu amigo."
        if len(hero.friends) >= MAX_FRIENDS:
            return f"Sua lista de amigos está cheia ({MAX_FRIENDS})."
        if len(target.friends) >= MAX_FRIENDS:
            return f"A lista de amigos de {target.name} está cheia."
        pending = self.friend_reqs.get(target.char_id)
        if pending and time.monotonic() - pending[1] < FRIEND_REQ_TTL:
            return f"{target.name} já tem um pedido esperando resposta. Tente daqui a pouco."
        self.friend_reqs[target.char_id] = (hero.char_id, time.monotonic())
        await self.send(target.char_id, {"type": "dialog", "npc": "friend", "name": "Pedido de amizade",
                                         "lines": [f"{hero.name} (Nv {hero.level}) quer ser seu amigo.",
                                                   "Amigos veem quando o outro está online e onde está."],
                                         "options": [{"id": "friend_decline", "label": "Recusar"},
                                                     {"id": "friend_accept", "label": "Aceitar"}]})
        await self.notice(hero.char_id, f"Pedido de amizade enviado para {target.name}.")
        return None

    async def friend_accept(self, hero: Hero) -> None:
        req = self.friend_reqs.pop(hero.char_id, None)
        asker = self.heroes.get(req[0]) if req and time.monotonic() - req[1] < FRIEND_REQ_TTL else None
        if not asker:
            await self.notice(hero.char_id, "Esse pedido de amizade expirou.", "warn")
            return
        if len(hero.friends) >= MAX_FRIENDS or len(asker.friends) >= MAX_FRIENDS:
            await self.notice(hero.char_id, "Uma das listas de amigos está cheia.", "warn")
            return
        hero.friends[asker.char_id] = asker.name
        asker.friends[hero.char_id] = hero.name
        for a, b in ((hero, asker), (asker, hero)):
            await self.notice(a.char_id, f"Agora você e {b.name} são amigos!", "quest")
            await self.push_friends(a)
            await self.save_hero(a)

    async def friend_decline(self, hero: Hero) -> None:
        req = self.friend_reqs.pop(hero.char_id, None)
        if req and req[0] in self.heroes:
            await self.notice(req[0], f"{hero.name} recusou o pedido de amizade.")

    async def friend_remove(self, hero: Hero, cid: str) -> str | None:
        name = hero.friends.pop(cid, None)
        if name is None:
            return "Esse jogador não está na sua lista de amigos."
        other = self.heroes.get(cid)
        if other:
            if other.friends.pop(hero.char_id, None) is not None:
                await self.push_friends(other)
                await self.save_hero(other)
        elif self.unfriend_offline:
            await self.unfriend_offline(cid, hero.char_id)
        await self.notice(hero.char_id, f"{name} foi removido dos seus amigos.")
        await self.push_friends(hero)
        await self.save_hero(hero)
        return None

    # ── parties ──────────────────────────────────────────────────────────

    def member_name(self, cid: str) -> str:
        h = self.heroes.get(cid)
        if h:
            self.party_names[cid] = h.name
        return self.party_names.get(cid, "Alguém")

    def party_state(self, p: pt.Party) -> dict[str, Any]:
        rows = []
        for cid in p.members:
            h = self.heroes.get(cid)
            rows.append({"id": cid, "name": self.member_name(cid), "cls": h.cls if h else "", "level": h.level if h else 0,
                         "hp": h.hp if h else 0, "max_hp": h.max_hp if h else 1, "map": h.map_id if h else "",
                         "online": h is not None and cid not in p.offline_since, "leader": cid == p.leader})
        return {"type": "party", "members": rows}

    async def push_party(self, cid: str, only_if_changed: bool = False) -> None:
        p = self.parties.party_of(cid)
        if not p:
            await self.send(cid, {"type": "party", "members": []})
            return
        state = self.party_state(p)
        key = json.dumps(state, sort_keys=True)
        if only_if_changed and key == p.last_sent:
            return
        p.last_sent = key
        for m in p.members:
            await self.send(m, state)

    async def party_invite(self, hero: Hero, name: str) -> str | None:
        target = self.hero_by_name(name)
        if not target:
            return f"{name.strip() or 'Esse jogador'} não está online."
        err = self.parties.invite(hero.char_id, target.char_id)
        if err:
            return err
        await self.send(target.char_id, {"type": "dialog", "npc": "party", "name": "Convite de grupo",
                                         "lines": [f"{hero.name} (Nv {hero.level}) convidou você para um grupo.",
                                                   "Em grupo vocês dividem a EXP e as missões, com bônus de EXP."],
                                         "options": [{"id": "party_decline", "label": "Recusar"},
                                                     {"id": "party_accept", "label": "Aceitar"}]})
        await self.notice(hero.char_id, f"Convite enviado para {target.name}.")
        return None

    async def party_accept(self, hero: Hero) -> None:
        p, err = self.parties.accept(hero.char_id)
        if err:
            await self.notice(hero.char_id, err, "warn")
            return
        for m in p.members:
            await self.notice(m, f"{hero.name} entrou no grupo.", "quest")
        await self.push_party(hero.char_id)

    async def party_decline(self, hero: Hero) -> None:
        inviter = self.parties.decline(hero.char_id)
        if inviter:
            await self.notice(inviter, f"{hero.name} recusou o convite para o grupo.")

    async def party_remove(self, cid: str, to_others: str, to_self: str | None = None, kind: str = "info") -> None:
        """Takes cid out of its party and tells everyone; a party left with one member is disbanded."""
        p = self.parties.party_of(cid)
        if not p:
            return
        others = [m for m in p.members if m != cid]
        self.parties.leave(cid)
        await self.send(cid, {"type": "party", "members": []})
        if to_self:
            await self.notice(cid, to_self, kind)
        still = bool(others) and self.parties.party_of(others[0]) is not None
        for m in others:
            if still:
                await self.notice(m, to_others)
            else:
                await self.send(m, {"type": "party", "members": []})
                await self.notice(m, f"{to_others} O grupo foi desfeito.")
        if still:
            await self.push_party(others[0])

    async def party_leave(self, hero: Hero) -> str | None:
        if not self.parties.party_of(hero.char_id):
            return "Você não está em um grupo."
        await self.party_remove(hero.char_id, f"{hero.name} saiu do grupo.", "Você saiu do grupo.")
        return None

    async def party_kick(self, hero: Hero, name: str) -> str | None:
        p = self.parties.party_of(hero.char_id)
        if not p or p.leader != hero.char_id:
            return "Só o líder do grupo pode expulsar."
        target = next((cid for cid in p.members if cid != hero.char_id
                       and self.member_name(cid).lower() == name.strip().lower()), None)
        if not target:
            return "Esse jogador não está no seu grupo."
        await self.party_remove(target, f"{self.member_name(target)} foi expulso do grupo.",
                                f"{hero.name} expulsou você do grupo.", "warn")
        return None

    # ── mining ───────────────────────────────────────────────────────────

    async def mine_start(self, hero: Hero, vein_id: str) -> str | None:
        if hero.map_id != mining.MINE_MAP or hero.is_dead:
            return "Você só pode minerar nas Minas de Ferro Negro."
        s = manager.sessions.get(hero.char_id)
        if not s:
            return None
        v = self.mine.veins.get(vein_id)
        if v and not inv.can_add(hero.bag, mining.KINDS[v.kind]["ore"], 2):
            return "Sua bolsa está cheia."
        err = self.mine.start(hero.char_id, vein_id, s.x, s.y, inv.count(hero.bag, mining.PICKAXE) > 0)
        if err:
            return err
        await self.to_map(hero.map_id, {"type": "mining", "char_id": hero.char_id, "vein": vein_id,
                                        "dur": mining.KINDS[v.kind]["time"]})
        return None

    async def tick_mining(self) -> None:
        if not self.mine.digs and all(v.ready for v in self.mine.veins.values()):
            return
        positions = {}
        for cid in self.mine.digs:
            h, s = self.heroes.get(cid), manager.sessions.get(cid)
            if h and s and h.map_id == mining.MINE_MAP and not h.is_dead:
                positions[cid] = (s.x, s.y)
        done, cancelled, changed = self.mine.tick(positions)
        for cid in cancelled:
            await self.to_map(mining.MINE_MAP, {"type": "mining_end", "char_id": cid, "ok": False})
        for cid, ore, qty in done:
            hero = self.heroes.get(cid)
            await self.to_map(mining.MINE_MAP, {"type": "mining_end", "char_id": cid, "ok": True})
            if not hero:
                continue
            got = inv.add_item(hero.bag, ore, qty)
            await self.send(cid, {"type": "reward", "exp": 0, "gold": 0, "loot": [inv.ITEMS[ore]["name"]] * got})
            await self.push_inventory(hero)
            if got:
                await self.daily_progress(hero, "mine", "", got)
        for v in changed:
            await self.to_map(mining.MINE_MAP, {"type": "vein", **v.public()})

    # ── forge ────────────────────────────────────────────────────────────

    def at_forge(self, hero: Hero) -> bool:
        return hero.shop == "forge" and self.shop_npc(hero, "forge") is not None

    def find_piece(self, hero: Hero, where: str, ref: Any, item_id: str) -> dict[str, Any] | None:
        """The gear piece the client pointed at (bag index or equipped slot), if it still matches."""
        if where == "gear":
            p = hero.gear.get(str(ref))
            return p if p and inv.item_id(p) == item_id else None
        try:
            e = hero.bag[int(ref)]
        except (ValueError, TypeError, IndexError):
            return None
        return e if e["id"] == item_id and inv.ITEMS[item_id]["type"] == "gear" else None

    async def forge_craft(self, hero: Hero, stone: str, qty: int) -> str | None:
        if not self.at_forge(hero):
            return "Fale com o ferreiro para usar a forja."
        recipe = forge.RECIPES.get(stone)
        if not recipe:
            return "Receita desconhecida."
        qty = max(1, min(qty, 20))
        for mat, n in recipe["mats"].items():
            if inv.count(hero.bag, mat) < n * qty:
                return f"Faltam materiais: {n * qty}× {inv.ITEMS[mat]['name']}."
        if hero.gold < recipe["gold"] * qty:
            return "Ouro insuficiente."
        for mat, n in recipe["mats"].items():
            self.take_stack(hero, mat, n * qty)
        if not inv.can_add(hero.bag, stone, qty):  # room freed by the ores is usually enough
            for mat, n in recipe["mats"].items():
                inv.add_item(hero.bag, mat, n * qty)
            return "Sua bolsa está cheia."
        hero.gold -= recipe["gold"] * qty
        inv.add_item(hero.bag, stone, qty)
        await self.send(hero.char_id, {"type": "forge_result", "ok": True,
                                       "text": f"Forjou {qty}× {inv.ITEMS[stone]['name']}."})
        await self.after_inventory(hero)
        return None

    def take_stack(self, hero: Hero, item_id: str, qty: int) -> None:
        for i in range(len(hero.bag) - 1, -1, -1):
            e = hero.bag[i]
            if qty <= 0:
                break
            if e["id"] == item_id:
                n = min(qty, e["qty"])
                inv.take_at(hero.bag, i, item_id, n)
                qty -= n

    async def forge_upgrade(self, hero: Hero, where: str, ref: Any, item_id: str, protect: bool) -> str | None:
        p = self.find_piece(hero, where, ref, item_id)
        if p is None:
            return "Esse item não está mais aí."
        plus = int(p.get("plus", 0))
        if plus >= forge.MAX_PLUS:
            return f"Esse item já está no máximo (+{forge.MAX_PLUS})."
        target = plus + 1
        stone, fee = forge.stone_for(target), forge.up_fee(target)
        if inv.count(hero.bag, stone) < 1:
            return f"Você precisa de 1× {inv.ITEMS[stone]['name']}."
        if protect and inv.count(hero.bag, "stone_protect") < 1:
            return "Você não tem Pedra de Proteção."
        if hero.gold < fee:
            return "Ouro insuficiente."
        hero.gold -= fee
        self.take_stack(hero, stone, 1)
        if protect:
            self.take_stack(hero, "stone_protect", 1)
        # `p` is the piece's own dict: removing stone stacks from the bag does not move or replace it
        name = inv.ITEMS[item_id]["name"]
        if random.random() < forge.UP_CHANCE[target]:
            p["plus"] = target
            msg = {"ok": True, "text": f"Sucesso! {name} agora é +{target}.", "plus": target}
        else:
            new = plus if protect else forge.after_failure(plus, target)
            p["plus"] = new
            lost = "A Pedra de Proteção segurou o nível." if protect and new == plus else (
                "O nível se manteve." if new == plus else f"Caiu para +{new}.")
            msg = {"ok": False, "text": f"Falhou ao aprimorar {name} para +{target}. {lost}", "plus": new}
        if where == "bag" and not p["plus"]:
            del p["plus"]  # bag entries only carry "plus" when it is above 0
        await self.send(hero.char_id, {"type": "forge_result", **msg})
        await self.after_inventory(hero, stats=where == "gear")
        await self.daily_progress(hero, "forge")
        return None

    def weapon_enchant(self, hero: Hero) -> dict[str, Any] | None:
        w = hero.gear.get("weapon")
        return forge.ENCHANTS.get(w.get("ench", "")) if isinstance(w, dict) else None

    async def enchant_proc(self, hero: Hero, ench: dict[str, Any], mob_id: str, hit: int) -> None:
        """The weapon's element on a direct hit: burn, slow, an extra shock or poison."""
        mob = self.mobs[hero.map_id].mobs.get(mob_id)
        if not mob or mob.is_dead:
            return
        now = time.monotonic()
        kind = ench["effect"]
        if kind in ("burn", "poison"):
            ticks = 3 if kind == "burn" else 4
            share = forge.BURN_SHARE if kind == "burn" else forge.POISON_SHARE
            per = max(1, int(hit * share / ticks))
            self.dots.append(Dot(hero.char_id, mob_id, hero.map_id, per, 1.0, ticks, now + 1.0, kind))
        elif kind == "slow":
            self.mobs[hero.map_id].apply_cc(mob_id, "slow", forge.SLOW_SECONDS)
            await self.to_target(hero.map_id, mob_id, {"type": "cc", "target": mob_id, "kind": "slow", "dur": forge.SLOW_SECONDS}, (0.0, 0.0))
        elif kind == "shock":
            await self.hurt_mob(hero, mob_id, max(1, int(hit * forge.SHOCK_SHARE)))
        await self.to_target(hero.map_id, mob_id, {"type": "enchant_proc", "target": mob_id, "kind": kind}, (0.0, 0.0))

    async def forge_enchant(self, hero: Hero, where: str, ref: Any, item_id: str, element: str) -> str | None:
        if element not in forge.ENCHANTS:
            return "Escolha um elemento."
        p = self.find_piece(hero, where, ref, item_id)
        if p is None:
            return "Esse item não está mais aí."
        if inv.ITEMS[item_id].get("slot") != "weapon":
            return "Só armas podem ser encantadas."
        if p.get("ench") == element:
            return f"Essa arma já está encantada com {forge.ENCHANTS[element]['name']}."
        tier = int(inv.ITEMS[item_id].get("tier", 1))
        fee = forge.enchant_fee(tier)
        if inv.count(hero.bag, "stone_enchant") < 1:
            return "Você precisa de 1× Pedra de Encantamento."
        if hero.gold < fee:
            return "Ouro insuficiente."
        hero.gold -= fee
        self.take_stack(hero, "stone_enchant", 1)
        p["ench"] = element
        e = forge.ENCHANTS[element]
        await self.send(hero.char_id, {"type": "forge_result", "ok": True, "ench": element,
                                       "text": f"{inv.ITEMS[item_id]['name']} encantada com {e['name']}: {e['desc']}."})
        await self.after_inventory(hero, stats=where == "gear")
        return None

    async def forge_refine(self, hero: Hero, where: str, ref: Any, item_id: str) -> str | None:
        p = self.find_piece(hero, where, ref, item_id)
        if p is None:
            return "Esse item não está mais aí."
        tier = int(inv.ITEMS[item_id].get("tier", 1))
        fee = forge.refine_fee(tier)
        if inv.count(hero.bag, "stone_refine") < 1:
            return "Você precisa de 1× Pedra de Refino."
        if hero.gold < fee:
            return "Ouro insuficiente."
        hero.gold -= fee
        self.take_stack(hero, "stone_refine", 1)
        full = len(p.get("ref") or {}) >= forge.REFINE_MAX_LINES
        p["ref"] = forge.refine(p.get("ref") or {}, tier)
        text = "Refino refeito: novos bônus sorteados." if full else "Refino concluído: um novo bônus foi adicionado."
        await self.send(hero.char_id, {"type": "forge_result", "ok": True, "text": text, "ref": p["ref"]})
        await self.after_inventory(hero, stats=where == "gear")
        return None

    # ── player market ────────────────────────────────────────────────────

    async def persist_market(self) -> None:
        if self.save_market:
            await self.save_market()
        self.market.dirty = False

    def at_market(self, hero: Hero) -> bool:
        return hero.shop == "market" and self.shop_npc(hero, "merchant") is not None

    async def market_open(self, hero: Hero) -> None:
        if not self.shop_npc(hero, "merchant") or hero.pk_status() == "red":
            return
        hero.shop = "market"
        await self.push_inventory(hero)
        await self.market_view(hero)

    async def market_view(self, hero: Hero, cat: str | None = None, sort: str | None = None, page: int | None = None) -> None:
        q = hero.market_q
        if cat in mk.CATEGORIES:
            q["cat"], q["page"] = cat, 0
        if sort in ("price", "new"):
            q["sort"], q["page"] = sort, 0
        if page is not None:
            q["page"] = page
        rows, pages = self.market.search(q["cat"], q["sort"], q["page"])
        q["page"] = min(q["page"], pages - 1)
        now = time.time()
        await self.send(hero.char_id, {
            "type": "market", "cat": q["cat"], "sort": q["sort"], "page": q["page"], "pages": pages,
            "rows": [l.public(now) for l in rows], "mine": [l.public(now) for l in self.market.mine(hero.char_id)],
            "box": self.market.box(hero.char_id), "fee": mk.LISTING_FEE, "tax": mk.SALES_TAX, "max": mk.MAX_LISTINGS,
            "categories": mk.CATEGORIES,
        })

    def give_item(self, hero: Hero, item: dict[str, Any]) -> bool:
        """Puts a market item (with its qty / plus / ref) into the hero's bag, if there is room."""
        if inv.ITEMS[item["id"]]["type"] == "gear":
            return inv.add_piece(hero.bag, item)
        if not inv.can_add(hero.bag, item["id"], item["qty"]):
            return False
        inv.add_item(hero.bag, item["id"], item["qty"])
        return True

    async def market_changed(self, *heroes: Hero) -> None:
        await self.persist_market()
        for h in heroes:
            await self.push_inventory(h)
            await self.save_hero(h)
            if h.shop == "market":
                await self.market_view(h)

    async def market_sell(self, hero: Hero, index: int, item_id: str, qty: int, price: int) -> str | None:
        if not self.at_market(hero):
            return "Fale com Dorian para usar o Mercado."
        if not (0 <= index < len(hero.bag)) or hero.bag[index]["id"] != item_id:
            return "Esse item não está mais na bolsa."
        qty = 1 if inv.ITEMS[item_id]["type"] == "gear" else max(1, min(qty, hero.bag[index]["qty"]))
        item = {k: v for k, v in hero.bag[index].items() if k in ("id", "plus", "ref", "ench")}
        item["qty"] = qty
        err = self.market.check_listing(hero.char_id, item, price)
        if err:
            return err
        fee = mk.listing_fee(price)
        if hero.gold < fee:
            return f"Você precisa de {fee} ouro para a taxa de anúncio."
        if not inv.take_at(hero.bag, index, item_id, qty):
            return "Esse item não está mais na bolsa."
        hero.gold -= fee
        self.market.add(hero.char_id, hero.name, item, price)
        await self.notice(hero.char_id, f"Anunciado: {qty}× {inv.ITEMS[item_id]['name']} por {price} ouro (taxa: {fee}).")
        await self.market_changed(hero)
        return None

    async def market_buy(self, hero: Hero, listing_id: int) -> str | None:
        if not self.at_market(hero):
            return "Fale com Dorian para usar o Mercado."
        listing = self.market.listings.get(listing_id)
        if not listing:
            return "Esse anúncio não existe mais (alguém comprou antes)."
        if listing.seller == hero.char_id:
            return "Esse anúncio é seu. Para tirar do mercado, use Cancelar."
        if hero.gold < listing.price:
            return "Ouro insuficiente."
        if not self.give_item(hero, listing.item):
            return "Sua bolsa está cheia."
        self.market.take(listing_id)
        hero.gold -= listing.price
        earned = mk.seller_gets(listing.price)
        self.market.credit(listing.seller, gold=earned)
        name = inv.ITEMS[listing.item["id"]]["name"]
        await self.notice(hero.char_id, f"Comprou {listing.item['qty']}× {name} por {listing.price} ouro.")
        await self.notice(listing.seller, f"Vendido no Mercado: {listing.item['qty']}× {name} por {listing.price} ouro. "
                                          f"{earned} ouro esperam na sua caixa de coleta (Dorian).", "quest")
        seller = self.heroes.get(listing.seller)
        await self.market_changed(*([hero, seller] if seller else [hero]))
        return None

    async def market_cancel(self, hero: Hero, listing_id: int) -> str | None:
        if not self.at_market(hero):
            return "Fale com Dorian para usar o Mercado."
        listing = self.market.listings.get(listing_id)
        if not listing or listing.seller != hero.char_id:
            return "Esse anúncio não é seu ou já foi vendido."
        self.market.take(listing_id)
        if not self.give_item(hero, listing.item):
            self.market.credit(hero.char_id, item=listing.item)
            await self.notice(hero.char_id, "Bolsa cheia: o item foi para a sua caixa de coleta.")
        await self.market_changed(hero)
        return None

    async def market_collect(self, hero: Hero) -> str | None:
        if not self.at_market(hero):
            return "Fale com Dorian para usar o Mercado."
        box = self.market.box(hero.char_id)
        if not box["gold"] and not box["items"]:
            return "Sua caixa de coleta está vazia."
        hero.gold += box["gold"]
        got, kept = box["gold"], []
        for item in box["items"]:
            if not self.give_item(hero, item):
                kept.append(item)
        self.market.claims[hero.char_id] = {"gold": 0, "items": kept}
        if not kept:
            del self.market.claims[hero.char_id]
        self.market.dirty = True
        await self.notice(hero.char_id, f"Coletado: {got} ouro e {len(box['items']) - len(kept)} item(ns)."
                                        + (" A bolsa encheu: o resto continua na caixa." if kept else ""))
        await self.market_changed(hero)
        return None
