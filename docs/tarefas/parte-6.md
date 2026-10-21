# Parte 6 — Rotina do mês (passos 18 e 19)

## Situação

**Aprovada em 19/10/2026** (ver seção Ajustes).

Nenhuma pendência aberta. A pendência do ciclo 6 (teto `VALOR_MAXIMO` aplicado ao valor na moeda estrangeira em `lancarReceita`) foi corrigida no ciclo 7: o teto em reais vale só para o valor em reais, e o valor na moeda exige apenas ser positivo após o arredondamento e caber na coluna numeric(14,2) (`VALOR_MOEDA_MAXIMO`). Os 3 casos de `plataforma/testes/rotina-ciclo6.qa.test.ts` passam.

## Resumo da entrega

- **Passo 18, rotina do mês em `/roteiro`** (atrás do portão):
  - lançamento da receita em BRL ou em moeda estrangeira, com PTAX de compra guardada em `cotacoes_ptax`;
  - pró-labore do mês apurado e do mês corrente;
  - cálculo de RBT12, Fator R, anexo e DAS por tributo. Caso real conferido: DAS de 09/2026 = R$ 1.000,76;
  - PGDAS-D com simulação, confirmação, idempotência por índice único, estado "incerta" quando não há resposta e retificação só por pedido explícito;
  - emissão do DAS, inclusive vencido com multa e juros;
  - DCTFWeb e DARF, com assinatura em duas etapas pelo e-CNPJ A1;
  - modo guiado (FacaNoPortal) quando falta autorização.
- Aba `/guias` e PDFs pela rota protegida `/documentos`.
- **Passo 19:** aviso do Fator R (faixa de 25% a 30%) no painel, na rotina e no sino, com o pró-labore sugerido e a economia estimada.
- Migrações 0010 (`rotina_do_mes`) e 0011 (`meses_sem_receita`), com as tabelas apagadas junto com a empresa.
- Correções dos ciclos:
  - vencimento do DAS no dia útil seguinte e do DARF no dia útil anterior;
  - teto do INSS por ano (2026 = R$ 8.475,55);
  - separação entre receita pendente e mês sem receita;
  - leitura robusta do valor digitado;
  - validação do valor arredondado, do `VALOR_MAXIMO` em reais e da `COTACAO_MAXIMA`.

## Arquivos principais

- Núcleo: `nucleo/src/apuracao.ts`, `ptax.ts`, `assinatura.ts`, `meses.ts`, `simples.ts`, `prolabore.ts`, `serpro/{cliente,pgdasd,dctfweb,extrato,guias,pagamentos}.ts`
- Plataforma:
  - `lib/rotina/*` (base, receitas, pgdasd, dctfweb, guias, fator-r, mensagens, servidor, dependencias)
  - `app/(painel)/roteiro/*`, `app/(painel)/guias/page.tsx`, `app/(painel)/page.tsx`, `sino.tsx`
  - `app/documentos/[tipo]/[id]/route.ts`
  - `lib/historico/{documentos,leitura}.ts`, `lib/termo/guiado.ts`
- Banco: `banco/esquema.ts`, `banco/migracoes/0010_rotina_do_mes.sql`, `0011_meses_sem_receita.sql`
- `README.md`

## Testes

- Última rodada de `npm test` na raiz: núcleo 348/348 e plataforma 805/805 (798 do engenheiro e 7 do QA, incluindo `rotina-ciclo6.qa.test.ts` e `rotina-ciclo6-rodada2.qa.test.ts`). Nenhum teste falha.
- typecheck e lint limpos.
- Suítes novas:
  - `nucleo/src/apuracao.test.ts`, `ptax.test.ts`
  - `plataforma/testes/rotina.test.ts`, `rotina-telas.test.ts`, `rotina-ciclo{2,4,5,6}.test.ts`
  - testes de QA: `rotina.qa.test.ts`, `rotina-ciclo{2,3,4,5,6}.qa.test.ts`, `rotina-ciclo6-rodada2.qa.test.ts`
