"""The 20 mounts and 20 mascots: model, framing, colour grade, name, price, description. Imported by the scripts
that write art-source/units.json and the server catalog, so both always agree."""

Q = "sources/quaternius_animals/"
DRAKE = "sources/Ashwing_Drake_Lite/Ashwing_Drake_Lite.glb"
LAB = "sources/Labrador_AllAnimations.glb"

GRADES = {
    "gold": {"desat": 0.6, "tint": [1.3, 1.05, 0.55], "gain": 1.0},
    "ice": {"desat": 0.9, "tint": [0.9, 0.97, 1.18], "gain": 1.0},
    "shadow": {"desat": 0.75, "tint": [0.7, 0.68, 0.9], "gain": 0.65},
    "ember": {"desat": 0.5, "tint": [1.25, 0.72, 0.5], "gain": 0.9},
    "emerald": {"desat": 0.6, "tint": [0.6, 1.2, 0.75], "gain": 0.9},
    "spirit": {"desat": 0.85, "tint": [0.6, 1.15, 1.1], "gain": 1.05},
    "blood": {"desat": 0.5, "tint": [1.3, 0.5, 0.45], "gain": 0.8},
    "void": {"desat": 0.6, "tint": [0.72, 0.56, 1.35], "gain": 0.8},
    "ash": {"desat": 0.35, "tint": [1.12, 0.82, 0.66], "gain": 0.85},
}
QANIM = {"idle": "Idle", "walk": "Walk", "run": "Gallop"}
DANIM = {"idle": "idle_loop", "walk": "walk_loop", "run": "walk_loop"}
LANIM = {"idle": "Idle", "walk": "Walk", "run": "Gallop"}

# model → framing for a mount (height m, ortho, frame size, saddle = back height as a share of the height)
MOUNT_MODELS = {
    "horse": (Q + "Horse.glb", QANIM, 1.6, 3.6, 176, 0.72),
    "horse_white": (Q + "Horse_White.glb", QANIM, 1.6, 3.6, 176, 0.72),
    "donkey": (Q + "Donkey.glb", QANIM, 1.35, 3.2, 160, 0.70),
    "alpaca": (Q + "Alpaca.glb", QANIM, 1.8, 3.6, 176, 0.58),
    "deer": (Q + "Deer.glb", QANIM, 1.5, 3.4, 176, 0.66),
    "stag": (Q + "Stag.glb", QANIM, 2.0, 4.0, 192, 0.52),
    "bull": (Q + "Bull.glb", QANIM, 1.5, 3.6, 176, 0.78),
    "wolf": (Q + "Wolf.glb", QANIM, 1.4, 3.4, 176, 0.70),
    "drake": (DRAKE, DANIM, 2.2, 12.0, 320, 0.40),
}
# key, model, grade, name, price, description
MOUNTS = [
    ("mount_horse", "horse", None, "Cavalo Baio", 1200, "Um cavalo baio, firme e tranquilo."),
    ("mount_white", "horse_white", None, "Corcel Branco", 1600, "Um corcel branco digno de um herói."),
    ("mount_shadow", "horse", "shadow", "Corcel Sombrio", 2200, "Um corcel negro como a noite."),
    ("mount_ember", "horse_white", "ember", "Corcel de Brasa", 2200, "Um corcel com a cor das brasas."),
    ("mount_gold", "horse_white", "gold", "Corcel Dourado", 2600, "Um corcel que brilha como ouro."),
    ("mount_frost", "horse_white", "ice", "Corcel Gélido", 2200, "Um corcel pálido dos Picos Congelados."),
    ("mount_donkey", "donkey", None, "Burro Teimoso", 900, "Lento no humor, mas leva você a qualquer lugar."),
    ("mount_alpaca", "alpaca", None, "Alpaca Andina", 1400, "Fofa, alta e um pouco orgulhosa."),
    ("mount_alpaca_royal", "alpaca", "gold", "Alpaca Real", 2400, "Uma alpaca dourada, só para nobres."),
    ("mount_deer", "deer", None, "Corça da Floresta", 1500, "Leve e silenciosa como o vento da mata."),
    ("mount_stag", "stag", None, "Cervo Real", 2000, "Um cervo de grandes chifres, rei da floresta."),
    ("mount_stag_spirit", "stag", "spirit", "Cervo Espectral", 3000, "Um espírito da floresta em forma de cervo."),
    ("mount_bull", "bull", None, "Touro Bravo", 1600, "Forte e teimoso, abre caminho por qualquer lugar."),
    ("mount_bull_infernal", "bull", "blood", "Touro Infernal", 2800, "Um touro vermelho como as chamas do abismo."),
    ("mount_wolf", "wolf", None, "Lobo Cinzento", 1800, "Um lobo enorme que aceita um cavaleiro."),
    ("mount_wolf_shadow", "wolf", "shadow", "Lobo Sombrio", 2600, "Um lobo negro que caça na escuridão."),
    ("mount_wolf_frost", "wolf", "ice", "Lobo Glacial", 2600, "Um lobo branco do frio eterno."),
    ("mount_drake_ember", "drake", "ash", "Dragão de Brasa", 3500, "Um dragão das terras de cinza."),
    ("mount_drake_void", "drake", "void", "Dragão do Vazio", 3500, "Um dragão nascido no Vazio."),
    ("mount_drake_emerald", "drake", "emerald", "Dragão Esmeralda", 3500, "Um dragão verde das florestas antigas."),
]

