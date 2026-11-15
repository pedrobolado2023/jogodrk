"""
Gem shop: the premium currency (gems) and what it buys. Nothing here gives power — only looks (auras,
titles) and the season pass Premium track, which itself only gives looks.

Besides looks it sells time, never strength: boosts that speed up monster EXP or gold for a while, pass
levels (expensive) and finishing the current story quest when it is too hard (expensive, more each quest).
Gems will be bought with real money later (packs are listed as "coming soon"); for now they only come
from the developer test command. Each hero keeps their own gems (saved on the character).
Player-facing text is in Portuguese.
"""

from __future__ import annotations

from typing import Any

import season as ssn

CURRENCY = "Gemas"

# id → offer. kind: "premium_pass" (this season's Premium track), "aura", "title", "boost" (ref exp|gold, minutes),
# "pass_level" (levels), "quest_skip" (price grows with the quest number)
OFFERS: list[dict[str, Any]] = [
    {"id": "pass_premium", "kind": "premium_pass", "name": "Passe Premium", "price": 950, "tab": "destaques",
     "desc": "Libera a trilha Premium do Passe de Temporada: 4 títulos e 4 auras exclusivos."},
    {"id": "aura_sangue", "kind": "aura", "ref": "aura_sangue", "price": 600, "tab": "visuais",
     "desc": "Um brilho vermelho-sangue com faíscas subindo dos pés."},
    {"id": "aura_celeste", "kind": "aura", "ref": "aura_celeste", "price": 600, "tab": "visuais",
     "desc": "Uma luz azul calma, como o céu antes da tempestade."},
    {"id": "aura_esmeralda", "kind": "aura", "ref": "aura_esmeralda", "price": 600, "tab": "visuais",
     "desc": "O verde vivo das florestas antigas."},
    {"id": "aura_alma", "kind": "aura", "ref": "aura_alma", "price": 800, "tab": "destaques",
     "desc": "Almas azul-esverdeadas giram em volta do herói."},
    {"id": "title_nobre", "kind": "title", "ref": "nobre", "price": 400, "tab": "visuais",
     "desc": "Um título acima do nome, para todos verem."},
    {"id": "title_sombra", "kind": "title", "ref": "sombra_errante", "price": 400, "tab": "visuais",
     "desc": "Um título acima do nome, para todos verem."},
    {"id": "title_lamina", "kind": "title", "ref": "lamina_rubra", "price": 500, "tab": "destaques",
     "desc": "Um título acima do nome, para todos verem."},
    # mascots: follow the hero, looks only
    {"id": "pet_dog", "kind": "pet", "ref": "pet_dog", "price": 900, "tab": "mascotes", "desc": "Um cão leal que segue você por todo o mundo."},
    {"id": "pet_snow_wolf", "kind": "pet", "ref": "pet_snow_wolf", "price": 1100, "tab": "mascotes", "desc": "Um lobinho branco dos Picos Congelados."},
    {"id": "pet_fox", "kind": "pet", "ref": "pet_fox", "price": 1000, "tab": "mascotes", "desc": "Uma raposa ruiva e curiosa que nunca sai do seu lado."},
    {"id": "pet_husky", "kind": "pet", "ref": "pet_husky", "price": 1000, "tab": "mascotes", "desc": "Um husky forte, acostumado ao frio do norte."},
    {"id": "pet_shiba", "kind": "pet", "ref": "pet_shiba", "price": 1000, "tab": "mascotes", "desc": "Um shiba alegre que corre atrás de você."},
    {"id": "pet_ember_drake", "kind": "pet", "ref": "pet_ember_drake", "price": 1500, "tab": "mascotes", "desc": "Um filhote de dragão das terras de cinza."},
    {"id": "pet_void_drake", "kind": "pet", "ref": "pet_void_drake", "price": 1500, "tab": "mascotes", "desc": "Um filhote de dragão nascido no Vazio."},
    {"id": "pet_black_dog", "kind": "pet", "ref": "pet_black_dog", "price": 1000, "tab": "mascotes", "desc": "Um cão escuro de olhar atento."},
    {"id": "pet_arctic_fox", "kind": "pet", "ref": "pet_arctic_fox", "price": 1200, "tab": "mascotes", "desc": "Uma raposa branca como a neve."},
    {"id": "pet_ember_fox", "kind": "pet", "ref": "pet_ember_fox", "price": 1200, "tab": "mascotes", "desc": "Uma raposa com o pelo cor de fogo."},
    {"id": "pet_black_shiba", "kind": "pet", "ref": "pet_black_shiba", "price": 1200, "tab": "mascotes", "desc": "Um shiba escuro que adora passear à noite."},
    {"id": "pet_emerald_drake", "kind": "pet", "ref": "pet_emerald_drake", "price": 1500, "tab": "mascotes", "desc": "Um filhote de dragão verde da floresta."},
    {"id": "pet_frost_drake", "kind": "pet", "ref": "pet_frost_drake", "price": 1500, "tab": "mascotes", "desc": "Um filhote de dragão das neves."},
    {"id": "pet_gold_drake", "kind": "pet", "ref": "pet_gold_drake", "price": 1800, "tab": "mascotes", "desc": "Um filhote de dragão que brilha como ouro."},
    {"id": "pet_wolf_pup", "kind": "pet", "ref": "pet_wolf_pup", "price": 1000, "tab": "mascotes", "desc": "Um filhote de lobo que já se acha o líder."},
    {"id": "pet_fawn", "kind": "pet", "ref": "pet_fawn", "price": 1000, "tab": "mascotes", "desc": "Uma corça pequena e delicada."},
    {"id": "pet_spirit_fawn", "kind": "pet", "ref": "pet_spirit_fawn", "price": 1600, "tab": "mascotes", "desc": "Um pequeno espírito da floresta."},
    {"id": "pet_alpaca", "kind": "pet", "ref": "pet_alpaca", "price": 1100, "tab": "mascotes", "desc": "Uma alpaca de bolso, fofa demais."},
    {"id": "pet_donkey", "kind": "pet", "ref": "pet_donkey", "price": 800, "tab": "mascotes", "desc": "Um burrinho pequeno e muito teimoso."},
    {"id": "pet_calf", "kind": "pet", "ref": "pet_calf", "price": 900, "tab": "mascotes", "desc": "Um touro pequeno que se acha enorme."},
    # mounts: ride them, looks only (no speed)
    {"id": "mount_horse", "kind": "mount", "ref": "mount_horse", "price": 1200, "tab": "montarias", "desc": "Um cavalo baio, firme e tranquilo."},
    {"id": "mount_white", "kind": "mount", "ref": "mount_white", "price": 1600, "tab": "montarias", "desc": "Um corcel branco digno de um herói."},
    {"id": "mount_shadow", "kind": "mount", "ref": "mount_shadow", "price": 2200, "tab": "montarias", "desc": "Um corcel negro como a noite."},
    {"id": "mount_ember", "kind": "mount", "ref": "mount_ember", "price": 2200, "tab": "montarias", "desc": "Um corcel com a cor das brasas."},
    {"id": "mount_gold", "kind": "mount", "ref": "mount_gold", "price": 2600, "tab": "montarias", "desc": "Um corcel que brilha como ouro."},
    {"id": "mount_frost", "kind": "mount", "ref": "mount_frost", "price": 2200, "tab": "montarias", "desc": "Um corcel pálido dos Picos Congelados."},
    {"id": "mount_donkey", "kind": "mount", "ref": "mount_donkey", "price": 900, "tab": "montarias", "desc": "Lento no humor, mas leva você a qualquer lugar."},
    {"id": "mount_alpaca", "kind": "mount", "ref": "mount_alpaca", "price": 1400, "tab": "montarias", "desc": "Fofa, alta e um pouco orgulhosa."},
    {"id": "mount_alpaca_royal", "kind": "mount", "ref": "mount_alpaca_royal", "price": 2400, "tab": "montarias", "desc": "Uma alpaca dourada, só para nobres."},
    {"id": "mount_deer", "kind": "mount", "ref": "mount_deer", "price": 1500, "tab": "montarias", "desc": "Leve e silenciosa como o vento da mata."},
    {"id": "mount_stag", "kind": "mount", "ref": "mount_stag", "price": 2000, "tab": "montarias", "desc": "Um cervo de grandes chifres, rei da floresta."},
    {"id": "mount_stag_spirit", "kind": "mount", "ref": "mount_stag_spirit", "price": 3000, "tab": "montarias", "desc": "Um espírito da floresta em forma de cervo."},
    {"id": "mount_bull", "kind": "mount", "ref": "mount_bull", "price": 1600, "tab": "montarias", "desc": "Forte e teimoso, abre caminho por qualquer lugar."},
    {"id": "mount_bull_infernal", "kind": "mount", "ref": "mount_bull_infernal", "price": 2800, "tab": "montarias", "desc": "Um touro vermelho como as chamas do abismo."},
    {"id": "mount_wolf", "kind": "mount", "ref": "mount_wolf", "price": 1800, "tab": "montarias", "desc": "Um lobo enorme que aceita um cavaleiro."},
    {"id": "mount_wolf_shadow", "kind": "mount", "ref": "mount_wolf_shadow", "price": 2600, "tab": "montarias", "desc": "Um lobo negro que caça na escuridão."},
    {"id": "mount_wolf_frost", "kind": "mount", "ref": "mount_wolf_frost", "price": 2600, "tab": "montarias", "desc": "Um lobo branco do frio eterno."},
    {"id": "mount_drake_ember", "kind": "mount", "ref": "mount_drake_ember", "price": 3500, "tab": "montarias", "desc": "Um dragão das terras de cinza."},
    {"id": "mount_drake_void", "kind": "mount", "ref": "mount_drake_void", "price": 3500, "tab": "montarias", "desc": "Um dragão nascido no Vazio."},
    {"id": "mount_drake_emerald", "kind": "mount", "ref": "mount_drake_emerald", "price": 3500, "tab": "montarias", "desc": "Um dragão verde das florestas antigas."},
    # time savers
    {"id": "boost_exp_1h", "kind": "boost", "ref": "exp", "minutes": 60, "price": 250, "tab": "bonus", "name": "EXP +50% (1 hora)",
     "desc": "Monstros dão 50% mais EXP por 1 hora. Comprar de novo soma o tempo."},
    {"id": "boost_exp_3h", "kind": "boost", "ref": "exp", "minutes": 180, "price": 650, "tab": "bonus", "name": "EXP +50% (3 horas)",
     "desc": "Monstros dão 50% mais EXP por 3 horas. Comprar de novo soma o tempo."},
    {"id": "boost_gold_1h", "kind": "boost", "ref": "gold", "minutes": 60, "price": 200, "tab": "bonus", "name": "Ouro +50% (1 hora)",
     "desc": "Monstros dão 50% mais ouro por 1 hora. Comprar de novo soma o tempo."},
    {"id": "boost_gold_3h", "kind": "boost", "ref": "gold", "minutes": 180, "price": 520, "tab": "bonus", "name": "Ouro +50% (3 horas)",
     "desc": "Monstros dão 50% mais ouro por 3 horas. Comprar de novo soma o tempo."},
    {"id": "pass_level_1", "kind": "pass_level", "levels": 1, "price": 400, "tab": "passe", "name": "Passe +1 nível",
     "desc": "Sobe 1 nível do Passe de Temporada na hora."},
    {"id": "pass_level_5", "kind": "pass_level", "levels": 5, "price": 1900, "tab": "passe", "name": "Passe +5 níveis",
     "desc": "Sobe 5 níveis do Passe de Temporada na hora."},
    {"id": "quest_skip", "kind": "quest_skip", "price": 600, "price_step": 40, "tab": "passe", "name": "Concluir missão",
     "desc": "Termina na hora a missão da história que você está fazendo. Depois é só entregar ao Ancião."},
]

