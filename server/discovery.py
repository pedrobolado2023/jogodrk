"""
Hidden places and the discovery diary.

Every map has a few special places to find off the hunting paths: a statue, an old altar, a lost grave... and in each
region one giant landmark (a dead mother tree, a frozen waterfall, a stone dragon...). Walking up to a place for the
first time writes it in the hero's diary, tells a short story about it and gives a small permanent bonus. Finding
every place of a map gives gold; finding all of them gives the title "Cartógrafo de Ravencrest".

The places are public (sent in /meta, the client draws them), only which ones a hero found is personal.
Player-facing text is in Portuguese.
"""

from __future__ import annotations

import math
from typing import Any

TOUCH = 3.2          # walking this close to a place discovers it (tiles)
LANDMARK_TOUCH = 5.0  # the landmarks are big: their foot is enough
TITLE = "cartografo"

# what each bonus means for Hero.mod(), and how the diary says it
BONUS_TEXT = {
    "max_hp_pct": ("vida", 100), "atk_pct": ("ataque", 100), "def_pct": ("defesa", 100),
    "crit": ("chance de crítico", 100), "crit_dmg": ("dano crítico", 100), "max_mp_pct": ("mana", 100),
}


def P(pid: str, name: str, x: float, y: float, look: str, bonus: tuple[str, float], hint: str, lore: str,
      glow: str = "gold", landmark: bool = False) -> dict[str, Any]:
    return {"id": pid, "name": name, "x": x, "y": y, "look": look, "glow": glow, "bonus": [bonus[0], bonus[1]],
            "hint": hint, "lore": lore, "landmark": landmark}


HP, ATK, DEF, CRIT, CDMG, MP = "max_hp_pct", "atk_pct", "def_pct", "crit", "crit_dmg", "max_mp_pct"

