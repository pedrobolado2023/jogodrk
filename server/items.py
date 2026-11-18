"""
Items, loot and shops: the catalog (sent to clients through /meta, so player-facing text is in
Portuguese), drop rolls, the starting kit and the inventory rules used by game.py.

Inventory model (per hero, saved as JSON on the character):
  bag:  list of {"id": item_id, "qty": n}   — stackable items (potions, materials) share one entry;
        gear entries are single pieces that may also carry "plus" (upgrade level 0–15) and
        "ref" (refinement bonuses, e.g. {"atk_pct": 0.04, "dodge": 0.02}) — see forge.py
  gear: {"weapon" | "armor" | "legs" | "boots" | "ring" | "necklace": {"id": item_id, "plus": n, "ref": {...}}}
        ("armor" is the chest piece; old saves had one "accessory" slot, moved to "ring" or "necklace" on load)
The catalog stats are the +0 values; the upgrade level multiplies them (UPGRADE_STEP per +1).
"""

from __future__ import annotations

import random
from typing import Any

BAG_SLOTS = 100  # every hero; VIP adds more (vip.py), up to BAG_MAX
BAG_MAX = 170


class Bag(list):
    """A hero's bag: a list of entries that knows its own size (VIP heroes have more spaces)."""
    cap = BAG_SLOTS
STACK_MAX = 99
GEAR_SLOTS = ("weapon", "armor", "legs", "boots", "ring", "necklace")
POTION_COOLDOWN = 3.0  # seconds, per kind (hp / mp)
SELL_RATE = 0.25       # gear sells for a quarter of its shop price
UPGRADE_STEP = 0.07
FRACTION_STATS = ("crit", "crit_dmg")  # stats kept as fractions (0.05 = 5%), everything else is a whole number    # each +1 adds 7% to the item's stats (+15 → 2.05×)

RARITY: dict[str, dict[str, str]] = {
    "comum": {"name": "Comum", "color": "#d8d0c0"},
    "incomum": {"name": "Incomum", "color": "#7ee07a"},
    "raro": {"name": "Raro", "color": "#6fb0ff"},
    "epico": {"name": "Épico", "color": "#c08cff"},
    "lendario": {"name": "Lendário", "color": "#ffa040"},
}

BM, GS, NR = ["blade_master"], ["grand_sorcerer"], ["night_ranger"]


def _gear(name: str, slot: str, icon: str, rarity: str, lvl: int, tier: int, stats: dict[str, float],
          price: int = 0, sell: int = 0, cls: list[str] | None = None) -> dict[str, Any]:
    return {"name": name, "type": "gear", "slot": slot, "icon": icon, "rarity": rarity, "lvl": lvl, "tier": tier,
            "stats": stats, "price": price, "sell": sell or max(1, int(price * SELL_RATE)), "cls": cls or []}


