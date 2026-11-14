"""
Party test: invite/accept/decline, only the leader invites and kicks, no friendly fire (even in the
arena), shared EXP with bonus and shared quest kills for members nearby, party chat, leaving
disbands a party of two, and members offline for too long are dropped.
Run: .venv/Scripts/python.exe test_party.py   (or -m pytest test_party.py -q)
"""

from __future__ import annotations

import asyncio
import time

import party as pt
from game import Game
from test_skills import _hero, _noop_save
from websocket_manager import manager


def last(ws, kind: str) -> dict | None:
    return next((m for m in reversed(ws.sent) if m["type"] == kind), None)


async def run_all() -> None:
    game = Game(_noop_save)
    wolf = next(m for m in game.mobs["forest_01"].mobs.values() if m.mob_def_id == "wolf")
    a, aws = _hero(game, "blade_master", "forest_01", wolf.x + 1, wolf.y)
    b, bws = _hero(game, "night_ranger", "forest_01", wolf.x + 3, wolf.y)
    c, cws = _hero(game, "grand_sorcerer", "forest_01", wolf.x + 2, wolf.y + 2)
    a.name, b.name, c.name = "Arthur", "Lyra", "Merlin"

    # invite → dialog → accept
    assert await game.party_invite(a, "lyra") is None
    assert last(bws, "dialog")["npc"] == "party"
    await game.dialog_option(b, "party_accept")
    assert game.parties.same_party(a.char_id, b.char_id)
    state = last(aws, "party")
    assert [m["name"] for m in state["members"]] == ["Arthur", "Lyra"] and state["members"][0]["leader"]
    assert await game.party_invite(b, "Merlin") == "Só o líder do grupo pode convidar."
    assert await game.party_invite(a, "Ninguém") == "Ninguém não está online."
    print("ok  convite, aceitar e só o líder convida")

    # declining tells the inviter
    assert await game.party_invite(a, "Merlin") is None
    await game.dialog_option(c, "party_decline")
    assert not game.parties.party_of(c.char_id) and "recusou" in last(aws, "notice")["text"]
    print("ok  recusar convite")

    # no friendly fire, in the open world or in the arena
    a.cooldowns.clear()
    assert await game.use_skill(a, "bm_slash", b.char_id, None, None) == "no_target" and b.hp == b.max_hp
    for h in (a, b):
        h.map_id = "arena_01"
        manager.sessions[h.char_id].map_id = "arena_01"
    assert await game.use_skill(a, "bm_slash", b.char_id, None, None) == "no_target" and b.hp == b.max_hp
    for h in (a, b):
        h.map_id = "forest_01"
        manager.sessions[h.char_id].map_id = "forest_01"
    print("ok  sem fogo amigo (inclusive na arena)")

    # shared EXP (with bonus) and shared quest kill for a member who did not hit
    for h in (a, b):
        h.level, h.exp = 5, 0
    b.story = {"q": 0, "st": "active", "n": 0}
    a.cooldowns.clear()
    a.mp = a.max_mp
    wolf.hp = 1
    assert await game.use_skill(a, "bm_slash", wolf.instance_id, None, None) is None
    expected = int(wolf.exp_reward * (1 + pt.EXP_BONUS_PER_MEMBER))
    assert last(bws, "reward")["exp"] == expected and last(aws, "reward")["exp"] == expected
    assert b.exp == expected and b.story["n"] == 1
    assert last(cws, "reward") is None  # not in the party: nothing
    print("ok  EXP com bônus e missão divididas com quem está perto")

    # party chat reaches members only
    bws.sent.clear(); cws.sent.clear()
    assert await game.chat(a, "party", "vamos no treant") is None
    assert last(bws, "chat")["channel"] == "party" and last(cws, "chat") is None
    assert await game.chat(c, "party", "oi") is not None
    print("ok  chat do grupo")

    # kick (leader only) in a party of three
    assert await game.party_invite(a, "Merlin") is None
    await game.dialog_option(c, "party_accept")
    assert len(game.parties.party_of(a.char_id).members) == 3
    assert await game.party_kick(b, "Merlin") == "Só o líder do grupo pode expulsar."
    assert await game.party_kick(a, "merlin") is None
    assert not game.parties.party_of(c.char_id) and len(game.parties.party_of(a.char_id).members) == 2
    print("ok  expulsar (só o líder)")

    # leaving a party of two disbands it
    assert await game.party_leave(b) is None
    assert not game.parties.party_of(a.char_id) and last(aws, "party")["members"] == []
    print("ok  sair desfaz grupo de dois")

    # a member offline for too long is dropped; the leader seat moves on
    assert await game.party_invite(a, "Lyra") is None
    await game.dialog_option(b, "party_accept")
    assert await game.party_invite(a, "Merlin") is None
    await game.dialog_option(c, "party_accept")
    game.parties.set_online(a.char_id, False)
    game.parties.party_of(a.char_id).offline_since[a.char_id] = time.monotonic() - pt.OFFLINE_GRACE - 1
    await game.tick(0.1, 10)
    p = game.parties.party_of(b.char_id)
    assert p and a.char_id not in p.members and p.leader == b.char_id
    print("ok  quem fica offline muito tempo sai do grupo e a liderança passa")


if __name__ == "__main__":
    asyncio.run(run_all())


def test_party() -> None:
    asyncio.run(run_all())
