// O passo a passo da produção com o Coolify (v4, self-hosted num VPS), mostrado na página /admin/producao e espelhado em
// docs/producao.md (o teste confere que os dois têm os mesmos passos e as mesmas fontes). Cada passo cita a fonte: a
// documentação oficial do Coolify (coolify.io/docs, conferida em 22/10/2026) ou o próprio código do projeto. Nada de telas
// ou opções que a documentação não mostra: onde ela não detalha, o passo diz o que fazer sem inventar o caminho.
// Área do administrador, só ADMIN: pode citar fornecedores.

export type Fonte = { texto: string; href: string };
// `texto`: o passo, curto. `detalhe`: o porquê e o como, no tooltip. `comando`: bloco copiável.
export type Passo = { id: string; texto: string; detalhe?: string[]; comando?: string; fontes: Fonte[] };
export type SecaoDoGuia = { id: string; titulo: string; resumo: string; passos: Passo[] };

const COOLIFY = "https://coolify.io/docs";
export const F = {
  instalacao: { texto: "Coolify: instalação self-hosted", href: `${COOLIFY}/start-with-self-hosted` },
  firewall: { texto: "Coolify: firewall", href: `${COOLIFY}/core/infrastructure/servers/firewall` },
  doisFatores: { texto: "Coolify: autenticação em dois fatores", href: `${COOLIFY}/core/security/authentication/2fa` },
  instancia: { texto: "Coolify: configurações da instância", href: `${COOLIFY}/core/instance-management/instance-settings` },
  dns: { texto: "Coolify: DNS", href: `${COOLIFY}/core/networking/dns` },
  dominios: { texto: "Coolify: domínios", href: `${COOLIFY}/core/networking/domains` },
  postgres: { texto: "Coolify: PostgreSQL", href: `${COOLIFY}/databases/postgresql` },
  githubApp: { texto: "Coolify: GitHub App", href: `${COOLIFY}/applications/sources/github/app` },
  deployKey: { texto: "Coolify: deploy key do GitHub", href: `${COOLIFY}/applications/sources/github/deploy-key` },
  autoDeploy: { texto: "Coolify: deploy automático do GitHub", href: `${COOLIFY}/applications/sources/github/auto-deploy` },
  dockerfile: { texto: "Coolify: build pack Dockerfile", href: `${COOLIFY}/applications/builds/dockerfile` },
  saude: { texto: "Coolify: health checks", href: `${COOLIFY}/applications/configuration/health-checks` },
  variaveis: { texto: "Coolify: variáveis de ambiente", href: `${COOLIFY}/applications/configuration/environment-variables` },
  backups: { texto: "Coolify: backups de banco", href: `${COOLIFY}/databases/backups` },
  s3: { texto: "Coolify: armazenamento S3", href: `${COOLIFY}/core/s3-storage/overview` },
  restaurar: { texto: "Coolify: restaurar um banco", href: `${COOLIFY}/databases/restore` },
  operacao: { texto: "Coolify: operação da aplicação (registros)", href: `${COOLIFY}/applications/operations/overview` },
  notificacoes: { texto: "Coolify: notificações", href: `${COOLIFY}/core/notifications/overview` },
  eventos: { texto: "Coolify: eventos de notificação", href: `${COOLIFY}/core/notifications/events` },
  monitoramento: { texto: "Coolify: monitoramento", href: `${COOLIFY}/core/observability/monitoring/overview` },
  lightsail: { texto: "AWS Lightsail: regiões (São Paulo, sa-east-1)", href: "https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-regions-and-availability-zones-in-amazon-lightsail.html" },
  registroBr: { texto: "Registro.br", href: "https://registro.br/" },
  google: { texto: "Google: Client ID do Sign In With Google", href: "https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid" },
  // Do próprio projeto (o código é a fonte).
  dockerfileDoProjeto: { texto: "Dockerfile do projeto", href: "Dockerfile" },
  envExemplo: { texto: ".env.exemplo do projeto", href: ".env.exemplo" },
  login: { texto: "docs/login.md do projeto", href: "docs/login.md" },
  saudeDoProjeto: { texto: "Rota de saúde do projeto", href: "plataforma/app/api/saude/route.ts" },
  conferencia: { texto: "Conferência do ambiente do projeto", href: "plataforma/lib/producao/conferencia.ts" },
  seguranca: { texto: "Plano do projeto: aba Segurança", href: "/admin/plano?aba=seguranca" },
  plano: { texto: "Plano do projeto: Parte 9", href: "/admin/plano" },
} satisfies Record<string, Fonte>;