ITEMS: dict[str, dict[str, Any]] = {
    # ── potions ────────────────────────────────────────────────────────
    "pot_hp_s": {"name": "Poção de Vida Pequena", "type": "potion", "icon": "potion_hp_s", "rarity": "comum",
                 "kind": "hp", "amount": 0.10, "price": 15, "sell": 3, "desc": "Recupera 10% da vida."},
    "pot_hp_l": {"name": "Poção de Vida Grande", "type": "potion", "icon": "potion_hp_l", "rarity": "incomum",
                 "kind": "hp", "amount": 0.20, "price": 45, "sell": 10, "desc": "Recupera 20% da vida."},
    "pot_mp_s": {"name": "Poção de Mana Pequena", "type": "potion", "icon": "potion_mp_s", "rarity": "comum",
                 "kind": "mp", "amount": 0.35, "price": 15, "sell": 3, "desc": "Recupera 35% da mana."},
    "pot_mp_l": {"name": "Poção de Mana Grande", "type": "potion", "icon": "potion_mp_l", "rarity": "incomum",
                 "kind": "mp", "amount": 0.70, "price": 45, "sell": 10, "desc": "Recupera 70% da mana."},

    # ── mining: the pickaxe, ores and the stones the forge makes from them ──
    "pickaxe": {"name": "Picareta", "type": "tool", "icon": "pickaxe", "rarity": "comum", "price": 150, "sell": 30,
                "desc": "Necessária para minerar os veios das Minas de Ferro Negro. Não se gasta."},
    "ore_iron": {"name": "Minério de Ferro", "type": "material", "icon": "ore_iron", "rarity": "comum", "sell": 4,
                 "desc": "Base das Pedras de Aprimoramento Menores."},
    "ore_silver": {"name": "Minério de Prata", "type": "material", "icon": "ore_silver", "rarity": "incomum", "sell": 12,
                   "desc": "Usado nas Pedras de Aprimoramento e de Proteção."},
    "ore_gold": {"name": "Minério de Ouro", "type": "material", "icon": "ore_gold", "rarity": "raro", "sell": 30,
                 "desc": "Usado nas pedras mais fortes da forja."},
    "ore_arcane": {"name": "Cristal Arcano", "type": "material", "icon": "ore_arcane", "rarity": "epico", "sell": 80,
                   "desc": "Raro, só nas profundezas da mina. Essencial para Refino e Proteção."},
    "stone_up_1": {"name": "Pedra de Aprimoramento Menor", "type": "material", "icon": "stone_up_1", "rarity": "incomum",
                   "sell": 15, "desc": "Aprimora um equipamento de +0 até +5."},
    "stone_up_2": {"name": "Pedra de Aprimoramento", "type": "material", "icon": "stone_up_2", "rarity": "raro",
                   "sell": 70, "desc": "Aprimora um equipamento de +5 até +10."},
    "stone_up_3": {"name": "Pedra de Aprimoramento Maior", "type": "material", "icon": "stone_up_3", "rarity": "epico",
                   "sell": 280, "desc": "Aprimora um equipamento de +10 até +15."},
    "stone_protect": {"name": "Pedra de Proteção", "type": "material", "icon": "stone_protect", "rarity": "epico",
                      "sell": 400, "desc": "Se o aprimoramento falhar, o item não perde nível."},
    "stone_refine": {"name": "Pedra de Refino", "type": "material", "icon": "stone_refine", "rarity": "lendario",
                     "sell": 520, "desc": "Dá ao equipamento um bônus extra (dano, crítico, evasão…)."},
    "stone_enchant": {"name": "Pedra de Encantamento", "type": "material", "icon": "stone_enchant", "rarity": "lendario",
                      "sell": 480, "desc": "Encanta uma arma com Fogo, Gelo, Raio ou Veneno (na forja)."},

    # ── materials (monster drops, only for selling) ────────────────────
    "wolf_pelt": {"name": "Pele de Lobo", "type": "material", "icon": "mat_pelt", "rarity": "comum", "sell": 6,
                  "desc": "Couro grosso. Os mercadores pagam bem."},
    "goblin_ear": {"name": "Orelha de Goblin", "type": "material", "icon": "mat_ear", "rarity": "comum", "sell": 10,
                   "desc": "Prova de caça aceita na vila."},
    "ancient_bark": {"name": "Casca Ancestral", "type": "material", "icon": "mat_bark", "rarity": "incomum", "sell": 25,
                     "desc": "Ainda pulsa com a corrupção do bosque."},
    "toxic_slime": {"name": "Lodo Tóxico", "type": "material", "icon": "mat_slime", "rarity": "incomum", "sell": 30,
                    "desc": "Borbulha sozinho. Alquimistas pagam bem."},
    "mutant_fang": {"name": "Presa de Mutante", "type": "material", "icon": "mat_fang", "rarity": "incomum", "sell": 45,
                    "desc": "Ainda brilha com a energia do brejo."},
    "frost_pelt": {"name": "Pele da Nevasca", "type": "material", "icon": "mat_frost_pelt", "rarity": "incomum", "sell": 55,
                   "desc": "Branca e gelada ao toque. Vale bom dinheiro."},
    "frozen_core": {"name": "Núcleo Congelado", "type": "material", "icon": "mat_frozen_core", "rarity": "raro", "sell": 75,
                    "desc": "O gelo mágico que movia um Sentinela."},
    "troll_tusk": {"name": "Presa de Troll", "type": "material", "icon": "mat_tusk", "rarity": "raro", "sell": 95,
                   "desc": "Pesada e dura como pedra."},
    "bone_shard": {"name": "Fragmento de Osso", "type": "material", "icon": "mat_bone", "rarity": "comum", "sell": 22,
                   "desc": "Osso amaldiçoado das Catacumbas."},

    # ── weapons ────────────────────────────────────────────────────────
    "sword_t1": _gear("Espada de Ferro", "weapon", "sword", "comum", 1, 1, {"str": 2, "atk": 4}, 60, cls=BM),
    "sword_t2": _gear("Espada de Aço Negro", "weapon", "sword", "incomum", 5, 2, {"str": 5, "atk": 9}, 260, cls=BM),
    "sword_t3": _gear("Montante Rúnico", "weapon", "sword", "raro", 9, 3, {"str": 9, "atk": 16, "crit": 0.03},
                      sell=180, cls=BM),
    "sword_t4": _gear("Lâmina de Vorthas", "weapon", "sword", "lendario", 12, 4,
                      {"str": 15, "atk": 28, "crit": 0.05, "crit_dmg": 0.10, "hp": 60}, sell=600, cls=BM),
    "staff_t1": _gear("Cajado de Carvalho", "weapon", "staff", "comum", 1, 1, {"int": 2, "mp": 15}, 60, cls=GS),
    "staff_t2": _gear("Cajado de Ônix", "weapon", "staff", "incomum", 5, 2, {"int": 5, "mp": 35}, 260, cls=GS),
    "staff_t3": _gear("Cetro Rúnico", "weapon", "staff", "raro", 9, 3, {"int": 9, "mp": 60, "crit": 0.03},
                      sell=180, cls=GS),
    "staff_t4": _gear("Cetro de Vorthas", "weapon", "staff", "lendario", 12, 4,
                      {"int": 15, "mp": 100, "crit": 0.05, "crit_dmg": 0.10, "hp": 40}, sell=600, cls=GS),
    "sword_t6": _gear("Lâmina do Rei Lich", "weapon", "sword", "lendario", 24, 6,
                      {"str": 24, "atk": 44, "crit": 0.06, "crit_dmg": 0.15, "hp": 110}, sell=1400, cls=BM),
    "staff_t6": _gear("Cetro de Valdrek", "weapon", "staff", "lendario", 24, 6,
                      {"int": 24, "mp": 180, "crit": 0.07, "crit_dmg": 0.15, "hp": 80}, sell=1400, cls=GS),
    "bow_t1": _gear("Arco Curto", "weapon", "bow", "comum", 1, 1, {"agi": 2, "atk": 3}, 60, cls=NR),
    "bow_t2": _gear("Arco Longo de Teixo", "weapon", "bow", "incomum", 5, 2, {"agi": 5, "atk": 7}, 260, cls=NR),
    "bow_t3": _gear("Arco Rúnico", "weapon", "bow", "raro", 9, 3, {"agi": 9, "atk": 12, "crit": 0.04},
                    sell=180, cls=NR),
    "bow_t4": _gear("Arco de Vorthas", "weapon", "bow", "lendario", 12, 4,
                    {"agi": 15, "atk": 22, "crit": 0.07, "crit_dmg": 0.15, "hp": 50}, sell=600, cls=NR),

    "bow_t6": _gear("Arco da Nevasca Eterna", "weapon", "bow", "lendario", 24, 6,
                    {"agi": 24, "atk": 36, "crit": 0.10, "crit_dmg": 0.25, "hp": 90}, sell=1400, cls=NR),

    # ── armor ──────────────────────────────────────────────────────────
    "plate_t1": _gear("Cota de Malha", "armor", "plate", "comum", 1, 1, {"vit": 2, "def": 6, "hp": 20}, 70, cls=BM),
    "plate_t2": _gear("Armadura de Placas", "armor", "plate", "incomum", 5, 2, {"vit": 4, "def": 14, "hp": 50}, 300,
                      cls=BM),
    "plate_t3": _gear("Armadura dos Mortos", "armor", "plate", "raro", 9, 3, {"vit": 7, "def": 24, "hp": 90},
                      sell=200, cls=BM),
    "robe_t1": _gear("Túnica de Aprendiz", "armor", "robe", "comum", 1, 1, {"int": 1, "def": 3, "mp": 20}, 70, cls=GS),
    "robe_t2": _gear("Manto Arcano", "armor", "robe", "incomum", 5, 2, {"int": 3, "def": 7, "mp": 50}, 300, cls=GS),
    "robe_t3": _gear("Manto do Lich", "armor", "robe", "raro", 9, 3, {"int": 6, "def": 12, "mp": 90, "hp": 30},
                     sell=200, cls=GS),
    "leather_t1": _gear("Couro Curtido", "armor", "leather", "comum", 1, 1, {"agi": 1, "def": 4, "hp": 10}, 70, cls=NR),
    "leather_t2": _gear("Gibão de Caçador", "armor", "leather", "incomum", 5, 2, {"agi": 3, "def": 9, "hp": 30}, 300,
                        cls=NR),
    "leather_t3": _gear("Couraça Sombria", "armor", "leather", "raro", 9, 3,
                        {"agi": 6, "def": 16, "hp": 50, "crit": 0.02}, sell=200, cls=NR),

    "plate_t5": _gear("Armadura do Inverno", "armor", "plate", "epico", 18, 5, {"vit": 11, "def": 36, "hp": 150},
                      sell=450, cls=BM),
    "robe_t5": _gear("Manto da Geada", "armor", "robe", "epico", 18, 5, {"int": 10, "def": 19, "mp": 150, "hp": 60},
                     sell=450, cls=GS),
    "leather_t5": _gear("Couraça da Nevasca", "armor", "leather", "epico", 18, 5,
                        {"agi": 10, "def": 25, "hp": 90, "crit": 0.03}, sell=450, cls=NR),

    # ── rings and necklaces (any class) ────────────────────────────────
    "ring_t1": _gear("Anel de Cobre", "ring", "ring", "comum", 1, 1, {"hp": 15}, 50),
    "amulet_t2": _gear("Amuleto da Vitalidade", "necklace", "amulet", "incomum", 4, 2, {"vit": 3, "hp": 30}, 220),
    "ring_t3": _gear("Anel do Caçador", "ring", "ring", "raro", 7, 2, {"agi": 2, "crit": 0.04}, sell=120),
    "ring_witch": _gear("Anel de Morgana", "ring", "ring", "epico", 15, 5,  # tier 5: only Morgana drops it
                        {"str": 5, "agi": 5, "int": 5, "crit": 0.05, "crit_dmg": 0.10, "hp": 60}, sell=400) | {"unique": True},
    "amulet_t5": _gear("Amuleto Gélido", "necklace", "amulet", "epico", 18, 5,
                       {"str": 3, "agi": 3, "int": 3, "vit": 4, "crit_dmg": 0.08, "hp": 80}, sell=420),
    "amulet_t3": _gear("Amuleto Sombrio", "necklace", "amulet", "raro", 9, 3, {"int": 3, "str": 3, "mp": 40, "hp": 40},
                       sell=160),
    "ring_shadow": _gear("Anel Sombrio", "ring", "ring", "raro", 9, 3, {"str": 2, "agi": 2, "int": 2, "crit": 0.03, "hp": 30},
                         sell=150),
    "ring_t5": _gear("Anel Gélido", "ring", "ring", "epico", 18, 5,
                     {"str": 2, "agi": 4, "int": 2, "crit": 0.04, "crit_dmg": 0.06, "hp": 50}, sell=400),
}

