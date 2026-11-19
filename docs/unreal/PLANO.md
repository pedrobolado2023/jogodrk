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

Detalhes da Etapa 3:

**Antes de tudo: repositório privado.** O `pedrobolado2023/unrealengine221` está **público**. Modelos do Mixamo,
Megascans e pacotes do Fab só podem ser usados dentro do jogo, não espalhados como arquivos soltos; num repositório
público qualquer um baixa os `.uasset`. O Pedro deixa o repositório **privado** (GitHub → Settings → Danger Zone →
Change visibility) antes de importar qualquer arte desta etapa.

**Quem faz o quê nesta etapa**
| Quem | O quê |
|---|---|
| Claude | Exportador do layout (`server/export_layout.py`, já pronto), revisão, decisões de arte e posição |
| Codex | Importador do layout, PCG da floresta, atores de portal/NPC/lugar escondido, heróis e monstros com animação (C++ + Python do editor), efeitos Niagara, modo "nível montado" no cliente |
| Pedro | Baixar os pacotes no Fab/Megascans, pintar o chão e as trilhas, ajustar luz, olhar e aprovar o visual |

**1. Layout vindo do servidor** (feito)
- `server/export_layout.py <pasta>` grava `<map_id>.json` com tamanho, ponto de entrada, portais, NPCs, clareiras,
  pontos de monstros (`spawns`: tipo, centro, quantidade, raio), lugares escondidos e marcos (`places`), e o
  acampamento da Floresta (`camp`). Os arquivos ficam em `unrealengine221/DarkFantasy/Data/Layouts/` (texto, Git
  normal). Se o mapa mudar no servidor, rodar de novo.
- Coordenadas em tiles; na Unreal `X = x·200`, `Y = y·200`. A Floresta tem 200×200 tiles = 400 m × 400 m.

**2. Regra de colisão (importante)**
- O servidor **não tem obstáculos**: no navegador todo mundo atravessa árvores. Na Unreal, árvores, pedras e
  arbustos **não bloqueiam** o herói nem os monstros (sem colisão de movimento). Senão o herói da Unreal fica preso
  onde os outros passam, e a posição dele se desencontra da do servidor.
- O clique para andar continua batendo só no chão (`ECC_Visibility` no Landscape); a vegetação ignora esse canal.
- Clareiras, portais, acampamento e pontos de monstros ficam livres de árvores (ver PCG abaixo), para a câmera de
  cima ver a luta.

**3. Montar a Floresta** (`L_forest_01`)
- Landscape de 400 m × 400 m com origem no canto (tile 0,0 = 0,0 uu). Altura quase plana (o servidor é 2D: morros
  leves só nas bordas e fora das áreas de luta, sem mudar a altura onde se anda além de ±1 m).
- Script Python do editor (`Content/Python/import_layout.py`) lê o JSON e cria/atualiza, marcando tudo com a tag
  `DFLayout` (rodar de novo substitui sem duplicar):
  - **Portais** (`ADFPortal`): anel com Niagara e o nome do destino; cor por estado (`locked` do `map_info` em tempo
    de execução).
  - **NPCs** (`ADFNpc`): modelo provisório + nome; o Ancião Aldric perto do acampamento.
  - **Acampamento**: tendas, bancos, caixotes, barril, estandarte, fogueira e braseiros com luz e Niagara de fogo.
  - **Lugares escondidos** (`ADFPlace`): o objeto de cada um (`look`: santuário, poço, túmulo, círculo de
    cogumelos...) com brilho na cor `glow`. A **Árvore-Mãe Morta** (marco, 72,52) é a peça grande do mapa:
    árvore morta gigante, visível de longe, numa clareira de 10 tiles.
  - **Volumes de exclusão** do PCG para clareiras, portais, acampamento, pontos de monstros (raio = `wander`) e
    lugares.
- **PCG** (o framework de geração do UE 5.8) espalha a floresta: pinheiros e carvalhos densos, árvores mortas nas
  áreas mais abertas, arbustos, pedras, tocos, cogumelos e lápides (mesma mistura do navegador), respeitando as
  exclusões e deixando trilhas ligando acampamento → portais → pontos de monstros.
