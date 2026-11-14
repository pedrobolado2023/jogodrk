"""
World content: maps, portals, NPCs, monsters, the story campaign, classes and the level curve.
Everything here is sent to clients (via /meta or map_info), so player-facing text is in Portuguese.
"""

from __future__ import annotations

import re
from typing import Any

MAX_LEVEL = 1000

# Experience: a gentle curve up to level 10, then ×10 every 10 levels (level 100 asks ~10^9 times level 10).
# Monster EXP follows the same curve (see mob_exp), so what makes leveling harder is the number of kills
# per level, which grows ~10% every 10 levels.
EXP_LEVEL_10 = 40 * 10 ** 1.45


# Power: every damage and HP number is multiplied by power(level) on both sides (heroes and monsters), so the
# numbers grow big as heroes level up while a fight at the same level stays just as hard.
POWER_BASE = 10
POWER_PER_LEVEL = 0.1


def power(level: int) -> float:
    return POWER_BASE * (1 + POWER_PER_LEVEL * level)


def exp_to_next(level: int) -> int:
    if level <= 10:
        return int(40 * level ** 1.45)
    return int(EXP_LEVEL_10 * 10 ** ((level - 10) / 10))


BIG_UNITS = ["mi", "bi", "tri", "quatri", "quinti", "sexti", "septi", "octi", "noni", "deci"]


def fmt_big(n: float) -> str:
    """Numbers for people (same as the client's fmtBig): 12.345 · 4,5 mi · 3,2 bi … 1,2e45."""
    a = abs(n)
    if a < 1_000_000:
        return f"{int(round(n)):,}".replace(",", ".")
    e = (len(str(int(a))) - 1) // 3 - 2  # 0 → mi, 1 → bi, ...
    if e < len(BIG_UNITS):
        return f"{n / 10 ** (3 * (e + 2)):.1f}".replace(".", ",") + f" {BIG_UNITS[e]}"
    return f"{float(n):.1e}".replace(".", ",").replace("e+", "e")


def kills_per_level(level: int) -> float:
    """How many regular monsters of the hero's level one level takes."""
    return 6 * 1.1 ** (level / 10)


def mob_exp(level: int, weight: float) -> int:
    """EXP of a monster: a share of a level, bigger for tougher monsters (weight) and bosses."""
    return max(1, int(exp_to_next(level) * weight / kills_per_level(level)))


CLASS_BASE: dict[str, dict[str, int]] = {
    "blade_master":   {"str": 10, "agi": 7,  "int": 3,  "vit": 8, "hp": 150, "mp": 40},
    "grand_sorcerer": {"str": 3,  "agi": 5,  "int": 12, "vit": 5, "hp": 115, "mp": 120},
    "night_ranger":   {"str": 6,  "agi": 12, "int": 4,  "vit": 5, "hp": 125, "mp": 60},
}

# per level: every class gains some vitality (life) and intelligence (mana), on top of its main stat
CLASS_GROWTH: dict[str, dict[str, int]] = {
    "blade_master":   {"str": 3, "agi": 1, "int": 1, "vit": 3, "hp": 18, "mp": 4},
    "grand_sorcerer": {"str": 0, "agi": 1, "int": 3, "vit": 2, "hp": 9,  "mp": 14},
    "night_ranger":   {"str": 1, "agi": 3, "int": 1, "vit": 2, "hp": 12, "mp": 6},
}
LEVEL_HP = 100        # extra life per level, for every class
LEVEL_MP = 100        # extra mana per level
LEVEL_DODGE = 0.0005  # evasion per level (+5% at level 100)
DODGE_CAP = 0.6       # evasion never goes above 60%

START_MAP = "town_01"

