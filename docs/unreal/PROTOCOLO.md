# Protocolo do servidor Dark Fantasy (para o cliente Unreal)

O servidor (FastAPI, pasta `server/`) é o mesmo para o jogo de navegador e para o cliente Unreal. Ele decide tudo:
posição válida, dano, morte, drop, missões. O cliente só **mostra** e **pede**. Nunca calcule dano, EXP ou drop no
cliente.

- Produção: o mesmo endereço que o jogo de navegador usa como API (variável `VITE_API_URL` do `client/`).
- Desenvolvimento: `http://127.0.0.1:8000` (rodar `server/` com `uvicorn main:app`).
- Todo texto que o jogador vê já vem em português do servidor (avisos, nomes, falas). Telas próprias do cliente também
  devem ser em português simples.

---

## 1. Coordenadas

- O mundo é uma grade de **tiles**. Posições são `x`, `y` em tiles (números com vírgula: `24.5`). `x` e `y` vão de
  `0` até `size` do mapa (`map_info.size`, ex.: 200 na Floresta, 40 na Vila).
- O jogo de navegador desenha em isométrico (`tela_x = (x − y)·32`, `tela_y = (x + y)·16`), mas isso é só desenho.
  No Unreal use um plano: **1 tile = 200 uu (2 m)** sugerido, `X_unreal = x·200`, `Y_unreal = y·200`, `Z` pela
  altura do terreno. O servidor não tem altura.
- Velocidade de andar: **4 tiles/s** (o servidor aceita até 8 tiles/s; acima disso corta o movimento).

## 2. HTTP (antes de entrar no jogo)

Cabeçalho para rotas protegidas: `Authorization: Bearer <token>`.

| Método e rota | Corpo | Resposta |
|---|---|---|
| `POST /auth/register` | `{"username", "password", "email"?}` (usuário 3–20 letras/números/_, senha ≥ 8) | `201 {"token", "user": {"id", "username"}}` |
| `POST /auth/login` | `{"username", "password"}` | `{"token", "user"}` · `401` senha errada · `403` conta bloqueada |
| `GET /auth/me` | — | `{"user", "characters": [...]}` |
| `GET /characters` | — | `[{"character_id", "name", "class", "level", "map"}]` (até 4 por conta) |
| `POST /characters` | `{"name", "char_class"}` (`blade_master` · `grand_sorcerer` · `night_ranger`) | `201 {"character_id", "name", "class"}` |
| `GET /meta` | — | Tudo que é dado fixo do jogo: skills, passivas, monstros, mapas, missões, itens, títulos, skins, conquistas, lugares escondidos (`discovery`)… Baixe uma vez ao abrir o jogo. |

Erros vêm como `{"detail": "texto em português"}` — mostre o texto ao jogador.

## 3. WebSocket (dentro do jogo)

`ws(s)://<servidor>/ws/<character_id>?token=<token>`

- Mensagens são JSON, cada uma com `"type"`.
- **Pacotes**: o servidor junta várias mensagens do mesmo instante em
  `{"type": "batch", "m": [msg, msg, ...]}`. Abra o pacote e trate cada uma.
- Limite: 25 mensagens/s por conexão (rajada de 60). Mande a posição **no máximo a cada 100 ms**.
- Fechamentos: `1008` = token inválido ou herói de outra conta (volte ao login); `4001` = o mesmo herói entrou em
  outro lugar (não reconecte sozinho).
- A cada 5 s mande `{"type": "ping", "ts": <ms>}`; o servidor responde `{"type": "pong", "ts"}` (mostra o ping).

### 3.1 Etapa 1 — entrar, andar e ver os outros

**Recebe ao conectar** (nesta ordem, mais ou menos):

| Mensagem | Campos principais | O que fazer |
|---|---|---|
| `welcome` | campos do `map_info` (abaixo) + `hero` (estado do herói, ver 3.4) + `x`, `y` | Carregar o mapa `map_id`, pôr o herói em `x, y` |
| `inventory` | `bag`, `gear`, ... | Guardar (telas vêm depois) |
| `nearby_snapshot` | `players: [{char_id, name, x, y, cls, level, title, aura, pet, mount, skin, guild, pk}]` | Criar os outros jogadores que estão perto |
| `mob_spawn` (vários) | `id, def_id, name, level, boss, x, y, hp, max_hp` | Criar cada monstro (`def_id` → modelo, ver `/meta` `mobs`) |
| `daynight`, `invasion`, `tourney`, `tutorial`, `login_cal`, `achievements`, `wb_status`, ... | | Podem ser ignoradas na etapa 1 |

`map_info` (também vem sozinho e dentro de `map_change`):
`map_id, name, theme, size, safe, pvp, event, level, portals[{id, x, y, to, label, locked}], npcs[{id, name, x, y, look, role}], clearings[[x, y, r]]`

**Manda**:

| Mensagem | Quando |
|---|---|
| `{"type": "move", "x": 24.6, "y": 44.1}` | Enquanto anda, a cada 100 ms (e uma vez ao parar). O servidor confere a velocidade. |

**Recebe enquanto joga**:

| Mensagem | Campos | O que fazer |
|---|---|---|
| `mv` | `m: [[char_id, x, y], ...]` | Posições novas dos jogadores perto (interpolar até lá). Pode incluir o próprio herói: ignore o seu. |
| `player_spawn` | igual a um item do `nearby_snapshot` | Outro jogador chegou perto |
| `player_despawn` | `char_id` | Saiu de perto / desconectou: remover |
| `mob_move` | `id, x, y` | Monstro andou |
| `mob_sync` | `mobs: [[id, x, y, hp], ...]` | Posições atuais dos monstros ao redor (ao mudar de região do mapa) |
| `map_change` | `map_info` + `x, y` | Pisou num portal: trocar de mapa **na hora** (os `mob_spawn` do mapa novo chegam logo depois) |
| `notice` | `text, kind` (`info` · `warn` · `quest`) | Aviso no centro da tela |
| `chat` | `channel, name?, text` | Chat (etapa 4) |

