"""
Global world boss event: three bosses take turns, one per time slot, three times a day.

  • The event room (EVENT_MAP) has no PvP and dying there costs nothing: you get back up at the
    entrance in a few seconds and keep fighting.
  • The boss's health is BASE × number of players who entered the room (10 players → 10×).
    It only grows: leaving does not make the boss weaker.
  • Boss skills are telegraphed circles on the ground (wb_cast → wb_impact). Damage is a share of each
    player's max HP, so it is fair at any level. Exactly one skill per boss is deadly: whoever is still
    inside its circle when it lands has KILL_CHANCE of dying instantly (and takes heavy damage otherwise).
  • Rewards: the top 3 damage dealers and the last hit, plus a participation reward for everyone who hit it.
"""

from __future__ import annotations

import math
import random
import time
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

import items as inv

if TYPE_CHECKING:
    from game import Game, Hero

EVENT_MAP = "worldboss_01"
EVENT_TIMES: list[tuple[int, int]] = [(10, 0), (16, 0), (22, 0)]  # local server time; slot i → BOSSES[i] (Gorgath, Ignaroth, Krovak)
ANNOUNCE_LEADS = (600, 300, 60)       # warn everyone this many seconds before the start
EVENT_DURATION = 30 * 60          # the boss leaves if not defeated in time
AFTER_KILL_STAY = 60              # seconds to read the results before going back to town
KILL_CHANCE = 0.20
BOSS_POS = (15.0, 12.5)
BOSS_TETHER = 6.5                 # tiles the boss may walk from BOSS_POS (the entrance/respawn is ~11.5 away)
SCORES_EVERY = 2.0

# Strength from the level: a region monster's health (35·L^1.15) × WB_HP_MULT for each player in the room,
# and a region monster's attack × WB_ATK_MULT for the boss's own blows.
WB_HP_MULT = 220
WB_ATK_MULT = 2.6


def boss_stats(level: int) -> dict[str, int]:
    from world_data import power
    k = power(level)
    return {"hp": int(35 * level ** 1.15 * WB_HP_MULT * k), "atk": int((2.4 * level + 0.16 * level * level) * WB_ATK_MULT * k),
            "def": level + 20}

BOSSES: list[dict[str, Any]] = [
    {
        "id": "wb_gorgath", "name": "Gorgath, o Devorador", "level": 50, **boss_stats(50), "speed": 2.4,
        "intro": "O chão treme... Gorgath, o Devorador, despertou!",
        "skills": [
            {"id": "quake", "name": "Terremoto", "kind": "self", "radius": 5.0, "warn": 1.4, "every": 7, "damage": 0.45},
            {"id": "boulders", "name": "Chuva de Rochas", "kind": "targets", "count": 4, "radius": 2.4, "warn": 1.6, "every": 6,
             "damage": 0.38},
            {"id": "roar", "name": "Rugido Ensurdecedor", "kind": "all", "warn": 1.0, "every": 12, "damage": 0.18},
            {"id": "doom", "name": "Esmagamento Final", "kind": "deadly", "radius": 5.5, "warn": 2.8, "every": 18, "damage": 0.65},
        ],
    },
    {
        "id": "wb_ignaroth", "name": "Ignaroth, a Fera Ígnea", "level": 70, **boss_stats(70), "speed": 2.8,
        "intro": "O ar ferve... Ignaroth, a Fera Ígnea, surgiu das cinzas!",
        "skills": [
            {"id": "flame_ring", "name": "Anel de Chamas", "kind": "self", "radius": 6.0, "warn": 1.2, "every": 6, "damage": 0.45},
            {"id": "meteors", "name": "Meteoros", "kind": "targets", "count": 6, "radius": 2.0, "warn": 1.5, "every": 5,
             "damage": 0.36},
            {"id": "heat", "name": "Calor Infernal", "kind": "all", "warn": 1.0, "every": 10, "damage": 0.16},
            {"id": "inferno", "name": "Inferno", "kind": "deadly", "radius": 6.0, "warn": 2.6, "every": 18, "damage": 0.7},
        ],
    },
    {
        "id": "wb_krovak", "name": "Krovak, o Colosso de Gelo", "level": 100, **boss_stats(100), "speed": 2.4,
        "intro": "Um frio mortal toma a arena... Krovak, o Colosso de Gelo, chegou!",
        "skills": [
            {"id": "frost_nova", "name": "Nova Congelante", "kind": "self", "radius": 5.0, "warn": 1.3, "every": 7, "damage": 0.42,
             "stun": 1.5},
            {"id": "icicles", "name": "Estalactites", "kind": "random", "count": 8, "radius": 1.8, "warn": 1.4, "every": 5,
             "damage": 0.35},
            {"id": "blizzard", "name": "Nevasca", "kind": "all", "warn": 1.0, "every": 10, "damage": 0.16},
            {"id": "absolute_zero", "name": "Zero Absoluto", "kind": "deadly", "radius": 6.0, "warn": 2.6, "every": 18,
             "damage": 0.75},
        ],
    },
]
BOSS_BY_ID = {b["id"]: b for b in BOSSES}

