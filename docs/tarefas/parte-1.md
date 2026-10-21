# Parte 1 - Núcleo (sem tela)

**Situação:** aprovada em 16/10/2026 (2 ciclos).

## Resumo da entrega
- Núcleo em `nucleo/`, copiado e generalizado do `../fiscal` (sem alterá-lo): cliente do Serpro (limite, confirmação, finalidade, custo, token de procurador), assinatura XML e .pfx só em memória, PGDAS-D, DCTFWeb, guias com multa e juros, PAGTOWEB, situação fiscal, Caixa Postal, DEFIS, pró-labore, eSocial (S-1200/1210/1299/1000, lote, webservice, XSD) e leitores de PDF e Excel.
- Nada fixo: CNPJ, CNAE, categoria, CPF, certificado e transporte vêm por parâmetro; nenhuma função grava em banco ou disco.
- `simples.ts`: Anexos III e V (tabelas até 2026 e 2027–2028, CGSN 140/190), teto de 5% do ISS com redistribuição, RBT12 e Fator R (28% exato fica no Anexo III).
- `cnae.ts`: CNAEs de TI com Anexo III fixo ou dependentes do Fator R, com fundamento no art. 25, § 1º.
- Caso real conferido: DAS de 09/2026 = R$ 1.000,76 (RBT12 R$ 352.998,85); INSS de R$ 178,31.

## Arquivos
`nucleo/src/` (simples, cnae, formato, meses, http, certificado, assinatura, pdf, xlsx, prolabore, casos-reais, certificado-teste), `nucleo/src/serpro/*`, `nucleo/src/esocial/*`, `nucleo/esquemas/esocial/`, `nucleo/package.json`, `package-lock.json`, `README.md`.

## Testes
- 128 testes, 0 falhas (`npm test`); `typecheck` e `lint` limpos.
- Testes de QA: `nucleo/src/simples.qa.test.ts`, `nucleo/src/simples.redistribuicao.qa.test.ts`.
- Nenhum teste chama Serpro ou eSocial (respostas gravadas e certificado autoassinado temporário).

## Ciclos
| Ciclo | Etapa | Resultado | Problemas apontados | Como foi resolvido |
|---|---|---|---|---|
| 1 | Engenheiro | Entregue | - | 109 testes passando |
| 1 | QA | Reprovado | [alta] 5ª faixa do Anexo III até 2026 usava o modo "acrescimo" para redistribuir o ISS; a nota (*) manda (efetiva - 5%) × percentual | - |
| 2 | Engenheiro | Entregue | - | Removido o modo "acrescimo"; fórmula única (efetiva - teto) × peso; teste corrigido (IRPJ 711,08, CSLL 621,31, CPP 7.708,51) e teste novo do Anexo V |
| 2 | QA | Aprovado | - | 6 testes novos de QA passando (128 no total) |
| 2 | Tech lead | Aprovado | - | - |

## Pendências e observações
- 6ª faixa (RBT12 > R$ 3,6 mi) e PA a partir de 2029 lançam erro; CBS/IBS sem código de tributo.
- Caminho dos XSD (`import.meta.url`) pode precisar de ajuste no empacotamento do Next (Parte 7).
- Login com Google do horizons fica na Parte 2, passo 9.

## Ajustes

### Correções pedidas e como foram resolvidas
1. **Código de atividade do PGDAS-D para exportação com Fator R** — transcrito o catálogo oficial do Serpro (Dados de domínio, atividades 1 a 43) em `nucleo/src/serpro/atividades-pgdasd.ts`, com a URL. `idAtividadeExportacao` devolve 29 para 6201 a 6204 e 30 para 6209, 6311 e 6319 (30 confere com o extrato real do `../fiscal`); `idAtividadeInterno` devolve 10/11/12 (Fator R) e 13/14/15 (Anexo III). A declaração (TRANSDECLARACAO11) agora leva `folhasSalario` com os meses de `mesesDoFatorR`, a mesma função do `fatorR` (FSPA no mês de abertura até 2026, janela da CGSN 190/2026 a partir de 2027, nenhum mês no 1º e 2º mês de 2027); `inicioAtividade` entra em `DadosDeclaracao`.
2. **Lint não cobria o núcleo** — criado `nucleo/eslint.config.mjs` e o script `lint` do núcleo; o `npm run lint` da raiz roda núcleo e plataforma, sem apontamentos.
3. **Percentuais sem fonte no Anexo V até 2026** — trocados por `redistribuicao: {}`; teste mostra que o resultado é igual.
4. **Funções não usadas em `meses.ts`** — removidas `mesAtual`, `dozeAnteriores` e `fimDeSemana`, com os testes delas.
5. **Vencimento sempre no dia 20** — novo `nucleo/src/feriados.ts` (feriados fixos e móveis pela Páscoa, feriados extras por parâmetro, `diaUtilAnterior`/`diaUtilSeguinte`); o vencimento é antecipado para o dia útil anterior (LC 123 art. 21, III; CGSN 140 art. 40; Lei 8.212 art. 30) e usado em guias, pagamentos, PGDAS-D e DCTFWeb.
6. **1 centavo de diferença no mercado interno** — confirmado que é o comportamento do PGDAS-D (cada tributo arredondado, total = soma): bate com os exemplos 4, 5 e 6 do Manual PGDAS-D 2018 v4 e com o extrato real de 09/2026 (1.000,76). Fórmula mantida, fonte documentada em `calcularDas` e testes acrescentados.

### Ciclos desta rodada
| Ciclo | Etapa | Resultado | Problemas apontados | Como foi resolvido |
|---|---|---|---|---|
| 1 | Engenheiro | Entregue | - | As 6 correções; 146 testes passando, typecheck e lint limpos |
| 1 | QA | Reprovado | [alta] No mês de abertura com atividade 29, a declaração não levava a folha do próprio PA (FSPA) e o PGDAS-D calcularia Anexo V | - |
| 2 | Engenheiro | Entregue | - | `mesesDoFatorR` única para `fatorR` e declaração; `inicioAtividade` em `DadosDeclaracao`; 156 testes |
| 2 | QA | Aprovado | - | Varredura de 48 PAs (2025 a 2028) com inícios variados; 161 testes, 0 falhas |
| 2 | Tech lead | Aprovado | - | - |

### Situação
Aprovada. Todas as correções do tech lead e a pendência do código de atividade estão resolvidas; 161 testes, typecheck e lint sem erros.
