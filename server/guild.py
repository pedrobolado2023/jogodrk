"""
Guilds: lasting groups of up to MAX_MEMBERS heroes with a leader, officers and members, a guild chat,
the guild's name over each member's head, no friendly fire, and wars between guilds.

  • creating one costs CREATE_COST gold and needs level CREATE_LEVEL
  • the leader and officers invite (online players answer in a dialog); officers can remove members,
    only the leader promotes, demotes, hands over leadership, declares war and disbands
  • a war lasts WAR_SECS: members of the two guilds can fight anywhere outside the safe zones without
    turning Aggressor or Assassin, and every kill scores for the killer's guild

Pure bookkeeping, saved as one JSON blob (GameState "guilds"); game.py applies the effects. Wars use the
wall clock so they survive a server restart.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any

CREATE_COST = 10_000
CREATE_LEVEL = 20
MAX_MEMBERS = 30
INVITE_SECS = 60.0
WAR_SECS = 3600.0
NAME_MIN, NAME_MAX = 3, 16
NAME_OK = re.compile(r"^[A-Za-zÀ-ÖØ-öø-ÿ0-9 ]+$")
RANKS = {"leader": "Líder", "officer": "Oficial", "member": "Membro"}


@dataclass
class Guild:
    id: int
    name: str
    leader: str
    members: dict[str, dict[str, str]] = field(default_factory=dict)  # char id → {"name", "rank"}
    wars: dict[str, float] = field(default_factory=dict)              # other guild id → ends at (epoch s)
    score: dict[str, list[int]] = field(default_factory=dict)         # other guild id → [our kills, theirs]

    def rank(self, cid: str) -> str:
        return self.members.get(cid, {}).get("rank", "")

    def to_json(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "leader": self.leader, "members": self.members,
                "wars": self.wars, "score": self.score}


class GuildManager:
    def __init__(self) -> None:
        self.guilds: dict[int, Guild] = {}
        self.of: dict[str, int] = {}                     # char id → guild id
        self.invites: dict[str, tuple[int, str, float]] = {}  # invitee → (guild id, inviter id, expires)
        self.next_id = 1
        self.dirty = False

    # ── lookups ──
    def guild_of(self, cid: str) -> Guild | None:
        gid = self.of.get(cid)
        return self.guilds.get(gid) if gid is not None else None

    def by_name(self, name: str) -> Guild | None:
        key = name.strip().lower()
        return next((g for g in self.guilds.values() if g.name.lower() == key), None)

    def same_guild(self, a: str, b: str) -> bool:
        ga = self.of.get(a)
        return ga is not None and ga == self.of.get(b)

    def at_war(self, a: str, b: str, now: float | None = None) -> bool:
        """True when the guilds of heroes a and b are at war right now."""
        ga, gb = self.guild_of(a), self.guild_of(b)
        if not ga or not gb or ga is gb:
            return False
        return ga.wars.get(str(gb.id), 0) > (now or time.time())

    # ── membership ──
    def check_name(self, name: str) -> str | None:
        name = " ".join(name.split())
        if not NAME_MIN <= len(name) <= NAME_MAX:
            return f"O nome da guilda precisa ter de {NAME_MIN} a {NAME_MAX} letras."
        if not NAME_OK.match(name):
            return "Use só letras, números e espaços no nome da guilda."
        if self.by_name(name):
            return "Já existe uma guilda com esse nome."
        return None

    def create(self, cid: str, hero_name: str, name: str) -> tuple[Guild | None, str | None]:
        if cid in self.of:
            return None, "Você já está em uma guilda."
        name = " ".join(name.split())
        err = self.check_name(name)
        if err:
            return None, err
        g = Guild(self.next_id, name, cid, {cid: {"name": hero_name, "rank": "leader"}})
        self.next_id += 1
        self.guilds[g.id] = g
        self.of[cid] = g.id
        self.dirty = True
        return g, None

    def invite(self, inviter: str, target: str) -> str | None:
        g = self.guild_of(inviter)
        if not g:
            return "Você não está em uma guilda."
        if g.rank(inviter) not in ("leader", "officer"):
            return "Só o líder e os oficiais podem convidar."
        if target in self.of:
            return "Esse jogador já está em uma guilda."
        if len(g.members) >= MAX_MEMBERS:
            return f"A guilda está cheia ({MAX_MEMBERS} membros)."
        pending = self.invites.get(target)
        if pending and pending[2] > time.monotonic():
            return "Esse jogador já tem um convite de guilda esperando resposta."
        self.invites[target] = (g.id, inviter, time.monotonic() + INVITE_SECS)
        return None

    def accept(self, cid: str, hero_name: str) -> tuple[Guild | None, str | None]:
        inv = self.invites.pop(cid, None)
        g = self.guilds.get(inv[0]) if inv and inv[2] > time.monotonic() else None
        if not g:
            return None, "Esse convite de guilda expirou."
        if cid in self.of:
            return None, "Você já está em uma guilda."
        if len(g.members) >= MAX_MEMBERS:
            return None, "A guilda ficou cheia."
        g.members[cid] = {"name": hero_name, "rank": "member"}
        self.of[cid] = g.id
        self.dirty = True
        return g, None

    def decline(self, cid: str) -> str | None:
        inv = self.invites.pop(cid, None)
        return inv[1] if inv else None

    def remove(self, cid: str) -> Guild | None:
        """Takes cid out of its guild. A leader leaving hands the guild to an officer (or the oldest member);
        the last member leaving disbands it."""
        g = self.guild_of(cid)
        if not g:
            return None
        del g.members[cid]
        del self.of[cid]
        self.dirty = True
        if not g.members:
            self.disband(g)
        elif g.leader == cid:
            heir = next((m for m, d in g.members.items() if d["rank"] == "officer"), next(iter(g.members)))
            g.leader = heir
            g.members[heir]["rank"] = "leader"
        return g

    def disband(self, g: Guild) -> None:
        for cid in list(g.members):
            self.of.pop(cid, None)
        for other in self.guilds.values():
            other.wars.pop(str(g.id), None)
            other.score.pop(str(g.id), None)
        self.guilds.pop(g.id, None)
        self.dirty = True

    def set_rank(self, by: str, target: str, rank: str) -> str | None:
        g = self.guild_of(by)
        if not g or g.leader != by:
            return "Só o líder pode mudar os cargos."
        if target == by or target not in g.members:
            return "Esse jogador não está na sua guilda."
        if rank == "leader":
            g.members[by]["rank"] = "officer"
            g.leader = target
        g.members[target]["rank"] = rank
        self.dirty = True
        return None

    def can_kick(self, by: str, target: str) -> str | None:
        g = self.guild_of(by)
        if not g or target not in g.members or target == by:
            return "Esse jogador não está na sua guilda."
        mine, theirs = g.rank(by), g.rank(target)
        if mine == "leader" or (mine == "officer" and theirs == "member"):
            return None
        return "Você não pode expulsar esse membro."

    # ── wars ──
    def declare_war(self, by: str, other_name: str, now: float | None = None) -> tuple[Guild | None, str | None]:
        g = self.guild_of(by)
        if not g or g.leader != by:
            return None, "Só o líder pode declarar guerra."
        other = self.by_name(other_name)
        if not other:
            return None, "Não existe guilda com esse nome."
        if other is g:
            return None, "Sua guilda não pode guerrear contra ela mesma."
        now = now or time.time()
        if g.wars.get(str(other.id), 0) > now:
            return None, f"Vocês já estão em guerra com {other.name}."
        end = now + WAR_SECS
        g.wars[str(other.id)] = other.wars[str(g.id)] = end
        g.score[str(other.id)] = [0, 0]
        other.score[str(g.id)] = [0, 0]
        self.dirty = True
        return other, None

    def war_kill(self, killer: str, victim: str) -> tuple[Guild, Guild] | None:
        gk, gv = self.guild_of(killer), self.guild_of(victim)
        if not gk or not gv or not self.at_war(killer, victim):
            return None
        gk.score.setdefault(str(gv.id), [0, 0])[0] += 1
        gv.score.setdefault(str(gk.id), [0, 0])[1] += 1
        self.dirty = True
        return gk, gv

    def ended_wars(self, now: float | None = None) -> list[tuple[Guild, Guild, list[int]]]:
        """Wars whose time ran out (each pair once), removed from both guilds."""
        now = now or time.time()
        out = []
        for g in list(self.guilds.values()):
            for oid, end in list(g.wars.items()):
                if end > now:
                    continue
                other = self.guilds.get(int(oid))
                score = g.score.pop(oid, [0, 0])
                del g.wars[oid]
                if other:
                    other.wars.pop(str(g.id), None)
                    other.score.pop(str(g.id), None)
                    out.append((g, other, score))
                self.dirty = True
        return out

    # ── saving ──
    def to_json(self) -> dict[str, Any]:
        self.dirty = False
        return {"next_id": self.next_id, "guilds": [g.to_json() for g in self.guilds.values()]}

    @classmethod
    def from_json(cls, data: dict[str, Any] | None) -> "GuildManager":
        gm = cls()
        if not data:
            return gm
        gm.next_id = int(data.get("next_id", 1))
        for d in data.get("guilds", []):
            g = Guild(int(d["id"]), d["name"], d["leader"], dict(d.get("members", {})),
                      {k: float(v) for k, v in d.get("wars", {}).items()},
                      {k: list(v) for k, v in d.get("score", {}).items()})
            gm.guilds[g.id] = g
            for cid in g.members:
                gm.of[cid] = g.id
        return gm
