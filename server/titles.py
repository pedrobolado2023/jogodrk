"""
Level titles: one every 100 levels, from 100 to 1000. A title shows above the hero's name and in chat.
Reaching one is announced to everyone online and equips it; the hero can later pick any title they
have earned (or none) in the character window. Player-facing names are in Portuguese.
"""

from __future__ import annotations

from typing import Any

# level, id, name, colour
TITLES: list[tuple[int, str, str, str]] = [
    (100, "desbravador", "Desbravador", "#9dff8a"),
    (200, "veterano", "Veterano", "#6fdcff"),
    (300, "campeao", "Campeão", "#6fb0ff"),
    (400, "senhor_guerra", "Senhor da Guerra", "#c08cff"),
    (500, "lenda_viva", "Lenda Viva", "#ff8ae0"),
    (600, "matador_dragoes", "Matador de Dragões", "#ff9a4a"),
    (700, "mao_destino", "Mão do Destino", "#ffc857"),
    (800, "imortal", "Imortal", "#ff5a5a"),
    (900, "semideus", "Semideus", "#fff0a0"),
    (1000, "eterno", "O Eterno", "#ffffff"),
]
BY_ID = {t[1]: t for t in TITLES}


def unlocked(level: int) -> list[str]:
    return [tid for lv, tid, _, _ in TITLES if level >= lv]


def best(level: int) -> str:
    got = unlocked(level)
    return got[-1] if got else ""


def can_use(level: int, title_id: str) -> bool:
    return title_id == "" or title_id in unlocked(level)


def crossed(before: int, after: int) -> list[tuple[int, str, str, str]]:
    """Titles reached by going from level `before` to `after`."""
    return [t for t in TITLES if before < t[0] <= after]


def name(title_id: str) -> str:
    return BY_ID[title_id][2] if title_id in BY_ID else ""


def meta() -> list[dict[str, Any]]:
    return [{"level": lv, "id": tid, "name": nm, "color": col} for lv, tid, nm, col in TITLES]