MAPS: dict[str, dict[str, Any]] = {
    "town_01": {
        "name": "Vila de Ravencrest", "theme": "town", "size": 40, "safe": True, "pvp": False,
        "spawn": (20.0, 25.0), "level": "Zona segura",
        "portals": [
            {"id": "to_forest", "x": 35.0, "y": 21.0, "to": "forest_01", "dx": 26.0, "dy": 47.0, "label": "Floresta Sombria"},
            {"id": "to_arena", "x": 20.0, "y": 5.0, "to": "arena_01", "dx": 15.0, "dy": 22.0, "label": "Arena de Sangue (PvP)"},
            {"id": "to_crypt", "x": 5.0, "y": 21.0, "to": "dungeon_01", "dx": 30.0, "dy": 53.0, "label": "Catacumbas Esquecidas",
             "story": 3},
            {"id": "to_worldboss", "x": 20.0, "y": 35.5, "to": "worldboss_01", "dx": 15.0, "dy": 24.0, "label": "Boss Global",
             "event": True},
        ],
        "npcs": [
            {"id": "elder", "name": "Ancião Aldric", "x": 20.0, "y": 17.5, "look": "elder", "role": "story"},
            {"id": "healer", "name": "Mira, a Curandeira", "x": 13.5, "y": 24.0, "look": "healer", "role": "healer"},
            {"id": "arena_master", "name": "Bran, Mestre da Arena", "x": 23.0, "y": 8.0, "look": "warrior", "role": "arena"},
            {"id": "merchant", "name": "Dorian, o Mercador", "x": 27.2, "y": 19.4, "look": "merchant", "role": "shop",
             "shop": "merchant"},
            {"id": "smith", "name": "Brom, o Ferreiro", "x": 28.6, "y": 27.4, "look": "smith", "role": "forge", "shop": "forge"},
            {"id": "sergeant", "name": "Sargento Hald", "x": 15.6, "y": 18.2, "look": "warrior", "role": "daily"},
        ],
        "clearings": [],
    },
    "forest_01": {
        "name": "Floresta Sombria", "theme": "forest", "size": 200, "safe": False, "pvp": False,
        "spawn": (26.0, 47.0), "level": "Nível 1 – 8",
        "portals": [
            {"id": "to_town", "x": 22.5, "y": 49.0, "to": "town_01", "dx": 32.0, "dy": 21.0, "label": "Vila de Ravencrest"},
            {"id": "to_swamp", "x": 112.0, "y": 40.0, "to": "swamp_01", "dx": 10.0, "dy": 60.0, "label": "Pântano Amaldiçoado",
             "story": 5},
            {"id": "to_mine", "x": 12.0, "y": 32.0, "to": "mine_01", "dx": 7.5, "dy": 35.0, "label": "Minas de Ferro Negro"},
        ],
        "npcs": [],
        "clearings": [[12, 32, 4], [112, 40, 5], [24, 46, 6], [36, 58, 7], [52, 40, 6], [62, 72, 7], [42, 90, 7], [82, 96, 7], [96, 62, 6]],
    },
    "dungeon_01": {
        "name": "Catacumbas Esquecidas", "theme": "crypt", "size": 60, "safe": False, "pvp": False,
        "spawn": (30.0, 53.0), "level": "Nível 8 – 14",
        "portals": [
            {"id": "to_town", "x": 30.0, "y": 57.0, "to": "town_01", "dx": 7.5, "dy": 21.0, "label": "Vila de Ravencrest"},
        ],
        "npcs": [],
        "clearings": [],
    },
    "mine_01": {
        "name": "Minas de Ferro Negro", "theme": "mine", "size": 70, "safe": False, "pvp": False,
        "spawn": (7.5, 35.0), "level": "Mineração — veios mais ricos ficam no fundo",
        "portals": [
            {"id": "to_forest", "x": 3.0, "y": 35.0, "to": "forest_01", "dx": 15.5, "dy": 31.5, "label": "Floresta Sombria"},
        ],
        "npcs": [
            {"id": "foreman", "name": "Gunnar, o Capataz", "x": 9.0, "y": 31.6, "look": "merchant", "role": "shop", "shop": "mine"},
        ],
        # mine chambers (x, y, radius) — the client carves them out of the rock; mining.py puts the veins in them
        "clearings": [[16, 22, 6], [18, 48, 6], [34, 18, 7], [36, 52, 7], [54, 24, 7], [56, 47, 7], [64, 35, 6]],
    },
    "swamp_01": {
        "name": "Pântano Amaldiçoado", "theme": "swamp", "size": 120, "safe": False, "pvp": False,
        "spawn": (10.0, 60.0), "level": "Nível 12 – 18",
        "portals": [
            {"id": "to_forest", "x": 5.0, "y": 60.0, "to": "forest_01", "dx": 108.5, "dy": 40.0, "label": "Floresta Sombria"},
            {"id": "to_frost", "x": 112.0, "y": 44.0, "to": "frost_01", "dx": 10.0, "dy": 65.0, "label": "Picos Congelados",
             "story": 8},
        ],
        "npcs": [],
        # open ground: entrance camp, monster grounds, the witch's lair and the path north to the peaks
        "clearings": [[11, 60, 7], [34, 46, 7], [40, 78, 7], [54, 60, 6], [68, 38, 8], [72, 86, 8], [103, 60, 11],
                      [112, 44, 5]],
    },
    "frost_01": {
        "name": "Picos Congelados", "theme": "frost", "size": 130, "safe": False, "pvp": False,
        "spawn": (10.0, 65.0), "level": "Nível 18 – 26",
        "portals": [
            {"id": "to_swamp", "x": 4.5, "y": 65.0, "to": "swamp_01", "dx": 108.0, "dy": 47.5, "label": "Pântano Amaldiçoado"},
            {"id": "to_ash", "x": 110.0, "y": 30.0, "to": "ash_01", "dx": 10.0, "dy": 65.0, "label": "Terras de Cinza",
             "story": 12},
        ],
        "npcs": [],
        # entrance camp, wolf dens, the sentinels' ruins, the troll caves and, last, the Lich's citadel
        "clearings": [[11, 65, 7], [32, 48, 7], [30, 84, 7], [54, 38, 8], [56, 92, 8], [80, 56, 8], [84, 100, 8],
                      [114, 65, 12], [110, 30, 5]],
    },
    "worldboss_01": {
        "name": "Covil dos Titãs", "theme": "arena", "size": 30, "safe": False, "pvp": False, "event": True,
        "spawn": (15.0, 24.0), "level": "Boss Global — sem PvP, sem perdas ao morrer",
        "portals": [
            {"id": "to_town", "x": 15.0, "y": 27.5, "to": "town_01", "dx": 20.0, "dy": 32.0, "label": "Vila de Ravencrest"},
        ],
        "npcs": [],
        "clearings": [],
    },
    "arena_01": {
        "name": "Arena de Sangue", "theme": "arena", "size": 30, "safe": False, "pvp": True,
        "spawn": (15.0, 22.0), "level": "PvP livre",
        "portals": [
            {"id": "to_town", "x": 15.0, "y": 27.0, "to": "town_01", "dx": 20.0, "dy": 7.5, "label": "Vila de Ravencrest"},
        ],
        "npcs": [],
        "clearings": [],
    },
}

# ── Regions of chapters IV-VII: same layout (entrance camp in the west, three hunting grounds, the
# boss's lair in the east, the way onward in the north-east), built by region() ──
REGION_CLEARINGS = [[11, 65, 7], [32, 48, 7], [30, 84, 7], [54, 38, 8], [56, 92, 8], [80, 56, 8], [84, 100, 8],
                    [114, 65, 12], [110, 30, 5]]
