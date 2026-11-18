"""
Duels and the weekly Arena tournament.

Duel: a player challenges another one nearby (target panel → "Desafiar para duelo"). If accepted, the two can hit
each other for up to 2 minutes, wherever they are (except safe zones, the Arena and event rooms), even friends,
party or guild mates. Nobody dies: the hit that would knock one out leaves them standing with 1 of life and ends the
duel; both get their life back. No Assassin status, no losses.

Tournament: every Saturday from 21:00 to 21:20 (Brasília time) the Arena de Sangue counts points: one per player
defeated there. The top 3 win gems (the champion also a title). Admins can start one at any time.
Player-facing text is in Portuguese.
"""

from __future__ import annotations

import datetime as dt
import time
from typing import TYPE_CHECKING, Any

from progress import BR

if TYPE_CHECKING:
    from game import Game, Hero

INVITE_TTL = 30.0
DUEL_TIME = 120.0
START_RANGE = 15.0     # tiles between the two to start
BREAK_RANGE = 30.0     # walking this far apart calls it off

TOURNEY_DAY = 5        # Saturday (Monday = 0)
TOURNEY_AT = (21, 0)
TOURNEY_TIME = 20 * 60
TOURNEY_LEADS = (600, 300, 60)
TOURNEY_MAP = "arena_01"
PRIZES: list[list[dict[str, Any]]] = [
    [{"gems": 100}, {"gold": 50000}, {"title": "campeao_torneio"}],
    [{"gems": 60}, {"gold": 25000}],
    [{"gems": 30}, {"gold": 10000}],
]


