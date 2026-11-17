"""
Spatial partitioning — grid-based zone system.

Each map is divided into cells (default 16x16 tiles). A player belongs to
one cell at a time. When broadcasting state (movement, combat, chat), only
players in the SAME cell and its 8 neighbors receive the message. This caps
the fan-out to ~50-100 players even on a map with 500+.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from websocket_manager import PlayerSession

CELL_SIZE = 16  # tiles per cell side


@dataclass
class Cell:
    players: set[str] = field(default_factory=set)  # character ids


class SpatialGrid:
    """One grid per map instance."""

    def __init__(self, map_id: str, width: int = 200, height: int = 200):
        self.map_id = map_id
        self.cols = math.ceil(width / CELL_SIZE)
        self.rows = math.ceil(height / CELL_SIZE)
        self.cells: dict[tuple[int, int], Cell] = defaultdict(Cell)

    @staticmethod
    def _key(x: float, y: float) -> tuple[int, int]:
        return int(x // CELL_SIZE), int(y // CELL_SIZE)

    def add(self, char_id: str, x: float, y: float) -> tuple[int, int]:
        key = self._key(x, y)
        self.cells[key].players.add(char_id)
        return key

    def remove(self, char_id: str, x: float, y: float) -> None:
        key = self._key(x, y)
        self.cells[key].players.discard(char_id)

    def move(self, char_id: str, old_x: float, old_y: float, new_x: float, new_y: float) -> tuple[int, int]:
        old_key = self._key(old_x, old_y)
        new_key = self._key(new_x, new_y)
        if old_key != new_key:
            self.cells[old_key].players.discard(char_id)
            self.cells[new_key].players.add(char_id)
        return new_key

    def players_within(self, x: float, y: float, r: float) -> set[str]:
        """Everyone in the cells that a circle of radius r (tiles) around (x, y) touches (callers check the distance)."""
        x0, y0 = self._key(x - r, y - r)
        x1, y1 = self._key(x + r, y + r)
        result: set[str] = set()
        for cx in range(x0, x1 + 1):
            for cy in range(y0, y1 + 1):
                cell = self.cells.get((cx, cy))
                if cell:
                    result.update(cell.players)
        return result

    def nearby_players(self, x: float, y: float) -> set[str]:
        cx, cy = self._key(x, y)
        result: set[str] = set()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                key = (cx + dx, cy + dy)
                if key in self.cells:
                    result.update(self.cells[key].players)
        return result
