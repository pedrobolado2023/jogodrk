"""
Skill and passive definitions — the single source of truth.
The client downloads these from GET /meta, so names, numbers and visuals live only here.

Active skill kinds:
  melee / projectile  one target within range
  aoe_self            everything within `radius` of the caster
  aoe_target          everything within `radius` of the target
  line                everything along a line from caster toward the target, up to `range`
  chain               the target, then up to `chain` more enemies near the last one hit
  dash                caster moves next to the target and hits it
  blink               caster jumps `blink` tiles away from the target (or backward)
  buff                timed self buff
  heal                restores a share of max HP
"""

from __future__ import annotations

from typing import Any

ACTIVE_LEVELS = [1, 1, 2, 3, 4, 5, 6, 8, 10, 12]
PASSIVE_LEVELS = [1, 3, 5, 8, 11]


def A(cls: str, slot: int, sid: str, name: str, desc: str, icon: tuple[str, str], mp: int, cd: float,
      kind: str, **kw: Any) -> dict[str, Any]:
    return {
        "id": sid, "cls": cls, "name": name, "desc": desc, "icon": {"g": icon[0], "c": icon[1]},
        "lvl": ACTIVE_LEVELS[slot], "mp": mp, "cd": int(cd * 1000), "kind": kind,
        "range": kw.pop("range", 2.2), "radius": kw.pop("radius", 0.0),
        "power": kw.pop("power", 0), "scale": kw.pop("scale", 0.0), "hits": kw.pop("hits", 1),
        **kw,
    }


def P(cls: str, slot: int, sid: str, name: str, desc: str, icon: tuple[str, str], fx: dict[str, float]) -> dict[str, Any]:
    return {"id": sid, "cls": cls, "name": name, "desc": desc, "icon": {"g": icon[0], "c": icon[1]},
            "lvl": PASSIVE_LEVELS[slot], "passive": True, "fx": fx}


BM, GS, NR = "blade_master", "grand_sorcerer", "night_ranger"