PLACES: dict[str, list[dict[str, Any]]] = {
    "town_01": [
        P("t_founder", "Estátua do Fundador", 20.0, 21.5, "", (HP, 0.01), "No meio da praça da vila.",
          "Ravencrest foi erguida por um caçador que matou o primeiro lobo sombrio com as próprias mãos. "
          "Ninguém lembra o nome dele, mas todos tocam a estátua antes de sair para caçar."),
        P("t_garden", "Jardim Esquecido", 34.0, 35.0, "shrine", (MP, 0.01), "Num canto escondido da vila, longe da praça.",
          "Uma velha curandeira plantava ervas aqui. As flores ainda brotam, mesmo sem ninguém para cuidar.", "green"),
    ],
    "forest_01": [
        P("f_mother", "Árvore-Mãe Morta", 72.0, 52.0, "lm_forest", (HP, 0.02), "No coração da floresta, entre os lobos e os goblins.",
          "Dizem que toda a floresta nasceu das sementes desta árvore. Quando ela morreu, as sombras começaram a andar.",
          landmark=True),
        P("f_hunters", "Altar dos Caçadores", 20.0, 96.0, "shrine", (ATK, 0.01), "No sudoeste, bem longe da trilha.",
          "Os caçadores deixavam aqui o primeiro dente de cada presa. Quem reza no altar nunca erra o golpe.", "orange"),
        P("f_well", "Poço dos Desejos Seco", 140.0, 30.0, "well", (CRIT, 0.005), "Muito a leste, depois do portal do pântano.",
          "Moedas cobertas de musgo enchem o fundo. Nenhum desejo foi atendido desde que a água secou."),
        P("f_woodcutter", "Túmulo do Lenhador", 150.0, 140.0, "grave_1", (DEF, 0.01), "No sudeste distante, onde quase ninguém vai.",
          "Aqui descansa o lenhador que tentou cortar a Árvore-Mãe. O machado dele nunca foi encontrado."),
        P("f_ring", "Círculo de Cogumelos", 112.0, 112.0, "shrine", (MP, 0.01), "Ao sul dos treants, num lugar úmido.",
          "Quem dorme dentro do círculo acorda com a cabeça cheia de feitiços que nunca aprendeu.", "teal"),
        P("f_watch", "Ruína do Vigia", 178.0, 178.0, "pillar_broken", (CDMG, 0.01), "No canto mais distante da floresta.",
          "A última torre de vigia do antigo reino. Do alto dela se via a vila inteira... antes de cair."),
    ],
    "dungeon_01": [
        P("c_gate", "Portão da Caveira", 30.0, 23.0, "lm_crypt", (DEF, 0.02), "Na frente da sala do Cavaleiro da Morte.",
          "Os construtores entalharam a caveira para avisar os vivos. Ninguém deu ouvidos.", "purple", landmark=True),
        P("c_king", "Sarcófago do Rei Sem Nome", 13.0, 26.0, "coffin", (HP, 0.01), "No salão do oeste, atrás dos esqueletos.",
          "Um rei tão odiado que apagaram o nome dele de todas as pedras. Até do próprio caixão."),
        P("c_bones", "Altar de Ossos", 46.0, 34.0, "shrine", (CDMG, 0.01), "No salão do leste.",
          "Feito com os ossos dos primeiros guardas das catacumbas. Ainda está morno.", "purple"),
        P("c_widow", "Estátua da Viúva", 26.5, 50.0, "statue", (MP, 0.01), "Perto da entrada das catacumbas.",
          "Ela esperou o marido voltar das catacumbas por quarenta anos. Viraram estátua os dois, cada um de um lado."),
    ],
    "mine_01": [
        P("m_crystal", "O Grande Cristal", 64.0, 35.0, "lm_mine", (MP, 0.02), "No fundo da mina, no fim do túnel principal.",
          "Os mineiros cavaram por cem anos atrás deste cristal. Quando o acharam, ninguém teve coragem de quebrá-lo.",
          "cyan", landmark=True),
        P("m_cart", "Carrinho Perdido", 18.0, 48.0, "crate", (DEF, 0.01), "Numa câmara ao sul da entrada.",
          "Cheio de ferro e esquecido no desabamento de 30 anos atrás. O dono nunca voltou para buscar."),
        P("m_shrine", "Altar dos Mineiros", 34.0, 18.0, "shrine", (HP, 0.01), "Numa câmara ao norte.",
          "Antes de descer, todo mineiro acende uma vela aqui. Os que esqueceram não voltaram.", "gold"),
        P("m_forgotten", "Mineiro Esquecido", 56.0, 47.0, "bonepile", (ATK, 0.01), "Numa câmara funda, ao sul do túnel.",
          "Ainda segura a picareta. Pelo jeito, cavou até o último suspiro."),
    ],
    "swamp_01": [
        P("s_tower", "Torre Afundada", 86.0, 40.0, "lm_swamp", (MP, 0.02), "Ao norte do caminho para o covil da bruxa.",
          "A torre do primeiro mago do pântano afundou numa noite só, com ele dentro. Às vezes ainda se vê luz na janela.",
          "green", landmark=True),
        P("s_coffin", "Caixão Flutuante", 22.0, 80.0, "coffin", (DEF, 0.01), "Ao sul da entrada, na beira da água.",
          "Ninguém sabe de onde veio. Ele aparece em lugares diferentes do pântano, mas nunca afunda."),
        P("s_mist", "Altar da Névoa", 60.0, 104.0, "shrine", (CRIT, 0.005), "No extremo sul do pântano.",
          "A névoa do pântano nasce aqui. Quem fica parado muito tempo some junto com ela.", "teal"),
        P("s_moss", "Estátua Coberta de Musgo", 50.0, 20.0, "statue", (HP, 0.01), "No norte do pântano, longe do caminho.",
          "Era um herói da vila. O musgo cobriu o rosto e agora ninguém sabe quem foi."),
        P("s_graves", "Cemitério Alagado", 100.0, 96.0, "grave_0", (ATK, 0.01), "No sudeste, perto do covil.",
          "A água subiu e levou o cemitério. Os mortos daqui são os carniçais que você enfrenta."),
    ],
    "frost_01": [
        P("fr_falls", "Cachoeira Congelada", 68.0, 24.0, "lm_frost", (DEF, 0.02), "No norte dos picos, longe da estrada.",
          "Ela congelou no meio da queda no dia em que o Rei Lich chegou. A água ainda está lá dentro, esperando.",
          "ice", landmark=True),
        P("fr_heart", "Coração de Gelo", 20.0, 100.0, "ice_crystal_0", (MP, 0.01), "No sudoeste, longe da entrada.",
          "Um cristal que nunca derrete, nem no fogo. Bate devagar, como um coração.", "ice"),
        P("fr_winter", "Altar do Inverno", 100.0, 102.0, "shrine", (CRIT, 0.005), "No sudeste dos picos.",
          "O povo do norte pedia aqui um inverno curto. Desde o Rei Lich, o inverno nunca mais acabou.", "ice"),
        P("fr_warrior", "Guerreiro Congelado", 42.0, 76.0, "statue", (ATK, 0.01), "Um pouco ao sul da estrada, no começo dos picos.",
          "Não é uma estátua. É um soldado de verdade, congelado com a espada levantada."),
        P("fr_camp", "Acampamento Perdido", 100.0, 28.0, "tent", (HP, 0.01), "No nordeste, perto do caminho para as cinzas.",
          "Uma expedição montou o acampamento aqui e nunca mais foi vista. A fogueira ainda tem cinzas."),
    ],
    "ash_01": [
        P("a_dragon", "Dragão de Pedra", 70.0, 22.0, "lm_ash", (ATK, 0.02), "No norte das terras queimadas.",
          "O esqueleto de um dragão tão antigo que virou pedra. Pyraxis dorme perto dele... talvez seja a mãe dela.",
          "orange", landmark=True),
        P("a_altar", "Altar das Cinzas", 22.0, 100.0, "shrine", (CDMG, 0.01), "No sudoeste, longe do acampamento.",
          "Os cultistas queimam aqui oferendas para o dragão. O chão nunca esfria.", "orange"),
        P("a_statue", "Estátua Derretida", 100.0, 98.0, "statue", (DEF, 0.01), "No sudeste das cinzas.",
          "O calor derreteu o rosto e as mãos. Só sobrou a capa, de pedra."),
        P("a_giant", "Ossos do Gigante", 44.0, 20.0, "bonepile", (HP, 0.01), "No noroeste, perto do dragão de pedra.",
          "Um gigante caiu aqui tentando fugir das cinzas. Os ossos são do tamanho de árvores."),
        P("a_forge", "Forja Abandonada", 60.0, 112.0, "rack", (ATK, 0.01), "No extremo sul das terras de cinza.",
          "Ferreiros vinham aqui pelo calor do vulcão. Deixaram as armas para trás quando o dragão acordou."),
    ],
    "crimson_01": [
        P("cr_spire", "Coração Sangrento", 70.0, 76.0, "lm_crimson", (HP, 0.02), "No meio do abismo, entre os cavaleiros.",
          "Um cristal vermelho que pulsa como um coração. É dele que vem o rio de sangue.", "red", landmark=True),
        P("cr_altar", "Altar de Sangue", 22.0, 30.0, "shrine", (CRIT, 0.005), "No noroeste do abismo.",
          "Sanguina bebia aqui a vida dos prisioneiros. A pedra ficou vermelha para sempre.", "red"),
        P("cr_queen", "Estátua da Rainha", 102.0, 100.0, "statue", (CDMG, 0.01), "No sudeste, perto do trono.",
          "Sanguina mandou fazer a própria estátua. O escultor foi o primeiro a virar carniçal."),
        P("cr_coffin", "Caixão Vermelho", 40.0, 110.0, "coffin", (DEF, 0.01), "No sul do abismo.",
          "Fechado por dentro. Ninguém tem coragem de abrir."),
        P("cr_pillar", "Pilar Partido", 96.0, 22.0, "pillar_broken", (ATK, 0.01), "No nordeste, perto da passagem para Eldmoor.",
          "Restos da ponte que ligava o abismo a Eldmoor, antes da queda do reino."),
    ],
    "ghost_01": [
        P("g_tower", "Torre Quebrada de Eldmoor", 70.0, 76.0, "lm_ghost", (MP, 0.02), "No centro das ruínas.",
          "A torre do relógio da capital. Os ponteiros pararam na hora exata em que Eldmoor sumiu.", "soul", landmark=True),
        P("g_souls", "Altar das Almas", 22.0, 30.0, "shrine", (HP, 0.01), "No noroeste das ruínas.",
          "As almas de Eldmoor se juntam aqui à noite, procurando o caminho de casa.", "soul"),
        P("g_knight", "Túmulo do Cavaleiro", 40.0, 110.0, "grave_0", (DEF, 0.01), "No sul das ruínas.",
          "O único cavaleiro que se recusou a seguir o rei. Foi enterrado com honra pelos próprios inimigos."),
        P("g_king", "Estátua do Rei", 102.0, 100.0, "statue", (ATK, 0.01), "No sudeste, perto do palácio.",
          "Aldrec quando ainda era um rei bom. A estátua chora quando chove."),
        P("g_fountain", "Fonte Seca", 60.0, 18.0, "well", (CRIT, 0.005), "No norte das ruínas.",
          "A fonte da praça principal. As crianças jogavam moedas aqui pedindo um reino eterno."),
    ],
    "void_01": [
        P("v_monolith", "Monólito Flutuante", 70.0, 76.0, "lm_void", (ATK, 0.02), "No centro da cidadela.",
          "Uma pedra que flutua sem nada a segurar. Foi ela que abriu a fenda para o Vazio.", "purple", landmark=True),
        P("v_altar", "Altar do Vazio", 22.0, 30.0, "shrine", (CDMG, 0.01), "No noroeste da cidadela.",
          "As bruxas cantam aqui. O altar engole a luz em volta.", "purple"),
        P("v_crystal", "Cristal Partido", 40.0, 110.0, "ice_crystal_1", (MP, 0.01), "No sul da cidadela.",
          "Um pedaço do mundo antigo, partido ao meio quando a cidadela subiu.", "purple"),
        P("v_ruin", "Ruína Suspensa", 102.0, 100.0, "pillar_broken", (HP, 0.01), "No sudeste, perto de Nyxara.",
          "Um pedaço de Eldmoor arrancado do chão e trazido para o Vazio."),
        P("v_faceless", "Estátua sem Rosto", 60.0, 18.0, "statue", (DEF, 0.01), "No norte da cidadela.",
          "Quem olha muito tempo para ela começa a esquecer o próprio rosto."),
    ],
}

