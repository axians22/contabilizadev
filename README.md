# ContabilizaDev

Simples Nacional self-service para empresas de TI que exportam serviço: a empresa calcula, declara e paga
sozinha, com a própria autorização. O plano, por partes, está em [`plano.txt`](plano.txt).

## Estrutura

| Pasta | O que tem |
|---|---|
| `nucleo/` | Regras fiscais (Simples, Fator R, guias) e integrações (Receita Federal, eSocial), em TypeScript puro. Nada fixo de empresa. |
| `plataforma/` | O site: Next.js 16, Tailwind 4, Drizzle + Postgres 17. Usa o núcleo como `@contabilizadev/nucleo`. |
| raiz | `docker-compose.yaml` (produção no Coolify; sempre `.yaml`, com `.yml` o Coolify não carrega), `Dockerfile` e `.dockerignore`. |
| `nucleo/certificados/icp-brasil/` | Raízes e ACs oficiais da ICP-Brasil (do ITI), para conferir a cadeia do e-CNPJ do termo. Origem no `ORIGEM.md`. |
| `docs/` | Documentação por assunto (abaixo) e os relatórios de cada parte em `docs/tarefas/`. |

## Como rodar

Precisa de Node 22 e Docker (no WSL, com a integração ligada no Docker Desktop).

```sh
npm install
cp .env.exemplo plataforma/.env.local   # e preencha (veja abaixo)
npm run banco:subir                      # Postgres na porta 5433
npm run banco:migrar                     # cria as tabelas
npm run dev                              # http://localhost:3001
```

No desenvolvimento não há login: com `AUTH_DISABLED=true` o site abre direto como administrador. O usuário comum, no
primeiro acesso, preenche "Seus dados" (`/meus-dados`) antes de qualquer coisa; o administrador só precisa deles para
cadastrar uma empresa de cliente ou assinar o termo.

Variáveis do `plataforma/.env.local` (os detalhes estão no `.env.exemplo`):

- **Banco e sessão:** `DATABASE_URL`, `SESSAO_SEGREDO`.
- **Login:** `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`, `AUTH_DISABLED` (só fora de produção).
- **Plataforma:** `PLATAFORMA_CNPJ`, `PLATAFORMA_CHAVE` e `TOKEN_CHAVE` (chaves de cifra; gere com `openssl rand -base64 32`).
- **Contrato com a Receita:** o certificado e as chaves são enviados pela Área do administrador (`/admin/plataforma`);
  `CERT_PFX_PATH`, `CERT_PFX_SENHA`, `SERPRO_CONSUMER_KEY` e `SERPRO_CONSUMER_SECRET` ficam como alternativa.

## Comandos (na raiz)

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe a plataforma em modo desenvolvimento |
| `npm test` | Testes do núcleo e da plataforma |
| `npm run typecheck` / `npm run lint` | Tipos e lint dos dois pacotes |
| `npm run banco:gerar` | Cria a migração depois de mudar `plataforma/banco/esquema.ts` |
| `npm run docker:subir` | Banco + plataforma no Docker, em http://localhost:3002 |

Os testes de integração usam um banco separado (`contabilizadev_teste`) e **nunca** chamam a Receita, o eSocial nem
o Google: usam clientes falsos e respostas gravadas.

## Documentação

- [Desenvolvimento](docs/desenvolvimento.md): banco, Docker, comandos e testes em detalhe.
- [Núcleo](docs/nucleo.md) e [Plataforma](docs/plataforma.md): como o código está organizado.
- [Login e autorização](docs/login.md) (com "Seus dados") e [Empresas e cadastro](docs/empresas.md) (quadro de sócios e
  prova de posse pelo termo).
- [Certificados](docs/certificados.md): o da plataforma e a assinatura do cliente no navegador.
- [Autorização (termo)](docs/autorizacao.md), com o roteiro do teste real.
- [Histórico](docs/historico.md), [Rotina do mês](docs/rotina.md), [eSocial](docs/esocial.md) e
  [Painel, mensagens e avisos](docs/painel.md).
- [Produção com o Coolify](docs/producao.md): passo a passo, conferência do ambiente (`/admin/producao`) e rota de saúde.
- [Time de agentes](docs/agentes.md): como cada parte do plano é entregue (engenheiro → QA → tech lead).

## Regras

- Certificados, senhas e chaves nunca vão para o git; ficam no `.env.local` ou cifrados no banco.
- O certificado do cliente nunca vai para o servidor: ele assina no navegador.
- O cliente nunca vê o nome do fornecedor da integração; para ele, a fonte é sempre a Receita Federal.
- O site pessoal `../fiscal` é a referência: o que já funciona lá é reaproveitado e generalizado aqui.