class Duels:
    def __init__(self) -> None:
        self.invites: dict[str, tuple[str, float]] = {}   # invited → (who invited, when it expires)
        self.pairs: dict[str, str] = {}                   # each duelist → the other
        self.ends: dict[str, float] = {}                  # each duelist → when the duel ends

    def partner(self, cid: str) -> str | None:
        return self.pairs.get(cid)

    def dueling(self, a: str, b: str) -> bool:
        return self.pairs.get(a) == b

    def can_duel_here(self, map_id: str) -> bool:
        from world_data import MAPS
        m = MAPS[map_id]
        return not m["safe"] and not m["pvp"] and not m.get("event")

    async def invite(self, game: Game, hero: Hero, target_id: str) -> str | None:
        from websocket_manager import manager
        other = game.heroes.get(target_id) or game.hero_by_name(target_id)  # by id or by name
        if not other or other.char_id == hero.char_id:
            return "Jogador não encontrado."
        if not self.can_duel_here(hero.map_id):
            return "Aqui não dá para duelar. Saia da vila (e da Arena) para desafiar alguém."
        if hero.char_id in self.pairs or other.char_id in self.pairs:
            return "Um dos dois já está num duelo."
        a, b = manager.sessions.get(hero.char_id), manager.sessions.get(other.char_id)
        if not a or not b or other.map_id != hero.map_id or ((a.x - b.x) ** 2 + (a.y - b.y) ** 2) ** 0.5 > START_RANGE:
            return "Chegue mais perto do jogador para desafiar."
        if hero.is_dead or other.is_dead:
            return "Não dá para duelar agora."
        self.invites[other.char_id] = (hero.char_id, time.monotonic() + INVITE_TTL)
        await game.send(other.char_id, {"type": "dialog", "npc": "duel", "name": "Desafio de duelo",
                                        "lines": [f"{hero.name} (nível {hero.level}) desafiou você para um duelo!",
                                                  "Ninguém morre e ninguém perde nada: quem chegar a 1 de vida perde."],
                                        "options": [{"id": "duel_accept", "label": "Aceitar o duelo"},
                                                    {"id": "duel_decline", "label": "Recusar"}]})
        await game.notice(hero.char_id, f"Desafio enviado para {other.name}. Esperando resposta...", "info")
        return None

    async def answer(self, game: Game, hero: Hero, accept: bool) -> None:
        inv = self.invites.pop(hero.char_id, None)
        if not inv or inv[1] < time.monotonic():
            await game.notice(hero.char_id, "O desafio expirou.", "info")
            return
        challenger = game.heroes.get(inv[0])
        if not challenger:
            return
        if not accept:
            await game.notice(challenger.char_id, f"{hero.name} recusou o duelo.", "info")
            return
        if challenger.char_id in self.pairs or hero.char_id in self.pairs or challenger.map_id != hero.map_id \
                or not self.can_duel_here(hero.map_id):
            await game.notice(hero.char_id, "O duelo não pôde começar.", "warn")
            return
        end = time.monotonic() + DUEL_TIME
        self.pairs[hero.char_id], self.pairs[challenger.char_id] = challenger.char_id, hero.char_id
        self.ends[hero.char_id] = self.ends[challenger.char_id] = end
        for h, o in ((hero, challenger), (challenger, hero)):
            await game.send(h.char_id, {"type": "duel", "state": "start", "foe": o.char_id, "foe_name": o.name, "time": int(DUEL_TIME)})
            await game.notice(h.char_id, f"Duelo contra {o.name} começou! Você tem {int(DUEL_TIME // 60)} minutos.", "quest")

    async def end(self, game: Game, a: str, winner: str | None, why: str = "") -> None:
        b = self.pairs.pop(a, None)
        if not b:
            return
        self.pairs.pop(b, None)
        self.ends.pop(a, None)
        self.ends.pop(b, None)
        names = {cid: (game.heroes[cid].name if cid in game.heroes else "?") for cid in (a, b)}
        for cid in (a, b):
            h = game.heroes.get(cid)
            if not h:
                continue
            if not h.is_dead:
                h.hp = h.max_hp
            if winner is None:
                text = f"O duelo terminou empatado{(': ' + why) if why else '.'}"
            elif cid == winner:
                text = f"Você venceu o duelo contra {names[b if cid == a else a]}!"
            else:
                text = f"{names[winner]} venceu o duelo."
            await game.send(cid, {"type": "duel", "state": "end", "winner": winner or "", "text": text})
            await game.notice(cid, text, "quest" if cid == winner else "info")
            await game.push_hero(h)
        if winner and winner in game.heroes:
            w = game.heroes[winner]
            loser = names[b if winner == a else a]
            await game.to_map(w.map_id, {"type": "kill_feed", "text": f"{w.name} venceu um duelo contra {loser}!"})
            await game.track(w, "duel_win")
            await game.save_hero(w)

    def on_hit(self, victim: Hero, attacker: Hero | None, dmg: int) -> tuple[int, bool]:
        """A duel hit never kills: it stops at 1 of life and says the duel is over. Returns (damage, duel won)."""
        if not attacker or not self.dueling(victim.char_id, attacker.char_id):
            return dmg, False
        if dmg >= victim.hp:
            return max(0, victim.hp - 1), True
        return dmg, False

    async def tick(self, game: Game) -> None:
        from websocket_manager import manager
        now = time.monotonic()
        for cid, (_, until) in list(self.invites.items()):
            if until < now:
                self.invites.pop(cid, None)
        for a, b in list(self.pairs.items()):
            if a not in self.pairs:
                continue
            ha, hb = game.heroes.get(a), game.heroes.get(b)
            sa, sb = manager.sessions.get(a), manager.sessions.get(b)
            if not ha or not hb or not sa or not sb or ha.map_id != hb.map_id:
                await self.end(game, a, None, "um dos dois saiu")
            elif ha.is_dead or hb.is_dead:
                await self.end(game, a, None, "alguém caiu para um monstro")
            elif ((sa.x - sb.x) ** 2 + (sa.y - sb.y) ** 2) ** 0.5 > BREAK_RANGE:
                await self.end(game, a, None, "vocês se afastaram demais")
            elif now >= self.ends.get(a, now):
                await self.end(game, a, None, "o tempo acabou")


