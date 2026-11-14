"""
Chat test: local chat stays on the map, global reaches everyone, whispers reach only the target
(case-insensitive name), unknown names and spam are refused, and text is cleaned and capped.
Run: .venv/Scripts/python.exe test_chat.py   (or -m pytest test_chat.py -q)
"""

from __future__ import annotations

import asyncio

from game import CHAT_BURST, CHAT_MAX_LEN, Game
from test_skills import _hero, _noop_save


def chats(ws) -> list[dict]:
    return [m for m in ws.sent if m["type"] == "chat"]


async def run_all() -> None:
    game = Game(_noop_save)
    a, aws = _hero(game, "blade_master", "forest_01", 150, 150)
    b, bws = _hero(game, "night_ranger", "forest_01", 160, 160)
    c, cws = _hero(game, "grand_sorcerer", "town_01", 20, 20)
    a.name, b.name, c.name = "Arthur", "Lyra", "Merlin"

    assert await game.chat(a, "map", "olá floresta") is None
    assert chats(aws)[-1]["text"] == "olá floresta" and chats(bws)[-1]["from"] == "Arthur" and not chats(cws)
    print("ok  chat local fica no mapa")

    assert await game.chat(c, "global", "alguém na arena?") is None
    assert all(chats(w)[-1]["channel"] == "global" for w in (aws, bws, cws))
    print("ok  chat global chega a todos")

    for w in (aws, bws, cws):
        w.sent.clear()
    assert await game.chat(a, "whisper", "segredo", "merlin") is None
    assert chats(cws)[-1]["text"] == "segredo" and not chats(bws)
    assert chats(aws)[-1]["to"] == "Merlin" and c.last_whisper_from == "Arthur"
    assert await game.chat(a, "whisper", "oi", "Fantasma") == "Fantasma não está online."
    assert await game.chat(a, "whisper", "oi", "arthur") == "Você não pode sussurrar para si mesmo."
    print("ok  sussurro só chega ao destinatário")

    aws.sent.clear()
    assert await game.chat(b, "map", "  a" + chr(0) + "b" + chr(10) + "x" * 300) is None
    text = chats(aws)[-1]["text"]
    assert text.startswith("ab") and len(text) == CHAT_MAX_LEN
    assert await game.chat(b, "map", "   ") is None and len(chats(aws)) == 1
    print("ok  texto limpo e limitado")

    errors = [await game.chat(c, "map", f"spam {i}") for i in range(CHAT_BURST + 2)]
    # c already sent one message (global) in this window
    assert errors[:CHAT_BURST - 1] == [None] * (CHAT_BURST - 1) and errors[-1] == "Calma! Você está mandando mensagens rápido demais."
    print("ok  anti-spam")


if __name__ == "__main__":
    asyncio.run(run_all())


def test_chat() -> None:
    asyncio.run(run_all())