ACTIVES: list[dict[str, Any]] = [
    # ── Mestre da Lâmina (força, tudo corpo a corpo) ────────────────────
    A(BM, 0, "bm_slash", "Golpe Cortante", "Dois cortes rápidos e precisos no alvo.", ("slash", "#e8e2d6"),
      4, 1.0, "melee", power=12, scale=1.2, stat="str",
      vfx={"hit": "melee/double-slash", "hs": 0.75, "impact": "impacts/hit-flash", "is": 0.5}),
    A(BM, 1, "bm_twisting_slash", "Corte Giratório", "Gira a lâmina e fere todos ao redor.", ("spiral", "#ffc857"),
      8, 3.0, "aoe_self", radius=3.0, power=15, scale=1.4, stat="str",
      vfx={"area": "melee/spin-slash", "as": 1.05, "area2": "melee/spear-sweep", "as2": 0.9}),
    A(BM, 2, "bm_charge", "Investida", "Avança até o alvo num golpe de lança e o deixa atordoado.", ("bolt", "#ffd23c"),
      12, 9.0, "dash", range=8.0, power=22, scale=1.3, stat="str", cc={"t": "stun", "d": 1.5},
      vfx={"hit": "melee/thrust", "hs": 0.9, "impact": "impacts/heavy-landing", "is": 0.8, "shake": 0.006}),
    A(BM, 3, "bm_rend", "Fenda Sangrenta", "Um corte em foice que sangra por 5 segundos.", ("drop", "#d42a30"),
      10, 6.0, "melee", power=10, scale=1.0, stat="str", dot={"ticks": 5, "every": 1.0, "pct": 0.4, "kind": "bleed"},
      vfx={"hit": "melee/scythe-reap", "hs": 0.75, "pal": "blood", "status": "status/bleeding"}),
    A(BM, 4, "bm_war_cry", "Grito de Guerra", "Um grito que faz tremer o chão: ataque +25% por 12 segundos.", ("crown", "#ff8a2a"),
      15, 25.0, "buff", buff={"atk_pct": 0.25, "dur": 12},
      vfx={"cast": "lightning/thunderclap", "cs": 0.8, "pal": "ember", "buff": "status/rage", "bs": 0.9}),
    A(BM, 5, "bm_ground_slam", "Terremoto", "Golpeia o chão com o martelo, ferindo e deixando os inimigos lentos.", ("fist", "#b88a52"),
      18, 10.0, "aoe_self", radius=3.5, power=30, scale=1.6, stat="str", cc={"t": "slow", "d": 2.5},
      vfx={"cast": "melee/hammer-smash", "cs": 0.9, "area": "nature/quake", "as": 1.0, "area2": "impacts/ground-slam", "as2": 1.0,
           "shake": 0.01}),
    A(BM, 6, "bm_blood_aura", "Aura de Sangue", "Rouba 12% do dano como vida e aumenta a vida máxima em 15%.", ("heart", "#a01824"),
      20, 30.0, "buff", buff={"lifesteal": 0.12, "max_hp_pct": 0.15, "dur": 20},
      vfx={"cast": "shadow/life-steal", "cs": 0.8, "buff": "holy/blessing", "pal": "blood", "bs": 0.85}),
    A(BM, 7, "bm_phantom_blades", "Golpe Esmagador", "Esmaga o alvo com tanta força que atinge todos em volta dele.", ("fist", "#9a48ec"),
      20, 8.0, "aoe_target", range=2.4, radius=2.5, power=34, scale=1.7, stat="str",
      vfx={"area": "melee/hammer-smash", "as": 0.95, "area2": "explosions/dirt-explosion", "as2": 0.8, "shake": 0.009}),
    A(BM, 8, "bm_execute", "Fúria Implacável", "Golpe brutal; causa o dobro de dano em alvos com pouca vida.", ("skull", "#ff5a50"),
      25, 12.0, "melee", power=45, scale=2.2, stat="str", execute=0.3,
      vfx={"hit": "melee/heavy-cleave", "hs": 0.95, "impact": "impacts/crit-hit", "is": 0.85, "shake": 0.01}),
    A(BM, 9, "bm_blade_storm", "Tempestade de Aço", "Gira como um furacão de lâminas, golpeando 4 vezes ao redor.", ("storm", "#d0d8e6"),
      35, 20.0, "aoe_self", radius=4.0, power=18, scale=1.0, stat="str", hits=4,
      vfx={"area": "melee/spin-slash", "as": 1.3, "repeat": 4, "area2": "melee/dagger-flurry", "as2": 1.0}),

    # ── Grande Feiticeiro (inteligência, tudo à distância) ──────────────
    A(GS, 0, "gs_fireball", "Bola de Fogo", "Arremessa uma bola de fogo que explode no alvo.", ("flame", "#ff8a2a"),
      6, 1.2, "projectile", range=10.0, power=14, scale=1.4, stat="int",
      vfx={"proj": "fire/fireball", "ps": 0.55, "hit": "explosions/small-explosion", "hs": 0.5, "impact": "impacts/hit-flash", "is": 0.5}),
    A(GS, 1, "gs_ice_lance", "Lança de Gelo", "Uma lança de gelo que estilhaça no alvo e o deixa lento.", ("shard", "#9bdcff"),
      8, 2.5, "projectile", range=10.0, power=18, scale=1.5, stat="int", cc={"t": "slow", "d": 2.0},
      vfx={"proj": "ice/ice-lance", "ps": 0.6, "hit": "ice/ice-shatter", "hs": 0.6, "pal": "ice"}),
    A(GS, 2, "gs_frost_nova", "Nova Congelante", "Congela todos numa área à distância por 2 segundos.", ("snow", "#d8f4ff"),
      18, 12.0, "aoe_target", range=10.0, radius=4.0, power=16, scale=1.0, stat="int", cc={"t": "freeze", "d": 2.0},
      vfx={"cast": "arcane/spell-charge", "cs": 0.6, "area": "ice/frost-nova", "as": 1.05, "area2": "ice/ice-spikes", "as2": 0.9}),
    A(GS, 3, "gs_mana_shield", "Escudo de Mana", "Absorve 35% do dano recebido usando sua mana.", ("shield", "#58b4ec"),
      15, 25.0, "buff", buff={"mana_shield": 0.35, "dur": 15},
      vfx={"cast": "arcane/magic-circle-cast", "cs": 0.8, "buff": "holy/divine-shield", "pal": "ice", "bs": 0.95}),
    A(GS, 4, "gs_meteor_strike", "Meteoro", "Invoca um meteoro que explode e queima a área.", ("comet", "#f2561d"),
      25, 8.0, "aoe_target", range=10.0, radius=3.0, power=40, scale=2.0, stat="int",
      dot={"ticks": 4, "every": 1.5, "pct": 0.3, "kind": "burn"},
      vfx={"cast": "arcane/spell-charge", "cs": 0.7, "area": "fire/meteor", "as": 0.85, "area2": "explosions/dirt-explosion", "as2": 0.9,
           "shake": 0.01, "delay": 0.55}),
    A(GS, 5, "gs_chain_lightning", "Raio em Cadeia", "Um raio que salta entre os inimigos próximos.", ("bolt", "#7cc8ff"),
      20, 7.0, "chain", range=9.0, chain=3, power=26, scale=1.6, stat="int",
      vfx={"cast": "lightning/charge-up", "cs": 0.7, "hit": "lightning/zap-hit", "hs": 0.7, "beam": "#9fd8ff"}),
    A(GS, 6, "gs_blink", "Teletransporte", "Some e reaparece alguns passos atrás.", ("swirl", "#c684ff"),
      10, 10.0, "blink", blink=5.0,
      vfx={"cast": "arcane/blink-out", "cs": 0.75, "after": "arcane/blink-in", "pal": "arcane"}),
    A(GS, 7, "gs_arcane_missiles", "Mísseis Arcanos", "Dispara 3 mísseis mágicos que explodem em energia.", ("orbs", "#c684ff"),
      22, 6.0, "projectile", range=10.0, power=14, scale=0.9, stat="int", hits=3,
      vfx={"cast": "arcane/rune-circle", "cs": 0.6, "proj": "projectiles/magic-missile", "ps": 0.55, "repeat": 3,
           "hit": "arcane/mana-burst", "hs": 0.5, "pal": "arcane"}),
    A(GS, 8, "gs_fire_ring", "Tornado de Fogo", "Um tornado de chamas surge na área do alvo e queima todos.", ("ring", "#ffae35"),
      30, 14.0, "aoe_target", range=10.0, radius=4.5, power=35, scale=1.8, stat="int",
      dot={"ticks": 3, "every": 1.0, "pct": 0.25, "kind": "burn"},
      vfx={"area": "fire/fire-tornado", "as": 1.1, "area2": "fire/fire-ring", "as2": 1.0}),
    A(GS, 9, "gs_black_hole", "Buraco Negro", "Abre um vórtice que esmaga e atordoa os inimigos.", ("void", "#5e3290"),
      40, 25.0, "aoe_target", range=9.0, radius=4.0, power=55, scale=2.4, stat="int", cc={"t": "stun", "d": 2.0},
      vfx={"cast": "arcane/magic-circle-cast", "cs": 0.8, "area": "shadow/black-hole", "as": 0.9,
           "area2": "shadow/grasping-hands", "as2": 0.9, "shake": 0.008}),

    # ── Patrulheiro Noturno (agilidade, arco, tudo à distância) ─────────
    A(NR, 0, "nr_quick_shot", "Tiro Rápido", "Uma flecha rápida no alvo.", ("arrow", "#e8e2d6"),
      3, 0.8, "projectile", range=10.0, power=10, scale=1.2, stat="agi",
      vfx={"proj": "projectiles/arrow", "ps": 0.55, "hit": "impacts/hit-spark", "hs": 0.45, "impact": "impacts/hit-flash", "is": 0.4}),
    A(NR, 1, "nr_piercing_arrow", "Flecha Perfurante", "Atravessa todos os inimigos em linha reta.", ("pierce", "#7cc048"),
      10, 3.0, "line", range=12.0, width=1.2, power=20, scale=1.8, stat="agi",
      vfx={"cast": "arcane/spell-charge", "cs": 0.5, "proj": "projectiles/arrow", "ps": 0.65, "hit": "impacts/ricochet", "hs": 0.55,
           "pal": "leaf"}),
    A(NR, 2, "nr_shadow_step", "Passo Sombrio", "Salta para trás e deixa uma nuvem venenosa.", ("moon", "#a970e0"),
      12, 9.0, "blink", blink=4.0, radius=2.0, power=6, scale=0.5, stat="agi",
      dot={"ticks": 3, "every": 1.0, "pct": 1.0, "kind": "poison"},
      vfx={"cast": "arcane/blink-out", "cs": 0.75, "after": "arcane/blink-in", "pal": "shadow", "area": "nature/poison-cloud", "as": 0.7}),
    A(NR, 3, "nr_poison_arrow", "Flecha Envenenada", "Uma flecha que explode em ácido e envenena por 5 segundos.", ("venom", "#6cb82a"),
      10, 5.0, "projectile", range=10.0, power=12, scale=1.0, stat="agi",
      dot={"ticks": 5, "every": 1.0, "pct": 0.5, "kind": "poison"},
      vfx={"proj": "projectiles/arrow", "ps": 0.55, "pal": "poison", "hit": "nature/acid-splash", "hs": 0.6, "status": "status/poisoned"}),
    A(NR, 4, "nr_eagle_eye", "Olho de Águia", "Aumenta a chance de crítico em 20% por 20 segundos.", ("eye", "#ffd84a"),
      15, 25.0, "buff", buff={"crit": 0.20, "range": 2.0, "dur": 20},
      vfx={"cast": "arcane/rune-circle", "cs": 0.7, "buff": "holy/blessing", "pal": "gold", "bs": 0.85}),
    A(NR, 5, "nr_arrow_rain", "Chuva de Flechas", "Uma chuva de flechas cai sobre a área.", ("rain", "#dcc8a2"),
      22, 10.0, "aoe_target", range=10.0, radius=3.5, power=26, scale=1.5, stat="agi",
      vfx={"area": "ice/icicle-fall", "as": 1.0, "pal": "gold", "area2": "arcane/star-fall", "as2": 0.8, "delay": 0.3}),
    A(NR, 6, "nr_thorn_trap", "Armadilha de Espinhos", "Espinhos brotam do chão e prendem os inimigos no lugar.", ("thorn", "#4f9a3a"),
      15, 12.0, "aoe_target", range=9.0, radius=2.5, power=18, scale=1.0, stat="agi", cc={"t": "stun", "d": 2.5},
      vfx={"area": "nature/thorns", "as": 0.9, "area2": "nature/root-snare", "as2": 0.8}),
    A(NR, 7, "nr_double_shot", "Tiro Duplo", "Duas flechas certeiras em sequência.", ("arrows", "#e8e2d6"),
      16, 5.0, "projectile", range=10.0, power=22, scale=1.4, stat="agi", hits=2,
      vfx={"proj": "projectiles/arrow", "ps": 0.6, "repeat": 2, "hit": "impacts/hit-spark", "hs": 0.5, "impact": "impacts/hit-flash",
           "is": 0.45}),
    A(NR, 8, "nr_deadly_shot", "Disparo Mortal", "Um tiro carregado que sempre é crítico.", ("target", "#ff5a50"),
      28, 14.0, "projectile", range=12.0, power=55, scale=2.6, stat="agi", crit=True,
      vfx={"cast": "lightning/charge-up", "cs": 0.7, "pal": "gold", "proj": "projectiles/arrow", "ps": 0.8, "hit": "impacts/crit-hit",
           "hs": 0.8, "impact": "explosions/implosion", "is": 0.6, "shake": 0.008}),
    A(NR, 9, "nr_night_storm", "Tempestade Noturna", "Sombras rodopiam na área do alvo, ferindo 3 vezes.", ("storm", "#8048b8"),
      38, 22.0, "aoe_target", range=11.0, radius=5.0, power=20, scale=1.1, stat="agi", hits=3,
      vfx={"area": "shadow/shadow-tendrils", "as": 1.0, "repeat": 3, "area2": "shadow/eclipse", "as2": 0.9}),
]

