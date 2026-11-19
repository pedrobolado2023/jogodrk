# Dark Fantasy na Unreal Engine — plano

Cliente novo em **Unreal Engine 5.8** (C++) que se conecta ao **mesmo servidor** do jogo de navegador. O servidor
(`server/`) continua sendo o único dono das regras; o jogo de navegador continua no ar. Quem joga nos dois fica no
mesmo mundo.

Como o cliente conversa com o servidor: [PROTOCOLO.md](PROTOCOLO.md).

---

## Quem faz o quê

| Quem | Papel |
|---|---|
| **Claude** | Arquitetura e etapas, protocolo, mudanças no servidor (`server/`), revisão do que o Codex fizer, decisões de design |
| **Codex** | Código C++ do projeto Unreal (rede, personagens, combate, telas UMG), scripts Python do editor, build |
| **Pedro (no editor)** | Montar os mapas, escolher modelos/materiais (Megascans, MetaHuman, Fab), testar e jogar |

Os dois agentes gravam decisões e lições na memória **kg** (mesmo grafo). Antes de mudar algo, procure lá.

## Regras do projeto

1. **O servidor manda.** O cliente nunca decide dano, EXP, drop, morte, missão nem posição final — ele pede
   (`move`, `skill`, `talk`...) e mostra o que o servidor responde.
2. **Não mexer no protocolo sem combinar.** Mudança em mensagem do servidor quebra o jogo de navegador. Se o cliente
   Unreal precisar de algo novo, adicionar campo/mensagem **novo** (sem mudar os antigos) e anotar no PROTOCOLO.md.
3. **Português simples** em tudo que o jogador vê.
4. **Repositório separado** para o projeto Unreal: `pedrobolado2023/unrealengine221` (pasta local
   `C:\Users\pedro\Documents\unrealengine221`), com **Git LFS** para `.uasset`, `.umap`, texturas, áudio e modelos (`.gitattributes` e `.gitignore`
   já prontos lá). Nada da Unreal entra no repositório `jogodrk`.
5. **Nada de arte licenciada crua no Git** (modelos do Mixamo, pacotes do Fab baixados, `art-source`): só o que a
   licença permite e já importado no projeto. Na dúvida, perguntar ao Pedro.
6. Segredos (`SECRET_KEY`, senha do banco, tokens do Mercado Pago) **nunca** no projeto Unreal. O cliente só guarda o
   token do jogador.
7. Commit/push só com o "pode enviar" do Pedro.

## Preparação (uma vez)

- Unreal Engine 5.8.4 + Visual Studio 2022 com "Desenvolvimento de jogos com C++" (MSVC v143, Windows SDK) e
  "Desenvolvimento para desktop com .NET".