REGIONS = [
    # map id, name, theme, levels, previous map, next map, story step that opens it
    ("ash_01", "Terras de Cinza", "ash", "Nível 26 – 45", "frost_01", "crimson_01", 12),
    ("crimson_01", "Abismo Carmesim", "crimson", "Nível 45 – 65", "ash_01", "ghost_01", 16),
    ("ghost_01", "Ruínas de Eldmoor", "ghost", "Nível 65 – 85", "crimson_01", "void_01", 20),
    ("void_01", "Cidadela do Vazio", "void", "Nível 85 – 100", "ghost_01", None, 24),
]
REGION_NAMES = {r[0]: r[1] for r in REGIONS}


def region(map_id: str, name: str, theme: str, level: str, prev: str, nxt: str | None, gate: int) -> dict[str, Any]:
    back_name = REGION_NAMES.get(prev, "Picos Congelados")
    portals = [{"id": f"to_{prev}", "x": 4.5, "y": 65.0, "to": prev, "dx": 106.0, "dy": 34.0, "label": back_name}]
    if nxt:
        nxt_gate = next(r[6] for r in REGIONS if r[0] == nxt)
        portals.append({"id": f"to_{nxt}", "x": 110.0, "y": 30.0, "to": nxt, "dx": 10.0, "dy": 65.0,
                        "label": REGION_NAMES[nxt], "story": nxt_gate})
    return {"name": name, "theme": theme, "size": 130, "safe": False, "pvp": False, "spawn": (10.0, 65.0), "level": level,
            "portals": portals, "npcs": [], "clearings": REGION_CLEARINGS}


for _r in REGIONS:
    MAPS[_r[0]] = region(*_r)


def region_mob(name: str, level: int, kind: str = "normal", **extra: Any) -> dict[str, Any]:
    """Stats of a chapter IV+ monster from its level: hp ~ level^1.15, attack and defense ~ level."""
    hp = 35 * level ** 1.15
    mult = {"normal": (1.0, 1.0, 1.0, 3.2), "fast": (0.85, 1.05, 1.0, 3.6), "caster": (0.9, 1.2, 1.3, 2.8),
            "strong": (2.0, 1.25, 2.0, 2.5), "boss": (20.0, 1.6, 12.0, 2.6)}[kind]
    d: dict[str, Any] = {"name": name, "level": level, "hp": int(hp * mult[0]), "atk": int((2.4 * level + 0.16 * level * level) * mult[1]),
                         "def": level + 5 + (10 if kind == "boss" else 0), "w": mult[2],
                         "gold": (40 * level, 60 * level) if kind == "boss" else (level, 2 * level),
                         "aggro": 9.0 if kind == "boss" else 6.0, "respawn": 180 if kind == "boss" else 20, "speed": mult[3]}
    if kind == "boss":
        d.update(boss=True, slam={"every": 5.5, "warn": 1.2, "radius": 4.5, "damage": int(6 * level + 0.5 * level * level)})
    d.update(extra)
    return d


MOBS: dict[str, dict[str, Any]] = {
    "wolf": {"name": "Lobo Sombrio", "level": 2, "hp": 75, "atk": 6, "def": 3, "exp": 22, "gold": (2, 8),
             "aggro": 4.0, "respawn": 12, "speed": 3.2},
    "goblin": {"name": "Goblin da Floresta", "level": 4, "hp": 130, "atk": 10, "def": 5, "exp": 38, "gold": (5, 15),
               "aggro": 6.0, "respawn": 15, "speed": 3.0},
    "treant": {"name": "Treant Corrompido", "level": 7, "hp": 420, "atk": 18, "def": 14, "exp": 110, "gold": (12, 30),
               "aggro": 4.5, "respawn": 30, "speed": 2.0},
    "skeleton": {"name": "Guerreiro Esqueleto", "level": 9, "hp": 320, "atk": 21, "def": 11, "exp": 120, "gold": (15, 35),
                 "aggro": 6.0, "respawn": 20, "speed": 2.8},
    "swamp_ghoul": {"name": "Carniçal do Pântano", "level": 12, "hp": 560, "atk": 27, "def": 16, "exp": 190,
                    "gold": (18, 40), "aggro": 6.0, "respawn": 18, "speed": 3.0},
    "bog_mutant": {"name": "Mutante do Brejo", "level": 15, "hp": 1100, "atk": 36, "def": 22, "exp": 340,
                   "gold": (30, 60), "aggro": 5.0, "respawn": 30, "speed": 2.4},
    "swamp_witch": {"name": "Morgana, a Bruxa do Pântano", "level": 18, "hp": 9000, "atk": 44, "def": 24, "exp": 4500,
                    "gold": (600, 900), "aggro": 9.0, "respawn": 120, "speed": 2.6, "boss": True,
                    "slam": {"every": 6.0, "warn": 1.2, "radius": 4.0, "damage": 80}},
    "frost_wolf": {"name": "Lobo da Nevasca", "level": 18, "hp": 1250, "atk": 46, "def": 26, "exp": 330, "gold": (28, 55),
                   "aggro": 6.5, "respawn": 16, "speed": 3.6},
    "frost_sentinel": {"name": "Sentinela Congelado", "level": 21, "hp": 1900, "atk": 55, "def": 32, "exp": 480,
                       "gold": (35, 70), "aggro": 6.0, "respawn": 20, "speed": 2.8},
    "ice_troll": {"name": "Troll do Gelo", "level": 24, "hp": 3600, "atk": 68, "def": 38, "exp": 820, "gold": (55, 100),
                  "aggro": 5.5, "respawn": 30, "speed": 2.5},
    "lich_king": {"name": "Valdrek, o Rei Lich", "level": 27, "hp": 26000, "atk": 82, "def": 40, "exp": 14000,
                  "gold": (1500, 2200), "aggro": 10.0, "respawn": 150, "speed": 2.6, "boss": True,
                  "slam": {"every": 5.5, "warn": 1.2, "radius": 4.5, "damage": 150}},
    # IV · Terras de Cinza
    "ash_hound": region_mob("Cão de Cinza", 28, "fast"),
    "magma_brute": region_mob("Bruto de Magma", 34, "strong"),
    "cinder_cultist": region_mob("Cultista das Cinzas", 39, "caster"),
    "ash_dragon": region_mob("Pyraxis, o Dragão de Cinzas", 45, "boss"),
    # V · Abismo Carmesim
    "blood_ghoul": region_mob("Carniçal Sangrento", 48, "fast"),
    "crimson_knight": region_mob("Cavaleiro Carmesim", 54, "normal"),
    "flesh_horror": region_mob("Horror de Carne", 60, "strong"),
    "blood_queen": region_mob("Sanguina, a Rainha de Sangue", 65, "boss"),
    # VI · Ruínas de Eldmoor
    "phantom_soldier": region_mob("Soldado Fantasma", 68, "normal"),
    "necromancer": region_mob("Necromante de Eldmoor", 74, "caster"),
    "spectral_colossus": region_mob("Colosso Espectral", 80, "strong"),
    "ghost_king": region_mob("Aldrec, o Rei Fantasma", 85, "boss"),
    # VII · Cidadela do Vazio
    "void_stalker": region_mob("Espreitador do Vazio", 88, "fast"),
    "void_titan": region_mob("Titã do Vazio", 93, "strong"),
    "void_witch": region_mob("Bruxa do Vazio", 97, "caster"),
    "void_dragon": region_mob("Nyxara, a Dragoa do Vazio", 100, "boss"),
    "death_knight": {"name": "Vorthas, o Cavaleiro da Morte", "level": 12, "hp": 4200, "atk": 30, "def": 18, "exp": 1500,
                     "gold": (300, 500), "aggro": 8.0, "respawn": 90, "speed": 2.4, "boss": True,
                     "slam": {"every": 7.0, "warn": 1.3, "radius": 3.5, "damage": 55}},
}

