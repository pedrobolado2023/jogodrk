"""
Daily missions: every hero gets 3 tasks a day (they change at midnight, server local time).

  • 2 hunts: monsters close to the hero's level, on maps the story has already opened for them
  • 1 job: mine ore in the Black Iron Mines, or (from level 10) try to upgrade gear at the forge

Progress counts on its own (party kills count too); rewards are collected from Sergeant Hald in
the town. Collecting all three on the same day gives a bonus of forge stones. The tasks of a day
are drawn from the hero id and the date, so reconnecting never rerolls them.
"""

from __future__ import annotations

import datetime as dt
import random
from typing import Any

from world_data import MAPS, MOBS, SPAWNS, exp_to_next

TASKS_PER_DAY = 3
MINE_COUNT = 12
FORGE_COUNT = 2
FORGE_MIN_LEVEL = 10

# map → story step that opens it (from the portals' "story" gates)
MAP_GATE: dict[str, int] = {p["to"]: p["story"] for m in MAPS.values() for p in m["portals"] if "story" in p}
# where each regular monster lives (bosses are left out: one kill a day would be trivial or impossible)
MOB_MAP: dict[str, str] = {sp["mob"]: sp["map"] for sp in SPAWNS if not MOBS[sp["mob"]].get("boss")}


def today() -> str:
    return dt.date.today().isoformat()


def map_open(story: dict[str, Any], map_id: str) -> bool:
    need = MAP_GATE.get(map_id)
    if need is None:
        return True
    q, st = story.get("q", 0), story.get("st", "offer")
    return q > need or (q == need and st != "offer")


def hunt_count(mob: str) -> int:
    hp = MOBS[mob].get("base_hp", MOBS[mob]["hp"])  # how tough it is, before the power scaling
    return 15 if hp < 600 else 10 if hp < 1500 else 7


def hunt_pool(level: int, story: dict[str, Any]) -> list[str]:
    """Regular monsters the hero can reach, closest to their level first."""
    reach = [m for m, mp in MOB_MAP.items() if map_open(story, mp)]
    near = [m for m in reach if level - 6 <= MOBS[m]["level"] <= level + 2]
    if len(near) >= 2:
        return near
    return sorted(reach, key=lambda m: abs(MOBS[m]["level"] - level))[:2]


def task_reward(level: int) -> dict[str, int]:
    return {"exp": int(exp_to_next(level) * 0.35), "gold": 40 * level}


def bonus_reward(level: int) -> dict[str, Any]:
    stone, qty = ("stone_up_1", 3) if level < 12 else ("stone_up_2", 2) if level < 22 else ("stone_up_3", 1)
    return {"gold": 60 * level, "items": [[stone, qty]]}


def task_text(t: dict[str, Any]) -> str:
    if t["kind"] == "kill":
        return f"Derrote {t['count']}× {MOBS[t['target']]['name']}"
    if t["kind"] == "mine":
        return f"Minere {t['count']} minérios nas Minas"
    return f"Tente aprimorar equipamentos {t['count']}× na forja"


def roll(char_id: str, day: str, level: int, story: dict[str, Any]) -> dict[str, Any]:
    rng = random.Random(f"{char_id}:{day}")
    pool = hunt_pool(level, story)
    hunts = rng.sample(pool, 2) if len(pool) >= 2 else (pool * 2)[:2]
    tasks = [{"kind": "kill", "target": m, "count": hunt_count(m)} for m in hunts]
    if level >= FORGE_MIN_LEVEL and rng.random() < 0.5:
        tasks.append({"kind": "forge", "target": "", "count": FORGE_COUNT})
    else:
        tasks.append({"kind": "mine", "target": "", "count": MINE_COUNT})
    reward = task_reward(level)
    for t in tasks:
        t.update(n=0, claimed=False, **reward)
    return {"day": day, "level": level, "tasks": tasks, "bonus": False}


def fresh(state: dict[str, Any] | None, char_id: str, level: int, story: dict[str, Any], day: str | None = None) -> dict[str, Any]:
    """Today's missions: the saved ones if they are from today, otherwise a new set."""
    day = day or today()
    if state and state.get("day") == day and len(state.get("tasks", [])) == TASKS_PER_DAY:
        reward = task_reward(state.get("level", level))  # keeps saved sets in step with reward changes
        for t in state["tasks"]:
            t.update(reward)
        return state
    return roll(char_id, day, level, story)


def progress(state: dict[str, Any], kind: str, target: str = "", amount: int = 1) -> list[dict[str, Any]]:
    """Adds progress; returns the tasks this just completed."""
    finished = []
    for t in state.get("tasks", []):
        if t["kind"] != kind or (t["target"] and t["target"] != target) or t["n"] >= t["count"]:
            continue
        t["n"] = min(t["count"], t["n"] + amount)
        if t["n"] >= t["count"]:
            finished.append(t)
    return finished


def claimable(state: dict[str, Any]) -> list[dict[str, Any]]:
    return [t for t in state.get("tasks", []) if t["n"] >= t["count"] and not t["claimed"]]


def all_claimed(state: dict[str, Any]) -> bool:
    return bool(state.get("tasks")) and all(t["claimed"] for t in state["tasks"])


def public(state: dict[str, Any]) -> dict[str, Any]:
    return {"day": state["day"], "bonus": state["bonus"],
            "tasks": [{"text": task_text(t), "n": t["n"], "count": t["count"], "claimed": t["claimed"]}
                      for t in state["tasks"]]}
