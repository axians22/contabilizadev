# Rotina do mês (Parte 6)

Na aba **Roteiro** (`/roteiro`, a aba que já descrevia "o que fazer a cada mês"), um passo por cartão, para o mês escolhido
no topo (padrão: o último mês encerrado). Só banco ao abrir: nada é consultado na Receita sem um clique.

1. **Receita do mês** (`lib/rotina/receitas.ts`): o valor em reais que caiu na conta pelo trabalho do mês, lançado depois
   que o mês termina. Em moeda estrangeira, o valor na moeda e, se o cliente souber, o valor em reais creditado; sem ele, a
   PTAX de compra do dia do recebimento (Banco Central, banco primeiro em `cotacoes_ptax`).
2. **Pró-labore do mês** (`prolabores`): entra no Fator R e define o INSS esperado (11%) da DCTFWeb.
3. **Cálculo** (`lib/rotina/base.ts` + núcleo `apuracao.ts`): RBT12 e folha dos meses anteriores vindas do histórico da
   Parte 5 (itens 2.2 e 2.3 do extrato mais recente, receita declarada de cada mês, pró-labore pelo DARF do INSS pago) e do
   que foi lançado aqui; Anexo III ou V pelo Fator R; DAS por tributo, com a conta inteira no tooltip. Meses sem receita
   viram o aviso de histórico incompleto. Confere com o caso real: DAS de 09/2026 = R$ 1.000,76 (Anexo III, exportação).
4. **Declaração (PGDAS-D)** (`lib/rotina/pgdasd.ts`): simular (a Receita calcula sem transmitir; a comparação fica na tela;
   a mesma simulação que bateu no mesmo dia não é pedida de novo)
   e transmitir só com uma simulação que bateu, com os mesmos dados, e com a **confirmação** na caixa de diálogo com o
   resumo (receita, anexo, DAS); o servidor confere que o resumo confirmado é o atual. **Idempotente**: uma transmissão
   viva por mês e declaração retificada (índice único em `pgdasd_envios`; duplo clique e duas abas chamam uma vez);
   sem resposta da Receita a transmissão fica **incerta** e nada é transmitido de novo até o histórico mostrar se a
   declaração chegou. **Retificação** explícita: mês declarado só recebe retificadora (lançando a receita correta), presa
   à declaração que ela substitui. Transmitida, a declaração entra no histórico na hora, com a declaração e o recibo em PDF.
5. **DAS** (`lib/rotina/guias.ts`): a guia da declaração vigente; vencida e sem pagamento, a guia atualizada com multa e
   juros para o dia escolhido (dia útil de hoje até o fim do mês, `dataConsolidacao`). Banco primeiro: a mesma guia (mês,
   tipo, declaração e data) não é pedida de novo.
6. **DCTFWeb e DARF do INSS** (`lib/rotina/dctfweb.ts`): conferir (situação e valor), transmitir só se o INSS bater com
   11% do pró-labore, com confirmação, e gerar o DARF (vencido: `DataAcolhimentoProposta`). A Receita exige a assinatura
   do autor do pedido: a empresa da plataforma assina no servidor com o certificado do contrato; um cliente assina no
   navegador com o e-CNPJ A1 dele (o servidor prepara, o navegador devolve só o valor assinado), pelo assinador único
   (abaixo). Já transmitida, a correção é no e-CAC.

Sem autorização em dia, cada passo que depende da Receita vira o modo guiado (`<FacaNoPortal>`) com os valores prontos.
A aba **Guias** lista as guias geradas e as vencidas dos últimos 12 meses (com a guia atualizada). PDFs (guias,
declaração e recibo) ficam no banco e saem só pela rota de documentos. Cada chamada fica em `serpro_chamadas`.

**Fator R perto de 28%** (passo 19, `lib/rotina/fator-r.ts`): para atividade com Fator R, o painel, a rotina e o sino
avisam entre 25% e 30% (abaixo de 28% a empresa está no Anexo V; até 30% está no III com margem de menos de 2 pontos),
com o pró-labore deste mês que deixa o próximo PA em 28% e a economia estimada, com a conta no tooltip.

Tabelas novas (todas com `empresa_id`, apagadas com a empresa): `receitas_lancadas`, `prolabores`, `pgdasd_envios`,
`dctfweb_envios` e `guias`; da plataforma: `cotacoes_ptax`. Migração `0010_rotina_do_mes`.

Testes: `nucleo/src/apuracao.test.ts`, `ptax.test.ts`, `serpro/dctfweb.test.ts` (assinatura em duas etapas, inclusive o
XML real da DCTFWeb de 09/2026), `serpro/pgdasd.test.ts`, `serpro/extrato.test.ts`; `plataforma/testes/rotina.test.ts`
(ponta a ponta no banco de teste com respostas gravadas: receita e PTAX, caso real, simular/confirmar/transmitir,
duplo clique, sem resposta, retificação, guias e vencida, DCTFWeb no servidor e no navegador, sem autorização, Fator R,
isolamento, remoção e o cliente real registrando o custo), `testes/rotina-telas.test.ts` e `lib/rotina/rotina.test.ts`.