- Nenhuma chamada real ao Serpro nem à PTAX: `serpro_chamadas` = 0. A porta 3001 não foi usada.

## Ciclos

| Ciclo | Etapa | Resultado | Problemas apontados | Como foram resolvidos |
|---|---|---|---|---|
| 1 | Engenheiro | Entregue | — | Passos 18 e 19 implementados |
| 1 | QA | Reprovado (7) | Alta: "23.000" lido como 23. Média: link do pró-labore ia para o mês errado; DAS antecipado em vez de prorrogado; INSS sem teto; transmissão possível com receita R$ 0,00 sem lançamento. Baixa: nome da "alíquota efetiva" incoerente; lista de tributos vazia com receita zero | Ciclo 2: `numero()` com milhar; formulário do pró-labore do mês corrente; `vencimentoDas` e `vencimentoDarf`; `TETO_INSS` por ano; tabela `meses_sem_receita` e bloqueio quando a receita está pendente; bloco renomeado para "Alíquota paga"; `tributosDoDas` |
| 2 | QA | Reprovado (1) | Baixa: `numero()` aceitava "1e5", "0x10" e "0b11" | Ciclo 3: último caso aceita só `/^\d+(\.\d+)?$/` |
| 3 | QA | Reprovado (1) | Média: valor em reais inválido com moeda estrangeira caía na PTAX sem aviso (regressão do "-6300") | Ciclo 4: só null/undefined contam como "não informado"; NaN é recusado |
| 4 | QA | Reprovado (1) | Média: valor abaixo de meio centavo era gravado como R$ 0,00 | Ciclo 5: validação depois de arredondar (`centavos(v) > 0`); "0.004" lido como decimal |
| 5 | QA | Reprovado (2) | Média: valor convertido pela PTAX passava do `VALOR_MAXIMO`; cotação implícita estourava `numeric(12,6)` com exceção | Ciclo 6: `valorValido` aplicado ao valor convertido; `COTACAO_MAXIMA` e `cotacaoValida` |
| 6 | QA | Reprovado (1) | Média: `VALOR_MAXIMO` aplicado ao valor na moeda estrangeira (JPY 5.000.000 recusado) | Ciclo 7: o valor na moeda só exige positivo após arredondar e o teto da coluna numeric(14,2) (`VALOR_MOEDA_MAXIMO`); `VALOR_MAXIMO` vale para BRL, o convertido pela PTAX e o informado em reais. Tela, ação e base não aplicavam teto na moeda. Testes em `rotina-ciclo6.test.ts` |

## Ajustes

### Correções pedidas

1. **Tech lead (pendência do ciclo 6, média):** `VALOR_MAXIMO` (R$ 4.800.000) era aplicado ao valor na moeda estrangeira em `lancarReceita`, recusando por exemplo ¥ 5.000.000.
   - Resolvido no ciclo 1 desta rodada em `plataforma/lib/rotina/receitas.ts`: `valorValido` (teto em reais) passa a valer só para BRL, para o valor em reais informado e para o convertido pela PTAX; o valor na moeda usa `valorMoedaValido` (finito, positivo após arredondar e até `VALOR_MOEDA_MAXIMO` = 999.999.999.999,99, máximo de numeric(14,2)). Testes em `rotina-ciclo6.test.ts` (9 casos); os 3 casos de `rotina-ciclo6.qa.test.ts` passam.
2. **QA (ciclo 1, baixa):** este relatório ainda dizia que a pendência estava aberta e que testes falhavam.
   - Resolvido no ciclo 2: situação, pendência, contagem de testes (núcleo 348/348, plataforma 805/805) e lista de suítes atualizadas.

### Ciclos desta rodada