- Clima: névoa exponencial de altura + névoa volumétrica, luz da lua fria, raios de luz entre as árvores,
  vagalumes (Niagara) nas clareiras. Escuro como o navegador (`darkness 0.5`), mas legível de cima.
- Noite do jogo: a mensagem `daynight` (`night` true/false, `left` = segundos até virar) já chega ao entrar e a
  cada troca. De noite, escurecer a luz e aumentar a névoa em ~5 s (no navegador a noite é +0,16 de escuridão).

**4. Modo "nível montado" no cliente**
- Hoje `UDFWorldSubsystem::AttachWorld` cria chão e portais provisórios. Se o nível tiver atores `DFLayout` (ou um
  ator `ADFLevelInfo` marcando "montado"), não criar o chão nem os portais provisórios; só posicionar o herói.
- A altura do herói, dos monstros e dos outros jogadores segue o chão: traço para baixo no Landscape (com cache por
  ator, 5–10 vezes por segundo), em vez do Z fixo 96.

**5. Heróis** (os 3, com animação)
- Fonte: `art-source/mixamo/<classe>/` do repositório `jogodrk` (Mestre das Lâminas = paladino com espada e escudo,
  Grande Feiticeiro, Patrulheiro da Noite). O `art-source/units.json` diz qual arquivo é cada animação
  (`idle`, `walk`, `run`, `attack`, `cast`, `hit`, `death`).
- Importar como Skeletal Mesh + animações para `Content/Characters/Heroes/<classe>/` (só os `.uasset` vão para o
  Git; os `.fbx` crus **não**). Um Animation Blueprint simples: parado/andar/correr pela velocidade, e montagens
  para ataque, magia, levar golpe e morrer.
- Escala: herói ~1,85 m. Gira para onde anda e para o alvo ao atacar.
- O `cls` escolhe o modelo: do seu herói vem no `hero`; dos outros jogadores vem no `player_spawn` e em cada item
  do `nearby_snapshot` (campo `cls`, junto de `level`, `title`, `aura`, `pet`, `mount`). Skins e montarias ficam para a Etapa 5.

**6. Monstros da Floresta**
- Lobo Sombrio (`wolf`): `art-source/sources/Labrador_AllAnimations.glb` (o navegador usa ele escurecido e
  azulado); Goblin da Floresta (`goblin`) e Treant Corrompido (`treant`): `art-source/mixamo/goblin` e `treant`
  (Creature Pack). Mesmo esquema: andar, atacar, levar golpe, morrer.
- `ADFMob::ConfigureModel(def_id, boss)` passa a escolher a malha por uma tabela (`DataTable` ou mapa em C++); o que
  não tiver modelo continua cápsula.

**7. Efeitos Niagara** (as skills que mais aparecem no começo)
- Ataque básico das 3 classes (`bm_basic` corte, `gs_basic` orbe, `nr_basic` flecha).
- Mestre das Lâminas: `bm_slash` (Golpe Cortante), `bm_twisting_slash` (Corte Giratório), `bm_charge` (Investida).
- Grande Feiticeiro: `gs_fireball` (Bola de Fogo), `gs_ice_lance` (Lança de Gelo), `gs_frost_nova` (Nova
  Congelante).
- Patrulheiro: `nr_quick_shot` (Tiro Rápido), `nr_piercing_arrow` (Flecha Perfurante), `nr_shadow_step` (Passo
  Sombrio).
- Mais: impacto genérico, morte de monstro, subir de nível, renascer, portal, fogueira, vagalumes, `stun`/`freeze`/
  `slow`. As outras skills continuam com o efeito provisório da Etapa 2 até a Etapa 5.

**8. Desempenho**
- Meta: 60 qps em placa média (GTX 1660 / RX 580) a 1080p com a câmera de cima, 96 monstros e ~20 jogadores.
- Nanite na vegetação, Lumen ligado com opção de desligar, distâncias de corte para vegetação pequena,
  monstros longe já escondidos (Etapa 2).