### 3.2 Etapa 2 — combate

**Manda**:

`{"type": "skill", "skill_id": "<id>", "target_id": "<id do monstro ou jogador>"|null, "tx": <x>, "ty": <y>}`

- `skill_id` vem de `/meta` → `skills` (cada classe tem um ataque básico `basic: true` + 10 skills; `range`, `cd`
  em ms, `mp`, `kind`: `melee`, `projectile`, `aoe_self`, `aoe_target`, `line`, `dash`, `chain`, `buff`, `heal`,
  `blink`; `lvl` = nível para liberar).
- `tx, ty` = ponto mirado (skills de área/linha). Pode mandar a posição do alvo.
- O cliente controla só a **recarga visual**; o servidor recusa se não puder.

**Recebe**:

| Mensagem | Campos | O que fazer |
|---|---|---|
| `skill_used` | `char_id, skill_id, x, y, tx, ty, target, hits[], splash[]` | Tocar a animação/efeito da skill de quem usou |
| `skill_error` | `skill_id, error` (`safe_zone`, `on_cooldown`, `not_enough_mp`, `too_far`, `no_target`, `locked`, `stunned`, `dead`, `unavailable`, `unknown`) | Mostrar motivo curto (os textos do navegador estão em `ERRORS` no `GameScene.ts`) |
| `mob_damaged` | `mob_id, damage, hp_remaining, crit, dot?` + se morreu: `killed: true, def_id, exp, level, boss` | Número de dano, barra de vida; `killed` → animação de morte e remover |
| `damage` | `target_id, damage, crit, hp_remaining, mp_remaining, max_hp, source, dodge?, killed?, killer_name?, respawn_in?` | Dano num **jogador** (o seu ou outro). `killed` no seu herói → tela "Você morreu" |
| `mob_attack` / `boss_warn` / `boss_slam` | `boss_warn: mob_id, x, y, radius, delay` | Golpe do monstro; `boss_warn` = círculo vermelho no chão antes do golpe forte |
| `reward` | `exp, gold, loot[] (nomes), party` | Texto "+EXP +ouro" e itens |
| `level_up` | `char_id, level, unlocked[]` | Efeito de subir de nível |
| `hero` | estado completo do herói (3.4) | Atualizar barras e números |
| `player_respawn` | `x, y, hp, mp` | Seu herói levantou |
| `hero_respawn` | `char_id, x, y` | Outro jogador levantou |

### 3.3 Etapas seguintes (telas e sistemas)

Todos já funcionam no servidor; basta mandar/receber:

- **Inventário e loja**: manda `buy`, `sell`, `equip`, `unequip`, `auto_equip`, `discard`, `use_potion`
  (`{"kind": "hp"|"mp"}`), `close_shop`; recebe `inventory`, `shop`.
- **NPCs e diálogos**: manda `talk {npc}`, `dialog_option {option}`; recebe `dialog {npc, name, lines[], options[{id, label}]}`, `story`, `story_end`.
- **Forja**: `forge_craft`, `forge_upgrade`, `forge_refine`, `forge_enchant` → `forge_result`.
- **Mercado**: `market_query`, `market_sell`, `market_buy`, `market_cancel`, `market_collect` → `market`.
- **Mineração**: `mine {vein}` → `veins`, `vein`, `mining`, `mining_end`.
- **Grupo, guilda, amigos**: `party_invite`, `party_leave`, `party_kick`, `guild_*`, `friend_add`, `friend_remove` →
  `party`, `guild`, `guild_tag`, `friends`.
- **PvP**: `pk_status`, `kill_feed`, `arena_scores`; duelo `duel_invite {name}` → `duel`; torneio → `tourney`.
- **Boss Global**: `wb_join` → `wb_status`, `wb_scores`, `wb_cast`, `wb_impact`, `wb_result`.
- **Mapa do mundo e teleporte**: `world_map` → `world_map`; `teleport {map}`.
- **Visual**: `set_title`, `set_aura`, `set_pet`, `set_mount`, `set_skin`, `toggle_mount` → `title`, `aura`, `pet`,
  `mount`, `skin`.
- **Passe e loja de gemas**: `pass_claim`, `pass_claim_all`, `shop_buy` → `season`, `shop`.
- **Progresso**: `login_claim` → `login_cal`; `ranking` → `ranking`; recebe `tutorial`, `achievements`,
  `achievement`, `discovered`, `daynight`, `invasion`, `map_safe`.
- **Missão secreta**: `hidden_npc`, `hq`, `hq_mark`.

O jogo de navegador (`client/src/scenes/GameScene.ts`, `HUDScene.ts`) é a referência de como cada mensagem é usada.

### 3.4 Estado do herói (`hero` e `welcome.hero`)

`char_id, name, cls, level, exp, exp_next, gold, gems, title, cosmetics{titles, auras, aura, pets, pet, mounts, mount,
skins, skin}, boosts, vip, hp, mp, max_hp, max_mp, atk, def, crit, crit_dmg, dodge, str, agi, int, vit, speed,
buffs[], story{q, st, n}, loot, found[], pvp{kills, deaths}, pk{status, red_left, kills, aggressor_left}`

Números grandes: EXP e vida passam de bilhões em nível alto — use `int64` / `double` no Unreal.