export const DOMINIO = "contabilizadev.com.br";
export const REPOSITORIO = "git@github.com:axians22/contabilizadev.git";
export const PORTA_DO_CONTAINER = 3001;

// As variáveis da aplicação no Coolify (tiradas do código e da .env.exemplo). `gerar`: o comando que cria o valor.
export type Variavel = { nome: string; obrigatoria: boolean; oQueFaz: string; gerar?: string; valor?: string };
export const VARIAVEIS: Variavel[] = [
  { nome: "DATABASE_URL", obrigatoria: true, oQueFaz: "Conexão com o Postgres. Use a Postgres URL (internal) do recurso do banco no Coolify." },
  { nome: "SESSAO_SEGREDO", obrigatoria: true, oQueFaz: "Assina o cookie de sessão (mínimo 32 caracteres). Sem ela o servidor não sobe.", gerar: "openssl rand -base64 48" },
  { nome: "TOKEN_CHAVE", obrigatoria: true, oQueFaz: "Cifra o termo de autorização e o token de cada empresa. Perder = termos ilegíveis.", gerar: "openssl rand -base64 32" },
  { nome: "PLATAFORMA_CHAVE", obrigatoria: true, oQueFaz: "Cifra o certificado e as chaves do contrato da plataforma. Diferente da TOKEN_CHAVE. Perder = certificado ilegível.", gerar: "openssl rand -base64 32" },
  { nome: "GOOGLE_CLIENT_ID", obrigatoria: true, oQueFaz: "Client ID (Aplicativo da Web) do Google Cloud, para o login com Google." },
  { nome: "ADMIN_EMAILS", obrigatoria: true, oQueFaz: "Contas Google dos administradores, separadas por vírgula. Sem a conta de desenvolvimento." },
  { nome: "PLATAFORMA_CNPJ", obrigatoria: true, oQueFaz: "CNPJ da plataforma: contratante do Serpro e destinatário do termo de autorização." },
  { nome: "PLATAFORMA_RAZAO_SOCIAL", obrigatoria: true, oQueFaz: "Razão social do PLATAFORMA_CNPJ, como a Receita mostra (vai no termo)." },
  { nome: "NODE_ENV", obrigatoria: true, oQueFaz: "Já vem production na imagem (Dockerfile): cookie seguro e login obrigatório.", valor: "production" },
  { nome: "SERPRO_LIMITE_POR_PERIODO", obrigatoria: false, oQueFaz: "Opcional: limite de chamadas cobradas por período de cobrança (padrão 40)." },
];
// O que NÃO entra no Coolify em produção.
export const VARIAVEIS_PROIBIDAS = [
  { nome: "AUTH_DISABLED", porque: "Desliga o login (só desenvolvimento). Em produção, a variável não deve existir." },
  { nome: "DEV_USER_EMAIL", porque: "A conta do login desligado: não existe em produção." },
  { nome: "CERT_PFX_PATH e CERT_PFX_SENHA", porque: "O certificado da plataforma vai pela tela /admin/plataforma, cifrado no banco." },
  { nome: "SERPRO_CONSUMER_KEY e SERPRO_CONSUMER_SECRET", porque: "As chaves do contrato vão pela tela /admin/plataforma, cifradas no banco." },
  { nome: "DATABASE_URL_TESTE", porque: "Só dos testes automáticos." },
];