# monster EXP comes from the curve: weight 1 = a regular monster of its level, bosses are worth ~12
for _m in MOBS.values():
    _w = _m.get("w") or (12.0 if _m.get("boss") else max(0.8, min(3.0, _m["hp"] / (30 * _m["level"] ** 1.3))))
    _m["exp"] = mob_exp(_m["level"], _w)

SPAWNS: list[dict[str, Any]] = [
    {"map": "forest_01", "mob": "wolf", "x": 36, "y": 58, "count": 4, "wander": 4.0},
    {"map": "forest_01", "mob": "wolf", "x": 52, "y": 40, "count": 4, "wander": 3.5},
    {"map": "forest_01", "mob": "goblin", "x": 62, "y": 72, "count": 6, "wander": 4.5},
    {"map": "forest_01", "mob": "goblin", "x": 42, "y": 90, "count": 5, "wander": 4.0},
    {"map": "forest_01", "mob": "treant", "x": 82, "y": 96, "count": 3, "wander": 3.0},
    {"map": "forest_01", "mob": "treant", "x": 96, "y": 62, "count": 2, "wander": 2.5},
    {"map": "dungeon_01", "mob": "skeleton", "x": 30, "y": 42, "count": 4, "wander": 3.0},
    {"map": "dungeon_01", "mob": "skeleton", "x": 17, "y": 30, "count": 4, "wander": 3.0},
    {"map": "dungeon_01", "mob": "skeleton", "x": 43, "y": 30, "count": 4, "wander": 3.0},
    {"map": "dungeon_01", "mob": "death_knight", "x": 30, "y": 12, "count": 1, "wander": 0.0},
    {"map": "swamp_01", "mob": "swamp_ghoul", "x": 34, "y": 46, "count": 5, "wander": 4.5},
    {"map": "swamp_01", "mob": "swamp_ghoul", "x": 40, "y": 78, "count": 5, "wander": 4.5},
    {"map": "swamp_01", "mob": "swamp_ghoul", "x": 54, "y": 60, "count": 4, "wander": 4.0},
    {"map": "swamp_01", "mob": "bog_mutant", "x": 68, "y": 38, "count": 3, "wander": 4.0},
    {"map": "swamp_01", "mob": "bog_mutant", "x": 72, "y": 86, "count": 3, "wander": 4.0},
    {"map": "swamp_01", "mob": "swamp_witch", "x": 105, "y": 60, "count": 1, "wander": 0.0},
    {"map": "frost_01", "mob": "frost_wolf", "x": 32, "y": 48, "count": 5, "wander": 5.0},
    {"map": "frost_01", "mob": "frost_wolf", "x": 30, "y": 84, "count": 5, "wander": 5.0},
    {"map": "frost_01", "mob": "frost_sentinel", "x": 54, "y": 38, "count": 5, "wander": 4.0},
    {"map": "frost_01", "mob": "frost_sentinel", "x": 56, "y": 92, "count": 5, "wander": 4.0},
    {"map": "frost_01", "mob": "ice_troll", "x": 80, "y": 56, "count": 3, "wander": 4.0},
    {"map": "frost_01", "mob": "ice_troll", "x": 84, "y": 100, "count": 3, "wander": 4.0},
    {"map": "frost_01", "mob": "lich_king", "x": 116, "y": 65, "count": 1, "wander": 0.0},
]
REGION_MOBS = {
    "ash_01": ("ash_hound", "magma_brute", "cinder_cultist", "ash_dragon"),
    "crimson_01": ("blood_ghoul", "crimson_knight", "flesh_horror", "blood_queen"),
    "ghost_01": ("phantom_soldier", "necromancer", "spectral_colossus", "ghost_king"),
    "void_01": ("void_stalker", "void_titan", "void_witch", "void_dragon"),
}
for _map, (_a, _b, _c, _boss) in REGION_MOBS.items():
    SPAWNS += [
        {"map": _map, "mob": _a, "x": 32, "y": 48, "count": 5, "wander": 5.0},
        {"map": _map, "mob": _a, "x": 30, "y": 84, "count": 5, "wander": 5.0},
        {"map": _map, "mob": _b, "x": 54, "y": 38, "count": 4, "wander": 4.0},
        {"map": _map, "mob": _b, "x": 56, "y": 92, "count": 4, "wander": 4.0},
        {"map": _map, "mob": _c, "x": 80, "y": 56, "count": 4, "wander": 4.0},
        {"map": _map, "mob": _c, "x": 84, "y": 100, "count": 4, "wander": 4.0},
        {"map": _map, "mob": _boss, "x": 116, "y": 65, "count": 1, "wander": 0.0},
    ]

