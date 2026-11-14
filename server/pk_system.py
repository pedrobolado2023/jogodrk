"""
PK (player kill) rules for the open world — maps that are neither the safe town nor the arena.

  white      innocent (default)
  aggressor  attacked an innocent: anyone may fight back without penalty, for AGGRESSOR_SECS
  red        killed an innocent ("Assassino"): RED_PER_KILL seconds per kill (capped), counted down
             only while online; town NPCs refuse service; when killed by a player, each equipped
             item may pass to the killer; whoever kills a red earns a bounty.

Innocents are only hit by skills aimed at them on purpose (never by area damage), so farming next
to other players can never flag anyone. The arena keeps free PvP with no flags and no losses.
State lives on Hero (game.py) and is saved as the `pk` JSON column.
"""

from __future__ import annotations

AGGRESSOR_SECS = 30.0
RED_PER_KILL = 600.0       # 10 minutes per innocent killed
RED_MAX = 3600.0           # never more than 1 hour
RED_MOB_RELIEF = 5.0       # each monster a red player kills shortens the time
RED_GEAR_DROP = 0.30       # chance per equipped item, when a red player dies to another player

STATUS_NAMES = {"white": "Inocente", "aggressor": "Agressor", "red": "Assassino"}

NPC_REFUSAL = ["Afaste-se, assassino! Ninguém em Ravencrest atende quem tem sangue inocente nas mãos."]


def bounty_exp(victim_level: int) -> int:
    return 60 + victim_level * 15


def minutes_left(seconds: float) -> int:
    return max(1, int(seconds + 59) // 60)
