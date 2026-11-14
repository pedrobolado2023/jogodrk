"""
Forge: turning mine ores into stones (+ gold), upgrading gear from +0 to +15, and refining it.

Everything here costs gold on purpose — it is the game's main gold sink, and ores and stones are the
goods players gather and trade.

Upgrade (+N): each attempt uses one upgrade stone of the right tier and a gold fee. Success gets harder
as the item climbs. On failure:  +1…+5 nothing is lost but the stone;  +6…+10 the item drops one level;
+11…+15 it falls back to +10. A Protection Stone used on the attempt keeps the level on failure.

Refinement: adds a random bonus line (damage %, crit chance, crit damage, evasion, defense %, life %, life steal), up to
REFINE_MAX_LINES. Refining a full item rerolls all its lines. Values scale with the item's tier.
"""

from __future__ import annotations

import random
from typing import Any

MAX_PLUS = 15

RECIPES: dict[str, dict[str, Any]] = {
    "stone_up_1": {"mats": {"ore_iron": 3}, "gold": 50},
    "stone_up_2": {"mats": {"ore_silver": 3, "ore_iron": 2}, "gold": 250},
    "stone_up_3": {"mats": {"ore_gold": 3, "ore_arcane": 1}, "gold": 1000},
    "stone_protect": {"mats": {"ore_arcane": 1, "ore_silver": 2}, "gold": 1500},
    "stone_refine": {"mats": {"ore_arcane": 2, "ore_gold": 2}, "gold": 2000},
}

# chance of success for reaching each level
UP_CHANCE = {1: 1.0, 2: 1.0, 3: 1.0, 4: 0.9, 5: 0.8, 6: 0.7, 7: 0.6, 8: 0.5, 9: 0.45, 10: 0.4,
             11: 0.35, 12: 0.3, 13: 0.25, 14: 0.2, 15: 0.15}

REFINE_MAX_LINES = 3
REFINE_LINES: dict[str, dict[str, Any]] = {
    "atk_pct": {"name": "Dano", "min": 0.02, "max": 0.06},
    "crit": {"name": "Chance de crítico", "min": 0.01, "max": 0.03},
    "crit_dmg": {"name": "Dano crítico", "min": 0.05, "max": 0.12},
    "dodge": {"name": "Evasão", "min": 0.01, "max": 0.03},
    "def_pct": {"name": "Defesa", "min": 0.03, "max": 0.08},
    "max_hp_pct": {"name": "Vida", "min": 0.03, "max": 0.08},
    "lifesteal": {"name": "Roubo de vida", "min": 0.01, "max": 0.03},
}


def stone_for(target: int) -> str:
    return "stone_up_1" if target <= 5 else "stone_up_2" if target <= 10 else "stone_up_3"


def up_fee(target: int) -> int:
    return 100 * target


def after_failure(plus: int, target: int) -> int:
    if target <= 5:
        return plus
    if target <= 10:
        return max(0, plus - 1)
    return 10


def refine_fee(tier: int) -> int:
    return 400 * max(1, tier)


def roll_line(kind: str, tier: int) -> float:
    d = REFINE_LINES[kind]
    return round(random.uniform(d["min"], d["max"]) * (0.7 + 0.15 * max(1, tier)), 3)


def refine(ref: dict[str, float], tier: int) -> dict[str, float]:
    """New refinement lines: one more line while there is room, otherwise all lines rerolled."""
    out = dict(ref)
    if len(out) < REFINE_MAX_LINES:
        kind = random.choice([k for k in REFINE_LINES if k not in out])
        out[kind] = roll_line(kind, tier)
        return out
    kinds = random.sample(list(REFINE_LINES), REFINE_MAX_LINES)
    return {k: roll_line(k, tier) for k in kinds}


def info() -> dict[str, Any]:
    """Forge tables for the client (sent with /meta)."""
    return {"recipes": RECIPES, "up_chance": UP_CHANCE, "max_plus": MAX_PLUS,
            "refine_lines": {k: v["name"] for k, v in REFINE_LINES.items()}, "refine_max": REFINE_MAX_LINES}
