"""
Mob AI manager — spawning, aggro, movement, attacks, crowd control, boss mechanics and respawn.
One instance per map, ticked by the game loop.
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass, field
from typing import Any

MOB_ATTACK_INTERVAL = 1.5  # seconds between melee swings
ATTACK_RANGE = 1.5


@dataclass
class MobInstance:
    instance_id: str
    mob_def_id: str
    name: str
    map_id: str
    spawn_x: float
    spawn_y: float
    x: float
    y: float
    hp: int
    max_hp: int
    atk: int
    def_: int
    level: int
    exp_reward: int
    gold_min: int
    gold_max: int
    aggro_radius: float
    respawn_ms: int
    loot_table: list[dict]
    wander_radius: float
    speed: float = 3.0
    boss: bool = False
    slam: dict[str, float] | None = None
    aggro_target: str | None = None
    taunt_until: float = 0.0  # while taunted the monster keeps chasing aggro_target, even past its leash
    is_dead: bool = False
    died_at: float = 0.0
    last_attack_at: float = 0.0
    stun_until: float = 0.0
    slow_until: float = 0.0
    next_slam_at: float = 0.0
    slam_at: float = 0.0
    slam_pos: tuple[float, float] = (0.0, 0.0)
    damage_by: dict[str, int] = field(default_factory=dict)
    leash_radius: float = 0.0
    # > 0: never walks farther than this from its spawn point, but keeps its target (the Global Boss stays in its arena)
    tether: float = 0.0

    def __post_init__(self):
        self.leash_radius = self.wander_radius + self.aggro_radius * (4 if self.boss else 2)

    def snapshot(self) -> dict[str, Any]:
        return {"type": "mob_spawn", "id": self.instance_id, "def_id": self.mob_def_id, "name": self.name,
                "level": self.level, "boss": self.boss, "x": self.x, "y": self.y, "hp": self.hp, "max_hp": self.max_hp}


class MobManager:
    def __init__(self, map_id: str):
        self.map_id = map_id
        self.mobs: dict[str, MobInstance] = {}
        self._next_id = 0

    def spawn(self, def_id: str, d: dict[str, Any], sx: float, sy: float, count: int, wander: float) -> None:
        for _ in range(count):
            self._next_id += 1
            iid = f"{self.map_id}_mob_{self._next_id}"
            self.mobs[iid] = MobInstance(
                instance_id=iid, mob_def_id=def_id, name=d["name"], map_id=self.map_id,
                spawn_x=sx, spawn_y=sy,
                x=sx + random.uniform(-wander, wander), y=sy + random.uniform(-wander, wander),
                hp=d["hp"], max_hp=d["hp"], atk=d["atk"], def_=d["def"], level=d["level"],
                exp_reward=d["exp"], gold_min=d["gold"][0], gold_max=d["gold"][1],
                aggro_radius=d["aggro"], respawn_ms=int(d["respawn"] * 1000), loot_table=d.get("loot", []),
                wander_radius=wander, speed=d.get("speed", 3.0), boss=d.get("boss", False), slam=d.get("slam"),
            )

    def apply_cc(self, instance_id: str, kind: str, duration: float) -> None:
        mob = self.mobs.get(instance_id)
        if not mob or mob.is_dead:
            return
        until = time.monotonic() + duration * (0.5 if mob.boss else 1.0)
        if kind in ("stun", "freeze"):
            mob.stun_until = max(mob.stun_until, until)
        elif kind == "slow":
            mob.slow_until = max(mob.slow_until, until)

    def tick(self, players: dict[str, tuple[float, float]], dt: float) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        now = time.monotonic()

        for mob in self.mobs.values():
            if mob.is_dead:
                if (now - mob.died_at) * 1000 >= mob.respawn_ms:
                    self._respawn(mob)
                    events.append(mob.snapshot())
                continue

            if mob.slam_at and now >= mob.slam_at:
                events.append({"type": "boss_slam", "mob_id": mob.instance_id, "x": mob.slam_pos[0], "y": mob.slam_pos[1],
                               "radius": mob.slam["radius"], "damage": mob.slam["damage"]})
                mob.slam_at = 0.0

            if now < mob.stun_until:
                continue

            if mob.aggro_target and mob.aggro_target not in players:
                mob.aggro_target = None
                mob.taunt_until = 0.0

            if not mob.aggro_target:
                for cid, (px, py) in players.items():
                    if _dist(mob.x, mob.y, px, py) <= mob.aggro_radius:
                        mob.aggro_target = cid
                        break

            if not mob.aggro_target:
                if mob.hp < mob.max_hp and _dist(mob.x, mob.y, mob.spawn_x, mob.spawn_y) < 0.6:
                    mob.hp = min(mob.max_hp, mob.hp + max(1, mob.max_hp // 50))
                if _dist(mob.x, mob.y, mob.spawn_x, mob.spawn_y) > mob.wander_radius + 0.5:
                    self._step(mob, mob.spawn_x, mob.spawn_y, dt, 1.4)
                    events.append(_move(mob))
                elif random.random() < 0.015 and mob.wander_radius > 0:
                    tx = mob.spawn_x + random.uniform(-mob.wander_radius, mob.wander_radius)
                    ty = mob.spawn_y + random.uniform(-mob.wander_radius, mob.wander_radius)
                    mob.x, mob.y = tx, ty
                    events.append(_move(mob))
                continue

            px, py = players[mob.aggro_target]
            if now >= mob.taunt_until and _dist(mob.x, mob.y, mob.spawn_x, mob.spawn_y) > mob.leash_radius:
                mob.aggro_target = None
                mob.damage_by.clear()
                continue

            if mob.slam and now >= mob.next_slam_at and _dist(mob.x, mob.y, px, py) < mob.slam["radius"] + 2:
                mob.next_slam_at = now + mob.slam["every"]
                mob.slam_at = now + mob.slam["warn"]
                mob.slam_pos = (px, py)
                events.append({"type": "boss_warn", "mob_id": mob.instance_id, "x": px, "y": py,
                               "radius": mob.slam["radius"], "delay": mob.slam["warn"]})

            dist = _dist(mob.x, mob.y, px, py)
            if dist > ATTACK_RANGE:
                gx, gy = px, py
                if mob.tether:
                    far = _dist(mob.spawn_x, mob.spawn_y, px, py)
                    if far > mob.tether:
                        gx = mob.spawn_x + (px - mob.spawn_x) * mob.tether / far
                        gy = mob.spawn_y + (py - mob.spawn_y) * mob.tether / far
                if _dist(mob.x, mob.y, gx, gy) > 0.3:
                    self._step(mob, gx, gy, dt, 1.0)
                    events.append(_move(mob))
            elif now - mob.last_attack_at >= MOB_ATTACK_INTERVAL:
                mob.last_attack_at = now
                events.append({"type": "mob_attack", "mob_id": mob.instance_id, "target_id": mob.aggro_target,
                               "damage": mob.atk})
        return events

    def damage_mob(self, instance_id: str, damage: int, attacker_id: str) -> dict[str, Any] | None:
        mob = self.mobs.get(instance_id)
        if not mob or mob.is_dead:
            return None
        mob.hp = max(0, mob.hp - damage)
        mob.damage_by[attacker_id] = mob.damage_by.get(attacker_id, 0) + damage
        if not mob.aggro_target:
            mob.aggro_target = attacker_id
        result: dict[str, Any] = {"type": "mob_damaged", "mob_id": instance_id, "damage": damage, "hp_remaining": mob.hp, "by": attacker_id}
        if mob.hp <= 0:
            mob.is_dead = True
            mob.died_at = time.monotonic()
            mob.slam_at = 0.0
            result.update(killed=True, def_id=mob.mob_def_id, exp=mob.exp_reward, level=mob.level, boss=mob.boss,
                          gold=random.randint(mob.gold_min, mob.gold_max) if mob.gold_max else 0,
                          loot=[],  # rolled per killer in game.py (items.roll_loot)
                          contributors=list(mob.damage_by.keys()))
        return result

    def taunt(self, instance_id: str, attacker_id: str, secs: float) -> None:
        """The warrior's taunt: the monster turns on him and keeps him as its target for `secs` seconds."""
        mob = self.mobs.get(instance_id)
        if not mob or mob.is_dead:
            return
        mob.aggro_target = attacker_id
        mob.taunt_until = time.monotonic() + secs

    def _step(self, mob: MobInstance, tx: float, ty: float, dt: float, mult: float) -> None:
        dist = _dist(mob.x, mob.y, tx, ty)
        if dist <= 0.01:
            return
        speed = mob.speed * mult * (0.45 if time.monotonic() < mob.slow_until else 1.0) * dt
        r = min(1.0, speed / dist)
        mob.x += (tx - mob.x) * r
        mob.y += (ty - mob.y) * r

    def _respawn(self, mob: MobInstance) -> None:
        mob.hp = mob.max_hp
        mob.is_dead = False
        mob.aggro_target = None
        mob.taunt_until = 0.0
        mob.damage_by.clear()
        mob.stun_until = mob.slow_until = mob.slam_at = 0.0
        mob.x = mob.spawn_x + random.uniform(-mob.wander_radius, mob.wander_radius)
        mob.y = mob.spawn_y + random.uniform(-mob.wander_radius, mob.wander_radius)


def _move(mob: MobInstance) -> dict[str, Any]:
    return {"type": "mob_move", "id": mob.instance_id, "x": mob.x, "y": mob.y}


def _dist(x1: float, y1: float, x2: float, y2: float) -> float:
    return ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