QUESTS: list[dict[str, Any]] = [
    {
        "id": "q1", "title": "Sombras na Floresta", "giver": "elder",
        "goal": {"type": "kill", "mob": "wolf", "count": 5}, "goal_text": "Derrote Lobos Sombrios",
        "offer": ["Viajante! Os Lobos Sombrios estão atacando nossos caçadores.",
                  "Siga pelo portal a leste até a Floresta Sombria e elimine 5 deles."],
        "done": ["Você voltou inteiro... Talvez seja quem as profecias anunciavam."],
        "reward": {"exp": 150, "gold": 50},
    },
    {
        "id": "q2", "title": "Ladrões Verdes", "giver": "elder",
        "goal": {"type": "kill", "mob": "goblin", "count": 6}, "goal_text": "Derrote Goblins da Floresta",
        "offer": ["Os goblins saquearam o templo e levaram nossas relíquias.",
                  "Eles acampam mais fundo na floresta. Derrote 6 deles."],
        "done": ["As relíquias voltaram! Os aldeões cantam seu nome na taverna."],
        "reward": {"exp": 300, "gold": 90},
    },
    {
        "id": "q3", "title": "O Coração Corrompido", "giver": "elder",
        "goal": {"type": "kill", "mob": "treant", "count": 2}, "goal_text": "Destrua Treants Corrompidos",
        "offer": ["As árvores antigas estão ganhando vida... e sede de sangue.",
                  "Destrua 2 Treants Corrompidos e traga pistas da origem desse mal."],
        "done": ["Esta casca cheira a tumba antiga... A corrupção vem das Catacumbas!"],
        "reward": {"exp": 500, "gold": 130},
    },
    {
        "id": "q4", "title": "Descida às Catacumbas", "giver": "elder",
        "goal": {"type": "kill", "mob": "skeleton", "count": 8}, "goal_text": "Derrote Guerreiros Esqueletos",
        "offer": ["Abri o selo do portal das Catacumbas, a oeste da vila.",
                  "Os mortos marcham de novo. Derrote 8 Guerreiros Esqueletos e abra caminho."],
        "done": ["Você sentiu? O chão treme... Algo muito antigo despertou lá embaixo."],
        "reward": {"exp": 900, "gold": 220},
    },
    {
        "id": "q5", "title": "O Cavaleiro da Morte", "giver": "elder",
        "goal": {"type": "kill", "mob": "death_knight", "count": 1}, "goal_text": "Derrote Vorthas",
        "offer": ["Vorthas foi o maior herói de Ravencrest. Hoje é só ódio e aço.",
                  "Ele aguarda no salão mais fundo das Catacumbas. Liberte a alma dele."],
        "done": ["Você conseguiu... Vorthas descansa, e a vila está salva, Campeão de Ravencrest!",
                 "Mas as trevas do norte ainda se movem. Esta é só a primeira página da sua lenda."],
        "reward": {"exp": 2500, "gold": 600}, "chapter_end": "I",
    },
    # ── Chapter II: the swamp ──
    {
        "id": "q6", "title": "O Pântano Amaldiçoado", "giver": "elder",
        "goal": {"type": "kill", "mob": "swamp_ghoul", "count": 8}, "goal_text": "Derrote Carniçais do Pântano",
        "offer": ["Campeão... um cheiro de podridão sobe do leste da Floresta Sombria.",
                  "Abri a passagem para o Pântano Amaldiçoado. Derrote 8 Carniçais e descubra o que os desperta."],
        "done": ["Carniçais com marcas de feitiço... Alguém os controla de dentro do pântano."],
        "reward": {"exp": 1400, "gold": 300},
    },
    {
        "id": "q7", "title": "Feras do Brejo", "giver": "elder",
        "goal": {"type": "kill", "mob": "bog_mutant", "count": 5}, "goal_text": "Derrote Mutantes do Brejo",
        "offer": ["Os caçadores voltaram feridos: feras enormes guardam o coração do pântano.",
                  "Derrote 5 Mutantes do Brejo e abra caminho até a cabana da bruxa."],
        "done": ["As feras caíram. Agora só resta ela: Morgana, a Bruxa do Pântano."],
        "reward": {"exp": 2200, "gold": 450},
    },
    {
        "id": "q8", "title": "A Bruxa do Pântano", "giver": "elder",
        "goal": {"type": "kill", "mob": "swamp_witch", "count": 1}, "goal_text": "Derrote Morgana",
        "offer": ["Morgana foi curandeira de Ravencrest, antes de se entregar às trevas.",
                  "Foi ela quem acordou Vorthas. Vá até o fundo do pântano e acabe com isso."],
        "done": ["O pântano está em silêncio... pela primeira vez em cem anos.",
                 "Você é a lenda de Ravencrest. Descanse, que outras sombras virão."],
        "reward": {"exp": 5000, "gold": 1200}, "chapter_end": "II",
    },
    # ── Chapter III: the frozen peaks ──
    {
        "id": "q9", "title": "O Frio do Norte", "giver": "elder",
        "goal": {"type": "kill", "mob": "frost_wolf", "count": 10}, "goal_text": "Derrote Lobos da Nevasca",
        "offer": ["Campeão, encontraram isto na cabana de Morgana: cartas assinadas por um tal de Valdrek.",
                  "Atrás da cabana há uma trilha para os Picos Congelados. Derrote 10 Lobos da Nevasca e abra caminho."],
        "done": ["Os lobos usavam coleiras de gelo encantado... Alguém os prende ao seu serviço."],
        "reward": {"exp": 3000, "gold": 700},
    },
    {
        "id": "q10", "title": "Os Guardas de Gelo", "giver": "elder",
        "goal": {"type": "kill", "mob": "frost_sentinel", "count": 8}, "goal_text": "Derrote Sentinelas Congelados",
        "offer": ["Soldados antigos de Ravencrest morreram nas montanhas, e agora marcham congelados.",
                  "Eles guardam as ruínas no meio dos Picos. Derrote 8 Sentinelas Congelados."],
        "done": ["Um deles ainda tinha o brasão da vila... Valdrek transforma nossos mortos em guardas."],
        "reward": {"exp": 4500, "gold": 900},
    },
    {
        "id": "q11", "title": "Trolls na Passagem", "giver": "elder",
        "goal": {"type": "kill", "mob": "ice_troll", "count": 5}, "goal_text": "Derrote Trolls do Gelo",
        "offer": ["Os Trolls do Gelo fecham a passagem para a cidadela de Valdrek.",
                  "São fortes como uma montanha. Derrote 5 deles, e leve muitas poções."],
        "done": ["A passagem está livre. Agora você vai encarar quem está por trás de tudo isso."],
        "reward": {"exp": 6500, "gold": 1300},
    },
    {
        "id": "q12", "title": "O Rei Lich", "giver": "elder",
        "goal": {"type": "kill", "mob": "lich_king", "count": 1}, "goal_text": "Derrote Valdrek",
        "offer": ["Valdrek foi o mestre de Morgana. Foi ele quem a ensinou a acordar os mortos.",
                  "Ele espera na cidadela no fim dos Picos. Cuidado com o chão: a magia dele explode em gelo."],
        "done": ["O gelo dos Picos está derretendo... Valdrek caiu, e com ele a última sombra do norte.",
                 "Ravencrest nunca teve um herói como você."],
        "reward": {"exp": 16000, "gold": 3000}, "chapter_end": "III",
    },
]