# What each mob can drop. "item" is a fixed item; "pool" picks a random gear piece of that tier,
# usually one the killer's class can use.
LOOT: dict[str, list[dict[str, Any]]] = {
    "wolf": [{"item": "wolf_pelt", "rate": 0.30}, {"item": "pot_hp_s", "rate": 0.06}],
    "goblin": [{"item": "goblin_ear", "rate": 0.30}, {"item": "pot_hp_s", "rate": 0.06}, {"item": "pot_mp_s", "rate": 0.06},
               {"pool": 1, "rate": 0.05}],
    "treant": [{"item": "ancient_bark", "rate": 0.25}, {"pool": 2, "rate": 0.07}, {"item": "ring_t3", "rate": 0.03}],
    "skeleton": [{"item": "bone_shard", "rate": 0.35}, {"item": "pot_hp_l", "rate": 0.05}, {"item": "pot_mp_l", "rate": 0.05},
                 {"pool": 3, "rate": 0.04}, {"item": "amulet_t3", "rate": 0.015}],
    "death_knight": [{"pool": 4, "rate": 1.0}, {"pool": 3, "rate": 0.5}, {"item": "pot_hp_l", "rate": 1.0}],
    "swamp_ghoul": [{"item": "toxic_slime", "rate": 0.30}, {"item": "pot_hp_l", "rate": 0.06}, {"item": "pot_mp_l", "rate": 0.05},
                    {"pool": 3, "rate": 0.03}],
    "bog_mutant": [{"item": "mutant_fang", "rate": 0.30}, {"pool": 3, "rate": 0.06}, {"item": "amulet_t3", "rate": 0.02},
                   {"item": "pot_hp_l", "rate": 0.08}],
    "swamp_witch": [{"pool": 4, "rate": 1.0}, {"pool": 3, "rate": 1.0}, {"item": "ring_witch", "rate": 0.5},
                    {"item": "pot_hp_l", "rate": 1.0}, {"item": "pot_mp_l", "rate": 1.0}],
    "frost_wolf": [{"item": "frost_pelt", "rate": 0.30}, {"item": "pot_hp_l", "rate": 0.07}, {"pool": 3, "rate": 0.03}],
    "frost_sentinel": [{"item": "frozen_core", "rate": 0.30}, {"item": "pot_mp_l", "rate": 0.07}, {"pool": 5, "rate": 0.015}],
    "ice_troll": [{"item": "troll_tusk", "rate": 0.30}, {"pool": 5, "rate": 0.03}, {"item": "ore_arcane", "rate": 0.05},
                  {"item": "pot_hp_l", "rate": 0.08}],
    "lich_king": [{"pool": 6, "rate": 1.0}, {"pool": 5, "rate": 1.0}, {"item": "stone_refine", "rate": 0.5},
                  {"item": "pot_hp_l", "rate": 1.0}, {"item": "pot_mp_l", "rate": 1.0}],
}

