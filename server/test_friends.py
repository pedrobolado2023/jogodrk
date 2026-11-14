"""
Friends test: a request needs the other player online and their answer, accepting makes both sides
friends, the list shows who is online (online first) and where, logging in and out tells friends,
removing works on both sides (also when the other player is offline), and the limits hold.
Run: .venv/Scripts/python.exe test_friends.py   (or -m pytest test_friends.py -q)
"""

from __future__ import annotations

import asyncio

from game import MAX_FRIENDS, Game
from test_skills import _hero, _noop_save


async def run_all() -> None:
    removed_offline: list[tuple[str, str]] = []

    async def unfriend_offline(cid: str, other: str) -> None:
        removed_offline.append((cid, other))

    game = Game(_noop_save, None, unfriend_offline)
    a, wa = _hero(game, "blade_master", "town_01", 20, 20, level=10)
    b, wb = _hero(game, "night_ranger", "forest_01", 30, 50, level=7)
    c, wc = _hero(game, "grand_sorcerer", "town_01", 22, 20, level=3)
    a.name, b.name, c.name = "Arn", "Bia", "Caio"

    assert await game.friend_add(a, "Ninguém") and await game.friend_add(a, "arn")
    assert await game.friend_add(a, "bia") is None
    req = [m for m in wb.sent if m["type"] == "dialog"][-1]
    assert {o["id"] for o in req["options"]} == {"friend_accept", "friend_decline"}
    assert await game.friend_add(c, "Bia")  # one pending request at a time
    await game.dialog_option(b, "friend_accept")
    assert a.friends == {b.char_id: "Bia"} and b.friends == {a.char_id: "Arn"}
    assert await game.friend_add(a, "Bia")  # already friends
    print("ok  pedido, aceite e amizade dos dois lados")

    await game.friend_add(c, "Arn")
    await game.dialog_option(a, "friend_decline")
    assert c.char_id not in a.friends and any("recusou" in m.get("text", "") for m in wc.sent if m["type"] == "notice")
    print("ok  recusar não adiciona e avisa quem pediu")

    await game.friend_add(c, "Arn")
    await game.dialog_option(a, "friend_accept")
    rows = game.friends_state(a)["friends"]
    assert [r["name"] for r in rows] == ["Bia", "Caio"] and rows[0]["map"] == "forest_01" and rows[0]["level"] == 7
    await game.leave(c.char_id)
    rows = game.friends_state(a)["friends"]
    assert [(r["name"], r["online"]) for r in rows] == [("Bia", True), ("Caio", False)]
    assert any("Caio saiu do jogo" in m.get("text", "") for m in wa.sent if m["type"] == "notice")
    print("ok  lista mostra online primeiro, nível e mapa; aviso ao sair")

    wa.sent.clear()
    await game.join(c, 22, 20)
    assert any("Caio entrou no jogo" in m.get("text", "") for m in wa.sent if m["type"] == "notice")
    print("ok  aviso quando um amigo entra")

    # removing: online friend loses us too; offline friend is fixed in the database
    assert await game.friend_remove(a, b.char_id) is None
    assert b.char_id not in a.friends and a.char_id not in b.friends
    await game.leave(c.char_id)
    assert await game.friend_remove(a, c.char_id) is None
    assert removed_offline == [(c.char_id, a.char_id)] and not a.friends
    assert await game.friend_remove(a, "nao-existe")
    print("ok  remover dos dois lados, online e offline")

    a.friends = {f"x{i}": f"X{i}" for i in range(MAX_FRIENDS)}
    assert "cheia" in (await game.friend_add(a, "Bia") or "")
    print("ok  limite de amigos")


if __name__ == "__main__":
    asyncio.run(run_all())


def test_friends() -> None:
    asyncio.run(run_all())