PASSIVES: list[dict[str, Any]] = [
    P(BM, 0, "bm_iron_skin", "Pele de Ferro", "Defesa +20%.", ("shield", "#9aa6ba"), {"def_pct": 0.20}),
    P(BM, 1, "bm_bloodlust", "Sede de Sangue", "Todo dano causado cura 4% como vida.", ("drop", "#d42a30"), {"lifesteal": 0.04}),
    P(BM, 2, "bm_weapon_mastery", "Mestre de Armas", "Ataque +15%.", ("slash", "#ffc857"), {"atk_pct": 0.15}),
    P(BM, 3, "bm_vigor", "Vigor do Guerreiro", "Vida máxima +20% e regeneração de vida maior.", ("heart", "#ff5a50"),
      {"max_hp_pct": 0.20, "hp_regen_pct": 0.5}),
    P(BM, 4, "bm_precision", "Precisão Letal", "Crítico +10% e dano crítico +25%.", ("target", "#ffd23c"),
      {"crit": 0.10, "crit_dmg": 0.25}),

    P(GS, 0, "gs_arcane_mind", "Mente Arcana", "Mana máxima +25%.", ("orbs", "#9a48ec"), {"max_mp_pct": 0.25}),
    P(GS, 1, "gs_mana_flow", "Fluxo de Mana", "Regeneração de mana dobrada.", ("swirl", "#58b4ec"), {"mp_regen_pct": 1.0}),
    P(GS, 2, "gs_elemental_power", "Poder Elemental", "Dano das magias +15%.", ("flame", "#ff8a2a"), {"atk_pct": 0.15}),
    P(GS, 3, "gs_focus", "Concentração", "Tempo de recarga das skills -15%.", ("eye", "#c684ff"), {"cdr": 0.15}),
    P(GS, 4, "gs_ancient_wisdom", "Sabedoria Ancestral", "Crítico +8% e custo de mana -15%.", ("crown", "#ffe066"),
      {"crit": 0.08, "mp_cost": -0.15}),

    P(NR, 0, "nr_cat_reflexes", "Reflexos Felinos", "10% de chance de desviar de ataques.", ("moon", "#a970e0"), {"dodge": 0.10}),
    P(NR, 1, "nr_night_eyes", "Olhos da Noite", "Crítico +8%.", ("eye", "#d8ffcf"), {"crit": 0.08}),
    P(NR, 2, "nr_swift_feet", "Pés Ligeiros", "Velocidade de movimento +15%.", ("wing", "#b8c8e8"), {"speed": 0.15}),
    P(NR, 3, "nr_toxins", "Toxinas", "Dano de veneno e sangramento +30%.", ("venom", "#a8e04a"), {"dot_pct": 0.30}),
    P(NR, 4, "nr_born_hunter", "Caçador Nato", "Ataque +20%.", ("arrow", "#dcb47c"), {"atk_pct": 0.20}),
]