- Projeto novo: **Games → Top Down**, **C++**, sem Starter Content (os assets vêm depois). Em *Project Location*
  escolha `C:\Users\pedro\Documents\unrealengine221` e em *Project Name* `DarkFantasy`: o projeto fica em `unrealengine221\DarkFantasy\`, dentro
  do repositório.
- Plugins: **WebSockets** (vem com a Unreal), **HTTP** (módulo `HTTP`), **Json/JsonUtilities**, **Enhanced Input**,
  **Python Editor Script Plugin** (para automações do editor), **Niagara** (efeitos).
- `.gitignore` padrão da Unreal (`Binaries/`, `Intermediate/`, `Saved/`, `DerivedDataCache/`, `.vs/`) +
  `.gitattributes` com LFS.
- Servidor local para testar: `cd server && .venv\Scripts\python.exe -m uvicorn main:app --port 8000`
  (cópia do banco, contas de teste — nunca a conta real do Pedro).

## Arquitetura do cliente (C++)

| Peça | Responsabilidade |
|---|---|
| `UDFApiSubsystem` (GameInstance Subsystem) | HTTP: login, registro, lista/criação de heróis, `GET /meta` (guarda o JSON) |
| `UDFNetSubsystem` (GameInstance Subsystem) | WebSocket: conectar com token, abrir `batch`, despachar por `type` (delegates), fila de envio com limite (≤ 10 `move`/s), ping a cada 5 s, tratar fechamentos 1008/4001 |
| `ADFGameMode` / `ADFPlayerController` | Clique para andar (como no navegador) + teclado/joystick; manda `move` a cada 100 ms enquanto anda |
| `ADFHeroCharacter` | O herói do jogador (movimento local suave, corrigido pelo servidor) |
| `ADFRemoteHero`, `ADFMob` | Outros jogadores e monstros: interpolam até a última posição recebida (`mv`, `mob_move`) |
| `UDFWorldSubsystem` | Mapa atual: trocar de nível em `welcome`/`map_change`, criar/remover atores por id, conversão tile ↔ uu (1 tile = 200 uu) |
| UMG | Barras de vida/mana/EXP, barra de skills, números de dano, avisos, depois inventário, chat, diálogos |

Um nível (`.umap`) por mapa do servidor: `L_town_01`, `L_forest_01`, `L_dungeon_01`, `L_mine_01`, `L_swamp_01`,
`L_frost_01`, `L_ash_01`, `L_crimson_01`, `L_ghost_01`, `L_void_01`, `L_arena_01`, `L_worldboss_01`. O tamanho de
cada um sai de `map_info.size` (Vila 40×40 tiles = 80 m; Floresta 200×200 = 400 m).

## Etapas (cada uma termina jogável)

### Etapa 1 — Entrar e andar  *(primeira tarefa do Codex)*
- Tela de login simples (usuário/senha) → lista de heróis → Jogar.
- Conectar no WebSocket, receber `welcome`, abrir `L_town_01` (um chão plano já serve), pôr o herói em `x, y`.
- Clique no chão → andar a 4 tiles/s → mandar `move`.
- Ver outros jogadores (`nearby_snapshot`, `player_spawn`, `mv`, `player_despawn`) como cápsulas com o nome em cima.
- Pisar no portal → `map_change` → trocar de nível.
- **Pronto quando:** dois heróis (um no navegador, um na Unreal) se veem andando na Vila e na Floresta.

### Etapa 2 — Combate
- Monstros (`mob_spawn`, `mob_move`, `mob_sync`, `mob_damaged`) como modelos provisórios com barra de vida.
- Ataque básico (Espaço / clique no monstro) e skills 1–0 (`/meta` → `skills`), recarga visual, `skill_error`.
- Números de dano (`mob_damaged`, `damage`), morte/renascer, `reward`, `level_up`, barras do `hero`.
- **Pronto quando:** dá para caçar lobos na Floresta e subir de nível pela Unreal.

Detalhes da Etapa 2 (o jogo de navegador é a referência: `client/src/scenes/GameScene.ts` no repositório `jogodrk`):

**0. Arrumar o que ficou da Etapa 1**
- Separar uma classe base sem câmera (`ADFUnit`: cápsula/modelo, nome, barra de vida, interpolação). `ADFHeroCharacter`
  (o seu, com câmera) e `ADFRemoteHero`/`ADFMob` derivam dela. Os remotos não podem carregar câmera nem braço.
- Não refazer a lista inteira a cada `mv`: atualizar só o alvo do ator que se mexeu; criar/remover só em
  `player_spawn`/`player_despawn`/`nearby_snapshot`.

**1. Monstros (`ADFMob`)**
- Guardar todos os monstros do mapa num `TMap<id, estado>` (chegam até ~105 `mob_spawn` ao entrar). `mob_spawn` com id
  existente = renasceu (reviver e pôr no lugar).
- Ator provisório: cápsula com cor por tipo (boss maior e roxo), nome + nível em cima e barra de vida (componente de
  widget ou mesh simples). Mais tarde (Etapa 3) o `def_id` escolhe o modelo: deixe um ponto único para isso.
- Andar: interpolar até `mob_move`. `mob_sync`: corrigir posição e vida; se estiver a mais de 6 tiles, teleportar.
- Para render leve: esconder/parar o tick dos monstros a mais de ~45 tiles do herói.
- `mob_damaged`: atualizar a barra; `killed: true` → piscar/afundar e esconder (o ator pode ser reaproveitado no
  próximo `mob_spawn`). `mob_hp`: atualizar vida/vida máxima.

**2. Alvo e ataque**
- Clique esquerdo num monstro (ou jogador inimigo): vira o **alvo** (anel no chão embaixo dele + painel no topo com
  nome, nível e vida). Clique no chão continua andando e **não** tira o alvo. `Esc` tira o alvo.
- Os atores precisam de colisão só para o clique (canal de traço próprio, ex. `DFClick`), sem bloquear movimento.
- **Espaço** = ataque básico (a skill de `/meta` → `skills` com `basic: true` da classe do herói, `cls` no `hero`).
  Segurar Espaço continua atacando; durante a recarga fica em silêncio.
- **1–0** = as 10 skills da classe na ordem do `/meta`. Antes de mandar, o cliente checa (só para dar aviso rápido,
  o servidor decide): nível (`lvl`) → "Desbloqueia no nível N"; recarga → "Ainda recarregando"; mana (`mp`) →
  "Mana insuficiente"; mapa seguro (`safe` do `map_info`) e skill que não é `buff`/`heal`/`blink` → "Não é
  possível lutar na vila".
- Como mandar (igual ao navegador):
  - `melee`, `projectile`, `dash`, `chain` precisam de alvo. Sem alvo, escolher o inimigo mais perto a até
    `max(10, range + 2)` tiles; se não houver → "Escolha um alvo".
  - Com alvo, se a distância for maior que `range + 0.6` tiles: **andar até ele** e lançar quando entrar no alcance.
  - `aoe_target`, `line`, `blink` sem alvo: mandar `tx, ty` = ponto do chão sob o mouse.
  - `aoe_self`, `buff`, `heal`: `target_id: null`.
- Recarga visual: ao mandar, marcar `cd` (ms) na barra de skills; `skill_error` com `on_cooldown` não reinicia nada.
- `skill_error`: mostrar o texto curto (mesmos textos do `ERRORS` do navegador: `not_enough_mp` "Mana
  insuficiente", `on_cooldown` "Ainda recarregando", `dead` "Você está morto", `locked` "Skill bloqueada",
  `no_target` "Escolha um alvo", `too_far` "Alvo muito longe", `stunned` "Você está atordoado", `safe_zone` "Não é
  possível lutar na vila", `unknown` "Skill desconhecida", `unavailable` "Indisponível").
- `cc` no seu herói com `stun`/`freeze`: bloquear andar e skills por `dur × 0,6` s. Mostrar ícone/efeito simples.

**3. Ataque automático** (o jogador do navegador usa muito; regra combinada com o Pedro)
- Botão/tecla **Auto** (ex. `Q`): ataca sozinho o monstro vivo mais perto (bosses não, a não ser no Boss Global),
  usando a skill liberada mais forte que estiver pronta (cura se a vida < 60%, buffs quando prontos), senão o
  ataque básico, senão anda até o alvo.
- **Continua ligado ao andar** (clique no chão só pausa enquanto anda) e só desliga quando o jogador desliga ou entra
  num **mapa seguro** (aviso "Ataque automático desligado: você entrou numa zona segura.").
- Monstro mordendo o herói (a menos de 2,2 tiles) vira alvo primeiro.

**4. Efeitos e números**
- `skill_used` de qualquer jogador: tocar algo provisório (flash na cor da classe, projétil simples de `x,y` até
  `tx,ty` para `projectile`/`line`, círculo para `aoe_*`). Os efeitos Niagara de verdade são da Etapa 3.
- Números de dano flutuando: `mob_damaged` (branco, crítico amarelo e maior, `dot` menor) e `damage` (vermelho no
  seu herói; `dodge: true` → "Esquivou").
- `damage` com `source` = id de monstro → animação de ataque daquele monstro (não existe `mob_attack` no fio).
- `boss_warn`: círculo vermelho no chão com raio `radius` por `delay` s; `boss_slam`: tremida de câmera.

**5. HUD (UMG em C++, provisório e simples)**
- Barras de vida, mana e EXP (`hero`: `hp/max_hp`, `mp/max_mp`, `exp/exp_next`), nível e ouro. Números grandes em
  `int64`/`double`, formatados curto (1,2 mil / 3,4 mi / 5,6 bi, como o `fmtBig` do navegador).
- Barra de skills 1–0 + Espaço com nome curto, cadeado se bloqueada e a recarga escurecendo.
- `reward`: "+N EXP  +N ouro" e nomes dos itens (`loot[]`). `level_up` (seu): aviso grande "Nível N!" e skills
  liberadas (`unlocked[]`).
- Morte: `damage` com `killed: true` no seu herói → tela "Você morreu" com contagem `respawn_in`; bloquear
  movimento. `player_respawn` → pôr em `x,y`, vida/mana e tirar a tela. `hero_respawn` → outro jogador levantou.

**6. Teste**
- Estender `scripts/test_stage_one.py` (ou criar `test_stage_two.py`) no servidor isolado porta 18000: herói de teste
  vai à Floresta, mata monstros com Espaço e skills, recebe `reward`, sobe de nível, morre para um monstro forte
  (ou espera ser atacado com vida baixa) e renasce. Resultado em `Saved/StageTwoTest/result.json` + capturas.
- **Pronto quando:** dá para caçar lobos na Floresta pela Unreal, ver os números, subir de nível, morrer e renascer,
  e um jogador no navegador vê os monstros apanhando e morrendo ao mesmo tempo.

### Etapa 3 — Primeiro mapa bonito
- Floresta com Megascans (chão, árvores, pedras), luz e névoa, os lugares escondidos e a Árvore-Mãe.
- Os 3 heróis (modelos e animações), os monstros da Floresta, efeitos Niagara das skills mais usadas.

### Etapa 4 — Telas
- Inventário e equipamentos, lojas e NPCs (diálogos), missões (História, Diárias), chat, avisos, mapa do mundo.

### Etapa 5 — O resto
- Demais mapas, Arena (PvP), Boss Global, eventos (invasão, torneio), forja, mercado, mineração, guildas, grupo,
  passe, loja, conquistas, presentes. Builds para Windows e Android.

## Primeira tarefa para o Codex (copiar e colar)

> Trabalhe em `C:\Users\pedro\Documents\unrealengine221`. Leia `AGENTS.md`, `docs/PLANO.md`, `docs/PROTOCOLO.md` e a memória kg. No projeto
> Unreal `DarkFantasy/` (C++, template Top Down, UE 5.8), faça a **Etapa 1**: `UDFApiSubsystem` (login, lista de heróis,
> `/meta`), `UDFNetSubsystem` (WebSocket com token, `batch`, despacho por `type`, `move` a cada 100 ms, ping),
> clique para andar a 4 tiles/s com 1 tile = 200 uu, outros jogadores como cápsulas com nome, troca de nível no
> `map_change`. Use o servidor local em `http://127.0.0.1:8000` com uma conta de teste. Não mude nada em `server/`.
> Quando terminar, descreva como testar e grave as decisões na memória kg.

## Tarefa da Etapa 2 para o Codex (copiar e colar)

> Trabalhe em `C:\Users\pedro\Documents\unrealengine221`. Leia `AGENTS.md`, `docs/PLANO.md` (seção **Etapa 2** e os
> "Detalhes da Etapa 2"), `docs/PROTOCOLO.md` (3.2 e as notas do combate) e a memória kg (nó
> `unreal-etapa-1-revisada`). A referência de comportamento é o jogo de navegador em
> `C:\Users\pedro\Downloads\novo jogo 2.2\client\src\scenes\GameScene.ts` (só leitura). Faça a **Etapa 2** na ordem dos
> itens 0 a 6: primeiro separe a classe base sem câmera, depois monstros, alvo e ataque (Espaço e 1–0), ataque
> automático (fica ligado ao andar; só desliga no botão ou em mapa seguro), efeitos e números provisórios, HUD e
> morte/renascer. O servidor manda em tudo: o cliente só pede `skill` e mostra as respostas. Não mude nada em
> `server/` nem no protocolo; se faltar algum campo, anote e me avise. Teste no servidor isolado (porta 18000, cópia
> do banco, contas temporárias). Não faça commit. Quando terminar, descreva como testar e grave as decisões no kg.