BY_ID: dict[str, tuple[str, dict[str, Any]]] = {p["id"]: (m, p) for m, ps in PLACES.items() for p in ps}
TOTAL = len(BY_ID)
# gold for finding every place of a map, by the map's order in the adventure
MAP_GOLD = {"town_01": 500, "forest_01": 3000, "dungeon_01": 5000, "mine_01": 5000, "swamp_01": 9000, "frost_01": 15000,
            "ash_01": 30000, "crimson_01": 50000, "ghost_01": 80000, "void_01": 120000}


def clean(found: Any) -> list[str]:
    """The saved list, without unknown or repeated ids (places can be renamed or removed later)."""
    out: list[str] = []
    for pid in found or []:
        if isinstance(pid, str) and pid in BY_ID and pid not in out:
            out.append(pid)
    return out


def mods(found: list[str]) -> dict[str, float]:
    """The permanent bonus of the places found, as Hero.mod() keys."""
    out: dict[str, float] = {}
    for pid in found:
        if pid in BY_ID:
            key, val = BY_ID[pid][1]["bonus"]
            out[key] = round(out.get(key, 0.0) + val, 4)
    return out


def bonus_text(key: str, val: float) -> str:
    label, k = BONUS_TEXT.get(key, (key, 100))
    v = val * k
    return f"+{v:g}% de {label}"


def near(map_id: str, x: float, y: float, found: list[str]) -> dict[str, Any] | None:
    """The place of this map the hero is standing next to and has not found yet."""
    for p in PLACES.get(map_id, ()):
        if p["id"] in found:
            continue
        if math.hypot(x - p["x"], y - p["y"]) <= (LANDMARK_TOUCH if p["landmark"] else TOUCH):
            return p
    return None


def map_done(map_id: str, found: list[str]) -> bool:
    ps = PLACES.get(map_id, ())
    return bool(ps) and all(p["id"] in found for p in ps)


def meta() -> dict[str, Any]:
    return {"places": PLACES, "total": TOTAL, "map_gold": MAP_GOLD,
            "bonus_text": {k: v[0] for k, v in BONUS_TEXT.items()}}