def _q(qid: str, title: str, mob: str, count: int, goal: str, offer: list[str], done: list[str], gold: int,
       chapter: str | None = None) -> dict[str, Any]:
    q = {"id": qid, "title": title, "giver": "elder", "goal": {"type": "kill", "mob": mob, "count": count}, "goal_text": goal,
         "offer": offer, "done": done, "reward": {"exp": 0, "gold": gold}}
    if chapter:
        q["chapter_end"] = chapter
    return q


QUESTS += [
    # ── Chapter IV: the ash lands ──
    _q("q13", "Brasas no Horizonte", "ash_hound", 10, "Derrote Cães de Cinza",
       ["Valdrek caiu, mas o céu ao norte ficou vermelho. Os batedores falam de terras cobertas de cinza.",
        "Atravesse o portal atrás da cidadela de Valdrek e derrote 10 Cães de Cinza."],
       ["Os cães fugiam de algo maior... Uma sombra com asas cruza as nuvens de cinza."], 1800),
    _q("q14", "Gigantes de Magma", "magma_brute", 10, "Derrote Brutos de Magma",
       ["Brutos de magma andam pelas cinzas e derretem tudo o que tocam.", "Derrote 10 deles antes que cheguem às montanhas."],
       ["O calor diminuiu. Mas quem os despertou ainda está lá."], 2200),
    _q("q15", "O Culto das Cinzas", "cinder_cultist", 8, "Derrote Cultistas das Cinzas",
       ["Homens de capuz rezam diante do vulcão. Querem acordar por completo um dragão antigo.",
        "Derrote 8 Cultistas das Cinzas e interrompa o ritual."],
       ["O ritual foi quebrado, mas o dragão já abriu os olhos."], 2600),
    _q("q16", "Pyraxis", "ash_dragon", 1, "Derrote Pyraxis",
       ["Pyraxis, o Dragão de Cinzas, dorme no fundo das terras queimadas.", "Vá até o ninho dele e acabe com o fogo de uma vez."],
       ["O dragão caiu e o céu voltou a ficar azul... por enquanto."], 6000, "IV"),
    # ── Chapter V: the crimson abyss ──
    _q("q17", "O Abismo Carmesim", "blood_ghoul", 10, "Derrote Carniçais Sangrentos",
       ["Do ninho de Pyraxis desce um rio de sangue até um abismo sem fundo.", "Desça pela passagem e derrote 10 Carniçais Sangrentos."],
       ["Esse sangue não é de animal. Alguém está alimentando o abismo."], 3200),
    _q("q18", "Cavaleiros Carmesins", "crimson_knight", 10, "Derrote Cavaleiros Carmesins",
       ["Cavaleiros de armadura vermelha guardam o abismo e juram lealdade a uma rainha.", "Derrote 10 Cavaleiros Carmesins."],
       ["Eles gritavam o nome dela até o fim: Sanguina."], 3800),
    _q("q19", "Horrores de Carne", "flesh_horror", 8, "Derrote Horrores de Carne",
       ["A rainha cria monstros de carne no fundo do abismo.", "Derrote 8 Horrores de Carne e abra o caminho até o trono."],
       ["O caminho até o trono de sangue está aberto."], 4400),
    _q("q20", "A Rainha de Sangue", "blood_queen", 1, "Derrote Sanguina",
       ["Sanguina vive há mil anos bebendo a vida dos outros.", "Vá até o trono dela e termine com esse reinado."],
       ["A rainha virou pó. Nos papéis dela há um nome: Eldmoor, a capital perdida."], 9000, "V"),
    # ── Chapter VI: the Eldmoor ruins ──
    _q("q21", "Ruínas de Eldmoor", "phantom_soldier", 10, "Derrote Soldados Fantasmas",
       ["Eldmoor foi a capital do antigo reino, até sumir numa única noite.", "Os soldados de lá ainda patrulham como fantasmas. Derrote 10 deles."],
       ["Eles não sabem que estão mortos... Alguém os prende aqui."], 5000),
    _q("q22", "Os Necromantes", "necromancer", 10, "Derrote Necromantes de Eldmoor",
       ["Necromantes usam as ruínas para erguer os mortos.", "Derrote 10 Necromantes de Eldmoor."],
       ["Os necromantes serviam ao último rei de Eldmoor."], 5800),
    _q("q23", "Colossos Espectrais", "spectral_colossus", 8, "Derrote Colossos Espectrais",
       ["Colossos feitos de almas guardam o palácio.", "Derrote 8 Colossos Espectrais."],
       ["O palácio está aberto. O rei espera por você."], 6600),
    _q("q24", "O Rei Fantasma", "ghost_king", 1, "Derrote Aldrec",
       ["Aldrec, o Rei Fantasma, trocou o reino pela vida eterna.", "Liberte as almas de Eldmoor derrotando o rei."],
       ["As almas de Eldmoor descansam. Mas o rei abriu uma fenda para o Vazio antes de cair."], 13000, "VI"),
    # ── Chapter VII: the void citadel ──
    _q("q25", "A Fenda do Vazio", "void_stalker", 10, "Derrote Espreitadores do Vazio",
       ["Uma fenda roxa se abriu no palácio de Eldmoor, e criaturas do Vazio estão saindo.",
        "Atravesse a fenda e derrote 10 Espreitadores do Vazio."],
       ["Do outro lado existe uma cidadela inteira flutuando no nada."], 7500),
    _q("q26", "Titãs do Vazio", "void_titan", 10, "Derrote Titãs do Vazio",
       ["Titãs gigantes sustentam a cidadela.", "Derrote 10 Titãs do Vazio."],
       ["A cidadela treme. Só as bruxas a mantêm de pé."], 8500),
    _q("q27", "As Bruxas do Vazio", "void_witch", 8, "Derrote Bruxas do Vazio",
       ["As Bruxas do Vazio cantam para manter a fenda aberta.", "Derrote 8 delas."],
       ["O canto parou. Agora resta a dona da cidadela."], 9500),
    _q("q28", "Nyxara", "void_dragon", 1, "Derrote Nyxara",
       ["Nyxara, a Dragoa do Vazio, quer engolir o mundo inteiro.", "Esta é a maior batalha da sua vida. Boa sorte, campeão."],
       ["Nyxara caiu e a fenda se fechou. Ravencrest conta a sua história para sempre."], 20000, "VII"),
]