# ── Chapters IV-VII: one gear set per chapter, scaled from the tier-5/6 pieces by item level ──
# weapons are the bosses' signature drops (always the killer's class), armor and amulets drop anywhere
CHAPTER_SETS = [  # tier, item level, name suffix
    (7, 30, "das Cinzas"), (8, 50, "Carmesim"), (9, 70, "Espectral"), (10, 90, "do Vazio"),
]


def _scaled(stats: dict[str, float], f: float) -> dict[str, float]:
    return {k: v if k == "crit" else round(v * f ** 0.5, 3) if k == "crit_dmg" else int(round(v * f)) for k, v in stats.items()}


for _tier, _lvl, _suf in CHAPTER_SETS:
    fw, fa = _lvl / 24, _lvl / 18
    for _id, _name, _icon, _cls in (("sword", "Lâmina", "sword", BM), ("staff", "Cetro", "staff", GS), ("bow", "Arco", "bow", NR)):
        base = ITEMS[f"{_id}_t6"]["stats"]
        ITEMS[f"{_id}_t{_tier}"] = _gear(f"{_name} {_suf}", "weapon", _icon, "lendario", _lvl, _tier, _scaled(base, fw),
                                          sell=int(1400 * fw), cls=_cls) | {"unique": True}
    for _id, _name, _cls in (("plate", "Armadura", BM), ("robe", "Manto", GS), ("leather", "Couraça", NR)):
        base = ITEMS[f"{_id}_t5"]["stats"]
        ITEMS[f"{_id}_t{_tier}"] = _gear(f"{_name} {_suf}", "armor", _id, "epico", _lvl, _tier, _scaled(base, fa),
                                          sell=int(450 * fa), cls=_cls)
    ITEMS[f"amulet_t{_tier}"] = _gear(f"Amuleto {_suf}", "necklace", "amulet", "epico", _lvl, _tier,
                                      _scaled(ITEMS["amulet_t5"]["stats"], fa), sell=int(420 * fa))
    ITEMS[f"ring_t{_tier}"] = _gear(f"Anel {_suf}", "ring", "ring", "epico", _lvl, _tier,
                                    _scaled(ITEMS["ring_t5"]["stats"], fa), sell=int(400 * fa))