**9. Teste**
- `scripts/test_stage_three.py` (ou extensão do da Etapa 2) no servidor isolado: entrar na Floresta pelo portal da
  Vila, andar até cada ponto de monstro e lugar escondido checando que o caminho não tem bloqueio (o herói chega na
  posição pedida), lutar um pouco, capturas em 4 lugares (acampamento, Árvore-Mãe, ponto dos lobos, portal do
  Pântano) e medir o tempo de quadro.
- **Pronto quando:** a Floresta está bonita e escura, os 3 heróis e os 3 monstros têm modelo e animação, as skills
  do começo têm efeito de verdade, nada bloqueia o caminho, e quem joga no navegador e na Unreal continua se vendo
  nos mesmos lugares.

### Etapa 4 — Telas
- Inventário e equipamentos, lojas e NPCs (diálogos), missões (História, Diárias), chat, avisos, mapa do mundo.
- **Pronto quando:** dá para jogar o começo do jogo só pela Unreal: falar com o Ancião, aceitar e entregar a missão,
  comprar poção no curandeiro, vender o que caiu, equipar, conversar no chat com quem está no navegador e se
  teleportar pelo mapa do mundo.

Detalhes da Etapa 4 (referência: `client/src/scenes/HUDScene.ts`, `InventoryUI.ts`, `ShopUI.ts`, `ChatUI.ts`,
`DiaryUI.ts`, `WorldMapUI.ts` e `GameScene.ts` no repositório `jogodrk`; só leitura):

**0. Base das telas**
- Continuar com widgets em C++, como nas etapas anteriores, mas com o visual num lugar só (`DFUIStyle`: cores,
  fontes, tamanhos, cor de raridade vinda de `/meta` `rarity`), para o Pedro trocar a aparência depois sem mexer na
  lógica.
- Um gerenciador de janelas: abre e fecha por tecla, **Esc fecha a janela de cima** antes de limpar o alvo, uma
  janela grande por vez (inventário pode ficar aberto junto com a loja).
- **Clique em cima de janela não anda nem escolhe alvo.** Com o chat digitando, nenhuma tecla do jogo funciona
  (1–0, Espaço, WASD, Q/E, letras).
- Teclas iguais às do navegador: **I** inventário, **N** mapa do mundo, **J** diário (missões), **Enter** chat,
  **Q** poção de vida, **E** poção de mana, **Esc** fecha. O **ataque automático sai do Q e vai para o Z** (o
  navegador não usa Z); atualizar o texto do botão no HUD.
- Números grandes com `DF::Big`. Os textos que vêm do servidor já estão em português: mostrar como vieram.

**1. Avisos**
- `notice {text, kind}`: faixa no centro da tela, cor por tipo (`info` branco, `warn` laranja, `quest` dourado),
  até 3 ao mesmo tempo, somem em ~4 s. Os erros das ações (comprar sem ouro, bolsa cheia...) chegam assim.
- `story_end {chapter, title, text}`: janela grande com o texto do fim do capítulo e um botão "Continuar".

**2. NPCs e diálogos**
- No modo provisório (nível não montado), criar `ADFNpc` a partir de `map_info.npcs`, como já é feito com os
  portais. Os NPCs respondem ao canal de clique (DFClick) e mostram o cursor de mão.
- Clicar no NPC: andar até ficar a 5 tiles dele (o servidor aceita até 6) e mandar `talk {npc}`.
- `dialog {npc, name, title?, lines[], options[{id, label}]}`: janela com nome, título, falas e um botão por
  opção → `dialog_option {option}`, mais o botão "Fechar". Fecha sozinha se o herói se afastar mais de 7 tiles do
  NPC. Os convites (`npc` = `duel`, `guild`, `friend`, `party`) não têm NPC no mapa: usam a mesma janela e não
  fecham pela distância.
- Opção `shop:<loja>` → o servidor manda `shop` (ou `forge`) e `inventory`: abrir a loja (item 4). A forja e o
  mercado ficam para a Etapa 5: em `forge`, mostrar "A forja chega numa próxima versão" e mandar `close_shop`; a
  opção `market` não é mandada, só mostra o mesmo tipo de aviso.

