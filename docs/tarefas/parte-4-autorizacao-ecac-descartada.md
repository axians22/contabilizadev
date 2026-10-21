# Parte 4 (DESCARTADA em 18/10/2026) - Autorização de acesso no e-CAC

> Substituída pelo termo de autorização assinado com o e-CNPJ do cliente (ver DECISÕES no plano.txt). Código removido em 18/10/2026 (lista abaixo, em "Remoção"); este relatório fica só como histórico.

**Situação:** aprovada em 17/10/2026 (ciclo 5: QA e tech lead).

## Resumo da entrega

- Remoção completa do modelo antigo de termo de autorização (termo, AUTENTICAPROCURADOR, TOKEN_CHAVE, node-forge, tabela autorizacoes_serpro). Nova migração 0003_procuracoes (serpro_chamadas e procuracoes).
- Novo modelo: a plataforma é contratante, autora do pedido e procuradora; o cliente é o outorgante da procuração no e-CAC.
- Tela /automatico ("Ligar o automático"): 6 passos ilustrados, CNPJ da plataforma com botão de copiar, validade sugerida (hoje + 5 anos − 1 dia) e os 7 serviços com código e nome oficiais.
- Conferência da procuração (OBTERPROCURACAO41) com o banco primeiro: reconfere após 7 dias, "Verificar agora" com intervalo mínimo de 10 min, espera de 1 h após erro e trava por empresa no Postgres. `situacaoAtual` é usada no painel, no sino e nas Partes 5+.
- Estados: ligado, em parte, vencida, desligado, não conferido. O sino avisa quando faltam 30 dias ou menos e quando a procuração vence. Os vencimentos são mantidos mesmo quando a Receita deixa de devolver a procuração, e são limpos na renovação.
- Modo guiado reutilizável: `liberada`, `motivoGuiado`, `<FacaNoPortal>` e `<SeAutomatico>`.
- Regra "o cliente não vê o fornecedor": textos reescritos, mapa próprio de mensagens, detalhe técnico só no log, /plano só para área interna, teste automático pela AST.
- Correção extra: o CNPJ alfanumérico mantém as letras.

## Pendências

1. Preencher PLATAFORMA_CNPJ e PLATAFORMA_RAZAO_SOCIAL no .env.local.
2. Rodar `npm run docker:subir` para o container da porta 3002 pegar as migrações 0004 e 0005.
3. Conferir no teste real, dentro do modal do e-CAC, os nomes de 00146, 00002, 00076 e 00188.
4. A empresa da própria plataforma não pode dar procuração para si mesma (o README explica como proceder).

## Arquivos principais

- `nucleo/src/serpro/procuracoes.ts`, `cliente.ts`, `certificado-teste.ts`, `formato.ts`
- `plataforma/banco/esquema.ts`, `banco/migracoes/0003_procuracoes.sql`
- `plataforma/lib/procuracao/{situacao,consulta,mensagens,guiado,servidor}.ts`, `lib/serpro/config.ts`, `lib/autenticacao/papeis.ts`
- `plataforma/app/(painel)/automatico/*`, `faca-no-portal.tsx`, `page.tsx`, `layout.tsx`, `sino.tsx`, `plano/page.tsx`, `app/barra-lateral.tsx`
- `.env.exemplo`, `README.md`

## Testes

- Núcleo: `procuracoes.test.ts`, `cliente.test.ts`, `procuracoes.qa.test.ts`.
- Plataforma: `situacao.test.ts`, `config.test.ts`, `papeis.test.ts`, `testes/procuracao.test.ts`, `testes/sem-fornecedor-na-tela.test.ts`, além dos testes de QA (`procuracao.qa`, `procuracao-vencidos.qa`, `procuracao-vencidos-2.qa`, `guiado.qa`).
- Resultado final: núcleo 245/245 e plataforma 304/304. Typecheck e lint limpos.

## Ciclos

| Ciclo | Etapa | Resultado | Problemas apontados | Como foram resolvidos |
|---|---|---|---|---|
| 1 | Engenheiro | Entregue | - | Entrega inicial completa |
| 1 | QA | Reprovado | (alta) vencida virava "desligado" após o recheck; (média) serviço vencido em parte sem aviso no sino; (média) recheck só em /automatico; (baixa) 40007 do outorgado mal classificado; data impossível aceita; passo 6 citava um botão ausente; promessa falsa "Já fomos avisados" | Ciclo 2 |
| 2 | Engenheiro | Entregue | - | `manterVencidos` guarda os vencimentos; lista `vencidos` e aviso vermelho; `situacaoAtual` no painel e no sino; 40007 separado por texto; validação de calendário; passo 6 depende de `podeVerificar`; mensagem corrigida |
| 2 | QA | Reprovado | (média) após renovar sem o parcelamento, o aviso "venceu" ficava aceso para sempre | Ciclo 3 |
| 3 | Engenheiro | Entregue | - | Vencidos são limpos quando todos os obrigatórios estão vigentes; o alerta vermelho vale só para os obrigatórios |
| 3 | QA | Aprovado | - | - |
| 3 | Tech lead | Reprovado | (média) o motivo e o link do modo guiado ficavam errados com o automático ligado e um opcional ausente ou vencido; (baixa) import duplicado; (baixa) recuo no page.tsx | Ciclo 4 |
| 4 | Engenheiro | Entregue | - | Função pura `motivoGuiado` com testes; import único; recuo corrigido |
| 4 | QA | Reprovado | (baixa) singular quando faltavam 2 serviços | Ciclo 5 |
| 5 | Engenheiro | Entregue | - | `fraseNaoIncluidos` concorda com a quantidade |
| 5 | QA | Aprovado | - | - |
| 5 | Tech lead | Aprovado | - | - |

