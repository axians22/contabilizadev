# Login e autorização

Portados do horizons (`backend/src/auth`), com a sessão em cookie em vez de JWT no `localStorage`:

- O navegador recebe o ID token do Google Identity Services; a server action confere no servidor com
  `google-auth-library` (`audience = GOOGLE_CLIENT_ID`, `email_verified` obrigatório) e faz o upsert do usuário por e-mail.
- Sessão: cookie `httpOnly`, `SameSite=Lax`, `Secure` e prefixo `__Host-` em produção, com o token assinado por HMAC
  (`SESSAO_SEGREDO`). O banco (`sessoes`) guarda só o hash do token e vale 30 dias; Sair apaga a sessão no banco.
- A cada requisição o usuário é relido do banco: desativar a conta ou mudar o papel vale na hora.
- Fechado por padrão: o proxy barra quem não tem cookie, e toda página, route handler e server action confere a
  sessão no servidor (`exigirSessao`, `exigirAreaDoAdmin`, `comSessao` em `lib/autenticacao/servidor.ts`). O teste
  `testes/fechado-por-padrao.test.ts` falha se uma rota nova esquecer.
- Papéis: `COMMON_USER`, `MANAGER` e `ADMIN`. ADMIN só pela lista `ADMIN_EMAILS`, reavaliada a cada requisição
  (sair da lista tira o ADMIN na requisição seguinte, sem novo login; gravar ADMIN direto no banco não vale nem na sessão
  aberta, e a coluna é corrigida). O ADMIN promove/rebaixa MANAGER; o MANAGER vê a lista e desativa usuários comuns.
- **Localmente não há login.** Com `AUTH_DISABLED=true` (o padrão do `.env.exemplo` e do `.env.local` de
  desenvolvimento) e fora de produção (`NODE_ENV !== "production"`), abrir `http://localhost:3001` cai direto no
  painel: o proxy manda quem não tem cookie para `/sessao-local`, um route handler que cria (se faltar) a conta
  `DEV_USER_EMAIL`, grava o cookie de sessão e volta para a página pedida. Não há tela `/entrar` nem botão; Sair
  volta ao painel com uma sessão nova. API sem cookie continua com 401 (o navegador já terá o cookie).
- Em produção o login com Google é obrigatório e `AUTH_DISABLED` é ignorado (com aviso na subida): `/sessao-local`
  fica fechada e, se chamada, não abre nada. As sessões da conta de desenvolvimento deixam de valer quando o login é
  religado. Para testar o login de verdade localmente, tire `AUTH_DISABLED=true` do `.env.local`.

## Client ID do Google

1. No [Google Cloud Console](https://console.cloud.google.com/), crie (ou escolha) um projeto.
2. APIs e serviços → Tela de permissão OAuth: tipo "Externo", nome do app, e-mail de suporte; escopos `openid`, `email`,
   `profile` (os padrões). Enquanto estiver "Em teste", só os usuários de teste cadastrados ali conseguem entrar.
3. APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth → tipo "Aplicativo da Web".
4. Origens JavaScript autorizadas: `http://localhost:3001` (npm run dev) e `http://localhost:3002` (Docker). Em produção,
   o domínio com HTTPS. Não precisa de URI de redirecionamento (o botão usa popup).
5. Copie o ID do cliente (`....apps.googleusercontent.com`) para `GOOGLE_CLIENT_ID` no `plataforma/.env.local` e reinicie.

Sem `GOOGLE_CLIENT_ID`, a tela de entrada mostra "Login com Google não configurado". Localmente isso não atrapalha:
com `AUTH_DISABLED=true` (o padrão local) não há tela de login.
