"""
Mining in the mine map: ore veins players mine with a pickaxe.

Click a vein → stand next to it → mine for a few seconds (moving away cancels) → get its ore
(sometimes two). Each vein holds a few loads and grows back a while after it runs out. Richer
veins sit deeper in the mine and take longer to mine and to grow back.
"""

from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass
from typing import Any

MINE_MAP = "mine_01"
PICKAXE = "pickaxe"
MINING_RANGE = 2.4
MOVE_TOLERANCE = 0.8
DOUBLE_CHANCE = 0.25

KINDS: dict[str, dict[str, Any]] = {
    "iron": {"name": "Veio de Ferro", "ore": "ore_iron", "charges": 4, "respawn": 45, "time": 2.5},
    "silver": {"name": "Veio de Prata", "ore": "ore_silver", "charges": 3, "respawn": 90, "time": 3.0},
    "gold": {"name": "Veio de Ouro", "ore": "ore_gold", "charges": 3, "respawn": 150, "time": 3.5},
    "arcane": {"name": "Veio de Cristal Arcano", "ore": "ore_arcane", "charges": 2, "respawn": 300, "time": 4.0},
}

# chambers of the mine (x, y, radius) and what grows in each — the map's clearings use the same list
CHAMBERS: list[tuple[float, float, float, str, int]] = [
    (16, 22, 6, "iron", 4), (18, 48, 6, "iron", 4),
    (34, 18, 7, "silver", 4), (36, 52, 7, "silver", 4),
    (54, 24, 7, "gold", 3), (56, 47, 7, "gold", 3),
    (64, 35, 6, "arcane", 3),
]
SHAFT_VEINS: list[tuple[str, float, float]] = [("iron", 10.5, 32.5), ("iron", 12.5, 37.8)]


@dataclass
class Vein:
    id: str
    kind: str
    x: float
    y: float
    charges: int
    ready_at: float = 0.0

    @property
    def ready(self) -> bool:
        return self.charges > 0

    def public(self) -> dict[str, Any]:
        return {"id": self.id, "kind": self.kind, "x": self.x, "y": self.y, "ready": self.ready}


@dataclass
class Dig:
    vein: str
    until: float
    x: float
    y: float


def layout() -> list[tuple[str, float, float]]:
    out = list(SHAFT_VEINS)
    for cx, cy, r, kind, n in CHAMBERS:
        for i in range(n):
            a = (i / n) * math.tau + 0.6
            out.append((kind, round(cx + math.cos(a) * (r - 2.2), 1), round(cy + math.sin(a) * (r - 2.2), 1)))
    return out


class Mine:
    def __init__(self) -> None:
        self.veins: dict[str, Vein] = {}
        for i, (kind, x, y) in enumerate(layout()):
            vid = f"vein_{i}"
            self.veins[vid] = Vein(vid, kind, x, y, KINDS[kind]["charges"])
        self.digs: dict[str, Dig] = {}

    def state(self) -> dict[str, Any]:
        return {"type": "veins", "veins": [v.public() for v in self.veins.values()]}

    def start(self, cid: str, vein_id: str, x: float, y: float, has_pickaxe: bool) -> str | None:
        v = self.veins.get(vein_id)
        if not v:
            return "Veio desconhecido."
        if not has_pickaxe:
            return "Você precisa de uma Picareta. Compre com Dorian, na vila, ou com Gunnar, na entrada da mina."
        if not v.ready:
            return "Este veio está esgotado. Ele volta a crescer em breve."
        if math.hypot(x - v.x, y - v.y) > MINING_RANGE:
            return "Chegue mais perto do veio."
        if cid in self.digs:
            return "Você já está minerando."
        self.digs[cid] = Dig(vein_id, time.monotonic() + KINDS[v.kind]["time"], x, y)
        return None

    def cancel(self, cid: str) -> bool:
        return self.digs.pop(cid, None) is not None

    def tick(self, positions: dict[str, tuple[float, float]]) -> tuple[list[tuple[str, str, int]], list[str], list[Vein]]:
        """Returns (finished digs as (cid, ore, qty), cancelled cids, veins that changed)."""
        now = time.monotonic()
        done: list[tuple[str, str, int]] = []
        cancelled: list[str] = []
        changed: list[Vein] = []
        for v in self.veins.values():
            if not v.ready and now >= v.ready_at:
                v.charges = KINDS[v.kind]["charges"]
                changed.append(v)
        for cid, d in list(self.digs.items()):
            pos = positions.get(cid)
            v = self.veins[d.vein]
            if pos is None or math.hypot(pos[0] - d.x, pos[1] - d.y) > MOVE_TOLERANCE or not v.ready:
                del self.digs[cid]
                cancelled.append(cid)
                continue
            if now < d.until:
                continue
            del self.digs[cid]
            v.charges -= 1
            if not v.ready:
                v.ready_at = now + KINDS[v.kind]["respawn"]
                changed.append(v)
            done.append((cid, KINDS[v.kind]["ore"], 2 if random.random() < DOUBLE_CHANCE else 1))
        return done, cancelled, changed
