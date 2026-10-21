# ContabilizaDev — instruções para o Claude Code

Leia isto antes de qualquer tarefa. Resume as decisões e regras combinadas com o usuário nas sessões anteriores.
O plano por partes está em `plano.txt` (com a seção DECISÕES TOMADAS no fim); os relatórios de cada parte em
`docs/tarefas/`; a documentação por assunto em `docs/`.

## Como falar com o usuário

- Sempre em português, curto e direto.
- Quando ele faz uma **pergunta**, responda antes de agir; só mude código quando ele pedir ou confirmar.
- Antes de algo difícil de desfazer ou que sai do computador (push, chamadas reais à Receita/eSocial, apagar dados),
  confirme com ele.
- **Commits e PRs sem assinatura de IA** (nada de `Co-Authored-By: Claude` nem "Generated with Claude Code").
  Mencionar IA no código e na pasta `.claude/` é permitido.

## Estado (21/10/2026)

- Partes 0 a 8 feitas. **Próxima: Parte 9 (produção)** — hospedagem, domínio, backups, termos/LGPD e cobrança
  (plano mensal ou anual por empresa, pago pelo usuário). Depende de decisões e contratações do usuário: pergunte antes.
- Git: um único commit local `ContabilizaDev: partes 0 a 8 do plano`, sem assinatura de IA. O GitHub
  (`git@github.com:axians22/contabilizadev.git`, via SSH da conta axians22) ainda tem dois commits antigos com a
  assinatura; falta o usuário rodar `git push --force-with-lease origin main` (o force push foi bloqueado aqui).
- Pendências em aberto, para perguntar quando fizer sentido:
  - o `origin` do `../fiscal` aponta por engano para o repositório do contabilizadev;
  - visão interna de custo por cliente (dados em `serpro_chamadas`);
  - se `vieira89lucas@gmail.com` serve para algo (o admin é `vyeiralucas@gmail.com`).

## Ambiente local

- Banco: Postgres 17 no Docker, porta 5433. Desenvolvimento `contabilizadev` (tem **dados reais** do usuário: a empresa
  43.079.489/0001-41, o certificado e as chaves da plataforma, o histórico importado). Testes em `contabilizadev_teste`.
- **Porta 3001 é de outro projeto (memo-stick) e a 3000 é do `../fiscal`.** O contabilizadev roda em
  http://localhost:3003: `cd plataforma && npx next dev -p 3003`. **Nunca** suba o servidor com `DATABASE_URL`
  sobrescrito ou apontando para o banco de teste (já aconteceu e o usuário viu dados de teste).
- Na 3003, agentes (e você) só abrem `/admin/...` e `/entrar`. As páginas do painel e `/documentos/...` buscam na
  Receita sozinhas quando o dado está velho e geram custo: só com autorização do usuário. Para conferir essas telas,
  use os testes de render. Em 21/10/2026, um agente abriu `/avisos?aba=mensagens` e gerou uma consulta de R$ 0,24.
  A regra está em "Servidor local e chamadas reais", em `.claude/agents/*.md`.
- Local sem login (`AUTH_DISABLED=true`): entra como `dev@contabilizadev.local`, que é ADMIN e dona da empresa no banco.
  `ADMIN_EMAILS=vyeiralucas@gmail.com,dev@contabilizadev.local`.
- Só uma sessão do Claude por vez neste projeto: duas sessões ao mesmo tempo já sobrescreveram trabalho uma da outra.

## Modelo do produto (decisões do usuário)

- Público: desenvolvedores que trabalham como PJ e controlam a própria empresa, sozinhos. Convite de membro está no
  BACKLOG do `plano.txt`.

- Self-service: a plataforma é a contratante do Serpro (Integra Contador) e paga cada chamada; o cliente nunca paga o
  Serpro. Cobrança só por plano da empresa.
- Autorização = **termo do Autentica Procurador** assinado pelo cliente no navegador com o e-CNPJ A1 da própria empresa
  (requisitos: e-CNPJ A1 e gov.br prata/ouro). Termo e token ficam cifrados; o certificado do cliente **nunca** vai ao
  servidor. Procuração/autorização no e-CAC foi testada e descartada (exige aceite manual por cliente).
- Assinaturas do cliente (termo, DCTFWeb, eSocial): "Usar só agora" ou "Guardar neste navegador" (chave WebCrypto não
  exportável). O eSocial é assinado pelo cliente e transmitido com o certificado da plataforma.
- Certificado e chaves **da plataforma** ficam cifrados no banco, enviados em `/admin/plataforma`.
- A empresa da plataforma funciona como qualquer outra; só não precisa de termo.
- **Nunca existe modo simulado** (nada de empresas fictícias, certificado de teste baixável ou Serpro falso na tela).
- **O cliente nunca vê o nome Serpro/Integra Contador/BrasilAPI**: a fonte é sempre "Receita Federal". Única exceção: o
  texto oficial do termo. Área do admin é interna e pode citar.
- **Banco primeiro** em toda consulta externa: só chama se não existir ou estiver velho, e salva.
- Caixa Postal: abrir o conteúdo registra ciência na Receita — só com confirmação do cliente.
- Acesso em camadas: abas sempre visíveis; conteúdo só com empresa cadastrada (e, na Parte 9, plano ativo).
- Barra lateral: grupo **Empresa** (Painel do mês, Roteiro, Guias, Histórico, Situação fiscal, Declaração anual),
  grupo **Configuração** no fim (Dados da empresa, Autorização, eSocial). Avisos e Mensagens abrem pelo sino
  (link direto para a página com as duas abas). Área do administrador separada em `/admin` (Usuários, Plataforma, Plano),
  pelo menu do usuário.
- Telas: explicações sempre no tooltip único `<Explicacao>`; tabela única com paginação; visual igual ao `../fiscal`
  quando houver equivalente.

## Como as partes são feitas

- Cada tarefa roda pelo time de agentes (`.claude/agents/`: engenheiro, QA, tech lead) com o orquestrador
  `.claude/workflows/entregar-tarefa.js` — rode com a ferramenta Workflow (`scriptPath` desse arquivo) e args
  `{ parte, data: "DD/MM/AAAA", maxCiclos: 6, ajustes: [...], contexto: "..." }`. Detalhes em `docs/agentes.md`.
- **Não existe aprovar com ressalva**: tudo o que QA ou tech lead apontar é corrigido antes de a parte ficar FEITA;
  se acabar o limite de ciclos com pendência, rode de novo com `ajustes`.
- Depois de cada rodada, confira você mesmo: `npm test` (duas vezes), `npm run typecheck`, `npm run lint`, as telas na
  3003 e se houve chamada real nova em `serpro_chamadas` (os testes nunca chamam Serpro/eSocial/BrasilAPI de verdade).
- Reaproveite o que já existe no `../fiscal` (somente leitura; nunca altere arquivos lá).
- Segredos só no `plataforma/.env.local` (fora do git) ou cifrados no banco.
