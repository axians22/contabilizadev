# Desenvolvimento

## Banco de dados

Postgres 17 no Docker (porta 5433), acessado com Drizzle ORM e o driver postgres.js. Os arquivos do Docker
ficam em `docker/` (`docker-compose.yml`, `Dockerfile` e `Dockerfile.dockerignore`).

1. Abra o Docker Desktop (com a integração do WSL ligada: Settings → Resources → WSL integration).
2. `cp .env.exemplo plataforma/.env.local` (já feito no desenvolvimento local) e preencha `SESSAO_SEGREDO`
   (`openssl rand -base64 48`).
3. `npm run banco:subir` — sobe o Postgres.
4. `npm run banco:migrar` — cria as tabelas.

Para subir tudo no Docker (banco + plataforma em http://localhost:3002, aplicando as migrações ao iniciar):
`npm run docker:subir`. O contêiner lê o mesmo `plataforma/.env.local` (segredo, Client ID, admins, `PLATAFORMA_CNPJ`,
credenciais do contrato, `TOKEN_CHAVE`; o arquivo precisa existir) e monta só de leitura o .pfx de `CERT_PFX_PATH` (veja
"Configuração" em "Termo de autorização"). Roda em produção: lá o login é sempre pelo Google. Parar: `npm run docker:parar`. Ver o log: `npm run docker:logs`.

O esquema fica em `plataforma/banco/esquema.ts`; depois de mudar, `npm run banco:gerar` cria a migração
em `plataforma/banco/migracoes/`.

## Comandos (na raiz)

- `npm install` — instala tudo (workspaces)
- `npm run dev` — sobe a plataforma em http://localhost:3001
- `npm test` — testes do núcleo e da plataforma
- `npm run typecheck` — tipos do núcleo e da plataforma
- `npm run lint` — lint do núcleo e da plataforma

## Testes da plataforma

`npm test -w plataforma` (incluído no `npm test` da raiz) roda com `node --test` e `tsx`:

- unitários ao lado do código (`lib/**/*.test.ts`, `banco/esquema.test.ts`): configuração, papéis, cookie, rotas
  públicas, verificador do Google, CNPJ (dígito verificador e máscara), empresa ativa, prévia assinada do cadastro e
  validade da consulta à Receita;
- integração em `testes/` contra o Postgres local, num banco separado `contabilizadev_teste` (criado e migrado sozinho;
  o teste recusa banco cujo nome não termine em `_teste`, então nunca toca o de desenvolvimento): login, sessão,
  gestão de usuários, isolamento entre empresas, cadastro pelo CNPJ e dados da Receita (`testes/cadastro.test.ts`),
  o termo de autorização de ponta a ponta (`testes/termo.test.ts`), o proxy, a checagem de "fechado por padrão"
  e a regra "o cliente não vê o fornecedor" (`testes/sem-fornecedor-na-tela.test.ts`).

O Google, a BrasilAPI e o Serpro nunca são chamados: os testes usam um verificador falso e as respostas gravadas do núcleo. Precisa do banco no ar (`npm run banco:subir`).

## Regras

- Certificados, senhas e chaves nunca vão para o git (ver `.gitignore`); ficam em `.env.local`.
- O site pessoal (`../fiscal`) é a referência: o núcleo copia e generaliza o que já funciona lá.