| Ciclo | Etapa | Resultado | Problemas apontados | Como foram resolvidos |
|---|---|---|---|---|
| 1 | Engenheiro | Entregue | — | Teto em reais só para valores em reais; `VALOR_MOEDA_MAXIMO` para o valor na moeda |
| 1 | QA | Reprovado (1) | Baixa: relatório desatualizado | Ciclo 2: relatório atualizado. QA criou `rotina-ciclo6-rodada2.qa.test.ts` (7 casos) |
| 2 | Engenheiro | Entregue | — | Só documentação; sem mudança de código |
| 2 | QA | Aprovado | — | npm test: núcleo 348/348, plataforma 805/805; typecheck e lint limpos |
| 2 | Tech lead | Aprovado | — | — |

Observação: os arquivos de QA do ciclo 6 compartilham o banco de teste e precisam de `--test-concurrency=1` (como o `npm test` já roda).

### Situação

**Aprovada** pelo QA e pelo tech lead em 19/10/2026. Nenhuma pendência aberta. Parte marcada como feita no plano.txt.

## Ajustes (assinatura do cliente: usar só agora ou guardar no navegador)

### Correções pedidas

1. **Pedido do usuário:** em toda assinatura do cliente (termo de autorização no passo 7 do cadastro, em `/autorizacao` e em "Assinar de novo", e DCTFWeb da rotina), oferecer duas opções: "Usar só agora" ou "Guardar neste navegador".
   - Resolvido no ciclo 1: componente único `plataforma/app/assinador/assinador.tsx` com a lógica em `plataforma/lib/assinador/{assinador,cofre}.ts`. "Usar só agora" é o padrão (chave só em memória). "Guardar" importa a chave com `importKey('pkcs8', RSASSA-PKCS1-v1_5 SHA-256, extractable:false, ['sign'])` e grava no IndexedDB com o PEM, o CNPJ e a validade; a senha nunca é guardada e a chave nunca vai ao servidor. Um certificado por CNPJ; só usa o guardado se for da empresa ativa e estiver na validade; avisa com 30 dias ou menos. DCTFWeb em duas etapas (servidor prepara, navegador assina com `crypto.subtle.sign`, servidor confere); termo por `assinarTermoCom` (novo `nucleo/src/serpro/termo-xml.ts`, sem node-forge). Oferta de apagar a chave ao sair e ao remover a empresa.
2. **QA ciclo 1 (média):** na remoção da empresa, `executar(dados)` era chamado depois de `await`, fora da transição; o "pendente" não ligava e o botão aceitava clique duplo.
   - Resolvido no ciclo 2: o `<form>` usa `action={executar}` direto; a lógica pós-servidor roda no invólucro `acaoDeRemover`; o botão fica desativado com `pendente || estado.ok`.
3. **QA ciclo 1 (baixa):** a chave guardada era apagada antes de o servidor confirmar a remoção.
   - Resolvido no ciclo 2: `removerEmpresaAcao` devolve `{ ok: true }` em vez de `redirect`; o cliente apaga a chave só depois do ok (e com a caixa marcada) e navega com `router.replace('/empresa?removida=1')`. Com `{ erro }` ou exceção, nada é apagado.

### Ciclos desta rodada

| Ciclo | Etapa | Resultado | Observação |
|---|---|---|---|
| 1 | Engenheiro | Entregue | Assinador com as duas opções, cofre no IndexedDB, testes unitários, de ponta a ponta e de tela |
| 1 | QA | Reprovado (2) | Média: dispatch fora da transição na remoção da empresa. Baixa: chave apagada antes da confirmação do servidor |
| 2 | Engenheiro | Entregue | Remoção devolve `{ ok }`; chave apagada só depois; `action={executar}` |
| 2 | QA | Aprovado | Sem problemas novos; criou `remocao-empresa-certificado.qa.test.ts` (4/4) |
| 2 | Tech lead | Aprovado | Sem apontamentos; nucleo 352/352, plataforma 861/861; typecheck e lint limpos |

### Situação

Aprovada em 19/10/2026. Sem pendências abertas. Não houve teste manual com clique real no navegador (o projeto não tem Playwright); a cobertura é por testes automáticos.
