"""
Guild test: creating costs gold and needs the level, names are checked, invites are answered in a dialog,
ranks decide who may invite/kick/promote, guild chat reaches only members, guildmates cannot hit each
other, a war lets two guilds fight in the open world without PK penalties and keeps score, leaving hands
leadership over, and everything survives a save/load.
Run: .venv/Scripts/python.exe test_guild.py   (or -m pytest test_guild.py -q)
"""

from __future__ import annotations

import asyncio
import time

import guild as gd
from game import Game
from game import Hero
from test_skills import FakeWS, _hero, _noop_save
from websocket_manager import PlayerSession, manager


def _named(game: Game, cid: str, cls: str, map_id: str, x: float, y: float, level: int) -> tuple[Hero, FakeWS]:
    """Like test_skills._hero, with a chosen id (that helper's id is per class and map)."""
    ws = FakeWS()
    manager.sessions[cid] = PlayerSession(ws=ws, char_id=cid, char_name=cid, map_id=map_id, x=x, y=y)
    manager.get_grid(map_id).add(cid, x, y)
    hero = Hero(char_id=cid, name=cid, cls=cls, level=level, exp=0, gold=0, story={"q": 0, "st": "offer", "n": 0}, map_id=map_id)
    hero.refresh_passives()
    hero.hp, hero.mp = hero.max_hp, hero.max_mp
    game.heroes[cid] = hero
    return hero, ws


async def run_all() -> None:
    game = Game(_noop_save)
    a, wa = _hero(game, "blade_master", "forest_01", 50, 50, level=25)
    b, wb = _hero(game, "night_ranger", "forest_01", 51, 50, level=22)
    c, wc = _hero(game, "grand_sorcerer", "forest_01", 52, 50, level=21)
    d, wd = _named(game, "test_duda", "blade_master", "forest_01", 53, 50, level=30)
    a.name, b.name, c.name, d.name = "Arn", "Bia", "Caio", "Duda"

    a.gold = 100
    assert "custa" in (await game.guild_create(a, "Lobos") or "")
    c.level = 5
    c.gold = 10 ** 6
    assert "nível" in (await game.guild_create(c, "Corvos") or "")
    c.level = 21
    a.gold = gd.CREATE_COST + 50
    assert await game.guild_create(a, "x") and await game.guild_create(a, "Lobos@!")
    assert await game.guild_create(a, "Lobos  da  Noite") is None
    assert a.gold == 50 and game.guild_name(a.char_id) == "Lobos da Noite"
    assert await game.guild_create(c, "lobos da noite")  # name taken (any case)
    print("ok  criar guilda: custo, nível e nome")

    assert await game.guild_invite(a, "Bia") is None
    assert any(m["type"] == "dialog" and m.get("npc") == "guild" for m in wb.sent)
    await game.dialog_option(b, "guild_accept")
    assert game.guilds.same_guild(a.char_id, b.char_id)
    assert await game.guild_invite(b, "Caio")  # a member cannot invite
    assert await game.guild_set_rank(a, b.char_id, "officer") is None
    assert await game.guild_invite(b, "Caio") is None
    await game.dialog_option(c, "guild_accept")
    g = game.guilds.guild_of(a.char_id)
    assert len(g.members) == 3 and g.rank(b.char_id) == "officer"
    print("ok  convites e cargos (líder, oficial, membro)")

    wd.sent.clear()
    await game.chat(b, "guild", "bora caçar")
    assert any(m.get("text") == "bora caçar" for m in wa.sent) and not any(m.get("text") == "bora caçar" for m in wd.sent)
    ids = [e[1] for e in game.enemies(a, aimed_at=b.char_id)]
    assert b.char_id not in ids and d.char_id in [e[1] for e in game.enemies(a, aimed_at=d.char_id)]
    print("ok  chat da guilda e sem fogo amigo")

    # war: Duda founds a rival guild; Arn declares war; they can fight without PK
    d.gold = gd.CREATE_COST
    await game.guild_create(d, "Corvos")
    assert await game.guild_war(b, "Corvos")  # only the leader
    assert await game.guild_war(a, "Corvos") is None
    assert game.guilds.at_war(a.char_id, d.char_id)
    assert d.char_id in [e[1] for e in game.enemies(c)]  # war enemies are fair game even when not aimed at
    await game.flag_attack(a, d)
    assert a.pk_status() == "white"
    await game.on_player_kill(a, d, "white")
    assert a.red_left == 0 and g.score[str(game.guilds.guild_of(d.char_id).id)] == [1, 0]
    # the war ends on its own
    rival = game.guilds.guild_of(d.char_id)
    g.wars[str(rival.id)] = rival.wars[str(g.id)] = time.time() - 1
    ended = game.guilds.ended_wars()
    assert len(ended) == 1 and not game.guilds.at_war(a.char_id, d.char_id)
    print("ok  guerra: lutam sem virar assassino, placar e fim da guerra")

    # kicks: an officer can remove members, not the leader
    assert await game.guild_kick(b, a.char_id)
    assert await game.guild_kick(b, c.char_id) is None and not game.guilds.guild_of(c.char_id)
    # leader leaves → the officer takes over
    assert await game.guild_leave(a) is None
    assert g.leader == b.char_id and g.rank(b.char_id) == "leader"
    print("ok  expulsar e passar a liderança ao sair")

    saved = game.guilds.to_json()
    loaded = gd.GuildManager.from_json(saved)
    assert loaded.by_name("Lobos da Noite").leader == b.char_id and loaded.same_guild(b.char_id, b.char_id)
    assert await game.guild_disband(b) is None and not game.guilds.by_name("Lobos da Noite")
    print("ok  salvar/carregar e desfazer a guilda")


if __name__ == "__main__":
    asyncio.run(run_all())


def test_guild() -> None:
    asyncio.run(run_all())