# ── legs and boots: one of each for every chest piece, a share of its stats ──
LEG_NAMES = {"plate": "Grevas", "robe": "Calças de Seda", "leather": "Perneiras"}
BOOT_NAMES = {"plate": "Sabatões", "robe": "Sandálias", "leather": "Botas"}
TIER_SUFFIX = {1: "de Recruta", 2: "de Veterano", 3: "dos Mortos", 5: "da Geada", 7: "das Cinzas", 8: "Carmesim",
               9: "Espectrais", 10: "do Vazio"}  # plural: every legs/boots name is a plural word
LEG_SHARE, BOOT_SHARE = 0.55, 0.4


def _share(stats: dict[str, float], f: float) -> dict[str, float]:
    return {k: round(v * f, 3) if k in FRACTION_STATS else max(1, int(round(v * f))) for k, v in stats.items()}


for _id, _it in list(ITEMS.items()):
    if _it.get("slot") != "armor":
        continue
    _kind, _tier = _it["icon"], _it["tier"]
    for _slot, _names, _f, _pf in (("legs", LEG_NAMES, LEG_SHARE, 0.7), ("boots", BOOT_NAMES, BOOT_SHARE, 0.5)):
        ITEMS[f"{_kind}_{_slot}_t{_tier}"] = _gear(
            f"{_names[_kind]} {TIER_SUFFIX[_tier]}", _slot, f"{_slot}_{_kind}", _it["rarity"], _it["lvl"], _tier,
            _share(_it["stats"], _f), int(_it["price"] * _pf), max(1, int(_it["sell"] * _pf)), _it["cls"])

CHAPTER_MATERIALS = {  # monster → (item id, name, icon, description)
    "ash_hound": ("ash_pelt", "Pele Chamuscada", "mat_pelt", "Ainda quente das terras de cinza."),
    "magma_brute": ("magma_core", "Núcleo de Magma", "mat_ember", "Pedra que nunca esfria."),
    "cinder_cultist": ("cinder_rune", "Runa de Cinzas", "mat_ember", "Usada nos rituais do culto."),
    "blood_ghoul": ("clotted_blood", "Sangue Coagulado", "mat_blood", "Escuro e pesado."),
    "crimson_knight": ("crimson_crest", "Brasão Carmesim", "mat_blood", "O símbolo da rainha de sangue."),
    "flesh_horror": ("horror_fang", "Presa de Horror", "mat_fang", "Enorme e afiada."),
    "phantom_soldier": ("ectoplasm", "Ectoplasma", "mat_ecto", "Brilha fraco no escuro."),
    "necromancer": ("torn_grimoire", "Grimório Rasgado", "mat_ecto", "Páginas de magia proibida."),
    "spectral_colossus": ("spectral_shard", "Fragmento Espectral", "mat_ecto", "Um pedaço de alma presa."),
    "void_stalker": ("void_claw", "Garra do Vazio", "mat_void", "Corta até a luz."),
    "void_titan": ("void_core", "Núcleo do Vazio", "mat_void", "Pesa mais do que parece."),
    "void_witch": ("void_essence", "Essência do Vazio", "mat_void", "Sussurra quando ninguém olha."),
}
CHAPTER_OF = {  # monster → its chapter's gear tier and the forge stone it can drop
    **{m: (7, "stone_up_2") for m in ("ash_hound", "magma_brute", "cinder_cultist", "ash_dragon")},
    **{m: (8, "stone_up_2") for m in ("blood_ghoul", "crimson_knight", "flesh_horror", "blood_queen")},
    **{m: (9, "stone_up_3") for m in ("phantom_soldier", "necromancer", "spectral_colossus", "ghost_king")},
    **{m: (10, "stone_up_3") for m in ("void_stalker", "void_titan", "void_witch", "void_dragon")},
}
for _mob, (_iid, _nm, _ic, _desc) in CHAPTER_MATERIALS.items():
    _tier = CHAPTER_OF[_mob][0]
    ITEMS[_iid] = {"name": _nm, "type": "material", "icon": _ic, "rarity": "raro", "sell": 60 * (_tier - 5), "desc": _desc}
