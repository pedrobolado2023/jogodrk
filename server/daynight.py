"""
Day and night in the open world. Every 40 minutes there are 12 minutes of night: monsters hit harder, but give more
EXP and gold. The clock is the same for everyone (it comes from the time of day), so it never needs saving.
"""

from __future__ import annotations

import time

CYCLE = 40 * 60
NIGHT = 12 * 60          # the last 12 minutes of each cycle
NIGHT_REWARD = 1.5       # EXP and gold from monsters at night
NIGHT_MOB_HIT = 1.25     # monsters' hits at night


def phase(now: float | None = None) -> tuple[bool, int]:
    """(is it night, seconds until the next change)."""
    t = (now if now is not None else time.time()) % CYCLE
    day = CYCLE - NIGHT
    return (t >= day, int(CYCLE - t) if t >= day else int(day - t))


def is_night(now: float | None = None) -> bool:
    return phase(now)[0]


def public(now: float | None = None) -> dict[str, object]:
    night, left = phase(now)
    return {"type": "daynight", "night": night, "left": left,
            "reward": int(round((NIGHT_REWARD - 1) * 100)), "harder": int(round((NIGHT_MOB_HIT - 1) * 100))}