def next_tourney(now: dt.datetime) -> dt.datetime:
    base = now.replace(hour=TOURNEY_AT[0], minute=TOURNEY_AT[1], second=0, microsecond=0)
    start = base + dt.timedelta(days=(TOURNEY_DAY - now.weekday()) % 7)
    if start + dt.timedelta(seconds=TOURNEY_TIME) <= now:
        start += dt.timedelta(days=7)
    return start


class Tourney:
    def __init__(self) -> None:
        self.state = "idle"
        self.ends_at = 0.0
        self.scores: dict[str, dict[str, Any]] = {}
        self.announced: set[str] = set()

    def active(self) -> bool:
        return self.state == "active"

    def status(self) -> dict[str, Any]:
        st: dict[str, Any] = {"type": "tourney", "state": self.state}
        if self.active():
            st["ends_in"] = max(0, int(self.ends_at - time.monotonic()))
            st["rows"] = self.rows()[:10]
        else:
            nxt = next_tourney(dt.datetime.now(BR))
            st["next"] = nxt.strftime("%d/%m às %H:%M")
        return st

    def rows(self) -> list[dict[str, Any]]:
        return sorted(({"id": k, **v} for k, v in self.scores.items()), key=lambda r: (-r["kills"], r["deaths"]))

    async def push(self, game: Game, everyone: bool = True) -> None:
        st = self.status()
        for cid, h in list(game.heroes.items()):
            if everyone or h.map_id == TOURNEY_MAP:
                await game.send(cid, st)

    async def announce(self, game: Game, text: str) -> None:
        for cid in list(game.heroes):
            await game.notice(cid, text, "quest")
            await game.send(cid, {"type": "chat", "channel": "event", "text": text})

    async def tick(self, game: Game) -> None:
        if self.active():
            if time.monotonic() >= self.ends_at:
                await self.finish(game)
            return
        now = dt.datetime.now(BR)
        start = next_tourney(now)
        lead = (start - now).total_seconds()
        key = start.strftime("%Y-%m-%d")
        for secs in TOURNEY_LEADS:
            if 0 < lead <= secs and f"{key}/{secs}" not in self.announced:
                self.announced.add(f"{key}/{secs}")
                await self.announce(game, f"Torneio da Arena em {max(1, round(lead / 60))} min! Cada jogador derrotado na Arena de Sangue "
                                          "vale 1 ponto. Top 3 ganha gemas e o campeão ganha um título.")
        if lead <= 0 and f"{key}/go" not in self.announced:
            self.announced.add(f"{key}/go")
            await self.start(game)

    async def start(self, game: Game, minutes: int = TOURNEY_TIME // 60) -> str | None:
        if self.active():
            return "O torneio já está acontecendo."
        self.state = "active"
        self.ends_at = time.monotonic() + minutes * 60
        self.scores.clear()
        await self.announce(game, f"O Torneio da Arena começou! {minutes} minutos: entre na Arena de Sangue (portal ao norte da vila) e derrote o máximo de jogadores.")
        await self.push(game)
        return None

    def on_arena_kill(self, killer: Hero, victim: Hero) -> None:
        if not self.active():
            return
        for h, k in ((killer, "kills"), (victim, "deaths")):
            row = self.scores.setdefault(h.char_id, {"name": h.name, "cls": h.cls, "kills": 0, "deaths": 0})
            row[k] += 1

    async def finish(self, game: Game) -> None:
        self.state = "idle"
        rows = [r for r in self.rows() if r["kills"] > 0][:3]
        if not rows:
            await self.announce(game, "O Torneio da Arena terminou sem vencedores. Até sábado que vem!")
        else:
            podium = ", ".join(f"{i + 1}º {r['name']} ({r['kills']})" for i, r in enumerate(rows))
            await self.announce(game, f"Fim do Torneio da Arena! {podium}. Parabéns!")
            for i, r in enumerate(rows):
                await game.give_prize(r["id"], PRIZES[i], f"Torneio da Arena: {i + 1}º lugar", track="tourney")
        await self.push(game)