for _mob, (_tier, _stone) in CHAPTER_OF.items():
    if _mob in CHAPTER_MATERIALS:
        LOOT[_mob] = [{"item": CHAPTER_MATERIALS[_mob][0], "rate": 0.30}, {"item": "pot_hp_l", "rate": 0.08},
                      {"item": "pot_mp_l", "rate": 0.06}, {"pool": _tier, "rate": 0.02}, {"item": _stone, "rate": 0.03},
                      {"item": "ore_arcane", "rate": 0.03}]
    else:  # chapter boss
        LOOT[_mob] = [{"weapon": _tier, "rate": 1.0}, {"pool": _tier, "rate": 1.0}, {"item": "stone_refine", "rate": 0.6},
                      {"item": "stone_protect", "rate": 0.3}, {"item": "pot_hp_l", "rate": 1.0}, {"item": "pot_mp_l", "rate": 1.0}]

# Gear from the sets was filling bags before level 30: every gear drop is 10% of the rates written above, for monsters
# and bosses alike. A boss's own prize keeps its rate: the legendary weapon of the killer's class (pools of tiers 4 and
# 6 for Vorthas and Valdrek, the "weapon" entry for the chapter IV-VII bosses) and Morgana's ring.
GEAR_DROP_MULT = 0.1
SIGNATURE = {"ring_witch"}
LEGENDARY_POOLS = {4, 6}
for _mob, _entries in LOOT.items():
    for _e in _entries:
        if _e.get("pool") in LEGENDARY_POOLS:
            continue
        if "pool" in _e or ("item" in _e and ITEMS[_e["item"]]["type"] == "gear" and _e["item"] not in SIGNATURE):
            _e["rate"] = round(_e["rate"] * GEAR_DROP_MULT, 4)

SHOPS: dict[str, list[str]] = {
    "healer": ["pot_hp_s", "pot_hp_l", "pot_mp_s", "pot_mp_l"],
    "mine": ["pickaxe", "pot_hp_s", "pot_mp_s"],
    "forge": [],  # the smith buys loot but sells nothing; he crafts (see forge.py)
    "market": [],  # the player market at Dorian (see market.py)
    "merchant": ["pickaxe", "pot_hp_s", "pot_mp_s", "sword_t1", "staff_t1", "bow_t1", "plate_t1", "robe_t1", "leather_t1",
                 "plate_legs_t1", "robe_legs_t1", "leather_legs_t1", "plate_boots_t1", "robe_boots_t1", "leather_boots_t1",
                 "ring_t1", "sword_t2", "staff_t2", "bow_t2", "plate_t2", "robe_t2", "leather_t2", "plate_legs_t2",
                 "robe_legs_t2", "leather_legs_t2", "plate_boots_t2", "robe_boots_t2", "leather_boots_t2", "amulet_t2"],
}

STARTER_WEAPON = {"blade_master": "sword_t1", "grand_sorcerer": "staff_t1", "night_ranger": "bow_t1"}

# loot names saved by the old system → item ids
LEGACY_LOOT = {"Pele de Lobo": "wolf_pelt", "Orelha de Goblin": "goblin_ear", "Casca Ancestral": "ancient_bark",
               "Fragmento de Osso": "bone_shard", "Lâmina de Vorthas": "sword_t4"}


def stackable(item_id: str) -> bool:
    return ITEMS[item_id]["type"] != "gear"


def usable_by(item_id: str, cls: str) -> bool:
    allowed = ITEMS[item_id].get("cls") or []
    return not allowed or cls in allowed


def starter_kit(cls: str) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    return [{"id": "pot_hp_s", "qty": 5}, {"id": "pot_mp_s", "qty": 3}], {"weapon": {"id": STARTER_WEAPON[cls]}}


def migrate_legacy(cls: str, loot: dict[str, int]) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """First load after the inventory update: starting kit + old collected loot turned into items."""
    bag, gear = starter_kit(cls)
    for name, n in (loot or {}).items():
        item = LEGACY_LOOT.get(name)
        if item:
            add_item(bag, item, int(n))
    return bag, gear


