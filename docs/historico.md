# Histórico da Receita (Parte 5)

Para a empresa ativa **autorizada** (termo em dia, ou a empresa da própria plataforma), a plataforma importa da Receita
Federal: declarações do PGDAS-D dos últimos 12 meses (lista por ano + extrato de cada mês), pagamentos (DAS e DARF do
INSS) do mesmo período, a última DEFIS e a situação fiscal (protocolo + relatório). Sem autorização, as abas mostram o
modo guiado (`<FacaNoPortal>`) e o que já tinha sido importado.

- **Banco primeiro** (`lib/historico/prazos.ts`, funções puras): lista de declarações e pagamentos no máximo 1 vez por dia
  sozinhos (ao abrir o Histórico; o ano anterior só até ser consultado depois de 1º de fevereiro; pagamentos só com DAS
  sem pagamento conhecido e vencido) ou pelo botão Atualizar (intervalo mínimo de 10 minutos); extrato uma vez por
  declaração (retificadora = declaração nova = outro extrato); situação fiscal a cada 2 meses (botão: 30 minutos);
  DEFIS uma vez por ano depois de 31 de março (ou pelo botão). Tentativa que falhou conta: a automática espera 1 dia.
- **Importação em segundo plano** (`lib/historico/importacao.ts`): `iniciarImportacao` planeja e grava a linha em
  `importacoes` (no máximo uma rodando por empresa; parada há 15 minutos é encerrada como interrompida) e
  `executarImportacao` roda as etapas com `after()` do Next (`lib/historico/servidor.ts`), guardando o progresso; a tela
  recarrega sozinha enquanto roda. Começa quando a empresa fica autorizada (fim do passo 7 do cadastro, página
  Autorização) ou na primeira visita autorizada ao painel ou às abas. Falha de uma etapa não para as outras; a tela mostra
  mensagem própria (`lib/historico/mensagens.ts`) e o detalhe vai para o log com `[serpro]`.
- **Tabelas** (todas com `empresa_id`, pela porta de acesso, apagadas na remoção da empresa): `pgdasd_declaracoes`,
  `pgdasd_das`, `pgdasd_extratos`, `pagamentos`, `defis`, `situacoes_fiscais`, `historico_consultas` (quando cada
  consulta foi feita) e `importacoes`. Os PDFs (extrato, relatório, DEFIS e recibo) ficam no banco (`bytea`) e só saem por
  `app/documentos/[tipo]/[id]` (sessão, portão e a linha procurada só na empresa ativa; de outra empresa, 404). Cada
  chamada fica em `serpro_chamadas` com o custo (tabela de preços do núcleo).
- **Telas**: Histórico (`/historico`: tabela dos 12 meses com receita, DAS, situação pago/em aberto/vencido, data do
  pagamento e o extrato em PDF; gráficos de receita e DAS carregados sob demanda; aviso de atividade que não bate com o
  CNAE, com o que fazer no tooltip), Situação fiscal (`/situacao`: Regular/Irregular em evidência, pendências, data e
  PDF), Declaração anual (`/defis`: última DEFIS entregue com declaração e recibo). O painel ganha o resumo (situação
  fiscal e último DAS) e o sino avisa situação irregular e atividade divergente.
- **Testes**: `nucleo/src/serpro/pgdasd-consultas.test.ts`, `extrato.test.ts` (inclusive o extrato real do `../fiscal`,
  quando existe), `conferencia-anexo.test.ts`; `plataforma/lib/historico/*.test.ts` (prazos e montagem dos meses) e
  `testes/historico.test.ts` (ponta a ponta no banco de teste: importação inicial, banco primeiro, retificadora, falhas,
  limite, sem autorização, corrida, parada, isolamento, remoção e o cliente real com transporte falso registrando o
  custo) e `testes/historico-telas.test.ts`.
- **Desenvolvimento sem chamar a Receita**: para abrir as telas sem gastar consultas, suba com a integração desligada:
  `SERPRO_CONSUMER_KEY= CERT_PFX_PATH= npm run dev` (variável vazia no ambiente vale sobre o `.env.local`; a importação
  fica "indisponível" e nada é chamado). Com as credenciais, a empresa da própria plataforma é importada sozinha na
  primeira visita ao painel (cerca de 20 consultas).
