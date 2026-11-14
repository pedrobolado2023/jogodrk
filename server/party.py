"""
Parties (groups of up to MAX_MEMBERS heroes). Pure bookkeeping — game.py decides what a party changes:
shared EXP and quest kills for members nearby, no friendly fire, a party chat channel and the party frame.

A member who disconnects stays in the party for OFFLINE_GRACE seconds (a page reload must not drop
you from your group); after that they are removed. Invites expire after INVITE_SECS.
"""

from __future__ import annotations

import itertools
import time
from dataclasses import dataclass, field

MAX_MEMBERS = 4
INVITE_SECS = 60.0
OFFLINE_GRACE = 90.0
SHARE_RADIUS = 25.0     # members this close (same map) share EXP and quest kills
EXP_BONUS_PER_MEMBER = 0.10

_ids = itertools.count(1)


@dataclass
class Party:
    id: int
    leader: str
    members: list[str] = field(default_factory=list)
    offline_since: dict[str, float] = field(default_factory=dict)
    last_sent: str = ""  # last frame state sent, so the once-a-second refresh only goes out on changes


class PartyManager:
    def __init__(self) -> None:
        self.parties: dict[int, Party] = {}
        self.of: dict[str, int] = {}                          # char_id → party id
        self.invites: dict[str, tuple[str, float]] = {}       # invitee → (inviter, expires_at)

    def party_of(self, cid: str) -> Party | None:
        pid = self.of.get(cid)
        return self.parties.get(pid) if pid is not None else None

    def same_party(self, a: str, b: str) -> bool:
        return a != b and a in self.of and self.of.get(a) == self.of.get(b)

    def invite(self, inviter: str, invitee: str) -> str | None:
        if inviter == invitee:
            return "Você não pode convidar a si mesmo."
        if invitee in self.of:
            return "Esse jogador já está em um grupo."
        p = self.party_of(inviter)
        if p and p.leader != inviter:
            return "Só o líder do grupo pode convidar."
        if p and len(p.members) >= MAX_MEMBERS:
            return f"O grupo já está cheio ({MAX_MEMBERS} jogadores)."
        self.invites[invitee] = (inviter, time.monotonic() + INVITE_SECS)
        return None

    def accept(self, invitee: str) -> tuple[Party | None, str | None]:
        inv = self.invites.pop(invitee, None)
        if not inv or time.monotonic() > inv[1]:
            return None, "O convite expirou."
        inviter = inv[0]
        if invitee in self.of:
            return None, "Você já está em um grupo."
        p = self.party_of(inviter)
        if p is None:
            p = Party(id=next(_ids), leader=inviter, members=[inviter])
            self.parties[p.id] = p
            self.of[inviter] = p.id
        elif p.leader != inviter:
            return None, "Quem te convidou não é mais o líder do grupo."
        if len(p.members) >= MAX_MEMBERS:
            return None, "O grupo já está cheio."
        p.members.append(invitee)
        self.of[invitee] = p.id
        return p, None

    def decline(self, invitee: str) -> str | None:
        inv = self.invites.pop(invitee, None)
        return inv[0] if inv else None

    def leave(self, cid: str) -> Party | None:
        """Removes cid; returns the party it left (possibly now disbanded: members empty)."""
        p = self.party_of(cid)
        if not p:
            return None
        p.members.remove(cid)
        p.offline_since.pop(cid, None)
        del self.of[cid]
        if p.leader == cid and p.members:
            online = [m for m in p.members if m not in p.offline_since]
            p.leader = (online or p.members)[0]
        if len(p.members) < 2:
            for m in p.members:
                self.of.pop(m, None)
            p.members.clear()
            del self.parties[p.id]
        return p

    def kick(self, leader: str, target: str) -> tuple[Party | None, str | None]:
        p = self.party_of(leader)
        if not p or p.leader != leader:
            return None, "Só o líder do grupo pode expulsar."
        if target not in p.members or target == leader:
            return None, "Esse jogador não está no seu grupo."
        return self.leave(target), None

    def set_online(self, cid: str, online: bool) -> Party | None:
        p = self.party_of(cid)
        if p:
            if online:
                p.offline_since.pop(cid, None)
            else:
                p.offline_since[cid] = time.monotonic()
        return p

    def expired_offline(self) -> list[str]:
        now = time.monotonic()
        return [cid for p in self.parties.values() for cid, t in p.offline_since.items() if now - t > OFFLINE_GRACE]
