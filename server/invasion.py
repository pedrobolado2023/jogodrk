"""
Town invasion: three times a day monsters attack the Vila de Ravencrest and everyone defends it together.

While it lasts the town is not a safe zone for fighting monsters (players still cannot hurt each other there). Three
waves come in from the edges of the town, the last one with a boss. Monsters are made to the level of the heroes in
town, and everyone who helped (hit an invader) gets EXP and gold for their own level when the town is saved.
Admins can start one at any time from the admin panel. Player-facing text is in Portuguese.
"""

from __future__ import annotations

import datetime as dt
import random
import statistics
import time
from typing import TYPE_CHECKING, Any

from progress import BR
from world_data import MAPS, MOB_HP_MULT, mob_atk_mult, MOBS, exp_to_next, mob_exp, power, region_mob

if TYPE_CHECKING:
    from game import Game, Hero

TOWN = "town_01"
TIMES: list[tuple[int, int]] = [(12, 30), (18, 30), (20, 30)]  # Brasília time (the Global Boss is at 10h, 16h and 22h)
WARN_LEADS = (300, 60)
DURATION = 12 * 60
WAVES = 3
WAVE_TIMEOUT = 3 * 60      # the next wave comes after this even if the last one is still standing
MAX_HIT = 0.02             # an invader's hit takes at most 2% of a hero's life (newcomers live in town too)
# where the waves come in: the four edges of the town, off the portals
ENTRIES = [(5.5, 27.0), (34.5, 15.0), (13.0, 5.5), (27.0, 35.0), (6.0, 13.0), (34.0, 29.0)]
# monsters' looks by level (any monster the client can draw), then the boss of the last wave
LOOKS: list[tuple[int, list[str], str]] = [
    (15, ["wolf", "goblin"], "death_knight"), (30, ["skeleton", "swamp_ghoul"], "swamp_witch"),
    (60, ["frost_wolf", "frost_sentinel"], "lich_king"), (120, ["ash_hound", "magma_brute"], "ash_dragon"),
    (200, ["blood_ghoul", "crimson_knight"], "blood_queen"), (400, ["phantom_soldier", "necromancer"], "ghost_king"),
    (10 ** 6, ["void_stalker", "void_titan"], "void_dragon"),
]


MOBS_NAME = {k: v["name"] for k, v in MOBS.items()}


def looks(level: int) -> tuple[list[str], str]:
    for top, mobs, boss in LOOKS:
        if level < top:
            return mobs, boss
    return LOOKS[-1][1], LOOKS[-1][2]


def mob_def(name: str, level: int, kind: str) -> dict[str, Any]:
    d = region_mob(name, level, kind)
    k = power(level)
    hp_mult = 1.0 if d.get("boss") else MOB_HP_MULT  # same combat rework as the world's monsters (world_data)
    d["hp"], d["atk"] = int(d["hp"] * k * hp_mult), int(d["atk"] * k * mob_atk_mult(level))
    if d.get("slam"):
        d["slam"] = {**d["slam"], "damage": int(d["slam"]["damage"] * k)}
    d["exp"] = mob_exp(level, d["w"])
    d.update(aggro=40.0, respawn=10 ** 7)  # they rush the heroes and never come back once beaten
    return d


def next_start(now: dt.datetime) -> dt.datetime:
    for days in (0, 1):
        base = (now + dt.timedelta(days=days)).replace(second=0, microsecond=0)
        for h, m in TIMES:
            start = base.replace(hour=h, minute=m)
            if start > now:
                return start
    return now + dt.timedelta(days=1)


def reward(level: int) -> dict[str, int]:
    """What each defender gets for a saved town: about a third of a level and some gold, for their own level."""
    return {"exp": int(exp_to_next(level) * 0.35), "gold": int(3000 * (1 + level / 10))}