def pool_item(tier: int, cls: str) -> str | None:
    """A random gear piece of `tier`; usually (boss weapon tiers 4 and 6: always) one the class can use.
    Unique pieces (a boss's signature item) never come from pools."""
    pool = [k for k, v in ITEMS.items() if v["type"] == "gear" and v["tier"] == tier and not v.get("unique")]
    own = [k for k in pool if usable_by(k, cls)]
    pick = own if own and (tier in (4, 6) or random.random() < 0.7) else pool
    return random.choice(pick) if pick else None


# forge stones from any monster: the upgrade stone of its level band, and rarely the special stones; bosses always
# give an upgrade stone and often a special one
STONE_DROP = 0.06
SPECIAL_DROPS = (("stone_protect", 0.005, 0.25), ("stone_enchant", 0.004, 0.2), ("stone_refine", 0.003, 0.15))


def stone_of_level(level: int) -> str:
    return "stone_up_1" if level < 15 else "stone_up_2" if level < 35 else "stone_up_3"


def roll_stones(level: int, boss: bool) -> list[str]:
    out = [stone_of_level(level)] if boss or random.random() < STONE_DROP else []
    for stone, rate, boss_rate in SPECIAL_DROPS:
        if random.random() < (boss_rate if boss else rate):
            out.append(stone)
    return out


def roll_loot(mob_def: str, cls: str, level: int = 1, boss: bool = False) -> list[str]:
    out: list[str] = roll_stones(level, boss)
    for entry in LOOT.get(mob_def, []):
        if random.random() > entry["rate"]:
            continue
        if "item" in entry:
            item = entry["item"]
        elif "weapon" in entry:  # a boss's signature weapon, for the killer's class
            item = next((k for k, v in ITEMS.items() if v["type"] == "gear" and v["slot"] == "weapon"
                         and v["tier"] == entry["weapon"] and usable_by(k, cls)), None)
        else:
            item = pool_item(entry["pool"], cls)
        if item:
            out.append(item)
    return out


def piece(v: Any) -> dict[str, Any]:
    """A gear piece as {"id", "plus", "ref"} (older saves stored just the id)."""
    if isinstance(v, str):
        return {"id": v, "plus": 0, "ref": {}}
    p = {"id": v["id"], "plus": int(v.get("plus", 0)), "ref": dict(v.get("ref") or {})}
    if v.get("ench"):  # weapon enchantment element (forge.ENCHANTS)
        p["ench"] = v["ench"]
    return p


def item_id(v: Any) -> str:
    return v if isinstance(v, str) else v["id"]


def upgrade_mult(plus: int) -> float:
    return 1 + UPGRADE_STEP * plus


def piece_stats(v: Any) -> dict[str, float]:
    """Flat stats of a piece after its upgrade level."""
    p = piece(v)
    m = upgrade_mult(p["plus"])
    return {k: (round(val * m, 4) if k in FRACTION_STATS else round(val * m)) for k, val in ITEMS[p["id"]].get("stats", {}).items()}


# How much each stat point is worth when comparing two pieces (auto-equip and the "better" mark in the bag).
SCORE_WEIGHTS = {"str": 3, "agi": 3, "int": 3, "vit": 3, "atk": 2, "def": 1.5, "hp": 0.25, "mp": 0.2,
                 "crit": 300, "crit_dmg": 200}
REF_WEIGHT = 300  # refinement lines are percents (atk_pct 0.04 → 12 points)


def piece_score(v: Any) -> float:
    """One number for how good a piece is: its upgraded stats and refinement, weighted."""
    p = piece(v)
    return (sum(SCORE_WEIGHTS.get(k, 1) * val for k, val in piece_stats(p).items())
            + sum(REF_WEIGHT * val for val in p["ref"].values()))


def gear_bonus(gear: dict[str, Any], key: str) -> float:
    """Flat stat from equipped gear (upgrade level included)."""
    return sum(piece_stats(v).get(key, 0) for v in gear.values() if item_id(v) in ITEMS)


def gear_mod(gear: dict[str, Any], key: str) -> float:
    """Percent-style bonus (atk_pct, dodge, …) from the refinement lines of equipped gear."""
    return sum(piece(v)["ref"].get(key, 0.0) for v in gear.values() if item_id(v) in ITEMS)


# how much each potion heals, as first written above (the admin panel can change it while the game runs)
POTION_DEFAULTS: dict[str, float] = {k: v["amount"] for k, v in ITEMS.items() if v["type"] == "potion"}
POTION_MIN, POTION_MAX = 0.01, 1.0


def set_potion_amount(item_id: str, amount: float) -> None:
    """Changes how much a potion heals (share of the max life/mana) and its description."""
    it = ITEMS[item_id]
    it["amount"] = max(POTION_MIN, min(POTION_MAX, amount))
    pct = round(it["amount"] * 100)
    it["desc"] = f"Recupera {pct}% da {'vida' if it['kind'] == 'hp' else 'mana'}."