**3. Inventário e equipamento**
- `inventory {bag, gear, gold, shop, cap}`. `bag` é uma lista de `{id, qty, plus?, ref?, ench?}`; `gear` tem os
  espaços `weapon, armor, legs, boots, ring, necklace`, cada um com `{id, plus, ref, ench?}` ou vazio. Os dados do
  item (nome, raridade, espaço, classe, atributos, preço) estão em `/meta` `items`.
- Janela: os 6 espaços de equipamento, a grade da bolsa (`cap` espaços, com rolagem) e o ouro. Ao passar o mouse:
  nome na cor da raridade, +N, atributos já com o +N (`upgrade_step` = 7% por +1), refino, encantamento, preço de
  venda (25% do preço) e a marca de "melhor que o equipado", calculada como no navegador (`score_weights`,
  `ref_weight`). Item de outra classe aparece em vermelho.
- Ações: clique duplo ou "Equipar" → `equip {index, item}`; no espaço equipado → `unequip {slot}`; "Equipar o
  melhor" → `auto_equip`; "Descartar" pede confirmação → `discard {index, item}`. Mandar sempre `index` **e**
  `item`: o servidor confere se o item ainda está naquele lugar.
- Q/E → `use_potion {kind: "hp" | "mp"}`. Mostrar no HUD quantas poções de cada tipo há na bolsa e a recarga de 3 s.

**4. Loja**
- `shop {shop, name, items[]}`: janela da loja ao lado do inventário. Comprar → escolher quantidade (1 a 20) →
  `buy {item, qty}`. Com a loja aberta, vender da bolsa → `sell {index, item, qty}` (pilha: perguntar quantos).
  Seguir as confirmações do `ShopUI.ts` (antes de vender item raro ou melhor que o equipado).
- Fechar a loja (botão, Esc ou se afastar mais de 7 tiles) → `close_shop`.

**5. Missões**
- História: `hero.story {q, st, n}` com `/meta` `quests[q]` (`title`, `goal_text`, `count`). Painel pequeno fixo no
  canto: título e "goal_text (n/count)"; quando `st` = `ready`, "Volte ao Ancião Aldric"; quando `st` = `offer`,
  "Fale com o Ancião Aldric". Atualiza com a mensagem `story`.
- Diárias: `daily {day, bonus, tasks[{text, n, count, claimed}]}`, que chega ao entrar e quando avança. A janela J
  tem duas abas, História e Diárias. A recompensa da diária se recebe falando com o Sargento (opção `daily_claim`
  do diálogo): a janela só mostra o progresso.

**6. Chat**
- Caixa no canto de baixo à esquerda, últimas 50 mensagens. Enter abre e manda, Esc cancela. Canais: Mapa,
  Global, Grupo e Guilda, mais o sussurro. Copiar os comandos do `ChatUI.ts` (sussurro com `/s Nome texto`,
  responder etc.).
- Envio: `chat {channel, text, to?}` (`channel` = `map`, `global`, `party`, `guild` ou `whisper`; `to` = nome no
  sussurro). Recebe `chat {channel, from, from_id, text, pk, title, to?}`. Os canais `event` e `guild_info` vêm
  sem `from`: são textos do sistema, em dourado. Nome de assassino (`pk` = `red`) em vermelho.

**7. Mapa do mundo**
- N → manda `world_map` e recebe `world_map {current, gold, maps[{id, name, theme, level, unlocked, cost}],
  links[[a, b]]}`. Desenhar os mapas como pontos ligados (posições copiadas do `WorldMapUI.ts`), o atual em
  destaque e os bloqueados apagados. Clicar num liberado → confirmar o custo → `teleport {map}`. A resposta é
  `map_change` (já tratado) ou um `notice` de erro.

**8. Teste** (`scripts/test_stage_four.py`, servidor isolado na porta 18000, cópia do banco, conta nova):
- falar com o Ancião, aceitar a primeira missão, matar os monstros pedidos, entregar e ver EXP, ouro e o painel
  da missão mudarem;
