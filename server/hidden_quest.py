"""
The Hidden Wanderer (O Andarilho Oculto): a secret quest for the curious.

A hooded NPC hides at a random spot of a random hunting map. It is not on the minimap, and the server only tells a
player about it when they walk close (nobody can read its place from the network). Talking to it offers a hard
quest with 24 hours to finish it; accepting makes the Wanderer vanish, and while someone holds the quest nobody else
can find it (one at a time). Finished: a reward no one can buy (the Corcel Fantasma mount and the title "Caçador de
Segredos"), once per hero. Failed or finished: the Wanderer reappears somewhere else, at random.

Every few hours a vague rumour in the global chat names the region, never the spot.
Quest kinds (drawn at random, scaled to the hero's level): a big hunt, a map boss, the Global Boss (deal 1% of its
life), or exploration (3 hidden marks on other maps, seen only up close by the holder).
Player-facing text is in Portuguese.
"""

from __future__ import annotations

import math
import random
import time
from typing import TYPE_CHECKING, Any

from world_data import MAPS, MOBS, SPAWNS
from websocket_manager import manager

if TYPE_CHECKING:
    from game import Game, Hero

NPC_ID = "hidden_wanderer"
NPC_NAME = "Andarilho Oculto"
DURATION = 24 * 3600
VIS = 7.0            # the Wanderer shows within this distance (tiles)
TALK = 4.0
MARK_VIS = 5.0       # exploration marks show within this distance, only to the holder
MARK_TOUCH = 1.6
RUMOR_EVERY = 3 * 3600
FIRST_RUMOR = 20 * 60
HUNT_COUNT = 80
WB_SHARE = 0.01      # Global Boss: deal at least 1% of its life
REWARD_MOUNT = "mount_phantom"
REWARD_TITLE = "cacador_segredos"
ELIGIBLE = [k for k, m in MAPS.items() if not m["safe"] and not m["pvp"] and not m.get("event")]
RUMOR_PLACES = {
    "forest": "entre as árvores retorcidas da Floresta Sombria", "crypt": "nos corredores frios onde os mortos dormem",
    "mine": "nas profundezas onde se cava o ferro negro", "swamp": "onde a névoa do pântano nunca se dissipa",
    "frost": "onde a neve nunca derrete", "ash": "nas terras onde só restam cinzas",
    "crimson": "à beira de um abismo da cor do sangue", "ghost": "entre ruínas assombradas por soldados antigos",
    "void": "nas muralhas de uma cidadela esquecida pelo tempo",
}


def _dist(ax: float, ay: float, bx: float, by: float) -> float:
    return math.hypot(ax - bx, ay - by)


def spot(rng: random.Random, exclude: set[str] | None = None) -> dict[str, Any]:
    """A random place on a random hunting map, away from the map's entrance."""
    maps = [m for m in ELIGIBLE if m not in (exclude or set())] or ELIGIBLE
    map_id = rng.choice(maps)
    m = MAPS[map_id]
    size, (sx, sy) = m["size"], m["spawn"]
    places = [(c[0], c[1], c[2]) for c in m.get("clearings", [])] + [(s["x"], s["y"], 4.0) for s in SPAWNS if s["map"] == map_id]
    if not places:
        places = [(size / 2, size / 2, size / 3)]
    for _ in range(40):
        cx, cy, r = rng.choice(places)
        a, d = rng.uniform(0, math.tau), rng.uniform(0, max(1.0, r))
        x = min(size - 2.5, max(2.5, cx + math.cos(a) * d))
        y = min(size - 2.5, max(2.5, cy + math.sin(a) * d))
        # away from the entrance and from portals (no stumbling on it, no falling into a portal next to it)
        if _dist(x, y, sx, sy) >= min(14.0, size / 3) and all(_dist(x, y, p["x"], p["y"]) >= 8 for p in m["portals"]):
            break
    return {"map": map_id, "x": round(x, 2), "y": round(y, 2)}