REWARDS: dict[str, dict[str, int]] = {
    "1": {"gold": 5000, "exp": 8000, "pool": 4},
    "2": {"gold": 3000, "exp": 6000, "pool": 3},
    "3": {"gold": 2000, "exp": 5000, "pool": 3},
    "last": {"gold": 2500, "exp": 5000, "pool": 4},
    "all": {"gold": 300, "exp": 3000},
}
PLACE_NAMES = {"1": "1º lugar em dano", "2": "2º lugar em dano", "3": "3º lugar em dano", "last": "Último golpe"}


def mob_def(b: dict[str, Any]) -> dict[str, Any]:
    """The boss as a MobManager definition (skills are run by this module, not by the mob AI)."""
    return {"name": b["name"], "level": b["level"], "hp": b["hp"], "atk": b["atk"], "def": b["def"], "exp": 0,
            "gold": (0, 0), "aggro": 40.0, "respawn": 10 ** 7, "speed": b["speed"], "boss": True}


def next_slot(now: datetime) -> tuple[datetime, int]:
    """The next event start at or after `now` and its slot index."""
    for days in (0, 1):
        base = (now + timedelta(days=days)).replace(second=0, microsecond=0)
        for i, (h, m) in enumerate(EVENT_TIMES):
            start = base.replace(hour=h, minute=m)
            if start >= now.replace(second=0, microsecond=0):
                return start, i
    raise RuntimeError("no slot")  # unreachable: tomorrow always has slots


