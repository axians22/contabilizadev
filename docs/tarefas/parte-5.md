# Parte 5 - Importar o histórico

**Situação:** aprovada (ciclo 5, QA e tech lead), em 18/10/2026.

## Resumo da entrega
- Importação da Receita Federal, em segundo plano, para a empresa autorizada: declarações PGDAS-D dos últimos 12 meses com extratos (e PDF da declaração quando não há DAS), pagamentos, última DEFIS e situação fiscal.
- Regra banco primeiro com prazos por consulta (lib/historico/prazos.ts); falha conta 1 dia; custo registrado em serpro_chamadas.
- Conferência CNAE x atividade declarada (mercado e regra, com explicação pela natureza da atividade, LC 123/2006 art. 18).
- Situação do mês pelo DAS da declaração vigente (qualquer guia gerada depois dela quita o mês).
- Telas: Histórico (tabela, gráficos, divergência), Situação fiscal, Declaração anual, resumo no painel, avisos no sino.
- PDFs no banco, servidos só por app/documentos/[tipo]/[id] com portão e empresa ativa.
- Migrações 0008 e 0009; todas as tabelas com empresa_id e cascade na remoção.

## Arquivos principais
- nucleo/src/serpro/{pgdasd-consultas,extrato,historico-exemplo,pagamentos}.ts, nucleo/src/conferencia-anexo.ts
- plataforma/banco/esquema.ts, migracoes/0008_historico.sql, 0009_extrato_da_declaracao.sql
- plataforma/lib/historico/{prazos,leitura,importacao,mensagens,documentos,servidor}.ts, lib/empresas/acesso.ts
- plataforma/app/documentos/[tipo]/[id]/route.ts, app/(painel)/{historico,situacao,defis,autorizacao}/*, page.tsx, layout.tsx, sino.tsx
- README.md

## Testes
- Final: núcleo 325/325, plataforma 663/663; typecheck e lint limpos.
- Novos: pgdasd-consultas, extrato, conferencia-anexo, prazos, leitura, historico (integração), historico-telas.
- QA: conferencia-anexo.qa/ciclo2/ciclo3/ciclo4/ciclo5, leitura.qa/ciclo2/ciclo3, historico.qa, prazos.qa.

## Ciclos
| Ciclo | Etapa | Resultado | Problemas apontados | Como foram resolvidos |
|---|---|---|---|---|
| 1 | Engenheiro | entregue | - | Entrega inicial |
| 1 | QA | reprovado | (alta) conferência ignorava o mercado; (alta) retificadora com DAS complementar vencido aparecia pago; (média) mês sem receita virava "sem guia" e disparava pagamentos diários; (média) DEFIS "não encontrada" sem consulta; (baixa) tooltip errado para Anexo IV | - |
| 2 | Engenheiro | entregue | - | Conferência por mercado e regra; pago só pelo DAS vigente; débito lido da declaração (CONSDECREC15, migração 0009) e pagamentos só com DAS vencido; DEFIS "Ainda não consultada"; tooltip pela atividade declarada |
| 2 | QA | reprovado | (alta) DAS gerado de novo e o primeiro pago aparecia vencido; (baixa) tooltip errado para atividades 32, 28, 26 e revenda | - |
| 3 | Engenheiro | entregue | - | Qualquer DAS após a declaração vigente quita o mês; tabela NATUREZAS com anexo e regra própria de cada atividade |
| 3 | QA | aprovado | - | - |
| 3 | Tech lead | reprovado | (baixa) atividades 40-43 (IPI e ISS) descritas como venda de mercadoria | - |
| 4 | Engenheiro | entregue | - | Natureza "industrializacao-servico" com texto próprio e base legal (LC 123 art. 18 §4º VI; CGSN 140 art. 25 §1º VII) |
| 4 | QA | aprovado | - | - |
| 4 | Tech lead | reprovado | (baixa) código morto `regraPropria ?? "com ICMS"` e "Anexo II" fixo no texto | - |
| 5 | Engenheiro | entregue | - | "com ICMS" direto; anexo vindo de natureza.anexo; comentário ajustado |
| 5 | QA | aprovado | - | - |
| 5 | Tech lead | aprovado | - | - |
