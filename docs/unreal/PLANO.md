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