class WorldBossEvent:
    def __init__(self) -> None:
        self.state = "idle"                 # idle | active | over
        self.boss: dict[str, Any] | None = None
        self.mob_id: str | None = None
        self.started_at = 0.0
        self.ends_at = 0.0                  # monotonic: boss leaves (active) or room closes (over)
        self.participants: set[str] = set()
        self.next_cast: dict[str, float] = {}
        self.pending: list[dict[str, Any]] = []   # telegraphed skills waiting to land
        self.done_slots: set[tuple[str, int]] = set()
        self.announced: set[tuple[str, int, int]] = set()
        self.last_scores = 0.0

    # ── status ───────────────────────────────────────────────────────────

    def status(self) -> dict[str, Any]:
        start, slot = next_slot(datetime.now())
        msg: dict[str, Any] = {"type": "wb_status", "state": self.state,
                               "next_boss": BOSSES[slot]["name"], "next_at": start.strftime("%H:%M"),
                               # seconds to the next start, so the client can count down (its clock may differ)
                               "starts_in": max(0, int((start - datetime.now()).total_seconds()))}
        if self.state != "idle" and self.boss:
            msg["boss"] = self.boss["name"]
            msg["ends_in"] = max(0, int(self.ends_at - time.monotonic()))
        return msg

    def is_open(self) -> bool:
        return self.state == "active"

    def boss_mob(self, game: Game):
        return game.mobs[EVENT_MAP].mobs.get(self.mob_id) if self.mob_id else None

    # ── schedule ─────────────────────────────────────────────────────────

    async def tick_schedule(self, game: Game) -> None:
        """Called once a second: announcements, starting the slot's boss, and ending on time."""
        now = datetime.now()
        start, slot = next_slot(now)
        lead = (start - now).total_seconds()
        day = start.strftime("%Y-%m-%d")
        for secs in ANNOUNCE_LEADS:
            key = (day, slot, secs)
            if 0 < lead <= secs and key not in self.announced and self.state == "idle":
                self.announced.add(key)
                mins = max(1, round(lead / 60))
                await self.announce(game, f"Boss Global: {BOSSES[slot]['name']} surge em {mins} minuto{'s' if mins > 1 else ''}! "
                                          "Entre pelo portal ao sul da Vila de Ravencrest.")
                await self.push_status(game)   # fresh countdown for the on-screen alert
        # the minute a slot starts (and the minute after, in case of a slow tick)
        for i, (h, m) in enumerate(EVENT_TIMES):
            at = now.replace(hour=h, minute=m, second=0, microsecond=0)
            key = (now.strftime("%Y-%m-%d"), i)
            if 0 <= (now - at).total_seconds() < 120 and key not in self.done_slots and self.state == "idle":
                self.done_slots.add(key)
                await self.start(game, BOSSES[i])
        if self.state != "idle" and time.monotonic() >= self.ends_at:
            if self.state == "active":
                await self.announce(game, f"{self.boss['name']} escapou! Ninguém conseguiu derrotá-lo a tempo.")
            await self.close(game)

    async def announce(self, game: Game, text: str) -> None:
        for cid in list(game.heroes):
            await game.notice(cid, text, "quest")
            await game.send(cid, {"type": "chat", "channel": "event", "text": text})

    # ── lifecycle ────────────────────────────────────────────────────────

    async def start(self, game: Game, boss: dict[str, Any]) -> None:
        if self.state != "idle":
            return
        mm = game.mobs[EVENT_MAP]
        mm.mobs.clear()
        mm.spawn(boss["id"], mob_def(boss), BOSS_POS[0], BOSS_POS[1], 1, 0.0)
        self.mob_id = next(iter(mm.mobs))
        mob = mm.mobs[self.mob_id]
        mob.tether = BOSS_TETHER   # stays in its arena: whoever falls gets back up at the entrance, out of its reach
        mob.leash_radius = 10 ** 6  # and never gives up (a leash reset would wipe the damage ranking)
        self.boss, self.state = boss, "active"
        self.started_at = time.monotonic()
        self.ends_at = self.started_at + EVENT_DURATION
        self.participants.clear()
        self.pending.clear()
        now = time.monotonic()
        # stagger the first casts so the fight opens gently
        self.next_cast = {s["id"]: now + 6 + i * 3 for i, s in enumerate(boss["skills"])}
        for cid, h in list(game.heroes.items()):
            if h.map_id == EVENT_MAP:
                await self.on_enter(game, h)
                await game.send(cid, self.boss_mob(game).snapshot())
        await self.announce(game, f"{boss['intro']} Entre pelo portal ao sul da vila ou digite /boss no chat.")
        await self.push_status(game)

    async def close(self, game: Game) -> None:
        """Sends everyone in the room back to town and removes the boss."""
        mm = game.mobs[EVENT_MAP]
        mm.mobs.clear()
        self.state, self.boss, self.mob_id = "idle", None, None
        self.pending.clear()
        self.participants.clear()
        town = next(p for p in game_portals(game, EVENT_MAP) if p["to"] == "town_01")
        for h in list(game.heroes.values()):
            if h.map_id == EVENT_MAP:
                if h.is_dead:
                    h.is_dead, h.hp = False, h.max_hp
                await game.change_map(h, "town_01", town["dx"], town["dy"])
        await self.push_status(game)

    async def push_status(self, game: Game) -> None:
        st = self.status()
        for cid, h in list(game.heroes.items()):
            await game.send(cid, st)
            if h.map_id == "town_01":
                await game.send(cid, {**game.map_info(h), "type": "portals"})

    async def on_enter(self, game: Game, hero: Hero) -> None:
        """A hero arrived in the room: the boss grows to BASE × participants (keeping its health %)."""
        if self.state != "active" or hero.char_id in self.participants:
            return
        self.participants.add(hero.char_id)
        mob = self.boss_mob(game)
        if not mob or mob.is_dead:
            return
        ratio = mob.hp / mob.max_hp
        mob.max_hp = self.boss["hp"] * len(self.participants)
        mob.hp = max(1, round(mob.max_hp * ratio))
        await game.to_map(EVENT_MAP, {"type": "mob_hp", "id": mob.instance_id, "hp": mob.hp, "max_hp": mob.max_hp,
                                      "participants": len(self.participants)})
        await game.notice(hero.char_id, f"Você entrou no evento! {len(self.participants)} jogador(es): "
                                        f"a vida do boss agora é {len(self.participants)}×.", "quest")

    async def join(self, game: Game, hero: Hero) -> str | None:
        if self.state != "active":
            st = self.status()
            return f"Nenhum Boss Global agora. Próximo: {st['next_boss']} às {st['next_at']}."
        if hero.is_dead:
            return "Espere renascer para entrar no evento."
        if hero.map_id == EVENT_MAP:
            return None
        spawn = game_map(EVENT_MAP)["spawn"]
        await game.change_map(hero, EVENT_MAP, spawn[0], spawn[1])
        return None

    # ── fight ────────────────────────────────────────────────────────────

    def fighters(self, game: Game) -> list[tuple[Hero, float, float]]:
        from websocket_manager import manager
        out = []
        for h in game.heroes.values():
            s = manager.sessions.get(h.char_id)
            if h.map_id == EVENT_MAP and not h.is_dead and s:
                out.append((h, s.x, s.y))
        return out

    async def tick_fight(self, game: Game) -> None:
        if self.state != "active":
            return
        mob = self.boss_mob(game)
        if not mob or mob.is_dead:
            return
        now = time.monotonic()
        for p in [p for p in self.pending if now >= p["at"]]:
            self.pending.remove(p)
            await self.land(game, p)
        fighters = self.fighters(game)
        if not fighters or now < mob.stun_until:
            return
        for sk in self.boss["skills"]:
            if now >= self.next_cast.get(sk["id"], 0):
                self.next_cast[sk["id"]] = now + sk["every"]
                await self.cast(game, mob, sk, fighters)
                break  # one new skill per tick keeps patterns readable
        if now - self.last_scores >= SCORES_EVERY:
            self.last_scores = now
            await self.push_scores(game, mob)

    async def cast(self, game: Game, mob, sk: dict[str, Any], fighters: list[tuple[Hero, float, float]]) -> None:
        kind = sk["kind"]
        circles: list[list[float]] = []
        if kind == "self":
            circles = [[mob.x, mob.y, sk["radius"]]]
        elif kind == "targets":
            picks = random.sample(fighters, min(sk["count"], len(fighters)))
            circles = [[x, y, sk["radius"]] for _, x, y in picks]
        elif kind == "random":
            size = game_map(EVENT_MAP)["size"]
            for _ in range(sk["count"]):
                a, r = random.uniform(0, math.tau), random.uniform(0, 10)
                circles.append([max(2, min(size - 2, 15 + math.cos(a) * r)), max(2, min(size - 2, 15 + math.sin(a) * r)),
                                sk["radius"]])
        elif kind == "deadly":
            _, x, y = random.choice(fighters)
            circles = [[x, y, sk["radius"]]]
        pending = {"skill": sk, "circles": circles, "at": time.monotonic() + sk["warn"], "mob_id": mob.instance_id}
        self.pending.append(pending)
        await game.to_map(EVENT_MAP, {"type": "wb_cast", "mob_id": mob.instance_id, "skill": sk["id"], "name": sk["name"],
                                      "kind": kind, "deadly": kind == "deadly", "circles": circles, "warn": sk["warn"]})

    async def land(self, game: Game, p: dict[str, Any]) -> None:
        sk = p["skill"]
        await game.to_map(EVENT_MAP, {"type": "wb_impact", "mob_id": p["mob_id"], "skill": sk["id"], "kind": sk["kind"],
                                      "deadly": sk["kind"] == "deadly", "circles": p["circles"]})
        for h, x, y in self.fighters(game):
            inside = sk["kind"] == "all" or any(math.hypot(x - cx, y - cy) <= r for cx, cy, r in p["circles"])
            if not inside:
                continue
            if sk["kind"] == "deadly" and random.random() < KILL_CHANCE:
                await game.notice(h.char_id, f"{sk['name']} te acertou em cheio!", "warn")
                await game.hurt_hero(h, h.hp + h.mp * 10 + 10 ** 6, None, source=p["mob_id"], true_damage=True)
                continue
            dmg = max(1, int(h.max_hp * sk["damage"]))
            await game.hurt_hero(h, dmg, None, source=p["mob_id"], true_damage=True)
            if sk.get("stun") and not h.is_dead:
                h.stun_until = max(h.stun_until, time.monotonic() + sk["stun"])
                await game.to_map(EVENT_MAP, {"type": "cc", "target": h.char_id, "kind": "freeze", "dur": sk["stun"]})

    def ranking(self, mob) -> list[tuple[str, int]]:
        return sorted(mob.damage_by.items(), key=lambda kv: -kv[1])

    async def push_scores(self, game: Game, mob) -> None:
        total = max(1, sum(mob.damage_by.values()))
        rows = [{"name": game.member_name(cid), "dmg": d, "pct": round(100 * d / total, 1)}
                for cid, d in self.ranking(mob)[:5]]
        base = {"type": "wb_scores", "boss": self.boss["name"], "participants": len(self.participants), "rows": rows,
                "ends_in": max(0, int(self.ends_at - time.monotonic()))}
        for h, _, _ in self.fighters(game) + [(h, 0, 0) for h in game.heroes.values() if h.map_id == EVENT_MAP and h.is_dead]:
            mine = mob.damage_by.get(h.char_id, 0)
            await game.send(h.char_id, {**base, "me": mine, "me_pct": round(100 * mine / total, 1)})

    # ── the end ──────────────────────────────────────────────────────────

    async def on_boss_killed(self, game: Game, killer: Hero) -> None:
        mob = self.boss_mob(game)
        boss = self.boss
        if mob:
            await self.push_scores(game, mob)  # final numbers in the side panel, including the killing blow
        ranking = self.ranking(mob) if mob else []
        total = max(1, sum(d for _, d in ranking))
        places: dict[str, list[str]] = {}
        for i, (cid, _) in enumerate(ranking[:3]):
            places.setdefault(cid, []).append(str(i + 1))
        places.setdefault(killer.char_id, []).append("last")
        self.state, self.pending = "over", []
        self.ends_at = time.monotonic() + AFTER_KILL_STAY
        top = [{"name": game.member_name(cid), "dmg": d, "pct": round(100 * d / total, 1)} for cid, d in ranking[:3]]
        for cid, dmg in ranking:
            hero = game.heroes.get(cid)
            if not hero:
                continue
            got = await self.give(game, hero, ["all"] + places.get(cid, []))
            await game.send(cid, {"type": "wb_result", "boss": boss["name"], "top": top, "last_hit": killer.name,
                                  "participants": len(self.participants), "dmg": dmg, "pct": round(100 * dmg / total, 1),
                                  "places": [PLACE_NAMES[p] for p in places.get(cid, [])], "rewards": got})
        await self.announce(game, f"{boss['name']} foi derrotado! Último golpe: {killer.name}. "
                                  f"Maior dano: {top[0]['name'] if top else '—'}.")
        await self.push_status(game)

    async def give(self, game: Game, hero: Hero, keys: list[str]) -> list[str]:
        import season as ssn
        got: list[str] = []
        gold = exp = 0
        await game.pass_xp(hero, ssn.WB_JOIN_XP + ssn.WB_PLACE_XP * (len(keys) - 1))
        for key in keys:
            r = REWARDS[key]
            gold += r["gold"]
            exp += r["exp"]
            if r.get("pool"):
                item = inv.pool_item(r["pool"], hero.cls)
                if item and inv.add_item(hero.bag, item):
                    got.append(inv.ITEMS[item]["name"])
                elif item:
                    got.append(f"{inv.ITEMS[item]['name']} (perdido: bolsa cheia)")
        hero.gold += gold
        got[:0] = [f"{gold} ouro", f"{exp} EXP"]
        await game.add_exp(hero, exp)
        await game.push_hero(hero)
        await game.push_inventory(hero)
        await game.save_hero(hero)
        return got


def game_map(map_id: str) -> dict[str, Any]:
    from world_data import MAPS
    return MAPS[map_id]


def game_portals(game: Game, map_id: str) -> list[dict[str, Any]]:
    return game_map(map_id)["portals"]