def _map_mobs(boss: bool) -> list[tuple[int, str, str]]:
    seen: dict[str, str] = {}
    for s in SPAWNS:
        if s["map"] in ELIGIBLE and bool(MOBS[s["mob"]].get("boss")) == boss:
            seen.setdefault(s["mob"], s["map"])
    return sorted((MOBS[mid]["level"], mid, map_id) for mid, map_id in seen.items())


def make_quest(hero_level: int, rng: random.Random) -> dict[str, Any]:
    kind = rng.choice(["hunt", "boss", "wb", "explore"])
    if kind == "hunt":
        lv, mob, map_id = min(_map_mobs(False), key=lambda t: (abs(t[0] - hero_level), -t[0]))
        return {"kind": kind, "mob": mob, "map": map_id, "count": HUNT_COUNT, "n": 0,
                "desc": f"Derrote {HUNT_COUNT} {MOBS[mob]['name']} ({MAPS[map_id]['name']})"}
    if kind == "boss":
        bosses = _map_mobs(True)
        fit = [b for b in bosses if b[0] <= hero_level + 6]
        lv, mob, map_id = fit[-1] if fit else bosses[0]
        return {"kind": kind, "mob": mob, "map": map_id, "count": 1, "n": 0,
                "desc": f"Derrote {MOBS[mob]['name']} ({MAPS[map_id]['name']})"}
    if kind == "wb":
        return {"kind": kind, "count": 1, "n": 0,
                "desc": "Cause pelo menos 1% da vida de um Boss Global (Covil dos Titãs)"}
    marks, used = [], set()
    for _ in range(3):
        p = spot(rng, used)
        used.add(p["map"])
        marks.append({**p, "found": False})
    names = ", ".join(MAPS[mk["map"]]["name"] for mk in marks)
    return {"kind": kind, "count": 3, "n": 0, "marks": marks,
            "desc": f"Encontre 3 marcas antigas escondidas: {names}"}