- curandeiro: comprar 2 poções, usar com Q e ver a contagem cair;
- vender um item que caiu, equipar, desequipar, "Equipar o melhor", descartar com confirmação;
- chat: mandar da Unreal e ver no navegador de verdade, e o contrário; sussurro entre os dois;
- mapa do mundo: abrir, teleportar para um mapa liberado, e não conseguir clicar num bloqueado;
- Esc fecha a janela antes de limpar o alvo; com o chat aberto, 1 e Espaço não usam skill; clique na janela não
  anda; Z liga e desliga o ataque automático e Q usa poção;
- uma captura de cada janela, e a regressão das Etapas 2 e 3.

### Etapa 5 — O resto (em 5 partes)
A Etapa 5 é grande demais para uma tarefa só. Cada parte termina jogável e testada, e a seguinte só começa depois
da revisão da anterior:

| Parte | O que entra | Pronto quando |
|---|---|---|
| **5A — O mundo inteiro** | Os outros 11 mapas montados, modelo de todos os monstros, NPCs e bosses, mineração, lugares escondidos | dá para ir da Vila até o Vazio pela Unreal, caçando em cada mapa, e minerar |
| **5B — PvP e social** | Arena, cor do nome (PK), vida dos outros jogadores, duelo, torneio, grupo, guilda, amigos | duas pessoas (Unreal e navegador) se enfrentam na Arena, fazem grupo e guilda |
| **5C — Eventos** | Boss Global, invasão, missão secreta, Auto-Farm do servidor | dá para entrar no Boss Global e participar de uma invasão |
| **5D — Economia e progresso** | Forja, mercado, passe da temporada, loja de gemas, conquistas, calendário de login, ranking, tutorial, janela do Personagem (título, aura, pet, montaria, skin) | tudo o que o navegador tem de janela existe na Unreal |
| **5E — Lançamento** | Build Windows empacotado, configurações de gráfico, servidor de produção, medição na GTX 1660, Android | um instalador para Windows joga no servidor de verdade |

Na 5B o servidor passou a mandar a vida dos outros jogadores (`hp`/`max_hp` nas informações do jogador e a mensagem
nova `player_hp`).

**Situação (19/11/2026):** as partes 5A a 5D foram feitas pelo Claude neste repositório e passaram nos testes
`scripts/test_stage_5a.py` … `test_stage_5d.py`; a 5E tem as Opções, o endereço de produção e o empacotamento para
Windows. Detalhes e o que falta para você no editor: `docs/ETAPA_5.md` (no repositório unrealengine221).

Detalhes da Parte 5A (o mundo inteiro):

**0. O que já existe**
- `DarkFantasy/Data/Layouts/<map_id>.json` dos 12 mapas (portais, NPCs, clareiras, pontos de monstros, lugares).
- `import_layout.py`, os atores `ADFPortal`, `ADFNpc`, `ADFPlace`, `ADFLevelInfo`, o nó PCG `DFServerForestLayout` e
  o dither da vegetação, todos feitos para a Floresta.
- `import_characters.py` lê `art-source/units.json` (só leitura) para os 6 modelos da Floresta.

**1. Um nível montado por mapa**
- Generalizar `import_layout.py` para qualquer mapa (`DF_MAP=swamp_01`, ou todos). Cada nível ganha Landscape do
  tamanho de `size` (1 tile = 200 uu), `ADFLevelInfo`, portais, NPCs, lugares, luz e névoa.
- Um "tema" por mapa (`theme` do layout) escolhe vegetação, pedras, chão, luz, névoa e partículas do ar. Generalizar
  o nó PCG para receber as categorias do tema, sempre respeitando clareiras, pontos de monstros, portais, lugares e
  corredores, e **sem colisão de movimento** (o servidor não tem obstáculos):
  - `town` (Vila, 40×40, segura): praça, casas e muros nas bordas, tochas; nada de mata no meio;
  - `crypt` (Catacumbas, 60): chão de pedra, pilares, túmulos, velas, escuro com pontos de luz;
  - `mine` (Minas, 70): cavernas, trilhos, vigas de madeira, lanternas;
  - `swamp`, `frost`, `ash`, `crimson`, `ghost`, `void` (120–130): cada um com sua paleta (pântano verde e névoa
    baixa; neve e pinheiros brancos; cinza e lava; vermelho-sangue; fantasmagórico azulado; vazio roxo com
    cristais);
  - `arena` (Arena e Boss Global, 30): arena de pedra fechada, sem vegetação.