# The Elder travels with the hero: he waits near the entrance of every map that has a story mission, so a quest is
# turned in and the next one taken right there, without walking back to town.
STORY_NPC_OFFSET = (1.8, -1.2)
_mob_map: dict[str, str] = {}
for _sp in SPAWNS:
    _mob_map.setdefault(_sp["mob"], _sp["map"])
for _quest in QUESTS:
    _m = _mob_map.get(_quest["goal"].get("mob"))
    if not _m or any(n["role"] == "story" for n in MAPS[_m]["npcs"]):
        continue
    _sx, _sy = MAPS[_m]["spawn"]
    _ex, _ey = _sx + STORY_NPC_OFFSET[0], _sy + STORY_NPC_OFFSET[1]
    MAPS[_m]["npcs"].append({"id": "elder", "name": "Ancião Aldric", "x": _ex, "y": _ey, "look": "elder", "role": "story"})
    if MAPS[_m].get("theme") != "crypt":  # in the crypt the clearings are its rooms; elsewhere keep trees off him
        MAPS[_m]["clearings"].append([round(_ex), round(_ey), 2])

# Story quests are long hunts meant to be played with the auto-mission: 10× the monsters written above,
# and every boss twice (it comes back after its respawn). The numbers in the Elder's lines follow along.
QUEST_KILL_MULT = 10
BOSS_KILLS = 2
for _quest in QUESTS:
    _mob = MOBS[_quest["goal"]["mob"]]
    _old = _quest["goal"]["count"]
    if _mob.get("boss"):
        _quest["goal"]["count"] = BOSS_KILLS
        _quest["offer"] = _quest["offer"] + [f"Cuidado: ele volta depois de cair. Derrote-o {BOSS_KILLS} vezes."]
    else:
        _quest["goal"]["count"] = _old * QUEST_KILL_MULT
        _quest["offer"] = [re.sub(rf"\b{_old}\b", str(_old * QUEST_KILL_MULT), line) for line in _quest["offer"]]

