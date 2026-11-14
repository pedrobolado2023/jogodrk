"""
Auto-farm system — server-validated automation.

The client sends an "auto_farm" toggle with config. The server runs the logic
so that auto-farm cannot be exploited beyond what a manual player could do.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class AutoFarmConfig:
    enabled: bool = False
    skill_rotation: list[str] = field(default_factory=list)  # skill_def_ids in order
    farm_radius: float = 8.0  # tiles from current position
    hp_pot_threshold: float = 0.5  # use pot when hp < 50%
    mp_pot_threshold: float = 0.3  # use pot when mp < 30%
    loot_pickup: bool = True


@dataclass
class AutoFarmState:
    config: AutoFarmConfig
    current_target: str | None = None  # mob instance_id
    skill_index: int = 0
    last_action_at: float = 0.0
    last_pot_at: float = 0.0

    ACTION_INTERVAL = 0.5  # seconds between auto actions
    POT_COOLDOWN = 2.0     # seconds between pot uses


class AutoFarmManager:
    """Tracks auto-farm state per character."""

    def __init__(self):
        self.states: dict[str, AutoFarmState] = {}  # char_id → state

    def toggle(self, char_id: str, config: dict[str, Any]) -> bool:
        if char_id in self.states and self.states[char_id].config.enabled:
            del self.states[char_id]
            return False

        cfg = AutoFarmConfig(
            enabled=True,
            skill_rotation=config.get("skills", []),
            farm_radius=min(config.get("radius", 8.0), 12.0),  # cap at 12 tiles
            hp_pot_threshold=max(0.1, min(0.9, config.get("hp_pot", 0.5))),
            mp_pot_threshold=max(0.1, min(0.9, config.get("mp_pot", 0.3))),
            loot_pickup=config.get("loot", True),
        )
        self.states[char_id] = AutoFarmState(config=cfg)
        return True

    def tick(
        self,
        char_id: str,
        char_x: float,
        char_y: float,
        char_hp: int,
        char_max_hp: int,
        char_mp: int,
        char_max_mp: int,
        nearby_mobs: list[dict],  # [{id, x, y, is_dead}]
    ) -> list[dict[str, Any]]:
        """
        Returns a list of actions the auto-farm wants to perform this tick.
        The game loop validates and executes them.
        """
        state = self.states.get(char_id)
        if not state or not state.config.enabled:
            return []

        now = time.monotonic()
        actions: list[dict[str, Any]] = []

        # pot check
        if now - state.last_pot_at >= state.POT_COOLDOWN:
            if char_max_hp > 0 and char_hp / char_max_hp < state.config.hp_pot_threshold:
                actions.append({"action": "use_pot", "pot_type": "hp"})
                state.last_pot_at = now
            elif char_max_mp > 0 and char_mp / char_max_mp < state.config.mp_pot_threshold:
                actions.append({"action": "use_pot", "pot_type": "mp"})
                state.last_pot_at = now

        if now - state.last_action_at < state.ACTION_INTERVAL:
            return actions

        # find target
        if state.current_target:
            alive = any(m["id"] == state.current_target and not m.get("is_dead") for m in nearby_mobs)
            if not alive:
                state.current_target = None

        if not state.current_target:
            best = None
            best_dist = float("inf")
            for m in nearby_mobs:
                if m.get("is_dead"):
                    continue
                dx = m["x"] - char_x
                dy = m["y"] - char_y
                d = (dx * dx + dy * dy) ** 0.5
                if d <= state.config.farm_radius and d < best_dist:
                    best = m["id"]
                    best_dist = d
            state.current_target = best

        if not state.current_target:
            return actions

        # find target position for movement
        target_mob = next((m for m in nearby_mobs if m["id"] == state.current_target), None)
        if target_mob:
            dx = target_mob["x"] - char_x
            dy = target_mob["y"] - char_y
            dist = (dx * dx + dy * dy) ** 0.5
            if dist > 1.5:
                actions.append({
                    "action": "move",
                    "x": target_mob["x"],
                    "y": target_mob["y"],
                })
                state.last_action_at = now
                return actions

        # use next skill in rotation
        if state.config.skill_rotation:
            skill_id = state.config.skill_rotation[state.skill_index % len(state.config.skill_rotation)]
            actions.append({
                "action": "use_skill",
                "skill_id": skill_id,
                "target_id": state.current_target,
            })
            state.skill_index += 1
            state.last_action_at = now

        return actions


auto_farm = AutoFarmManager()
