"""
VIP: 7 levels for the whole account (every hero), bought with real money (payments.py).

Each purchase lasts 30 days. Buying VIP 1, 3 or 7 gives that level at once; buying again while still VIP adds
30 days and goes up one level (at most 7). When it runs out, the next purchase starts again from the level bought.

Benefits grow with the level and never give strength, only comfort and looks:
  +5% EXP and gold from monsters per level · 10 gems a day per level · +10 bag spaces per level ·
  a golden "VIP N" title, and an exclusive aura at VIP 3, 5 and 7.
Player-facing text is in Portuguese.
"""

from __future__ import annotations

import datetime as dt
import time
from typing import Any

MAX_LEVEL = 7
DAYS = 30
BONUS_PER_LEVEL = 0.05
GEMS_PER_LEVEL = 10
BAG_PER_LEVEL = 10

# title id, name, colour (shown above the name; the client reads them with the pass titles)
TITLES: list[tuple[str, str, str]] = [
    ("vip_1", "VIP 1", "#f3d08a"), ("vip_2", "VIP 2", "#f5c86a"), ("vip_3", "VIP 3", "#ffc24a"),
    ("vip_4", "VIP 4", "#ffb83a"), ("vip_5", "VIP 5", "#ffa62a"), ("vip_6", "VIP 6", "#ff9420"),
    ("vip_7", "VIP 7", "#ff7a18"),
]
# aura id, name, glow colour, VIP level needed
AURAS: list[tuple[str, str, str, int]] = [
    ("aura_vip_3", "Aura VIP Dourada", "gold", 3),
    ("aura_vip_5", "Aura VIP Real", "purple", 5),
    ("aura_vip_7", "Aura VIP Suprema", "red", 7),
]


def active_level(level: int, until: float, now: float | None = None) -> int:
    return level if until > (now if now is not None else time.time()) else 0


def after_purchase(level: int, until: float, tier: int, now: float | None = None) -> tuple[int, float]:
    """New (level, until) after buying VIP `tier` (1, 3 or 7)."""
    now = now if now is not None else time.time()
    tier = max(1, min(MAX_LEVEL, tier))
    if until > now:  # still VIP: 30 more days and one level up (or the bought level, if higher)
        return min(MAX_LEVEL, max(level + 1, tier)), until + DAYS * 86400
    return tier, now + DAYS * 86400


def bonus(level: int) -> float:
    return round(BONUS_PER_LEVEL * level, 4)


def daily_gems(level: int) -> int:
    return GEMS_PER_LEVEL * level


def bag_extra(level: int) -> int:
    return BAG_PER_LEVEL * level


def today() -> str:
    return dt.date.today().isoformat()


def sync_cosmetics(cos: dict[str, Any], level: int) -> dict[str, Any]:
    """The VIP title and auras the hero may use now: added while VIP, removed (and taken off) when it ends."""
    titles = [t for t in cos.get("titles", []) if not t.startswith("vip_")]
    auras = [a for a in cos.get("auras", []) if not a.startswith("aura_vip_")]
    if level > 0:
        titles.append(f"vip_{level}")
        auras += [a for a, _, _, need in AURAS if level >= need]
    cos["titles"], cos["auras"] = titles, auras
    if cos.get("aura") and cos["aura"] not in auras:
        cos["aura"] = ""
    return cos


def public(level: int, until: float) -> dict[str, Any]:
    lv = active_level(level, until)
    return {"level": lv, "last_level": level, "days_left": max(0, int((until - time.time()) // 86400)) if lv else 0,
            "until": int(until) if lv else 0, "bonus_pct": round(bonus(lv) * 100), "daily_gems": daily_gems(lv),
            "bag_extra": bag_extra(lv)}