## Ajustes

### Correções pedidas

1. Refazer /automatico com o fluxo atual do e-CAC (Autorização de Acesso), seguindo os prints, sem dados pessoais.
2. Sete passos com ilustração própria, CNPJ/validade/códigos com copiar, nome da plataforma sem valor fixo, obrigatórios e opcionais separados.
3. Conferir nomes e códigos dos serviços na tabela oficial.
4. Resolver o aceite pela pessoa autorizada (prazo de 30 dias).
5. Manter as regras de tela (explicações no `<Explicacao>`, sem fornecedor, portão de conteúdo).

### Como foi resolvido

1-2. /automatico virou um assistente "Passo N de 7" com SVGs próprios; nome da plataforma vem de `PLATAFORMA_RAZAO_SOCIAL` ou do banco; validade = hoje + 5 anos - 1 dia.
3. Códigos 00146, 00103, 00006, 00002, 00004 (obrigatórios) e 00076, 00188 (opcionais) conferidos; 00007 e 00150 ficaram de fora com justificativa.
4. Sem API de aceite e com automação proibida (IN RFB 2.320/2026, art. 13): "Já assinei", tabela `autorizacoes_recebidas` (migração 0004), fila interna /aceites, aviso no sino; confirmação pelo OBTERPROCURACAO41 com banco primeiro. Registrado em DECISÕES.
5. Regras de tela mantidas e cobertas por teste.

Correções dos ciclos de revisão:
- Aceite feito no prazo não vira mais "expirada" e força a reconferência.
- Aceite que não aparece na Receita vira "refazer" (coluna `nao_apareceu_em`, migração 0005), volta ao sino, com "Aceitei de novo" e "Desfazer".
- "Desfazer" é recusado depois do prazo (`podeDesfazer`), e o botão some.
- Corrida entre abas: decisão refeita dentro da trava com dados relidos; caminho rápido lê tudo numa transação REPEATABLE READ só de leitura (`lerGuardado`), `semChamar` virou função pura.
- Passo 7 e cartão do topo usam o mesmo texto (`ROTULO_ACEITE`).
- Comentários longos requebrados em ~120 colunas.

### Ciclos desta rodada

| Ciclo | Etapa | Situação | Problemas | Resolução |
|---|---|---|---|---|
| 1 | Engenheiro | Entregue | - | Passo a passo de 7 passos, serviços conferidos, fila de aceite |
| 1 | QA | Reprovado | (alta) aceite no prazo virava "expirada"; (baixa) aceite não confirmado ficava em silêncio | Ciclo 2 |
| 2 | Engenheiro | Entregue | - | Regra do prazo pelo aceite; estado "refazer", sino, "Aceitei de novo", "Desfazer" |
| 2 | QA | Reprovado | (alta) duas abas pagavam duas consultas; (média) "Desfazer" depois do prazo tirava da fila | Ciclo 3 |
| 3 | Engenheiro | Entregue | - | Decisão refeita dentro da trava; `podeDesfazer` |
| 3 | QA | Reprovado | (média) caminho rápido lia versões misturadas do banco | Ciclo 4 |
| 4 | Engenheiro | Entregue | - | Leitura em transação REPEATABLE READ (`lerGuardado`) |
| 4 | QA | Aprovado | - | - |
| 4 | Tech lead | Reprovado | (média) passo 7 contradizia o cartão no estado "aceita"; (baixa) comentários longos | Ciclo 5 |
| 5 | Engenheiro | Entregue | - | Passo 7 usa `ROTULO_ACEITE`; comentários requebrados |
| 5 | QA | Aprovado | - | - |
| 5 | Tech lead | Aprovado | - | - |

Verificação final: npm test (núcleo 250/250, plataforma 602/602), typecheck e lint sem erros.

### Situação

Aprovada.

## Remoção (18/10/2026)

O que era só da autorização no e-CAC saiu do código; o modo guiado, o portão, o tooltip, `serpro_chamadas`,
`PLATAFORMA_CNPJ` e as credenciais `SERPRO_*` ficaram e foram ligados ao termo de autorização.

- Núcleo: `nucleo/src/serpro/procuracoes.ts`, `procuracoes-exemplo.ts`, `procuracoes.test.ts`, `procuracoes.qa.test.ts`
  (OBTERPROCURACAO41, lista de serviços do e-CAC, cobertura). O tipo `Funcao` foi para `plataforma/lib/termo/guiado.ts`.
- Plataforma: `lib/procuracao/` inteiro (`aceite.ts`, `consulta.ts`, `guiado.ts`, `mensagens.ts`, `plataforma.ts`,
  `servidor.ts`, `situacao.ts` e testes); `app/(painel)/aceites/` (fila interna e o "Já aceitei"); do
  `app/(painel)/automatico/`: `passo-a-passo.tsx`, `passos.tsx`, `botao-assinei.tsx` ("Já assinei"),
  `botao-verificar.tsx`, `copiar.tsx`; o item "Autorizações" da área interna na barra lateral; o aviso de aceites no sino.
- Testes: `testes/procuracao*.test.ts`, `aceite*.test.ts`, `automatico-telas.test.ts`, `automatico-ciclo5.qa.test.ts`,
  `guiado.qa.test.ts`.
- Banco: a migração nova `0006_termo_autorizacao.sql` derruba `procuracoes` e `autorizacoes_recebidas` e cria
  `termos_autorizacao` (as migrações 0003 a 0005 ficam como estavam, já aplicadas).