BOOSTS = {"exp": ("EXP +50%", 0.5), "gold": ("Ouro +50%", 0.5)}
# coming later: shown in the shop so players know what to expect
SOON = [
    {"name": "Skins de equipamento", "desc": "Mude a aparência da armadura e da arma sem mudar os atributos."},
]


def price(o: dict[str, Any], quest_index: int = 0) -> int:
    """Finishing a quest costs more for later quests; every other offer has a fixed price."""
    return o["price"] + o.get("price_step", 0) * quest_index


BY_ID = {o["id"]: o for o in OFFERS}

# packs of gems for real money — shown, not sold yet
# (the price that counts is in payments.PRODUCTS; gems here already include the bonus)
PACKS = [{"id": "gems_500", "gems": 500, "bonus": 0, "price": 5.00}, {"id": "gems_1100", "gems": 1100, "bonus": 100, "price": 10.00},
         {"id": "gems_3000", "gems": 3000, "bonus": 500, "price": 25.00}, {"id": "gems_6500", "gems": 6500, "bonus": 1500, "price": 50.00},
         {"id": "gems_14000", "gems": 14000, "bonus": 4000, "price": 100.00}]


def offer_name(o: dict[str, Any]) -> str:
    if "name" in o and o["kind"] != "premium_pass":
        return o["name"]
    if o["kind"] == "aura":
        return ssn.AURAS[o["ref"]][0]
    if o["kind"] == "pet":
        return ssn.PETS[o["ref"]][0]
    if o["kind"] == "mount":
        return ssn.MOUNTS[o["ref"]][0]
    if o["kind"] == "title":
        return f"Título «{ssn.TITLE_BY_ID[o['ref']][1]}»"
    return o["name"]


def owned(o: dict[str, Any], cosmetics: dict[str, Any], season_state: dict[str, Any]) -> bool:
    if o["kind"] == "aura":
        return o["ref"] in cosmetics["auras"]
    if o["kind"] == "title":
        return o["ref"] in cosmetics["titles"]
    if o["kind"] == "pet":
        return o["ref"] in cosmetics["pets"]
    if o["kind"] == "mount":
        return o["ref"] in cosmetics["mounts"]
    if o["kind"] == "premium_pass":
        return bool(season_state.get("premium"))
    return False  # boosts, pass levels and quest finishing can be bought again


def meta() -> dict[str, Any]:
    return {"currency": CURRENCY, "packs": PACKS, "soon": SOON,
            "offers": [{**o, "name": offer_name(o)} for o in OFFERS]}