# Monster HP, attack and boss slams by the power of their level (the unscaled HP stays in base_hp)
for _d in MOBS.values():
    _k = power(_d["level"])
    _d["base_hp"] = _d["hp"]
    _d["hp"] = int(_d["hp"] * _k)
    _d["atk"] = int(_d["atk"] * _k)
    if _d.get("slam"):
        _d["slam"] = {**_d["slam"], "damage": int(_d["slam"]["damage"] * _k)}

# Hunting density: twice the monsters on every spot and respawns twice as fast (bosses too, so the
# auto-mission does not wait long for the second boss kill). The world boss event has its own rules.
SPOT_MULT = 2
RESPAWN_MULT = 0.5
for _sp in SPAWNS:
    if not MOBS[_sp["mob"]].get("boss"):
        _sp["count"] *= SPOT_MULT
for _m in MOBS.values():
    _m["respawn"] = max(5, round(_m["respawn"] * RESPAWN_MULT))

# story EXP follows the curve too: a regular quest is worth ~1 level, a boss quest ~2
for _quest in QUESTS:
    _mob = MOBS[_quest["goal"]["mob"]]
    _quest["reward"]["exp"] = max(_quest["reward"]["exp"],
                                  int(exp_to_next(_mob["level"]) * (2.0 if _mob.get("boss") else 1.0)))

CHAPTER_ENDS = {
    "I": ("FIM DO CAPÍTULO I", "Vorthas descansa e Ravencrest está salva.\nMas um cheiro de podridão vem do leste... Fale com o Ancião."),
    "II": ("FIM DO CAPÍTULO II", "Morgana foi derrotada e o pântano respira de novo.\nMas ela não agia sozinha... Fale com o Ancião."),
    "III": ("FIM DO CAPÍTULO III", "Valdrek, o Rei Lich, foi derrotado e o norte está livre.\nMas o céu além da cidadela ficou vermelho... Fale com o Ancião."),
    "IV": ("FIM DO CAPÍTULO IV", "Pyraxis caiu e as cinzas assentaram.\nUm rio de sangue desce para o abismo... Fale com o Ancião."),
    "V": ("FIM DO CAPÍTULO V", "Sanguina virou pó.\nOs papéis dela falam de Eldmoor, a capital perdida... Fale com o Ancião."),
    "VI": ("FIM DO CAPÍTULO VI", "As almas de Eldmoor descansam.\nMas uma fenda para o Vazio se abriu... Fale com o Ancião."),
    "VII": ("FIM DO CAPÍTULO VII", "Nyxara foi derrotada e o mundo está a salvo.\nNovas terras virão. Até lá, sua lenda segue na Arena e no Boss Global."),
}

def normalize_story(story: dict[str, Any] | None) -> dict[str, Any]:
    """A hero who finished the story before new chapters were added is offered the next quest."""
    st = dict(story or {"q": 0, "st": "offer", "n": 0})
    if st.get("st") == "done" and st.get("q", 0) < len(QUESTS):
        st["st"], st["n"] = "offer", 0
    return st


NPC_LINES: dict[str, list[str]] = {
    "elder_idle": ["Descanse, campeão. Ravencrest dorme tranquila graças a você."],
    "healer": ["Que a luz feche suas feridas.", "Pronto, você está como novo."],
    "smith": ["Traga minério das Minas de Ferro Negro e eu forjo as pedras.",
              "Com elas eu aprimoro seu equipamento até +15 e refino com bônus raros. Ouro na mesa, claro."],
    "foreman": ["Bem-vindo às Minas! Sem picareta não se tira nada da rocha.",
                "Ferro perto da entrada, prata e ouro no meio, e Cristal Arcano lá no fundo."],
    "merchant": ["Armas, armaduras e poções! Tudo forjado aqui mesmo em Ravencrest.",
                 "E se trouxer peles, ossos e outras pilhagens, eu compro."],
    "sergeant": ["Todo dia a vila precisa de braços fortes. Aqui estão as tarefas de hoje.",
                 "Faça as três e ganhe um bônus de pedras da forja."],
    "arena": ["Quer provar seu valor? A Arena de Sangue fica ao norte.",
              "Lá é PvP livre: cada abate conta pontos. Morrer não tem penalidade."],
}


def meta() -> dict[str, Any]:
    from items import catalog
    from titles import meta as titles_meta
    import season as season_meta
    import shop as shop_meta
    from skills_data import ACTIVES, PASSIVES
    return {
        "skills": ACTIVES,
        "passives": PASSIVES,
        "mobs": {k: {"name": v["name"], "level": v["level"], "boss": v.get("boss", False)} for k, v in MOBS.items()},
        "maps": {k: {"name": v["name"], "theme": v["theme"], "level": v["level"], "pvp": v["pvp"], "safe": v["safe"]}
                 for k, v in MAPS.items()},
        "quests": [{"id": q["id"], "title": q["title"], "goal_text": q["goal_text"], "count": q["goal"]["count"],
                    "mob": q["goal"].get("mob", "")} for q in QUESTS],
        # for the auto-pilot: how maps connect, where each monster lives and where the quest giver stands
        "world": {k: [{"to": p["to"], "x": p["x"], "y": p["y"]} for p in v["portals"] if not p.get("event")]
                  for k, v in MAPS.items()},
        "spawns": {m: [[sp["map"], sp["x"], sp["y"]] for sp in SPAWNS if sp["mob"] == m] for m in MOBS},
        "exp_table": [exp_to_next(lv) for lv in range(1, MAX_LEVEL + 1)],
        "max_level": MAX_LEVEL,
        "titles": titles_meta() + season_meta.titles_meta(),
        "auras": season_meta.auras_meta(),
        "pets": season_meta.pets_meta(),
        "mounts": season_meta.mounts_meta(),
        "season": season_meta.meta(),
        "shop": shop_meta.meta(),
        **catalog(),
    }