- Arte provisória própria, como na Etapa 3, e uma lista do Fab/Megascans **por tema** para o Pedro escolher
  (nome do pacote, link, pasta de destino). Nada é comprado nem baixado na conta dele.
- O modo provisório (cápsulas e chão de grade) continua funcionando para qualquer mapa que ainda não tenha nível.

**2. Modelos de todos os monstros, NPCs e bosses**
- Estender `import_characters.py` para todas as entradas `mob_*`, `npc_*` e `wb_*` do `units.json`. Muitas
  reaproveitam o mesmo corpo do Mixamo; a cor vem de `grade` (`tint`, `desat`, `gain`) num material instanciado,
  e a altura de `height`. Só os `.uasset` entram no projeto; os `.fbx`/`.glb`/`.zip` crus ficam em `Saved/`.
- `def_id` do monstro → perfil `DA_<def_id>`. Boss (`boss: true`) continua maior. Os bosses globais (`wb_*`) já
  ficam prontos para a Parte 5C.
- NPCs do mapa com modelo e animação parada: `elder` → `npc_elder`, `healer` → `npc_healer`, `merchant` →
  `npc_merchant`, `smith` → `npc_smith`; `arena_master`, `sergeant` e `foreman` → `npc_warrior`.
- O dragão de cinzas (`mob_ash_dragon`) vem de um `.glb` com animações próprias (nomes em `anims`).

**3. Mineração (Minas)**
- Ao entrar nas Minas chega `veins {veins[{id, kind, x, y, ready}]}`; cada mudança chega como `vein {id, kind, x, y,
  ready}`. Mostrar cada veio com aparência pelo `kind` e apagado quando `ready` = false.
- Clicar no veio: andar até 2 tiles dele (o servidor aceita até 2,4) e mandar `mine {vein}`. Precisa de Picareta na
  bolsa (sem ela o servidor manda um `notice` com onde comprar).
- `mining {char_id, vein, dur}`: animação de minerar no herói (o seu ou outro) e barra de progresso para o seu.
  Andar mais de 0,8 tile cancela no servidor: avisar e parar a barra. `mining_end {char_id, ok}` encerra.
- O minério chega como item na bolsa (`inventory`) e serve para a forja (Parte 5D).

**4. Lugares escondidos**
- `discovered {id, name, lore, bonus, landmark, map_n, map_total, map_gold, n, total, title}`: janela com nome, texto,
  bônus e "N de M neste mapa". O `ADFPlace` daquele lugar brilha diferente depois de achado (`hero.found` traz os já
  achados ao entrar).

**5. Desempenho**
- Cada mapa grande no mínimo como a Floresta (meta de 60 FPS; medir com 100 monstros e 20 jogadores). O teste
  registra média e p95 por mapa.

**6. Teste** (`scripts/test_stage_5a.py`, servidor isolado na porta 18000, cópia do banco, conta nova):
- herói de teste com a história concluída e nível alto (só na cópia do banco) percorre todos os mapas pelos portais e
  pelo teleporte, chega a cada portal e a cada ponto de monstro (erro menor que 65 cm);
- cada tipo de monstro aparece com o próprio modelo e muda de pose (lista igual à `animated_models` da Etapa 3);
- compra Picareta, minera um veio até o fim e recebe o minério; andar durante a mineração cancela;
- descobre um lugar escondido e vê a janela;
- navegador real confere as posições em pelo menos dois mapas;
- uma captura por mapa e a regressão das Etapas 2, 3 e 4.

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

## Tarefa da Etapa 3 para o Codex (copiar e colar)

