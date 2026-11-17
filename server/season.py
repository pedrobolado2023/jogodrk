"""
Season pass: a 50-level track that lasts one season (about two months).

  • Pass XP comes from playing: daily missions, monsters (with a daily cap so it rewards regular play,
    not endless grinding), story quests and the Global Boss.
  • Two reward tracks per level: the free one for everybody (gold, potions, forge stones and a title at the
    end) and the Premium one, which gives only looks (exclusive titles and auras) plus a few potions. Premium
    never gives power, so the game is never pay-to-win.
  • Premium will be unlocked through the game's shop later; for now it can only be switched on by the
    developer test command.
  • Cosmetics (titles and auras) are kept forever, after the season ends.

Per hero, saved as JSON:
  season:    {"id", "xp", "premium", "free": [levels claimed], "prem": [levels claimed], "kday": date, "kxp": n}
  cosmetics: {"titles": [ids], "auras": [ids], "aura": id or ""}
Player-facing text is in Portuguese.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

SEASON = {"id": "s1", "name": "Temporada 1 — Brasas do Despertar", "start": dt.date(2026, 11, 1), "end": dt.date(2026, 12, 31)}
MAX_LEVEL = 50
XP_PER_LEVEL = 1000

# how much pass XP each activity gives
KILL_XP = 2
BOSS_KILL_XP = 40
KILL_XP_DAY_CAP = 1500      # monsters stop giving pass XP after this much in a day
DAILY_TASK_XP = 150
DAILY_BONUS_XP = 250        # all three daily missions collected
QUEST_XP = 100
WB_JOIN_XP = 300            # took part in the Global Boss (hit it)
WB_PLACE_XP = 200           # each prize place (top 3 in damage, last hit)

# id, name, colour — titles that are owned (from the pass or the gem shop), not reached by level
PASS_TITLES: list[tuple[str, str, str]] = [
    ("s1_brasa", "Brasa Desperta", "#ff9a4a"),
    ("s1_cacador", "Caçador de Cinzas", "#ffb347"),
    ("s1_chama", "Chama Eterna", "#ff5a3a"),
    ("s1_fenix", "Fênix da Temporada", "#ffd77a"),
    ("s1_veterano", "Veterano da Temporada 1", "#d8c8a0"),
    # sold in the gem shop (shop.py)
    ("nobre", "Nobre de Ravencrest", "#e8d8ff"),
    ("sombra_errante", "Sombra Errante", "#9a8ac8"),
    ("lamina_rubra", "Lâmina Rubra", "#ff6a6a"),
]
import vip as _vip  # noqa: E402
PASS_TITLES += _vip.TITLES  # the VIP titles (worn while the account is VIP)
PASS_TITLES += [("cacador_segredos", "Caçador de Segredos", "#7af0ff")]
PASS_TITLES += [("cartografo", "Cartógrafo de Ravencrest", "#ffd77a")]  # every hidden place found (discovery.py)  # the Hidden Wanderer's reward (hidden_quest.py)
TITLE_BY_ID = {t[0]: t for t in PASS_TITLES}

# id → name, glow colour (a client GLOW_COLORS name)
AURAS: dict[str, tuple[str, str]] = {
    "aura_brasa": ("Aura de Brasas", "orange"),
    "aura_geada": ("Aura de Geada", "cyan"),
    "aura_vazio": ("Aura do Vazio", "purple"),
    "aura_fenix": ("Aura da Fênix", "gold"),
    # sold in the gem shop (shop.py)
    "aura_sangue": ("Aura Sanguínea", "red"),
    "aura_celeste": ("Aura Celeste", "blue"),
    "aura_esmeralda": ("Aura Esmeralda", "green"),
    "aura_alma": ("Aura das Almas", "teal"),
    # VIP 3, 5 and 7 (vip.py)
    **{a: (n, c) for a, n, c, _ in _vip.AURAS},
}

# id → name, 3D sprite sheet (client/public/sprites/<sheet>) — mascots that follow the hero, looks only
PETS: dict[str, tuple[str, str]] = {
    "pet_dog": ("Cão Fiel", "pet_dog"),
    "pet_snow_wolf": ("Lobinho da Neve", "pet_snow_wolf"),
    "pet_fox": ("Raposa Esperta", "pet_fox"),
    "pet_husky": ("Husky Valente", "pet_husky"),
    "pet_shiba": ("Shiba Sorridente", "pet_shiba"),
    "pet_ember_drake": ("Dragãozinho de Brasa", "pet_ember_drake"),
    "pet_void_drake": ("Dragãozinho do Vazio", "pet_void_drake"),
    "pet_black_dog": ("Cão Negro", "pet_black_dog"),
    "pet_arctic_fox": ("Raposa do Ártico", "pet_arctic_fox"),
    "pet_ember_fox": ("Raposa de Brasa", "pet_ember_fox"),
    "pet_black_shiba": ("Shiba Noturno", "pet_black_shiba"),
    "pet_emerald_drake": ("Dragãozinho Esmeralda", "pet_emerald_drake"),
    "pet_frost_drake": ("Dragãozinho Gélido", "pet_frost_drake"),
    "pet_gold_drake": ("Dragãozinho Dourado", "pet_gold_drake"),
    "pet_wolf_pup": ("Lobinho Cinzento", "pet_wolf_pup"),
    "pet_fawn": ("Filhote de Corça", "pet_fawn"),
    "pet_spirit_fawn": ("Corça Espectral", "pet_spirit_fawn"),
    "pet_alpaca": ("Mini Alpaca", "pet_alpaca"),
    "pet_donkey": ("Burrinho", "pet_donkey"),
    "pet_calf": ("Touro Mirim", "pet_calf"),
}

# id → name, colour grade, what it looks like — skins: the hero's own class recoloured (looks only). The client grades
# the class sheet once on a canvas (desaturate by "desat", multiply by "tint", scale by "gain"): no new images to load.
# A skin with its own 3D model has "sheet" instead: rendered once per class as <sheet>_<class> (render_units.py), the
# model wearing that class's animations.
SKINS: dict[str, dict[str, Any]] = {
    "skin_carmesim": {"name": "Sombra Carmesim", "grade": {"desat": 0.55, "tint": [1.45, 0.55, 0.55], "gain": 1.0},
                      "desc": "Armadura tingida de vermelho-sangue."},
    "skin_gelido": {"name": "Espectro Gélido", "grade": {"desat": 0.7, "tint": [0.72, 1.0, 1.5], "gain": 1.15},
                    "desc": "O frio dos Picos Congelados na sua armadura."},
    "skin_vazio": {"name": "Arauto do Vazio", "grade": {"desat": 0.6, "tint": [1.1, 0.62, 1.5], "gain": 1.0},
                   "desc": "Tons violeta de quem voltou do Vazio."},
    "skin_real": {"name": "Ouro Real", "grade": {"desat": 0.6, "tint": [1.5, 1.2, 0.55], "gain": 1.2},
                  "desc": "Dourado como a guarda do rei."},
    "skin_praieiro": {"name": "Praieiro", "sheet": "skin_praieiro",
                      "desc": "Camisa florida, bermuda e chinelo: o herói de férias, pronto para a luta."},
    "skin_presidente": {"name": "Bolzo", "sheet": "skin_presidente",
                        "desc": "Terno azul e faixa verde e amarela: governa o campo de batalha."},
    "skin_politico": {"name": "Lule", "sheet": "skin_politico",
                      "desc": "Terno escuro e gravata vermelha: discursa com os punhos."},
    "skin_brutamontes": {"name": "Brutamontes", "sheet": "skin_brutamontes",
                         "desc": "Sem camisa e cheio de músculos: dispensa armadura."},
    "skin_lutador": {"name": "Colosso de Ferro", "sheet": "skin_lutador",
                     "desc": "Um gigante de músculos e placas de metal escuro."},
}

# id → name, 3D sprite sheet — horses the hero rides, looks only (no speed: the same pace on foot or mounted)
MOUNTS: dict[str, tuple[str, str, float]] = {  # name, sheet, saddle height (share of the animal's height)
    "mount_horse": ("Cavalo Baio", "mount_horse", 0.72),
    "mount_white": ("Corcel Branco", "mount_white", 0.72),
    "mount_shadow": ("Corcel Sombrio", "mount_shadow", 0.72),
    "mount_ember": ("Corcel de Brasa", "mount_ember", 0.72),
    "mount_gold": ("Corcel Dourado", "mount_gold", 0.72),
    "mount_frost": ("Corcel Gélido", "mount_frost", 0.72),
    "mount_donkey": ("Burro Teimoso", "mount_donkey", 0.7),
    "mount_alpaca": ("Alpaca Andina", "mount_alpaca", 0.58),
    "mount_alpaca_royal": ("Alpaca Real", "mount_alpaca_royal", 0.58),
    "mount_deer": ("Corça da Floresta", "mount_deer", 0.66),
    "mount_stag": ("Cervo Real", "mount_stag", 0.52),
    "mount_stag_spirit": ("Cervo Espectral", "mount_stag_spirit", 0.52),
    "mount_bull": ("Touro Bravo", "mount_bull", 0.78),
    "mount_bull_infernal": ("Touro Infernal", "mount_bull_infernal", 0.78),
    "mount_wolf": ("Lobo Cinzento", "mount_wolf", 0.7),
    "mount_wolf_shadow": ("Lobo Sombrio", "mount_wolf_shadow", 0.7),
    "mount_wolf_frost": ("Lobo Glacial", "mount_wolf_frost", 0.7),
    "mount_drake_ember": ("Dragão de Brasa", "mount_drake_ember", 0.4),
    "mount_drake_void": ("Dragão do Vazio", "mount_drake_void", 0.4),
    "mount_drake_emerald": ("Dragão Esmeralda", "mount_drake_emerald", 0.4),
    "mount_phantom": ("Corcel Fantasma", "mount_phantom", 0.72),
}

FREE_STONES = {10: ("stone_up_1", 5), 20: ("stone_up_2", 3), 30: ("stone_protect", 1), 40: ("stone_up_3", 1)}
PREMIUM_LOOKS: dict[int, list[dict[str, Any]]] = {
    1: [{"title": "s1_brasa"}],
    10: [{"aura": "aura_brasa"}],
    20: [{"title": "s1_cacador"}],
    25: [{"aura": "aura_geada"}],
    35: [{"title": "s1_chama"}],
    40: [{"aura": "aura_vazio"}],
    50: [{"title": "s1_fenix"}, {"aura": "aura_fenix"}],
}


def rewards(level: int, track: str) -> list[dict[str, Any]]:
    """What a pass level gives on a track ("free" or "prem")."""
    if track == "free":
        if level == MAX_LEVEL:
            return [{"title": "s1_veterano"}, {"gold": 10000}]
        if level in FREE_STONES:
            item, qty = FREE_STONES[level]
            return [{"item": item, "qty": qty}]
        if level % 5 == 0:
            return [{"item": "pot_hp_l" if level % 10 == 5 else "pot_mp_l", "qty": 10}]
        return [{"gold": 300 + 60 * level}]
    if level in PREMIUM_LOOKS:
        return PREMIUM_LOOKS[level]
    return [{"item": "pot_hp_l" if level % 2 else "pot_mp_l", "qty": 3}]


def today() -> str:
    return dt.date.today().isoformat()


def days_left(now: dt.date | None = None) -> int:
    return max(0, (SEASON["end"] - (now or dt.date.today())).days)


def fresh(state: dict[str, Any] | None) -> dict[str, Any]:
    """The hero's pass for the current season (a new, empty one when the season changed)."""
    if not state or state.get("id") != SEASON["id"]:
        return {"id": SEASON["id"], "xp": 0, "premium": False, "free": [], "prem": [], "kday": today(), "kxp": 0}
    return state