class HiddenQuest:
    def __init__(self, data: dict[str, Any] | None = None, seed: int | None = None) -> None:
        self.rng = random.Random(seed)
        d = dict(data or {})
        self.npc: dict[str, Any] | None = d.get("npc")
        self.holder: dict[str, Any] | None = d.get("holder")
        self.winners: list[str] = list(d.get("winners", []))
        self.next_rumor: float = float(d.get("next_rumor", 0))
        self.offers: dict[str, dict[str, Any]] = {}     # quest shown in the dialog, until accepted
        self.shown: dict[str, str] = {}                  # char_id → map where the Wanderer was sent to them
        self.marks_shown: dict[str, set[int]] = {}
        self.dirty = False
        if not self.npc and not self.holder:
            self.relocate()

    def to_json(self) -> dict[str, Any]:
        return {"npc": self.npc, "holder": self.holder, "winners": self.winners, "next_rumor": self.next_rumor}

    def relocate(self) -> None:
        old = self.npc["map"] if self.npc else None
        self.npc = spot(self.rng, {old} if old else None)
        self.next_rumor = time.time() + FIRST_RUMOR
        self.dirty = True

    # ── what each player sees ────────────────────────────────────────────

    async def _hide_from_all(self, game: Game) -> None:
        for cid in list(self.shown):
            await game.send(cid, {"type": "hidden_npc", "gone": True})
        self.shown.clear()

    async def on_move(self, game: Game, hero: Hero, x: float, y: float) -> None:
        cid = hero.char_id
        near = bool(self.npc and self.npc["map"] == hero.map_id and _dist(x, y, self.npc["x"], self.npc["y"]) <= VIS)
        if near and self.shown.get(cid) != hero.map_id:
            self.shown[cid] = hero.map_id
            await game.send(cid, {"type": "hidden_npc", "id": NPC_ID, "name": NPC_NAME, "x": self.npc["x"], "y": self.npc["y"]})
        elif not near and cid in self.shown:
            if self.shown.pop(cid) == hero.map_id:  # (after a map change the client already dropped it)
                await game.send(cid, {"type": "hidden_npc", "gone": True})
        h = self.holder
        if h and h["cid"] == cid and h["kind"] == "explore":
            seen = self.marks_shown.setdefault(cid, set())
            for i, mk in enumerate(h["marks"]):
                if mk["found"] or mk["map"] != hero.map_id:
                    continue
                d = _dist(x, y, mk["x"], mk["y"])
                if d <= MARK_TOUCH:
                    mk["found"] = True
                    h["n"] += 1
                    seen.discard(i)
                    self.dirty = True
                    await game.send(cid, {"type": "hq_mark", "id": i, "gone": True, "found": True})
                    await game.notice(cid, f"Marca antiga encontrada! ({h['n']}/3)", "quest")
                    await self.push(game, hero)
                    if h["n"] >= 3:
                        await self.complete(game, hero)
                        return
                elif d <= MARK_VIS and i not in seen:
                    seen.add(i)
                    await game.send(cid, {"type": "hq_mark", "id": i, "x": mk["x"], "y": mk["y"]})

    def forget(self, cid: str) -> None:
        """The client dropped the map (map change): show things again when close."""
        self.shown.pop(cid, None)
        self.marks_shown.pop(cid, None)

    async def push(self, game: Game, hero: Hero) -> None:
        h = self.holder
        if not h or h["cid"] != hero.char_id:
            await game.send(hero.char_id, {"type": "hq", "active": False})
            return
        await game.send(hero.char_id, {"type": "hq", "active": True, "desc": h["desc"], "n": h["n"], "count": h["count"],
                                       "left": max(0, int(h["deadline"] - time.time()))})

    # ── talking ──────────────────────────────────────────────────────────

    def near_npc(self, hero: Hero) -> bool:
        s = manager.sessions.get(hero.char_id)
        return bool(s and self.npc and self.npc["map"] == hero.map_id and _dist(s.x, s.y, self.npc["x"], self.npc["y"]) <= TALK)

    async def talk(self, game: Game, hero: Hero) -> None:
        if not self.near_npc(hero):
            return
        dialog: dict[str, Any] = {"type": "dialog", "npc": NPC_ID, "name": NPC_NAME, "lines": [], "options": []}
        if hero.char_id in self.winners:
            dialog["lines"] = ["Você já provou seu valor, caçador de segredos.",
                               "Deixe que outros curiosos também me encontrem..."]
        else:
            q = self.offers.get(hero.char_id) or make_quest(hero.level, self.rng)
            self.offers[hero.char_id] = q
            dialog["title"] = "Missão Oculta"
            dialog["lines"] = ["Poucos me encontram... você tem olhos atentos.",
                               f"Prove seu valor: {q['desc']}.",
                               "Prêmio: Corcel Fantasma e o título Caçador de Segredos. Prazo: 24 horas."]
            dialog["options"] = [{"id": "hq_accept", "label": "Aceitar (24 horas)"}]
        await game.send(hero.char_id, dialog)

    async def accept(self, game: Game, hero: Hero) -> None:
        q = self.offers.pop(hero.char_id, None)
        if not q or self.holder or hero.char_id in self.winners or not self.near_npc(hero):
            return
        self.holder = {"cid": hero.char_id, "name": hero.name, **q, "deadline": time.time() + DURATION, "started": time.time()}
        self.npc = None
        self.offers.clear()
        self.dirty = True
        await self._hide_from_all(game)
        await game.notice(hero.char_id, "Missão Oculta aceita! Você tem 24 horas. O Andarilho desapareceu na névoa...", "quest")
        await self.push(game, hero)
        print(f"[hidden] {hero.name} accepted: {q['desc']}", flush=True)

    # ── progress ─────────────────────────────────────────────────────────

    async def on_kill(self, game: Game, hero: Hero, def_id: str) -> None:
        h = self.holder
        if not h or h["cid"] != hero.char_id or h["kind"] not in ("hunt", "boss") or h.get("mob") != def_id:
            return
        h["n"] += 1
        self.dirty = True
        if h["n"] >= h["count"]:
            await self.complete(game, hero)
        else:
            await self.push(game, hero)

    async def complete(self, game: Game, hero: Hero) -> None:
        import season as ssn
        hero.cosmetics = ssn.cosmetics(hero.cosmetics)
        if REWARD_MOUNT not in hero.cosmetics["mounts"]:
            hero.cosmetics["mounts"].append(REWARD_MOUNT)
        if REWARD_TITLE not in hero.cosmetics["titles"]:
            hero.cosmetics["titles"].append(REWARD_TITLE)
        self.winners.append(hero.char_id)
        self.holder = None
        self.marks_shown.pop(hero.char_id, None)
        self.relocate()
        await game.push_hero(hero)
        await game.save_hero(hero)
        await self.push(game, hero)
        await game.notice(hero.char_id, "Missão Oculta concluída! Você ganhou o Corcel Fantasma e o título Caçador de Segredos. "
                                        "Use-os na janela do personagem (C).", "quest")
        await self.announce(game, f"{hero.name} encontrou o Andarilho Oculto e cumpriu sua missão: ganhou o Corcel Fantasma! "
                                  "O Andarilho sumiu de novo... quem será o próximo?")
        print(f"[hidden] {hero.name} completed the quest", flush=True)

    async def fail(self, game: Game) -> None:
        h = self.holder
        self.holder = None
        if h:
            self.marks_shown.pop(h["cid"], None)
            hero = game.heroes.get(h["cid"])
            if hero:
                await game.notice(hero.char_id, "O tempo da Missão Oculta acabou. O Andarilho voltou a se esconder em outro lugar...", "warn")
                await self.push(game, hero)
            print(f"[hidden] {h['name']} ran out of time", flush=True)
        self.relocate()
        await self.announce(game, "Dizem que o Andarilho Oculto voltou a vagar pelo mundo... e ninguém sabe onde.")

    async def announce(self, game: Game, text: str) -> None:
        for cid in list(game.heroes):
            await game.send(cid, {"type": "chat", "channel": "event", "text": text})

    async def tick(self, game: Game) -> None:
        """Called about once a second."""
        now = time.time()
        h = self.holder
        if h:
            if now >= h["deadline"]:
                await self.fail(game)
                return
            if h["kind"] == "wb" and game.wb.state == "active":
                mob = game.wb.boss_mob(game)
                if mob and mob.damage_by.get(h["cid"], 0) >= mob.max_hp * WB_SHARE:
                    hero = game.heroes.get(h["cid"])
                    if hero:
                        h["n"] = 1
                        await self.complete(game, hero)
            return
        if self.npc and now >= self.next_rumor:
            self.next_rumor = now + RUMOR_EVERY
            self.dirty = True
            place = RUMOR_PLACES.get(MAPS[self.npc["map"]]["theme"], "em algum lugar perigoso")
            await self.announce(game, f"[Boato] Dizem que um andarilho encapuzado foi visto {place}...")

    # ── admin ────────────────────────────────────────────────────────────

    def admin_view(self) -> dict[str, Any]:
        h = self.holder
        return {
            "npc": {**self.npc, "map_name": MAPS[self.npc["map"]]["name"]} if self.npc else None,
            "holder": {"name": h["name"], "desc": h["desc"], "n": h["n"], "count": h["count"],
                       "left": max(0, int(h["deadline"] - time.time()))} if h else None,
            "winners": len(self.winners),
            "next_rumor_in": max(0, int(self.next_rumor - time.time())) if self.npc else None,
        }
