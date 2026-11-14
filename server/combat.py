"""
Combat system — damage formulas, skill execution, cooldowns, buffs/debuffs.
All calculations are server-authoritative.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class DamageType(str, Enum):
    PHYSICAL = "physical"
    MAGICAL = "magical"


@dataclass
class ActiveBuff:
    buff_id: str
    expires_at: float  # monotonic time
    effects: dict[str, Any] = field(default_factory=dict)
    # e.g. {"lifesteal": 0.05, "max_hp_mult": 1.1, "crit_bonus": 0.15}


@dataclass
class CombatState:
    """Tracks runtime combat state for one character (in memory, not DB)."""
    char_id: str
    char_class: str
    level: int
    base_str: int
    base_agi: int
    base_int: int
    base_vit: int
    hp: int
    max_hp: int
    mp: int
    max_mp: int
    base_atk: int = 0
    base_def: int = 0
    crit_rate: float = 0.05
    cooldowns: dict[str, float] = field(default_factory=dict)  # skill_id → ready_at
    buffs: list[ActiveBuff] = field(default_factory=list)
    target_id: str | None = None  # locked target (char or mob)
    is_dead: bool = False


def compute_effective_stats(state: CombatState) -> dict[str, Any]:
    """Apply buffs to base stats and return effective values."""
    stats = {
        "atk": state.base_atk,
        "def": state.base_def,
        "max_hp": state.max_hp,
        "max_mp": state.max_mp,
        "crit_rate": state.crit_rate,
        "lifesteal": 0.0,
        "damage_reduction": 0.0,
        "atk_range_bonus": 0.0,
    }
    now = time.monotonic()
    for buff in state.buffs:
        if buff.expires_at < now:
            continue
        if "max_hp_mult" in buff.effects:
            stats["max_hp"] = int(stats["max_hp"] * buff.effects["max_hp_mult"])
        if "lifesteal" in buff.effects:
            stats["lifesteal"] += buff.effects["lifesteal"]
        if "crit_bonus" in buff.effects:
            stats["crit_rate"] += buff.effects["crit_bonus"]
        if "mana_shield" in buff.effects:
            stats["damage_reduction"] = buff.effects["mana_shield"]
        if "atk_range_bonus" in buff.effects:
            stats["atk_range_bonus"] += buff.effects["atk_range_bonus"]
    return stats


def cleanup_expired_buffs(state: CombatState) -> list[str]:
    """Remove expired buffs, return their ids for client notification."""
    now = time.monotonic()
    expired = [b.buff_id for b in state.buffs if b.expires_at < now]
    state.buffs = [b for b in state.buffs if b.expires_at >= now]
    return expired


# ── Damage formula ───────────────────────────────────────────────────────────

def calc_damage(
    attacker: CombatState,
    defender_def: int,
    skill_base: int,
    skill_scaling: float,
    scaling_stat: str,
    damage_type: DamageType,
    is_crit: bool,
) -> int:
    """
    Server-authoritative damage calculation.
    Uses integer math where possible to avoid float rounding issues.
    """
    stat_val = {
        "str": attacker.base_str,
        "agi": attacker.base_agi,
        "int": attacker.base_int,
    }.get(scaling_stat, attacker.base_str)

    effective = compute_effective_stats(attacker)
    raw = skill_base + int(stat_val * skill_scaling) + effective["atk"]

    # defense reduction: damage * (100 / (100 + def))
    reduced = raw * 100 // (100 + defender_def)

    if is_crit:
        reduced = reduced * 150 // 100  # 1.5x crit multiplier

    # minimum 1 damage
    return max(1, reduced)


def apply_damage(
    target: CombatState,
    damage: int,
    attacker: CombatState | None = None,
) -> dict[str, Any]:
    """
    Apply damage to target, handle mana shield and lifesteal.
    Returns event dict for broadcasting.
    """
    effective = compute_effective_stats(target)
    actual_damage = damage

    # Mana Shield: absorb % from MP
    if effective["damage_reduction"] > 0 and target.mp > 0:
        absorbed = int(damage * effective["damage_reduction"])
        mp_drain = min(absorbed, target.mp)
        target.mp -= mp_drain
        actual_damage = damage - mp_drain

    target.hp = max(0, target.hp - actual_damage)

    result: dict[str, Any] = {
        "target_id": target.char_id,
        "damage": actual_damage,
        "hp_remaining": target.hp,
        "mp_remaining": target.mp,
    }

    if target.hp <= 0:
        target.is_dead = True
        result["killed"] = True

    # Lifesteal for attacker
    if attacker:
        atk_eff = compute_effective_stats(attacker)
        if atk_eff["lifesteal"] > 0 and actual_damage > 0:
            healed = int(actual_damage * atk_eff["lifesteal"])
            attacker.hp = min(attacker.max_hp, attacker.hp + healed)
            result["attacker_healed"] = healed

    return result


# ── Skill execution ──────────────────────────────────────────────────────────

@dataclass
class SkillResult:
    success: bool
    error: str = ""
    damage: int = 0
    targets_hit: list[dict[str, Any]] = field(default_factory=list)
    buff_applied: ActiveBuff | None = None
    mp_spent: int = 0


def can_use_skill(state: CombatState, skill_id: str, mp_cost: int, cooldown_ms: int) -> str | None:
    """Returns error message or None if skill can be used."""
    if state.is_dead:
        return "dead"
    if state.mp < mp_cost:
        return "not_enough_mp"
    now = time.monotonic()
    ready_at = state.cooldowns.get(skill_id, 0)
    if now < ready_at:
        return "on_cooldown"
    return None


def start_cooldown(state: CombatState, skill_id: str, cooldown_ms: int) -> None:
    state.cooldowns[skill_id] = time.monotonic() + cooldown_ms / 1000.0


def spend_mp(state: CombatState, cost: int) -> None:
    state.mp = max(0, state.mp - cost)


# ── Buff builders (one per skill that applies a buff) ────────────────────────

def create_blood_aura(skill_level: int) -> ActiveBuff:
    return ActiveBuff(
        buff_id="blood_aura",
        expires_at=time.monotonic() + 30.0,
        effects={
            "max_hp_mult": 1.0 + 0.02 * skill_level,  # +2% per level
            "lifesteal": 0.05,
        },
    )


def create_mana_shield(skill_level: int) -> ActiveBuff:
    return ActiveBuff(
        buff_id="mana_shield",
        expires_at=time.monotonic() + 15.0,
        effects={"mana_shield": 0.30 + 0.02 * skill_level},
    )


def create_eagle_eye(skill_level: int) -> ActiveBuff:
    return ActiveBuff(
        buff_id="eagle_eye",
        expires_at=time.monotonic() + 20.0,
        effects={
            "crit_bonus": 0.10 + 0.03 * skill_level,
            "atk_range_bonus": 2.0,
        },
    )


# ── DoT (Damage over Time) tracker ──────────────────────────────────────────

@dataclass
class DotEffect:
    source_id: str
    target_id: str
    damage_per_tick: int
    tick_interval: float  # seconds
    ticks_remaining: int
    next_tick_at: float

    @staticmethod
    def create_burn(source_id: str, target_id: str, total_damage: int, ticks: int = 4) -> DotEffect:
        return DotEffect(
            source_id=source_id,
            target_id=target_id,
            damage_per_tick=total_damage // ticks,
            tick_interval=1.5,
            ticks_remaining=ticks,
            next_tick_at=time.monotonic() + 1.5,
        )

    @staticmethod
    def create_poison(source_id: str, target_id: str, total_damage: int, ticks: int = 3) -> DotEffect:
        return DotEffect(
            source_id=source_id,
            target_id=target_id,
            damage_per_tick=total_damage // ticks,
            tick_interval=2.0,
            ticks_remaining=ticks,
            next_tick_at=time.monotonic() + 2.0,
        )


# ── Crowd Control ────────────────────────────────────────────────────────────

@dataclass
class CCEffect:
    target_id: str
    cc_type: str  # "stun", "freeze"
    expires_at: float

    @staticmethod
    def create_stun(target_id: str, duration_s: float = 1.5) -> CCEffect:
        return CCEffect(target_id=target_id, cc_type="stun", expires_at=time.monotonic() + duration_s)

    @staticmethod
    def create_freeze(target_id: str, duration_s: float = 2.0) -> CCEffect:
        return CCEffect(target_id=target_id, cc_type="freeze", expires_at=time.monotonic() + duration_s)