export const GUIA: SecaoDoGuia[] = [
  {
    id: "servidor",
    titulo: "1. Servidor",
    resumo: "Um VPS Linux com o Coolify instalado e o painel protegido.",
    passos: [
      {
        id: "requisitos",
        texto: "Contrate um VPS com pelo menos 2 núcleos, 2 GB de RAM e 10 GB livres (amd64 ou arm64), com Ubuntu LTS ou Debian.",
        detalhe: [
          "São os mínimos do Coolify, que manda aumentar a RAM conforme a carga cresce e acompanhar o uso, porque uso alto pode travar o servidor.",
          "Sugestão nossa, não da documentação: com o Postgres e o build do Next no mesmo servidor, 4 GB de RAM dão folga.",
          "A documentação recomenda Ubuntu LTS (20.04, 22.04 ou 24.04); fora de LTS o instalador pode se comportar diferente, e aí use a instalação manual.",
        ],
        fontes: [F.instalacao],
      },
      {
        id: "regiao",
        texto: "Escolha uma região no Brasil (São Paulo): por exemplo AWS Lightsail em sa-east-1, ou outro provedor com data center em São Paulo.",
        detalhe: [
          "Menos latência para os clientes e os dados (CNPJ, termos, histórico fiscal) ficam no país, o que simplifica a conversa de LGPD da Parte 9.",
          "Sugestão nossa, não da documentação do Coolify. Prefira um provedor com firewall no painel (próximo passo).",
        ],
        fontes: [F.lightsail],
      },
      {
        id: "instalar",
        texto: "Instale o Coolify como root, criando já o administrador (assim a tela de cadastro nunca fica exposta).",
        detalhe: [
          "Sem as variáveis ROOT_*, quem abrir primeiro a tela de cadastro na porta 8000 vira o administrador da instância, com acesso root ao servidor.",
          "A senha precisa de 8 caracteres ou mais, com maiúscula, minúscula, número e símbolo. Use uma senha longa gerada pelo gerenciador de senhas.",
        ],
        comando: "env ROOT_USERNAME=admin \\\n  ROOT_USER_EMAIL=seu-email@exemplo.com \\\n  ROOT_USER_PASSWORD='SENHA-FORTE-DO-GERENCIADOR' \\\n  bash -c 'curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash'",
        fontes: [F.instalacao],
      },
      {
        id: "dois-fatores",
        texto: "No painel, ative o 2FA: menu do usuário › Profile › Two-factor Authentication › Configure 2FA.",
        detalhe: ["Escaneie o QR code no aplicativo autenticador, valide o código e guarde os códigos de recuperação no gerenciador de senhas, fora do Coolify."],
        fontes: [F.doisFatores],
      },
      {
        id: "firewall",
        texto: "Firewall do provedor: libere só 22 (SSH), 80 e 443. As portas 8000, 6001 e 6002 só até o painel ter domínio.",
        detalhe: [
          "A documentação recomenda o firewall do painel do provedor, que barra o tráfego antes de chegar ao servidor, e restringir a regra do SSH sempre que possível.",
          "8000 (painel), 6001 (tempo real) e 6002 (terminal) servem só para o acesso pelo IP. Com o painel num domínio, feche as três: tudo passa a ir por 80 e 443.",
          "A porta 5432 do Postgres nunca é aberta.",
        ],
        fontes: [F.firewall],
      },
      {
        id: "dominio-do-painel",
        texto: "Dê um domínio próprio ao painel em Settings › General › URL (ex.: https://painel.contabilizadev.com.br) e feche a 8000.",
        detalhe: ["Só depois de o registro DNS do subdomínio apontar para o servidor. Não use o mesmo domínio da aplicação."],
        fontes: [F.instancia, F.dominios],
      },
    ],
  },
  {
    id: "dominio",
    titulo: "2. Domínio e HTTPS",
    resumo: `${DOMINIO} apontando para o servidor, com certificado automático.`,
    passos: [
      {
        id: "registrar",
        texto: `Registre ${DOMINIO} no registro.br (livre em 22/10/2026).`,
        detalhe: ["Domínio .com.br é registrado com o CPF ou o CNPJ do titular: use o CNPJ da plataforma.", "contabilizadev.com também estava livre, se quiser reservar."],
        fontes: [F.registroBr],
      },
      {
        id: "registro-a",
        texto: "Na zona DNS do domínio, crie um registro A com o IPv4 público do VPS (e AAAA com o IPv6, se o servidor aceitar IPv6).",
        detalhe: [
          "Para o domínio raiz e para o subdomínio do painel. O registro aponta para o servidor que roda a aplicação.",
          "Um curinga (*) não cobre o domínio raiz: crie o registro do raiz à parte.",
        ],
        fontes: [F.dns],
      },
      {
        id: "dominio-no-recurso",
        texto: `Na aplicação, em Domains › Add domain, use Protocol https e Domain ${DOMINIO}; depois faça o redeploy.`,
        detalhe: ["Com https, o proxy do Coolify pede e renova sozinho o certificado. Para isso o domínio já tem de apontar para o servidor e as portas 80 e 443 têm de estar abertas."],
        fontes: [F.dominios],
      },
      {
        id: "conferir-https",
        texto: "Abra https://contabilizadev.com.br/admin/producao: o item HTTPS da conferência tem de ficar OK.",
        detalhe: ["A conferência lê o cabeçalho x-forwarded-proto que o proxy manda. Sem HTTPS, o navegador também recusa o cookie de sessão de produção."],
        fontes: [F.dominios, F.conferencia],
      },
    ],
  },
  {
    id: "banco",
    titulo: "3. Banco de dados",
    resumo: "Postgres 17 como recurso do Coolify, só na rede interna.",
    passos: [
      {
        id: "criar-postgres",
        texto: "No projeto, New Resource › Databases › PostgreSQL, na mesma destination (rede) da aplicação, com a versão 17.",
        detalhe: ["O padrão do Coolify é o 18: escolha o 17, o mesmo do desenvolvimento (docker-compose.dev.yml)."],
        fontes: [F.postgres],
      },
      {
        id: "sem-acesso-publico",
        texto: "Deixe o Public access desligado (sem TCP proxy): o banco só é visto pela aplicação.",
        detalhe: ["A documentação recomenda a rede privada para a aplicação e expor a 5432 só quando um cliente externo precisar. Aqui, nunca."],
        fontes: [F.postgres],
      },
      {
        id: "senha-forte",
        texto: "Confira em General a senha gerada pelo Coolify (forte) e guarde no gerenciador de senhas.",
        detalhe: ["Se trocar usuário ou senha dentro do Postgres, atualize os campos no Coolify, senão a URL de conexão e os backups param."],
        fontes: [F.postgres],
      },
      {
        id: "url-interna",
        texto: "Copie a Postgres URL (internal) para a DATABASE_URL da aplicação. Depois clique em Start e espere ficar saudável.",
        detalhe: ["Formato postgres://usuário:senha@container-do-banco:5432/banco: só funciona dentro da rede do Coolify."],
        fontes: [F.postgres],
      },
    ],
  },
  {
    id: "aplicacao",
    titulo: "4. Aplicação",
    resumo: "Build pelo Dockerfile, a partir do GitHub.",
    passos: [
      {
        id: "fonte-github",
        texto: `Ligue o repositório privado ${REPOSITORIO}: GitHub App (Sources › New source › GitHub App) ou deploy key (Keys & Tokens › Private Keys).`,
        detalhe: [
          "A documentação recomenda a GitHub App (instale só neste repositório) e com ela o deploy no push já vem ligado.",
          "Com deploy key: gere a chave no Coolify, cole a pública em Settings › Deploy keys do repositório, sem permissão de escrita, e crie o recurso com Private Repository (with Deploy Key) e a URL SSH.",
        ],
        fontes: [F.githubApp, F.deployKey, F.autoDeploy],
      },
      {
        id: "build-pack",
        texto: "Crie a aplicação (+ New › Private Repository) com Build pack Dockerfile, Base Directory / e Dockerfile Location /Dockerfile, branch main.",
        detalhe: [
          "O build é feito a partir da raiz do repositório (o Dockerfile copia nucleo/, plataforma/ e o plano.txt).",
          "O clone do GitHub não tem o plataforma/.env.local (fora do git): os segredos vêm só das variáveis do Coolify.",
        ],
        fontes: [F.dockerfile, F.dockerfileDoProjeto],
      },
      {
        id: "porta",
        texto: `Ports Exposes: ${PORTA_DO_CONTAINER} (o next start do container escuta nessa porta).`,
        detalhe: ["O processo precisa escutar em 0.0.0.0, não só em 127.0.0.1, para o proxy do Coolify alcançar: o next start já escuta em todas as interfaces."],
        fontes: [F.dockerfile, F.dockerfileDoProjeto],
      },
      {
        id: "migracoes",
        texto: "Migrações: deixe como estão, no CMD da imagem (npm run banco:migrar antes do start). Não use Pre/Post-deployment para elas.",
        detalhe: [
          "O Pre-deployment roda no container ANTIGO, antes de ser trocado, e é pulado no primeiro deploy: aplicaria as migrações do código velho.",
          "O Post-deployment roda no container novo só depois de o deploy ser dado como concluído (e uma falha não muda o status): o site novo subiria antes das migrações.",
          "No CMD, o site só sobe depois das migrações aplicadas; se uma falhar, o site novo não sobe e o erro aparece nos registros. Rodar de novo não repete as já aplicadas.",
        ],
        fontes: [F.dockerfile, F.dockerfileDoProjeto],
      },
      {
        id: "health-check",
        texto: `Healthcheck: HTTP, GET, http, Host localhost, Port ${PORTA_DO_CONTAINER}, Path /api/saude, com Start period de 60 s.`,
        detalhe: [
          "/api/saude responde 200 {\"ok\":true} com o banco no ar e 503 sem ele; é pública e não mostra nada além disso.",
          "O check usa curl ou wget de dentro da imagem: a node:22-alpine tem o wget. O Start period cobre as migrações da subida.",
          "Depois de salvar, faça o redeploy. Com o container doente, o proxy tira a aplicação do ar (404 ou No available server).",
        ],
        comando: `wget -qO- http://localhost:${PORTA_DO_CONTAINER}/api/saude`,
        fontes: [F.saude, F.saudeDoProjeto],
      },
      {
        id: "deploy",
        texto: "Clique em Deploy e acompanhe as Deployment Logs; depois confira os registros, a porta, a saúde e o domínio.",
        fontes: [F.dockerfile, F.operacao],
      },
    ],
  },
  {
    id: "variaveis",
    titulo: "5. Variáveis de ambiente",
    resumo: "Os segredos só no Coolify, com cópia das chaves de cifra fora do servidor.",
    passos: [
      {
        id: "cadastrar",
        texto: "Em Environment Variables, cadastre as variáveis da tabela abaixo com Build time em Not available during build.",
        detalhe: [
          "Nenhuma é usada no build: todas são lidas quando o servidor sobe. Fora do build, o segredo não vai parar nas camadas da imagem.",
          "O Developer view aceita colar no formato .env. Trocou só valor de execução: Restart basta.",
        ],
        fontes: [F.variaveis, F.envExemplo],
      },
      {
        id: "gerar-chaves",
        texto: "Gere as chaves no seu computador, uma por variável (a TOKEN_CHAVE e a PLATAFORMA_CHAVE têm de ser diferentes).",
        comando: "openssl rand -base64 48   # SESSAO_SEGREDO\nopenssl rand -base64 32   # TOKEN_CHAVE\nopenssl rand -base64 32   # PLATAFORMA_CHAVE",
        fontes: [F.envExemplo],
      },
      {
        id: "copia-das-chaves",
        texto: "Guarde a TOKEN_CHAVE e a PLATAFORMA_CHAVE no gerenciador de senhas, fora do servidor, antes do primeiro cliente.",
        detalhe: [
          "Perder a TOKEN_CHAVE deixa ilegíveis todos os termos de autorização e tokens guardados: cada cliente assina de novo.",
          "Perder a PLATAFORMA_CHAVE deixa ilegíveis o certificado e as chaves do contrato: é preciso enviá-los de novo em /admin/plataforma.",
          "O backup do banco não serve sem elas: o que está nele é cifrado.",
        ],
        fontes: [F.envExemplo],
      },
      {
        id: "sem-login-desligado",
        texto: "Não crie AUTH_DISABLED nem DEV_USER_EMAIL. NODE_ENV já vem production da imagem.",
        fontes: [F.dockerfileDoProjeto, F.envExemplo],
      },
      {
        id: "certificado-pela-tela",
        texto: "O certificado da plataforma e as chaves do contrato vão pela tela Certificado da plataforma (/admin/plataforma), não por variável.",
        detalhe: ["Ficam cifrados no banco com a PLATAFORMA_CHAVE; a senha do .pfx não é guardada. Assim não há arquivo .pfx no servidor."],
        fontes: [F.envExemplo],
      },
    ],
  },
  {
    id: "google",
    titulo: "6. Login com Google",
    resumo: "O domínio de produção autorizado no Client ID.",
    passos: [
      {
        id: "origem",
        texto: `No Google Cloud › Credenciais › o Client ID (Aplicativo da Web), adicione https://${DOMINIO} em Origens JavaScript autorizadas.`,
        detalhe: ["Só o esquema e o domínio, sem caminho nem barra no fim."],
        fontes: [F.google, F.login],
      },
      {
        id: "sem-uri",
        texto: "URI de redirecionamento: não precisa (o botão abre em popup e devolve o login por JavaScript).",
        detalhe: ["As URIs de redirecionamento só são usadas no modo redirect, que este projeto não usa (app/entrar/botao-google.tsx, ux_mode popup)."],
        fontes: [F.google, F.login],
      },
      {
        id: "publicar",
        texto: "Na Tela de permissão OAuth, publique o app (sair de Em teste) antes de abrir para clientes.",
        detalhe: ["Em teste, só os usuários de teste cadastrados lá conseguem entrar."],
        fontes: [F.login],
      },
    ],
  },
  {
    id: "backups",
    titulo: "7. Backups",
    resumo: "Backup agendado do Postgres para um S3 fora do servidor, com restauração testada.",
    passos: [
      {
        id: "s3",
        texto: "Crie um bucket num S3 compatível (fora do VPS) e cadastre em S3 Storage › New storage › Validate Connection & Continue.",
        detalhe: [
          "O bucket tem de existir antes da validação. Compatíveis citados: Amazon S3, Cloudflare R2, Backblaze B2, Wasabi, DigitalOcean Spaces, entre outros.",
          "Use uma chave de acesso só para esse bucket.",
        ],
        fontes: [F.s3],
      },
      {
        id: "agendar",
        texto: "No Postgres, Backups › + Add: frequência daily (ou um cron, ex. 0 3 * * *), com o S3 ligado (Enable S3).",
        detalhe: ["Backups só rodam com o banco no ar. Sem valor, o job usa 3600 s; se definir o Timeout, use pelo menos 60 s para dumps maiores."],
        fontes: [F.backups],
      },
      {
        id: "retencao",
        texto: "Retenção: em Retention e em S3 backups, por exemplo 7 cópias locais e 30 dias no S3.",
        detalhe: ["Os limites são Backups to keep, Days to keep e Maximum storage (GB); 0 = sem limite. Os mais antigos saem primeiro."],
        fontes: [F.backups],
      },
      {
        id: "restaurar",
        texto: "Teste a restauração antes do primeiro cliente: Import Backup num Postgres descartável, a partir do S3, e confira as tabelas.",
        detalhe: [
          "A documentação recomenda restaurar numa cópia descartável e conferir que a aplicação lê. Uma importação pode sobrescrever dados e credenciais.",
          "Anote a data e o resultado do teste na aba Segurança do plano (item de backups). Repita depois de mudanças grandes.",
        ],
        fontes: [F.restaurar, F.backups],
      },
    ],
  },
  {
    id: "monitoramento",
    titulo: "8. Monitoramento e registros",
    resumo: "Registros no Coolify, avisos de falha e um monitor de fora.",
    passos: [
      {
        id: "registros",
        texto: "Registros: Runtime Logs (saída do servidor, com os avisos [login], [serpro] e [plataforma]) e Deployment Logs (build).",
        fontes: [F.operacao],
      },
      {
        id: "notificacoes",
        texto: "Em Notifications, ligue um canal (Email, Telegram, Discord…) com Deployment Failure, Backup Failure, Server Unreachable e o aviso de disco.",
        detalhe: ["Use Send test para conferir a entrega. Cada canal tem as próprias escolhas de eventos."],
        fontes: [F.notificacoes, F.eventos],
      },
      {
        id: "uptime",
        texto: `Monitor de disponibilidade externo apontando para https://${DOMINIO}/api/saude (o Coolify não tem checagem de fora).`,
        detalhe: ["A documentação diz que checagens do endereço público, feitas de fora da infraestrutura, precisam de um sistema externo. Qualquer monitor que avise quando a resposta não for 200 serve."],
        fontes: [F.monitoramento, F.saudeDoProjeto],
      },
    ],
  },
  {
    id: "antes-de-abrir",
    titulo: "9. Antes de abrir para clientes",
    resumo: "O que ainda bloqueia a produção.",
    passos: [
      {
        id: "seguranca",
        texto: "Resolver os itens da aba Segurança que bloqueiam a produção: cota de chamadas por empresa, cabeçalhos de segurança, limite de tentativas e backups com as chaves guardadas.",
        detalhe: ["Esta página só explica e confere o ambiente: esses itens continuam abertos no plano."],
        fontes: [F.seguranca],
      },
      {
        id: "parte-9",
        texto: "Fazer o resto da Parte 9: termos de uso, LGPD e a cobrança do plano por empresa.",
        fontes: [F.plano],
      },
      {
        id: "conferencia",
        texto: "Abrir esta página no domínio de produção: todos os itens da conferência em OK.",
        fontes: [F.conferencia],
      },
    ],
  },
];
