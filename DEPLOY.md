# Deploy no Easypanel

Use um projeto no Easypanel com um Postgres e dois serviços App, ambos ligados ao mesmo repositório GitHub. Troque os domínios e os valores de exemplo pelos seus.

## 1. Postgres

1. Crie um projeto e adicione um serviço **Postgres**.
2. Configure o nome do banco, o usuário e uma senha forte. Mantenha o armazenamento persistente do serviço.
3. Copie a URL de conexão interna fornecida pelo Easypanel. Ela será o `DATABASE_URL` do backend. Não use `localhost` e não exponha o banco em um domínio público.

## 2. Backend

1. Adicione um serviço **App**, por exemplo `api`.
2. Em **Source**, escolha **GitHub**, selecione o repositório e a branch desejada e configure **Build Path** como `server`.
3. Em **Build**, escolha **Dockerfile**, com caminho `Dockerfile`. O contexto de build deve ser `server`, pois os imports Python usam essa pasta.
4. Cadastre estas variáveis no ambiente do serviço:

   ```dotenv
   MMORPG_ENV=production
   DATABASE_URL=postgres://usuario:senha@host:5432/banco
   SECRET_KEY=troque_por_uma_chave_aleatoria
   CORS_ORIGINS=https://jogo.seudominio
   ```

   Use a URL real do Postgres. Os prefixos `postgres://` e `postgresql://` são convertidos automaticamente para `postgresql+asyncpg://`. Em produção, a URL é obrigatória. Para vários frontends, separe as origens por vírgula, sem caminho ou barra final.

5. Configure a porta interna **8000**. Mantenha uma réplica: o estado ativo do jogo fica na memória do processo.
6. Adicione o domínio `api.seudominio`, apontando para HTTP na porta interna 8000. Configure o DNS para o servidor e habilite HTTPS no Easypanel.
7. Configure o health check HTTP para **`/health`**, porta **8000**. Ele responde `{"ok": true}` sem consultar o banco.
8. Clique em **Deploy** e confira os logs. Na inicialização, o backend conecta ao banco e prepara as tabelas.

**Nunca defina `GAME_DEV_TOOLS` em produção.** O código também bloqueia as ferramentas fora do ambiente `dev`.

## 3. Frontend

1. Adicione outro serviço **App**, por exemplo `jogo`.
2. Em **Source**, escolha **GitHub** e o mesmo repositório e branch. Configure **Build Path** como `client`.
3. Em **Build**, escolha **Dockerfile**, com caminho `Dockerfile`.
4. Configure `VITE_API_URL=https://api.seudominio` no ambiente do serviço. O Easypanel passa esse valor como argumento de build, recebido pelo `ARG VITE_API_URL` do Dockerfile.
5. Configure a porta interna **80** e o domínio `jogo.seudominio`, apontando para HTTP nessa porta. Configure o DNS e habilite HTTPS no Easypanel.
6. Clique em **Deploy**. O build gera os arquivos estáticos e o Nginx os publica. Se mudar `VITE_API_URL`, faça um novo build: essa variável fica incorporada ao JavaScript.

O WebSocket passa pelo proxy do Easypanel, usando o mesmo domínio e porta interna da API, no caminho `/ws/...`. Com a API em HTTPS, o cliente usa `wss://` automaticamente. Não precisa de um serviço ou porta pública extra para WebSocket.

## 4. Conferência

- Abra `https://api.seudominio/health` e confirme `{"ok": true}`.
- Abra `https://jogo.seudominio` e teste login e conexão ao jogo.
- Confirme que `CORS_ORIGINS` contém exatamente a origem HTTPS do frontend.
- Os arquivos `.env.example` são modelos sem segredos; o backend recebe as variáveis pelo ambiente do Easypanel, sem carregar esses arquivos automaticamente.
- Em desenvolvimento, sem variáveis, continuam valendo SQLite, CORS `*` e API local na porta 8000.
- O `.gitignore` exclui bancos, segredos, outros projetos e modelos 3D de origem. Os sprites renderizados de `client/public/sprites/` continuam incluídos. Arquivos que já estiverem rastreados não deixam de ser rastreados apenas por adicionar o `.gitignore`; revise isso antes de publicar.

Referências: [builds e argumentos no Easypanel](https://easypanel.io/docs/builders) e [serviços App](https://easypanel.io/docs/services/app).

## Chave das contas

SECRET_KEY é obrigatória em produção, com pelo menos 32 caracteres. Gere uma chave com:
```sh
python -c "import secrets; print(secrets.token_urlsafe(48))"
```
Guarde a chave no ambiente do backend. Trocar a chave encerra as sessões existentes. O proxy deve substituir X-Forwarded-For pelo IP real; mantenha o backend acessível apenas pelo proxy.
