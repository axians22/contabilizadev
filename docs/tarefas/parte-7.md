# Parte 7 - eSocial

**Situação:** aprovada em 19/10/2026, no ciclo 3.

## Resumo da entrega
- Passos 20 e 21: o pró-labore vai para o eSocial (S-1200, S-1210, S-1298 e S-1299). Os lotes são transmitidos com o certificado da plataforma e cada evento é assinado pelo cliente no navegador. A fonte é o MOD do eSocial v1.16.
- A retificação é explícita (S-1200 com indRetif 2). Também entraram a idempotência (índices únicos e reenvio do mesmo lote quando a resposta não chega), o prazo e o aviso no sino.
- Para o eSocial ser feito no portal, há o modo guiado (`FacaNoPortal`).
- Reconciliação com a DCTFWeb: todo S-1299 vai com transDCTFWeb=S (Manual da DCTFWeb jan/2025, §14.5 e §17.1.1). Há uma trava de mão dupla, e cada lado confere o outro de novo depois de gravar a própria trava. O que foi registrado antes do último fechamento não conta.
- Pagamento do mês anterior sem o S-1200 dele aqui: o envio é recusado e pede a importação do mês, a menos que o cliente escolha explicitamente fechar sem ele.
- Migração 0012_esocial, aba /esocial, passo 6 no /roteiro (a DCTFWeb passou a ser o passo 7) e cartão no painel.

## Arquivos principais
- `nucleo/src/esocial/` (eventos, lote, folha, leitura, validar, ws), `nucleo/src/assinatura.ts`, `nucleo/esquemas/esocial/`
- `plataforma/lib/esocial/` (config, registro, configuracao, envio, prazo, mensagens, resumo, servidor), `plataforma/lib/rotina/dctfweb.ts`
- `plataforma/banco/migracoes/0012_esocial.sql`, `plataforma/banco/esquema.ts`
- `plataforma/app/(painel)/esocial/`, `app/(painel)/roteiro/esocial.tsx`, `faca-no-portal.tsx`, `sino.tsx`
- `README.md` (seção eSocial), `next.config.ts`, `.env.exemplo`

## Testes
- Núcleo: 361/361. Plataforma: 931/931. Typecheck e lint estão limpos.
- Os testes usam transporte falso com respostas gravadas e são validados contra os XSD oficiais. Nenhuma chamada real ao eSocial ou à Receita.
- Testes de QA: `testes/esocial.qa.test.ts`, `esocial-ciclo2.qa.test.ts` (inclui uma corrida real entre a DCTFWeb e o eSocial) e `esocial-ciclo3.qa.test.ts`.

## Ciclos
| Ciclo | Etapa | Resultado | Problemas apontados | Como foram resolvidos |
|---|---|---|---|---|
| 1 | Engenheiro | Entregue | - | - |
| 1 | QA | Reprovado | (alta) A retificação deixava de transmitir a DCTFWeb. (alta) A DCTFWeb podia ser transmitida em dobro com o S-1299 a caminho. (média) O S-1210 do mês anterior ficava de fora em silêncio. (baixa) Os tooltips não diziam a verdade sobre a DCTFWeb. | Ciclo 2 |
| 2 | Engenheiro | Entregue | - | Todo S-1299 vai com transDCTFWeb=S, e o que veio antes do último fechamento é ignorado. Trava de mão dupla conferida de novo depois de gravada. Recusa com pedido de importação ou escolha explícita do cliente. Textos condicionados. |
| 2 | QA | Aprovado | Nenhum. Conferiu a regra no Manual da DCTFWeb (§14.5 e §17.1.1). | - |
| 2 | Tech lead | Reprovado | (média) O README descrevia a regra antiga. (baixa) Código morto do ramo transDctf=false. (baixa) A mensagem dctfJaTransmitida não era usada. (baixa) A fonte estava citada de forma genérica. | Ciclo 3 |
| 3 | Engenheiro | Entregue | - | README reescrito, ramo morto e mensagem removidos, citação do §14.5 e do §17.1.1 em envio.ts e dctfweb.ts. |
| 3 | QA | Aprovado | Nenhum | - |
| 3 | Tech lead | Aprovado | Nenhum | - |