class Invasion:
    def __init__(self) -> None:
        self.state = "idle"
        self.wave = 0
        self.level = 1
        self.alive: set[str] = set()
        self.helpers: dict[str, int] = {}
        self.ends_at = 0.0
        self.wave_at = 0.0
        self.announced: set[str] = set()

    def owns(self, mob_id: str | None) -> bool:
        return bool(mob_id) and mob_id in self.alive

    def status(self) -> dict[str, Any]:
        st: dict[str, Any] = {"type": "invasion", "state": self.state}
        if self.state == "active":
            st.update(wave=self.wave, waves=WAVES, left=len(self.alive), ends_in=max(0, int(self.ends_at - time.monotonic())),
                      level=self.level)
        else:
            nxt = next_start(dt.datetime.now(BR))
            st["next_at"] = nxt.strftime("%H:%M")
        return st

    async def push(self, game: Game) -> None:
        st = self.status()
        for cid in list(game.heroes):
            await game.send(cid, st)

    async def announce(self, game: Game, text: str, kind: str = "warn") -> None:
        for cid in list(game.heroes):
            await game.notice(cid, text, kind)
            await game.send(cid, {"type": "chat", "channel": "event", "text": text})

    # ── schedule ─────────────────────────────────────────────────────────

    async def tick(self, game: Game) -> None:
        """Once a second: warnings before the start, the start, the waves and the end."""
        if self.state == "idle":
            now = dt.datetime.now(BR)
            start = next_start(now - dt.timedelta(seconds=1))
            lead = (start - now).total_seconds()
            key = start.strftime("%Y-%m-%d %H:%M")
            for secs in WARN_LEADS:
                if 0 < lead <= secs and f"{key}/{secs}" not in self.announced:
                    self.announced.add(f"{key}/{secs}")
                    mins = max(1, round(lead / 60))
                    await self.announce(game, f"Invasão! Monstros vão atacar a Vila de Ravencrest em {mins} minuto{'s' if mins > 1 else ''}. "
                                              "Venha defender e ganhe EXP e ouro!", "quest")
            if lead <= 1 and f"{key}/go" not in self.announced:
                self.announced.add(f"{key}/go")
                await self.start(game)
            return
        now_m = time.monotonic()
        if now_m >= self.ends_at:
            await self.finish(game, False)
        elif not self.alive or now_m >= self.wave_at + WAVE_TIMEOUT:
            if self.wave >= WAVES:
                if not self.alive:
                    await self.finish(game, True)
            else:
                await self.next_wave(game)

    # ── lifecycle ────────────────────────────────────────────────────────

    async def start(self, game: Game) -> str | None:
        if self.state != "idle":
            return "Já tem uma invasão acontecendo."
        if not game.heroes:
            return "Ninguém online para defender a vila."
        in_town = [h.level for h in game.heroes.values() if h.map_id == TOWN]
        levels = in_town or [h.level for h in game.heroes.values()]
        self.level = max(5, int(statistics.median(levels)))
        self.state, self.wave = "active", 0
        self.alive.clear()
        self.helpers.clear()
        self.ends_at = time.monotonic() + DURATION
        MAPS[TOWN]["safe"] = False
        for cid, h in list(game.heroes.items()):
            if h.map_id == TOWN:
                await game.send(cid, {"type": "map_safe", "safe": False})
        await self.announce(game, f"A Vila de Ravencrest está sendo invadida! Defenda a vila: {WAVES} ondas de monstros nível {self.level}.")
        await self.next_wave(game)
        return None

    async def next_wave(self, game: Game) -> None:
        self.wave += 1
        self.wave_at = time.monotonic()
        mm = game.mobs[TOWN]
        defenders = sum(1 for h in game.heroes.values() if h.map_id == TOWN)
        count = min(36, 8 + 4 * defenders + 2 * self.wave)
        names, boss = looks(self.level)
        before = set(mm.mobs)
        for i in range(count):
            look = names[i % len(names)]
            x, y = random.choice(ENTRIES)
            kind = "strong" if i % 6 == 5 else "normal"
            mm.spawn(look, mob_def(f"Invasor: {MOBS_NAME.get(look, 'Monstro')}", self.level, kind), x, y, 1, 1.5)
        if self.wave == WAVES:
            x, y = random.choice(ENTRIES)
            bd = mob_def("Líder da Invasão", self.level + 2, "boss")
            bd["hp"] = int(bd["hp"] * max(1, defenders) * 0.5)  # more defenders, a tougher leader
            mm.spawn(boss, bd, x, y, 1, 0.0)
        new = [mid for mid in mm.mobs if mid not in before]
        for mid in new:
            mm.mobs[mid].leash_radius = 10 ** 6
            self.alive.add(mid)
        for cid, h in list(game.heroes.items()):
            if h.map_id == TOWN:
                for mid in new:
                    await game.send(cid, mm.mobs[mid].snapshot())
        text = f"Onda {self.wave} de {WAVES}: {len(new)} monstros entrando na vila!" + (" O líder da invasão chegou!" if self.wave == WAVES else "")
        for cid, h in list(game.heroes.items()):
            if h.map_id == TOWN:
                await game.notice(cid, text, "warn")
        await self.push(game)

    async def on_kill(self, game: Game, mob_id: str, contributors: list[str]) -> None:
        self.alive.discard(mob_id)
        game.mobs[TOWN].mobs.pop(mob_id, None)
        for cid in contributors:
            self.helpers[cid] = self.helpers.get(cid, 0) + 1
        await self.push(game)

    async def finish(self, game: Game, saved: bool) -> None:
        mm = game.mobs[TOWN]
        for mid in list(self.alive):
            mm.mobs.pop(mid, None)
            for cid, h in list(game.heroes.items()):
                if h.map_id == TOWN:
                    await game.send(cid, {"type": "mob_damaged", "mob_id": mid, "damage": 0, "hp_remaining": 0, "killed": True})
        self.alive.clear()
        self.state = "idle"
        MAPS[TOWN]["safe"] = True
        for cid, h in list(game.heroes.items()):
            if h.map_id == TOWN:
                await game.send(cid, {"type": "map_safe", "safe": True})
        if saved:
            await self.announce(game, f"A vila foi salva! {len(self.helpers)} defensor(es) receberam a recompensa.", "quest")
            for cid in list(self.helpers):
                h = game.heroes.get(cid)
                if not h:
                    continue
                r = reward(h.level)
                await game.add_exp(h, r["exp"])
                h.gold += r["gold"]
                await game.notice(cid, f"Recompensa da defesa: +{r['exp']:,} EXP e +{r['gold']:,} ouro!".replace(",", "."), "quest")
                await game.track(h, "invasion")
                await game.push_hero(h)
                await game.save_hero(h)
        else:
            await self.announce(game, "Os invasores fugiram antes de serem derrotados. A próxima invasão vem mais tarde.", "info")
        self.helpers.clear()
        await self.push(game)