> **Só comece depois que o Pedro deixar o repositório `unrealengine221` privado.** Trabalhe em
> `C:\Users\pedro\Documents\unrealengine221`. Leia `AGENTS.md`, `docs/PLANO.md` (seção **Etapa 3** e os "Detalhes da
> Etapa 3"), `docs/PROTOCOLO.md` e a memória kg (nós `unreal-etapa-2-revisada` e `unreal-etapa-3-plano`). O layout de
> cada mapa já está em `DarkFantasy/Data/Layouts/<map_id>.json`. Faça a Etapa 3 na ordem: (a) modo "nível montado"
> e altura pelo chão; (b) `import_layout.py` + atores `ADFPortal`, `ADFNpc`, `ADFPlace`, acampamento e volumes de
> exclusão; (c) PCG da floresta em `L_forest_01` com vegetação **sem colisão de movimento**; (d) heróis e monstros
> da Floresta importados de `C:\Users\pedro\Downloads\novo jogo 2.2\art-source` (só leitura; só os `.uasset`
> importados entram no projeto, nunca os `.fbx`/`.glb`/`.zip` crus), com Animation Blueprint; (e) efeitos Niagara
> da lista; (f) luz, névoa, noite (`daynight`) e desempenho. Onde precisar de arte do Fab/Megascans, use um
> provisório e deixe uma lista do que o Pedro deve baixar (nome do pacote e onde colocar). Não mude `server/` nem o
> protocolo. Teste no servidor isolado (porta 18000). Não faça commit. Quando terminar, descreva como testar, liste
> o que o Pedro precisa fazer no editor e grave as decisões no kg.

## Tarefa da Etapa 4 para o Codex (copiar e colar)

> Trabalhe em `C:\Users\pedro\Documents\unrealengine221`. Leia `AGENTS.md`, `docs/PLANO.md` (seção **Etapa 4** e
> os "Detalhes da Etapa 4"), `docs/PROTOCOLO.md` (3.3) e a memória kg (nós `unreal-etapa-3-aprovada` e
> `unreal-etapa-4-plano`). A referência de comportamento é o jogo de navegador em
> `C:\Users\pedro\Downloads\novo jogo 2.2\client\src\scenes\` (`HUDScene.ts`, `InventoryUI.ts`, `ShopUI.ts`,
> `ChatUI.ts`, `DiaryUI.ts`, `WorldMapUI.ts`; só leitura). Faça a Etapa 4 na ordem dos itens 0 a 7: base das telas
> (inclusive mover o ataque automático do Q para o Z e deixar Q/E nas poções), avisos, NPCs e diálogos, inventário,
> loja, missões, chat e mapa do mundo. Todo texto que o jogador vê em português simples. O servidor manda em
> tudo: o cliente só pede e mostra a resposta. Não mude `server/` nem o protocolo; se faltar algum campo, anote e
> me avise. Teste no servidor isolado (porta 18000, cópia do banco, contas novas) com o item 8. Não faça commit.
> Quando terminar, descreva como testar e grave as decisões no kg.

## Tarefa da Parte 5A para o Codex (copiar e colar)

> Trabalhe em `C:\Users\pedro\Documents\unrealengine221`. Leia `AGENTS.md`, `docs/PLANO.md` (a tabela da **Etapa 5** e
> os "Detalhes da Parte 5A"), `docs/PROTOCOLO.md` e a memória kg (nós `unreal-etapa-4-concluida` e
> `unreal-etapa-5a-plano`). Os layouts já estão em `DarkFantasy/Data/Layouts/`; os modelos vêm de
> `C:\Users\pedro\Downloads\novo jogo 2.2\art-source` (só leitura; só os `.uasset` importados entram no projeto,
> nunca `.fbx`/`.glb`/`.zip` crus). Faça a Parte 5A na ordem dos itens 1 a 5: um nível montado por mapa com tema
> (vegetação e props **sem colisão de movimento**), modelos de todos os monstros, NPCs e bosses pelo `units.json`,
> mineração, lugares escondidos e desempenho. Onde precisar de arte do Fab/Megascans, use um provisório e deixe uma
> lista por tema do que o Pedro deve escolher. Não mude `server/` nem o protocolo. Teste no servidor isolado (porta
> 18000) com o item 6. Não faça commit. Antes de compilar, confira se o editor da Unreal está fechado (com ele aberto
> o Live Coding bloqueia). Quando terminar, descreva como testar, liste o que o Pedro precisa fazer no editor e grave
> as decisões no kg.