def level_of(xp: int) -> int:
    return min(MAX_LEVEL, xp // XP_PER_LEVEL)


def add_xp(state: dict[str, Any], amount: int, kind: str = "other") -> int:
    """Adds pass XP (monster XP stops at the daily cap); returns how much was really added."""
    if amount <= 0 or level_of(state["xp"]) >= MAX_LEVEL:
        return 0
    if kind == "kill":
        if state.get("kday") != today():
            state["kday"], state["kxp"] = today(), 0
        amount = min(amount, KILL_XP_DAY_CAP - state["kxp"])
        if amount <= 0:
            return 0
        state["kxp"] += amount
    state["xp"] = min(state["xp"] + amount, MAX_LEVEL * XP_PER_LEVEL)
    return amount


def can_claim(state: dict[str, Any], track: str, level: int) -> str | None:
    """None if the reward can be taken, else why not (in Portuguese)."""
    if track not in ("free", "prem") or not 1 <= level <= MAX_LEVEL:
        return "Recompensa inválida."
    if level > level_of(state["xp"]):
        return f"Chegue ao nível {level} do passe para pegar."
    if track == "prem" and not state.get("premium"):
        return "Essa recompensa é do Passe Premium."
    if level in state[track]:
        return "Você já pegou essa recompensa."
    return None


def claimable(state: dict[str, Any]) -> list[tuple[str, int]]:
    return [(tr, lv) for lv in range(1, level_of(state["xp"]) + 1) for tr in ("free", "prem") if can_claim(state, tr, lv) is None]


def cosmetics(state: dict[str, Any] | None) -> dict[str, Any]:
    c = dict(state or {})
    c.setdefault("titles", [])
    c.setdefault("auras", [])
    c.setdefault("aura", "")
    c.setdefault("pets", [])
    c.setdefault("pet", "")
    c.setdefault("mounts", [])
    c.setdefault("mount", "")
    c.setdefault("skins", [])
    c.setdefault("skin", "")
    if c["skin"] and c["skin"] not in c["skins"]:
        c["skin"] = ""
    if c["mount"] and c["mount"] not in c["mounts"]:
        c["mount"] = ""
    if c["aura"] and c["aura"] not in c["auras"]:
        c["aura"] = ""
    if c["pet"] and c["pet"] not in c["pets"]:
        c["pet"] = ""
    return c


def reward_text(r: dict[str, Any], item_name) -> str:
    if "gold" in r:
        return f"{r['gold']} ouro"
    if "item" in r:
        return f"{r['qty']}× {item_name(r['item'])}"
    if "title" in r:
        return f"título «{TITLE_BY_ID[r['title']][1]}»"
    return AURAS[r["aura"]][0]


def summary(rewards: list[dict[str, Any]], item_name) -> str:
    """Many rewards in one short line: gold added up, the same item counted once."""
    gold = sum(r.get("gold", 0) for r in rewards)
    items: dict[str, int] = {}
    for r in rewards:
        if "item" in r:
            items[r["item"]] = items.get(r["item"], 0) + r["qty"]
    parts = [reward_text(r, item_name) for r in rewards if "title" in r or "aura" in r]
    parts += [f"{n}× {item_name(i)}" for i, n in items.items()]
    if gold:
        parts.append(f"{gold} ouro")
    return ", ".join(parts)


def public(state: dict[str, Any]) -> dict[str, Any]:
    xp = state["xp"]
    lv = level_of(xp)
    return {"type": "season", "id": SEASON["id"], "name": SEASON["name"], "days_left": days_left(), "xp": xp, "level": lv,
            "xp_in": xp - lv * XP_PER_LEVEL if lv < MAX_LEVEL else XP_PER_LEVEL, "xp_per": XP_PER_LEVEL, "max": MAX_LEVEL,
            "premium": bool(state.get("premium")), "free": state["free"], "prem": state["prem"],
            "kill_xp_today": state.get("kxp", 0) if state.get("kday") == today() else 0, "kill_cap": KILL_XP_DAY_CAP}


def meta() -> dict[str, Any]:
    """Static pass data for the client (/meta): the reward table and how XP is earned."""
    return {
        "id": SEASON["id"], "name": SEASON["name"], "max": MAX_LEVEL, "xp_per": XP_PER_LEVEL,
        "track": [{"level": lv, "free": rewards(lv, "free"), "prem": rewards(lv, "prem")} for lv in range(1, MAX_LEVEL + 1)],
        "sources": [
            f"Missão diária entregue: +{DAILY_TASK_XP} (as 3 no dia: +{DAILY_BONUS_XP})",
            f"Monstro: +{KILL_XP} · Chefe: +{BOSS_KILL_XP} (até {KILL_XP_DAY_CAP} por dia)",
            f"Missão da história entregue: +{QUEST_XP}",
            f"Boss Global: +{WB_JOIN_XP} por participar, +{WB_PLACE_XP} por prêmio",
        ],
    }


def titles_meta() -> list[dict[str, Any]]:
    return [{"level": 0, "id": tid, "name": nm, "color": col, "pass": True} for tid, nm, col in PASS_TITLES]


def mounts_meta() -> list[dict[str, Any]]:
    return [{"id": mid, "name": nm, "sheet": sheet, "saddle": saddle} for mid, (nm, sheet, saddle) in MOUNTS.items()]


def skins_meta() -> list[dict[str, Any]]:
    return [{"id": sid, **s} for sid, s in SKINS.items()]


def pets_meta() -> list[dict[str, Any]]:
    return [{"id": pid, "name": nm, "sheet": sheet} for pid, (nm, sheet) in PETS.items()]


def auras_meta() -> list[dict[str, Any]]:
    return [{"id": aid, "name": nm, "color": col} for aid, (nm, col) in AURAS.items()]