def sell_price(entry: dict[str, Any]) -> int:
    """Upgraded gear is worth a little more to the merchant: +5% of its value per +1, but never more than half of the
    gold fees paid to reach that level (100 × N for each +N). The forge must stay a gold sink: upgrading something
    only to sell it is always a loss."""
    base = ITEMS[entry["id"]]["sell"]
    plus = max(0, int(entry.get("plus", 0)))
    return base + min(int(base * 0.05 * plus), 25 * plus * (plus + 1))


def free_slots(bag: list[dict[str, Any]]) -> int:
    return getattr(bag, "cap", BAG_SLOTS) - len(bag)


def can_add(bag: list[dict[str, Any]], item_id: str, qty: int = 1) -> bool:
    if stackable(item_id):
        room = sum(STACK_MAX - e["qty"] for e in bag if e["id"] == item_id)
        need_slots = max(0, -(-(qty - room) // STACK_MAX))
        return need_slots <= free_slots(bag)
    return qty <= free_slots(bag)


def add_item(bag: list[dict[str, Any]], item_id: str, qty: int = 1) -> int:
    """Adds as much as fits; returns how many were added."""
    added = 0
    if stackable(item_id):
        for e in bag:
            if e["id"] == item_id and e["qty"] < STACK_MAX and qty > 0:
                n = min(qty, STACK_MAX - e["qty"])
                e["qty"] += n
                qty -= n
                added += n
        while qty > 0 and free_slots(bag) > 0:
            n = min(qty, STACK_MAX)
            bag.append({"id": item_id, "qty": n})
            qty -= n
            added += n
    else:
        while qty > 0 and free_slots(bag) > 0:
            bag.append({"id": item_id, "qty": 1})
            qty -= 1
            added += 1
    return added


def take_at(bag: list[dict[str, Any]], index: int, item_id: str, qty: int = 1) -> dict[str, Any] | None:
    """Removes qty of the item at bag[index], checking it is still the item the client saw.
    Returns what was removed (with a gear piece's plus/ref), or None."""
    if not (0 <= index < len(bag)) or bag[index]["id"] != item_id or qty < 1 or bag[index]["qty"] < qty:
        return None
    taken = {**bag[index], "qty": qty}
    bag[index]["qty"] -= qty
    if bag[index]["qty"] <= 0:
        bag.pop(index)
    return taken


def add_piece(bag: list[dict[str, Any]], v: Any, index: int | None = None) -> bool:
    """Puts one gear piece (keeping its plus/ref) into the bag, optionally at a position."""
    if free_slots(bag) < 1:
        return False
    p = piece(v)
    entry = {"id": p["id"], "qty": 1}
    if p["plus"]:
        entry["plus"] = p["plus"]
    if p["ref"]:
        entry["ref"] = p["ref"]
    if p.get("ench"):
        entry["ench"] = p["ench"]
    if index is None:
        bag.append(entry)
    else:
        bag.insert(max(0, min(index, len(bag))), entry)
    return True


def strip(v: Any) -> dict[str, Any]:
    """The gear-slot form of a piece: {"id", "plus", "ref"} without qty."""
    p = piece(v)
    out = {"id": p["id"], "plus": p["plus"], "ref": p["ref"]}
    if p.get("ench"):
        out["ench"] = p["ench"]
    return out


def count(bag: list[dict[str, Any]], item_id: str) -> int:
    return sum(e["qty"] for e in bag if e["id"] == item_id)


def clean(bag: Any, gear: Any) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """Drops unknown ids from saved data (an item removed from the catalog never crashes a load)
    and brings old saves (gear stored as plain ids) to the piece format."""
    b: list[dict[str, Any]] = []
    for e in bag or []:
        if not isinstance(e, dict) or e.get("id") not in ITEMS:
            continue
        entry = {"id": e["id"], "qty": max(1, int(e.get("qty", 1)))}
        if ITEMS[e["id"]]["type"] == "gear":
            entry["qty"] = 1
            if int(e.get("plus", 0)):
                entry["plus"] = max(0, min(15, int(e["plus"])))
            if e.get("ref"):
                entry["ref"] = dict(e["ref"])
            if e.get("ench"):
                entry["ench"] = e["ench"]
        b.append(entry)
    g: dict[str, dict[str, Any]] = {}
    for s, v in (gear or {}).items():
        if not v or item_id(v) not in ITEMS:
            continue
        slot = ITEMS[item_id(v)].get("slot")
        # the old single "accessory" slot: its ring or amulet moves to the ring or necklace slot
        if slot in GEAR_SLOTS and (slot == s or s == "accessory") and slot not in g:
            g[slot] = strip(v)
    return b[:BAG_MAX], g  # spaces beyond the bag size (an expired VIP) keep their items until they are used


def catalog() -> dict[str, Any]:
    import forge
    return {"items": ITEMS, "rarity": RARITY, "bag_slots": BAG_SLOTS, "upgrade_step": UPGRADE_STEP, "forge": forge.info(),
            "score_weights": SCORE_WEIGHTS, "ref_weight": REF_WEIGHT}
