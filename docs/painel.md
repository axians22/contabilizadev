# Resto do painel (Parte 8): Caixa Postal, situação fiscal, declaração anual e avisos

**Caixa Postal** (aba **Mensagens**, `/mensagens`; `lib/caixa-postal/`, núcleo `serpro/caixa-postal.ts`). **Regra legal:** abrir
o conteúdo de uma mensagem registra a ciência do contribuinte e pode começar a contar prazos. Conferido na documentação
oficial do Integra Contador em 20/10/2026
(https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-caixapostal/caixapostal/servicos/):

- "Obter Lista de Mensagens por Contribuintes" (`CAIXAPOSTAL/MSGCONTRIBUINTE61`): só o cabeçalho (assunto, data e hora,
  remetente, indicador de leitura, data de ciência, relevância), 50 por página, com ponteiro para a próxima. Não registra
  ciência. É o único serviço que a lista usa.
- "Obter Indicador de Novas Mensagens" (`CAIXAPOSTAL/INNOVAMSG63`): só diz se há mensagem nova. Não usado.
- "Obter Detalhes de uma Mensagem Específica" (`CAIXAPOSTAL/MSGDETALHAMENTO62`): o conteúdo. A documentação diz: "a execução
  deste serviço caracteriza ciência da intimação, nos termos do art. 23, § 2º, inciso III, do Decreto nº 70.235/1972".

Por isso: a lista nunca abre nada; o conteúdo só é buscado quando o cliente clica em "Abrir a mensagem" e, se a mensagem
ainda não foi lida, confirma na caixa de diálogo "Ao abrir, a Receita registra que você tomou ciência desta mensagem"
(o servidor confere a confirmação de novo). Já lida na Receita, abre sem a caixa (a ciência já aconteceu). **Banco
primeiro:** a lista (tabela `caixa_postal`) é buscada sozinha no máximo uma vez por dia, em segundo plano (`after()`), ao
abrir o painel ou a aba, ou pelo botão Atualizar (intervalo mínimo de 10 minutos); a vez de buscar é uma troca condicional
em `historico_consultas` (`caixa-postal`), então duas abas buscam uma vez; a tentativa que falhou também conta. A primeira
busca segue até 3 páginas; as seguintes, só a primeira (as mais recentes). O conteúdo aberto fica guardado e não é pedido
de novo; a trava `abrindo_em` faz o duplo clique chamar uma vez. Na tela, cada mensagem é uma lista suspensa (o cabeçalho
visível com ela fechada: assunto, remetente, data, Nova, Importante, Lida/Não lida e a data em que a Receita considera a
ciência mesmo sem abrir), numa tabela única paginada; o HTML da Receita vira só texto e links (`mensagem-receita.ts`).
"Nova" (sino) = não lida e ainda não vista na lista (ver a lista apaga o sino sem registrar nada na Receita); "não lida"
(painel) = não lida na Receita e não aberta aqui. Sem autorização: modo guiado com o caminho no e-CAC.

**Situação fiscal** (`/situacao`, completa a Parte 5): consulta automática a cada 2 meses (banco primeiro); no painel fica
primeiro e, irregular, ocupa a linha inteira em vermelho com o resumo das pendências. As pendências do relatório
(`lib/situacao/pendencias.ts`) viram título curto em linguagem simples (imposto vencido, declaração em falta, dívida ativa,
parcelamento, processo, valores que não batem), com o que é e o que fazer no tooltip. Débito de DAS ou de INSS do
pró-labore com o mês casa com a guia vencida da rotina do mês (Parte 6): o botão gera a guia nova com multa e juros para a
data de pagamento escolhida (`GuiaAqui`). Guias vencidas que o relatório não citou aparecem logo abaixo.

**Declaração anual** (`/defis`, nome na tela "Declaração anual"): prazo do ano que fechou (Resolução CGSN 140/2018, art.
72: até 31 de março do ano seguinte; multa da LC 123/2006, art. 38), situação (entregue, a entregar, atrasada ou não
conferida), o que muda na virada do ano no tooltip, os valores do ano prontos (receita, pró-labore, INSS, DAS e o limite do
lucro isento sem contabilidade, com a conta no tooltip; `lib/defis/resumo.ts` com o `resumoDoAno` do núcleo) e o que só o
cliente sabe (lucros, saldos, despesas; tabela `defis_dados`). **A plataforma não transmite a DEFIS** (o site de referência
também não): modo guiado com os valores prontos; depois, a consulta da Parte 5 mostra a declaração entregue. Aviso
(`lib/defis/prazo.ts`): informativo em janeiro, amarelo em fevereiro e março, vermelho depois do prazo se a Receita não tem.

**Central de avisos** (`lib/avisos/`): `coleta.ts` junta, só do banco, situação fiscal irregular, guias vencidas, PGDAS-D
(meses sem declaração e o prazo do mês), DCTFWeb (dia 15, IN RFB 2.005/2021, art. 10, com a IN RFB 2.162/2023), eSocial,
declaração anual, Fator R, autorização perto de vencer, atividade que não bate com o CNAE e mensagens novas; o navegador
acrescenta o certificado guardado perto de vencer (`sino-navegador.tsx`). `central.ts` tira o repetido (mesma chave, ou
coberto por outro: o eSocial do mês cobre a DCTFWeb; o certificado do termo cobre o mesmo certificado guardado) e ordena
por prioridade (Urgente, Atenção, Para saber). O sino mostra a cor do mais grave, os cinco primeiros e "Ver todos os
avisos"; a página **Avisos** (`/avisos`) tem a lista completa numa tabela única paginada. Uma fonte que falha não derruba
as outras (log).

Tabelas novas (com `empresa_id`, apagadas com a empresa): `caixa_postal` e `defis_dados`. Migração
`0013_parte8_caixa_postal_defis`. Testes (nada chama a Receita; respostas gravadas da Caixa Postal no formato oficial em
`nucleo/src/serpro/caixa-postal-exemplo.ts`): `nucleo/src/serpro/caixa-postal.test.ts` (listar nunca chama o serviço da
ciência, páginas), `plataforma/testes/caixa-postal.test.ts` (banco primeiro, intervalo, corrida, confirmação, duplo
clique, falhas, isolamento, cliente real com transporte falso, remoção), `testes/avisos.test.ts` (central sem repetição,
pendência x guia vencida, declaração anual), `testes/parte8-telas.test.ts` e `lib/{avisos,defis,situacao}/*.test.ts`.