# Wider hits so a skill catches more of a pack: areas and lines ×1.6, chains jump to 3 more enemies,
# and single-target attacks splash onto monsters right next to the target (60% damage, see game.py).
AREA_MULT = 1.6
CHAIN_BONUS = 3
SPLASH_RADIUS = 1.8
for _s in ACTIVES:
    if _s["radius"]:
        _s["radius"] = round(_s["radius"] * AREA_MULT, 1)
    if "width" in _s:
        _s["width"] = round(_s["width"] * AREA_MULT, 2)
    if _s["kind"] == "chain":
        _s["chain"] = _s.get("chain", 3) + CHAIN_BONUS
    if _s["kind"] in ("melee", "projectile", "dash"):
        _s["splash"] = SPLASH_RADIUS
    if "as" in _s.get("vfx", {}):
        _s["vfx"]["as"] = round(_s["vfx"]["as"] * 1.4, 2)

SKILLS: dict[str, dict[str, Any]] = {s["id"]: s for s in ACTIVES}
PASSIVE_BY_ID: dict[str, dict[str, Any]] = {p["id"]: p for p in PASSIVES}


def skills_for(cls: str) -> list[dict[str, Any]]:
    return [s for s in ACTIVES if s["cls"] == cls]


def passives_for(cls: str) -> list[dict[str, Any]]:
    return [p for p in PASSIVES if p["cls"] == cls]


def passive_effects(cls: str, level: int) -> dict[str, float]:
    """Sum of the effects of every passive the character has unlocked."""
    total: dict[str, float] = {}
    for p in passives_for(cls):
        if level >= p["lvl"]:
            for k, v in p["fx"].items():
                total[k] = total.get(k, 0.0) + v
    return total