# model → framing for a mascot (height m, ortho, frame size, frame center)
PET_MODELS = {
    "dog": (LAB, LANIM, 0.55, 1.4, 112, 0.4),
    "fox": (Q + "Fox.glb", QANIM, 0.5, 1.6, 112, 0.4),
    "husky": (Q + "Husky.glb", QANIM, 0.6, 1.6, 112, 0.4),
    "shiba": (Q + "ShibaInu.glb", QANIM, 0.5, 1.4, 112, 0.4),
    "wolf": (Q + "Wolf.glb", QANIM, 0.6, 1.6, 112, 0.4),
    "deer": (Q + "Deer.glb", QANIM, 0.7, 1.7, 112, 0.4),
    "alpaca": (Q + "Alpaca.glb", QANIM, 0.75, 1.6, 112, 0.4),
    "donkey": (Q + "Donkey.glb", QANIM, 0.6, 1.5, 112, 0.4),
    "bull": (Q + "Bull.glb", QANIM, 0.55, 1.5, 112, 0.4),
    "drake": (DRAKE, DANIM, 1.1, 6.4, 224, 0.4),
}
PETS = [
    ("pet_dog", "dog", None, "Cão Fiel", 900, "Um cão leal que segue você por todo o mundo."),
    ("pet_snow_wolf", "dog", "ice", "Lobinho da Neve", 1100, "Um lobinho branco dos Picos Congelados."),
    ("pet_fox", "fox", None, "Raposa Esperta", 1000, "Uma raposa ruiva e curiosa que nunca sai do seu lado."),
    ("pet_husky", "husky", None, "Husky Valente", 1000, "Um husky forte, acostumado ao frio do norte."),
    ("pet_shiba", "shiba", None, "Shiba Sorridente", 1000, "Um shiba alegre que corre atrás de você."),
    ("pet_ember_drake", "drake", "ash", "Dragãozinho de Brasa", 1500, "Um filhote de dragão das terras de cinza."),
    ("pet_void_drake", "drake", "void", "Dragãozinho do Vazio", 1500, "Um filhote de dragão nascido no Vazio."),
    ("pet_black_dog", "dog", "shadow", "Cão Negro", 1000, "Um cão escuro de olhar atento."),
    ("pet_arctic_fox", "fox", "ice", "Raposa do Ártico", 1200, "Uma raposa branca como a neve."),
    ("pet_ember_fox", "fox", "ember", "Raposa de Brasa", 1200, "Uma raposa com o pelo cor de fogo."),
    ("pet_black_shiba", "shiba", "shadow", "Shiba Noturno", 1200, "Um shiba escuro que adora passear à noite."),
    ("pet_emerald_drake", "drake", "emerald", "Dragãozinho Esmeralda", 1500, "Um filhote de dragão verde da floresta."),
    ("pet_frost_drake", "drake", "ice", "Dragãozinho Gélido", 1500, "Um filhote de dragão das neves."),
    ("pet_gold_drake", "drake", "gold", "Dragãozinho Dourado", 1800, "Um filhote de dragão que brilha como ouro."),
    ("pet_wolf_pup", "wolf", None, "Lobinho Cinzento", 1000, "Um filhote de lobo que já se acha o líder."),
    ("pet_fawn", "deer", None, "Filhote de Corça", 1000, "Uma corça pequena e delicada."),
    ("pet_spirit_fawn", "deer", "spirit", "Corça Espectral", 1600, "Um pequeno espírito da floresta."),
    ("pet_alpaca", "alpaca", None, "Mini Alpaca", 1100, "Uma alpaca de bolso, fofa demais."),
    ("pet_donkey", "donkey", None, "Burrinho", 800, "Um burrinho pequeno e muito teimoso."),
    ("pet_calf", "bull", None, "Touro Mirim", 900, "Um touro pequeno que se acha enorme."),
]
