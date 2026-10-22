# Produção com o Coolify

Passo a passo para pôr o ContabilizaDev no ar num servidor próprio (VPS) com o **Coolify v4 self-hosted**. A mesma lista
aparece na área do administrador, em **Produção** (`/admin/producao`, só ADMIN), com a conferência do ambiente ao vivo no
topo. A fonte dos passos é `plataforma/lib/producao/guia.ts`; o teste `plataforma/testes/producao.test.ts` confere que
este arquivo tem os mesmos passos e as mesmas fontes.

Fontes: a documentação oficial do Coolify (<https://coolify.io/docs>, conferida em 22/10/2026) e o próprio código do
projeto. Onde a documentação não detalha uma tela, o passo diz o que fazer sem inventar o caminho.

## Conferência do ambiente (`/admin/producao`)

O servidor confere sozinho, sem chamar nenhum serviço externo, e mostra OK/Falta (o detalhe no tooltip; nunca o valor de
um segredo, só presente/ausente): `NODE_ENV` é `production`; login desligado inativo (`AUTH_DISABLED` ausente); cookie de
sessão seguro (`__Host-sessao`, Secure); `SESSAO_SEGREDO`, `TOKEN_CHAVE` e `PLATAFORMA_CHAVE` presentes e válidas;
`GOOGLE_CLIENT_ID` definido; `ADMIN_EMAILS` sem a conta de desenvolvimento; banco acessível e migrações em dia (tabela
`drizzle.__drizzle_migrations` contra `banco/migracoes/meta/_journal.json`); certificado da plataforma guardado no banco
(não pelo ambiente) e com mais de 30 dias de validade; chaves do contrato guardadas; `PLATAFORMA_CNPJ` e
`PLATAFORMA_RAZAO_SOCIAL` definidos; HTTPS na requisição atual (`x-forwarded-proto`). No computador de desenvolvimento,
vários itens aparecem como Falta: é o esperado.

Código: `plataforma/lib/producao/conferencia.ts` (regra pura) e `plataforma/lib/producao/servidor.ts` (lê banco,
certificado guardado e cabeçalhos).

## Rota de saúde (`GET /api/saude`)

Para o health check do Coolify e o monitor de disponibilidade. Pública (está em `ROTAS_PUBLICAS`,
`plataforma/lib/autenticacao/rotas.ts`), sem sessão: responde `200 {"ok":true}` quando a aplicação e o banco respondem e
`503 {"ok":false}` quando o banco não responde ou demora mais de 3 s. Não revela versão, segredo nem dado, não chama
serviço externo e vai com `cache-control: no-store`. Código: `plataforma/app/api/saude/route.ts` e
`plataforma/lib/producao/saude.ts`.

## 1. Servidor

Um VPS Linux com o Coolify instalado e o painel protegido.

- [ ] Contrate um VPS com pelo menos 2 núcleos, 2 GB de RAM e 10 GB livres (amd64 ou arm64), com Ubuntu LTS ou Debian.
  - São os mínimos do Coolify, que manda aumentar a RAM conforme a carga cresce e acompanhar o uso, porque uso alto pode travar o servidor.
  - Sugestão nossa, não da documentação: com o Postgres e o build do Next no mesmo servidor, 4 GB de RAM dão folga.
  - A documentação recomenda Ubuntu LTS (20.04, 22.04 ou 24.04); fora de LTS o instalador pode se comportar diferente, e aí use a instalação manual.
  - Fonte: [Coolify: instalação self-hosted](https://coolify.io/docs/start-with-self-hosted)
- [ ] Escolha uma região no Brasil (São Paulo): por exemplo AWS Lightsail em sa-east-1, ou outro provedor com data center em São Paulo.
  - Menos latência para os clientes e os dados (CNPJ, termos, histórico fiscal) ficam no país, o que simplifica a conversa de LGPD da Parte 9.
  - Sugestão nossa, não da documentação do Coolify. Prefira um provedor com firewall no painel (próximo passo).
  - Fonte: [AWS Lightsail: regiões (São Paulo, sa-east-1)](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-regions-and-availability-zones-in-amazon-lightsail.html)
- [ ] Instale o Coolify como root, criando já o administrador (assim a tela de cadastro nunca fica exposta).
  - Sem as variáveis ROOT_*, quem abrir primeiro a tela de cadastro na porta 8000 vira o administrador da instância, com acesso root ao servidor.
  - A senha precisa de 8 caracteres ou mais, com maiúscula, minúscula, número e símbolo. Use uma senha longa gerada pelo gerenciador de senhas.

  ```sh
  env ROOT_USERNAME=admin \
    ROOT_USER_EMAIL=seu-email@exemplo.com \
    ROOT_USER_PASSWORD='SENHA-FORTE-DO-GERENCIADOR' \
    bash -c 'curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash'
  ```

  - Fonte: [Coolify: instalação self-hosted](https://coolify.io/docs/start-with-self-hosted)
- [ ] No painel, ative o 2FA: menu do usuário › Profile › Two-factor Authentication › Configure 2FA.
  - Escaneie o QR code no aplicativo autenticador, valide o código e guarde os códigos de recuperação no gerenciador de senhas, fora do Coolify.
  - Fonte: [Coolify: autenticação em dois fatores](https://coolify.io/docs/core/security/authentication/2fa)
- [ ] Firewall do provedor: libere só 22 (SSH), 80 e 443. As portas 8000, 6001 e 6002 só até o painel ter domínio.
  - A documentação recomenda o firewall do painel do provedor, que barra o tráfego antes de chegar ao servidor, e restringir a regra do SSH sempre que possível.
  - 8000 (painel), 6001 (tempo real) e 6002 (terminal) servem só para o acesso pelo IP. Com o painel num domínio, feche as três: tudo passa a ir por 80 e 443.
  - A porta 5432 do Postgres nunca é aberta.
  - Fonte: [Coolify: firewall](https://coolify.io/docs/core/infrastructure/servers/firewall)
- [ ] Dê um domínio próprio ao painel em Settings › General › URL (ex.: https://painel.contabilizadev.com.br) e feche a 8000.
  - Só depois de o registro DNS do subdomínio apontar para o servidor. Não use o mesmo domínio da aplicação.
  - Fonte: [Coolify: configurações da instância](https://coolify.io/docs/core/instance-management/instance-settings) · [Coolify: domínios](https://coolify.io/docs/core/networking/domains)

## 2. Domínio e HTTPS

contabilizadev.com.br apontando para o servidor, com certificado automático.

- [ ] Registre contabilizadev.com.br no registro.br (livre em 22/10/2026).
  - Domínio .com.br é registrado com o CPF ou o CNPJ do titular: use o CNPJ da plataforma.
  - contabilizadev.com também estava livre, se quiser reservar.
  - Fonte: [Registro.br](https://registro.br/)
- [ ] Na zona DNS do domínio, crie um registro A com o IPv4 público do VPS (e AAAA com o IPv6, se o servidor aceitar IPv6).
  - Para o domínio raiz e para o subdomínio do painel. O registro aponta para o servidor que roda a aplicação.
  - Um curinga (*) não cobre o domínio raiz: crie o registro do raiz à parte.
  - Fonte: [Coolify: DNS](https://coolify.io/docs/core/networking/dns)
- [ ] Na aplicação, em Domains › Add domain, use Protocol https e Domain contabilizadev.com.br; depois faça o redeploy.
  - Com https, o proxy do Coolify pede e renova sozinho o certificado. Para isso o domínio já tem de apontar para o servidor e as portas 80 e 443 têm de estar abertas.
  - Fonte: [Coolify: domínios](https://coolify.io/docs/core/networking/domains)
- [ ] Abra https://contabilizadev.com.br/admin/producao: o item HTTPS da conferência tem de ficar OK.
  - A conferência lê o cabeçalho x-forwarded-proto que o proxy manda. Sem HTTPS, o navegador também recusa o cookie de sessão de produção.
  - Fonte: [Coolify: domínios](https://coolify.io/docs/core/networking/domains) · Conferência do ambiente do projeto (`plataforma/lib/producao/conferencia.ts`)

## 3. Banco de dados

Postgres 17 como recurso do Coolify, só na rede interna.

- [ ] No projeto, New Resource › Databases › PostgreSQL, na mesma destination (rede) da aplicação, com a versão 17.
  - O padrão do Coolify é o 18: escolha o 17, o mesmo do desenvolvimento (docker-compose.dev.yml).
  - Fonte: [Coolify: PostgreSQL](https://coolify.io/docs/databases/postgresql)
- [ ] Deixe o Public access desligado (sem TCP proxy): o banco só é visto pela aplicação.
  - A documentação recomenda a rede privada para a aplicação e expor a 5432 só quando um cliente externo precisar. Aqui, nunca.
  - Fonte: [Coolify: PostgreSQL](https://coolify.io/docs/databases/postgresql)
- [ ] Confira em General a senha gerada pelo Coolify (forte) e guarde no gerenciador de senhas.
  - Se trocar usuário ou senha dentro do Postgres, atualize os campos no Coolify, senão a URL de conexão e os backups param.
  - Fonte: [Coolify: PostgreSQL](https://coolify.io/docs/databases/postgresql)
- [ ] Copie a Postgres URL (internal) para a DATABASE_URL da aplicação. Depois clique em Start e espere ficar saudável.
  - Formato postgres://usuário:senha@container-do-banco:5432/banco: só funciona dentro da rede do Coolify.
  - Fonte: [Coolify: PostgreSQL](https://coolify.io/docs/databases/postgresql)

## 4. Aplicação

Build pelo Dockerfile, a partir do GitHub.

- [ ] Ligue o repositório privado git@github.com:axians22/contabilizadev.git: GitHub App (Sources › New source › GitHub App) ou deploy key (Keys & Tokens › Private Keys).
  - A documentação recomenda a GitHub App (instale só neste repositório) e com ela o deploy no push já vem ligado.
  - Com deploy key: gere a chave no Coolify, cole a pública em Settings › Deploy keys do repositório, sem permissão de escrita, e crie o recurso com Private Repository (with Deploy Key) e a URL SSH.
  - Fonte: [Coolify: GitHub App](https://coolify.io/docs/applications/sources/github/app) · [Coolify: deploy key do GitHub](https://coolify.io/docs/applications/sources/github/deploy-key) · [Coolify: deploy automático do GitHub](https://coolify.io/docs/applications/sources/github/auto-deploy)
- [ ] Crie a aplicação (+ New › Private Repository) com Build pack Dockerfile, Base Directory / e Dockerfile Location /Dockerfile, branch main.
  - O build é feito a partir da raiz do repositório (o Dockerfile copia nucleo/, plataforma/ e o plano.txt).
  - O clone do GitHub não tem o plataforma/.env.local (fora do git): os segredos vêm só das variáveis do Coolify.
  - Fonte: [Coolify: build pack Dockerfile](https://coolify.io/docs/applications/builds/dockerfile) · Dockerfile do projeto (`Dockerfile`)
- [ ] Ports Exposes: 3001 (o next start do container escuta nessa porta).
  - O processo precisa escutar em 0.0.0.0, não só em 127.0.0.1, para o proxy do Coolify alcançar: o next start já escuta em todas as interfaces.
  - Fonte: [Coolify: build pack Dockerfile](https://coolify.io/docs/applications/builds/dockerfile) · Dockerfile do projeto (`Dockerfile`)
- [ ] Migrações: deixe como estão, no CMD da imagem (npm run banco:migrar antes do start). Não use Pre/Post-deployment para elas.
  - O Pre-deployment roda no container ANTIGO, antes de ser trocado, e é pulado no primeiro deploy: aplicaria as migrações do código velho.
  - O Post-deployment roda no container novo só depois de o deploy ser dado como concluído (e uma falha não muda o status): o site novo subiria antes das migrações.
  - No CMD, o site só sobe depois das migrações aplicadas; se uma falhar, o site novo não sobe e o erro aparece nos registros. Rodar de novo não repete as já aplicadas.
  - Fonte: [Coolify: build pack Dockerfile](https://coolify.io/docs/applications/builds/dockerfile) · Dockerfile do projeto (`Dockerfile`)
- [ ] Healthcheck: HTTP, GET, http, Host localhost, Port 3001, Path /api/saude, com Start period de 60 s.
  - /api/saude responde 200 {"ok":true} com o banco no ar e 503 sem ele; é pública e não mostra nada além disso.
  - O check usa curl ou wget de dentro da imagem: a node:22-alpine tem o wget. O Start period cobre as migrações da subida.
  - Depois de salvar, faça o redeploy. Com o container doente, o proxy tira a aplicação do ar (404 ou No available server).

  ```sh
  wget -qO- http://localhost:3001/api/saude
  ```

  - Fonte: [Coolify: health checks](https://coolify.io/docs/applications/configuration/health-checks) · Rota de saúde do projeto (`plataforma/app/api/saude/route.ts`)
- [ ] Clique em Deploy e acompanhe as Deployment Logs; depois confira os registros, a porta, a saúde e o domínio.
  - Fonte: [Coolify: build pack Dockerfile](https://coolify.io/docs/applications/builds/dockerfile) · [Coolify: operação da aplicação (registros)](https://coolify.io/docs/applications/operations/overview)

## 5. Variáveis de ambiente

Os segredos só no Coolify, com cópia das chaves de cifra fora do servidor.

- [ ] Em Environment Variables, cadastre as variáveis da tabela abaixo com Build time em Not available during build.
  - Nenhuma é usada no build: todas são lidas quando o servidor sobe. Fora do build, o segredo não vai parar nas camadas da imagem.
  - O Developer view aceita colar no formato .env. Trocou só valor de execução: Restart basta.
  - Fonte: [Coolify: variáveis de ambiente](https://coolify.io/docs/applications/configuration/environment-variables) · .env.exemplo do projeto (`.env.exemplo`)
- [ ] Gere as chaves no seu computador, uma por variável (a TOKEN_CHAVE e a PLATAFORMA_CHAVE têm de ser diferentes).

  ```sh
  openssl rand -base64 48   # SESSAO_SEGREDO
  openssl rand -base64 32   # TOKEN_CHAVE
  openssl rand -base64 32   # PLATAFORMA_CHAVE
  ```

  - Fonte: .env.exemplo do projeto (`.env.exemplo`)
- [ ] Guarde a TOKEN_CHAVE e a PLATAFORMA_CHAVE no gerenciador de senhas, fora do servidor, antes do primeiro cliente.
  - Perder a TOKEN_CHAVE deixa ilegíveis todos os termos de autorização e tokens guardados: cada cliente assina de novo.
  - Perder a PLATAFORMA_CHAVE deixa ilegíveis o certificado e as chaves do contrato: é preciso enviá-los de novo em /admin/plataforma.
  - O backup do banco não serve sem elas: o que está nele é cifrado.
  - Fonte: .env.exemplo do projeto (`.env.exemplo`)
- [ ] Não crie AUTH_DISABLED nem DEV_USER_EMAIL. NODE_ENV já vem production da imagem.
  - Fonte: Dockerfile do projeto (`Dockerfile`) · .env.exemplo do projeto (`.env.exemplo`)
- [ ] O certificado da plataforma e as chaves do contrato vão pela tela Certificado da plataforma (/admin/plataforma), não por variável.
  - Ficam cifrados no banco com a PLATAFORMA_CHAVE; a senha do .pfx não é guardada. Assim não há arquivo .pfx no servidor.
  - Fonte: .env.exemplo do projeto (`.env.exemplo`)

| Variável | Obrigatória | O que faz | Como gerar |
|---|---|---|---|
| `DATABASE_URL` | Sim | Conexão com o Postgres. Use a Postgres URL (internal) do recurso do banco no Coolify. | — |
| `SESSAO_SEGREDO` | Sim | Assina o cookie de sessão (mínimo 32 caracteres). Sem ela o servidor não sobe. | `openssl rand -base64 48` |
| `TOKEN_CHAVE` | Sim | Cifra o termo de autorização e o token de cada empresa. Perder = termos ilegíveis. | `openssl rand -base64 32` |
| `PLATAFORMA_CHAVE` | Sim | Cifra o certificado e as chaves do contrato da plataforma. Diferente da TOKEN_CHAVE. Perder = certificado ilegível. | `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | Sim | Client ID (Aplicativo da Web) do Google Cloud, para o login com Google. | — |
| `ADMIN_EMAILS` | Sim | Contas Google dos administradores, separadas por vírgula. Sem a conta de desenvolvimento. | — |
| `PLATAFORMA_CNPJ` | Sim | CNPJ da plataforma: contratante do Serpro e destinatário do termo de autorização. | — |
| `PLATAFORMA_RAZAO_SOCIAL` | Sim | Razão social do PLATAFORMA_CNPJ, como a Receita mostra (vai no termo). | — |
| `NODE_ENV` | Sim | Já vem production na imagem (Dockerfile): cookie seguro e login obrigatório. | `production` |
| `SERPRO_LIMITE_POR_PERIODO` | Não | Opcional: limite de chamadas cobradas por período de cobrança (padrão 40). | — |

Não criar em produção:

- `AUTH_DISABLED`: Desliga o login (só desenvolvimento). Em produção, a variável não deve existir.
- `DEV_USER_EMAIL`: A conta do login desligado: não existe em produção.
- `CERT_PFX_PATH e CERT_PFX_SENHA`: O certificado da plataforma vai pela tela /admin/plataforma, cifrado no banco.
- `SERPRO_CONSUMER_KEY e SERPRO_CONSUMER_SECRET`: As chaves do contrato vão pela tela /admin/plataforma, cifradas no banco.
- `DATABASE_URL_TESTE`: Só dos testes automáticos.

## 6. Login com Google

O domínio de produção autorizado no Client ID.

- [ ] No Google Cloud › Credenciais › o Client ID (Aplicativo da Web), adicione https://contabilizadev.com.br em Origens JavaScript autorizadas.
  - Só o esquema e o domínio, sem caminho nem barra no fim.
  - Fonte: [Google: Client ID do Sign In With Google](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid) · docs/login.md do projeto (`docs/login.md`)
- [ ] URI de redirecionamento: não precisa (o botão abre em popup e devolve o login por JavaScript).
  - As URIs de redirecionamento só são usadas no modo redirect, que este projeto não usa (app/entrar/botao-google.tsx, ux_mode popup).
  - Fonte: [Google: Client ID do Sign In With Google](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid) · docs/login.md do projeto (`docs/login.md`)
- [ ] Na Tela de permissão OAuth, publique o app (sair de Em teste) antes de abrir para clientes.
  - Em teste, só os usuários de teste cadastrados lá conseguem entrar.
  - Fonte: docs/login.md do projeto (`docs/login.md`)

## 7. Backups

Backup agendado do Postgres para um S3 fora do servidor, com restauração testada.

- [ ] Crie um bucket num S3 compatível (fora do VPS) e cadastre em S3 Storage › New storage › Validate Connection & Continue.
  - O bucket tem de existir antes da validação. Compatíveis citados: Amazon S3, Cloudflare R2, Backblaze B2, Wasabi, DigitalOcean Spaces, entre outros.
  - Use uma chave de acesso só para esse bucket.
  - Fonte: [Coolify: armazenamento S3](https://coolify.io/docs/core/s3-storage/overview)
- [ ] No Postgres, Backups › + Add: frequência daily (ou um cron, ex. 0 3 * * *), com o S3 ligado (Enable S3).
  - Backups só rodam com o banco no ar. Sem valor, o job usa 3600 s; se definir o Timeout, use pelo menos 60 s para dumps maiores.
  - Fonte: [Coolify: backups de banco](https://coolify.io/docs/databases/backups)
- [ ] Retenção: em Retention e em S3 backups, por exemplo 7 cópias locais e 30 dias no S3.
  - Os limites são Backups to keep, Days to keep e Maximum storage (GB); 0 = sem limite. Os mais antigos saem primeiro.
  - Fonte: [Coolify: backups de banco](https://coolify.io/docs/databases/backups)
- [ ] Teste a restauração antes do primeiro cliente: Import Backup num Postgres descartável, a partir do S3, e confira as tabelas.
  - A documentação recomenda restaurar numa cópia descartável e conferir que a aplicação lê. Uma importação pode sobrescrever dados e credenciais.
  - Anote a data e o resultado do teste na aba Segurança do plano (item de backups). Repita depois de mudanças grandes.
  - Fonte: [Coolify: restaurar um banco](https://coolify.io/docs/databases/restore) · [Coolify: backups de banco](https://coolify.io/docs/databases/backups)

## 8. Monitoramento e registros

Registros no Coolify, avisos de falha e um monitor de fora.

- [ ] Registros: Runtime Logs (saída do servidor, com os avisos [login], [serpro] e [plataforma]) e Deployment Logs (build).
  - Fonte: [Coolify: operação da aplicação (registros)](https://coolify.io/docs/applications/operations/overview)
- [ ] Em Notifications, ligue um canal (Email, Telegram, Discord…) com Deployment Failure, Backup Failure, Server Unreachable e o aviso de disco.
  - Use Send test para conferir a entrega. Cada canal tem as próprias escolhas de eventos.
  - Fonte: [Coolify: notificações](https://coolify.io/docs/core/notifications/overview) · [Coolify: eventos de notificação](https://coolify.io/docs/core/notifications/events)
- [ ] Monitor de disponibilidade externo apontando para https://contabilizadev.com.br/api/saude (o Coolify não tem checagem de fora).
  - A documentação diz que checagens do endereço público, feitas de fora da infraestrutura, precisam de um sistema externo. Qualquer monitor que avise quando a resposta não for 200 serve.
  - Fonte: [Coolify: monitoramento](https://coolify.io/docs/core/observability/monitoring/overview) · Rota de saúde do projeto (`plataforma/app/api/saude/route.ts`)

## 9. Antes de abrir para clientes

O que ainda bloqueia a produção.

- [ ] Resolver os itens da aba Segurança que bloqueiam a produção: cota de chamadas por empresa, cabeçalhos de segurança, limite de tentativas e backups com as chaves guardadas.
  - Esta página só explica e confere o ambiente: esses itens continuam abertos no plano.
  - Fonte: Plano do projeto: aba Segurança (`/admin/plano?aba=seguranca`)
- [ ] Fazer o resto da Parte 9: termos de uso, LGPD e a cobrança do plano por empresa.
  - Fonte: Plano do projeto: Parte 9 (`/admin/plano`)
- [ ] Abrir esta página no domínio de produção: todos os itens da conferência em OK.
  - Fonte: Conferência do ambiente do projeto (`plataforma/lib/producao/conferencia.ts`)

