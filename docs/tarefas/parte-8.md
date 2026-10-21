# Parte 8 - Resto do painel

**Situação:** aprovada em 20/10/2026, no ciclo 6, pelo QA e pelo tech lead.

## Resumo da entrega
- **Caixa Postal** (/mensagens): a lista vem do MSGCONTRIBUINTE61, buscada no máximo uma vez por dia ou pelo Atualizar (intervalo mínimo de 10 min). O conteúdo vem do MSGDETALHAMENTO62, que registra a ciência (Decreto 70.235/1972, art. 23, § 2º, III). Por isso só é buscado quando o cliente pede, com confirmação e uma trava por mensagem. O HTML da Receita vira texto seguro.
- **Situação fiscal**: aparece primeiro no painel e, se irregular, em vermelho. As pendências são explicadas em linguagem simples e ligadas à guia vencida, com o botão de gerar a guia com juros.
- **Declaração anual** (/defis): situação, prazo de 31/03 e valores do ano prontos. A entrega é guiada no portal, porque a plataforma não transmite a DEFIS. O tooltip do lucro isento muda conforme o ano (Lei 15.270/2025). O estado "não devida" vale para empresas que entraram no Simples depois do ano declarado.
- **Central de avisos** (lib/avisos): reúne todas as fontes sem repetir aviso, com prioridade. O sino e a página /avisos usam essa central.
- Migração 0013 (caixa_postal, defis_dados), com cascade e teste de órfãs.

## Arquivos principais
- nucleo/src/serpro/caixa-postal.ts
- plataforma/lib/caixa-postal/*, lib/avisos/*, lib/defis/{prazo,resumo,limite}.ts, lib/situacao/pendencias.ts, lib/historico/leitura.ts, lib/rotina/base.ts
- plataforma/app/(painel)/: page.tsx, funcoes-do-painel.tsx, sino-visual.tsx, sino-navegador.tsx, mensagens/*, avisos/*, situacao/*, defis/*
- plataforma/banco/esquema.ts e migracoes/0013_parte8_caixa_postal_defis.sql
- README.md

## Testes
Ao final: núcleo 364/364 e plataforma 1052/1052, contando os testes do QA. typecheck e lint sem erros. Nenhuma chamada real à Receita.

## Ciclos
| Ciclo | Etapa | Aprovado | Problemas apontados | Como foi resolvido |
|---|---|---|---|---|
| 1 | Engenheiro | entregue | - | Entrega inicial (999 testes) |
| 1 | QA | não | Pendências lidas como uma linha por débito (o PDF real tem uma célula por linha); o sino perdia as mensagens não lidas depois de vista a lista; DEFIS "atrasada" com consulta feita antes do prazo | Ciclo 2: juntarDebitos; aviso pelas não lidas; entregaDaDeclaracaoAnual |
| 2 | QA | não | O cabeçalho de página (CNPJ e nome) entrava no débito; DEFIS cobrada antes do início de atividade | Ciclo 3: QUEBRA_DE_PAGINA ampliada; inicioNoSimples, declaracaoDevida e o estado "não devida" |
| 3 | QA | sim | - | - |
| 3 | Tech lead | não | DEFIS como "Feito aqui" no painel; quadro vermelho antes do prazo; tooltip sem a Lei 15.270/2025; sino.tsx morto; imports e rodape vazio | Ciclo 4: "Valores prontos aqui"; DefisNaoEncontrada só depois do prazo; lib/defis/limite.ts por ano; sino.tsx apagado; imports e rodapé arrumados |
| 4 | QA | sim | - | - |
| 4 | Tech lead | não | PDFs (bytea) lidos em toda página; ordem dos imports em coleta.ts; ultimaConsulta repetida; texto da retenção sem "por sócio" | Ciclo 5: "is not null" e defisDoAno; imports em ordem; promessa compartilhada; texto "ao mesmo sócio" |
| 5 | QA | sim | - | - |
| 5 | Tech lead | não | Painel com vários new Date() (risco na virada do ano); consulta do CNPJ lida 3 vezes no painel | Ciclo 6: um instante só (agora/hoje); consultaLida em baseDoMes e avisoFatorR |
| 6 | QA | sim | - | - |
| 6 | Tech lead | sim | - | - |

## Ajustes
Pedido: o painel e a página do histórico devem seguir o desenho do ../fiscal (que só foi lido, nunca alterado).

### Correções pedidas e como foram resolvidas
1. **Painel igual ao do fiscal**: painel-do-mes.tsx, situacao-fiscal.tsx e guias-do-mes.tsx seguem fiscal/app/page.tsx bloco a bloco (cabeçalho do mês, faixas, situação fiscal, destaque do total, recebido/12 meses, lançar com as guias, Guias do mês e Alíquota). O "Modo de teste" virou a faixa "Modo guiado"; CPF e investimentos ficaram fora do escopo.
2. **Histórico parecido com o do fiscal**: refeito com lib/historico/conferencia.ts (função pura com o apurar do núcleo), tela-historico.tsx e page.tsx. Título "Histórico e conferência", botão de pró-labore e INSS (?prolabore=1), tabela densa com 12 por página e as colunas do fiscal, mais Situação e Extrato (PDF). A conferência do CNAE, o modo guiado e os gráficos sob demanda foram mantidos.
3. **DEFIS repetida no sino**: a faixa saiu do painel; o aviso fica só no sino.
4. **"-R$ 0,00"**: brl do núcleo trata |v| < 0,005 como zero e a diferença usa `centavos(...) || 0`.
5. **Linha de CNAE divergente em verde**: novo `destaque: "alerta"` (bg-bad/5) na Tabela.
6. **Guia "vencida" sem existir**: guiaExiste, como o vencidaNoMes do fiscal; guia vencida sem declaração leva ao passo 4; o destaque só fica vermelho com guia existente.
7. **Faixa do modo guiado repetindo o sino**: só aparece quando o termo nunca foi assinado.
8. **"Nenhuma guia vencida aqui" no modo guiado**: as vencidas são lidas do banco também sem autorização; nova mesesComGuiaVencida.
9. **#guias inexistente com DARF vencido sem receita**: `mostrarGuias` passou a considerar guias existentes.
10. **Destaque verde com DARF vencido sem pró-labore**: o DARF existente entra no total, no destaque e nas vencidas pela regra guiaExiste.

### Ciclos desta rodada
| Ciclo | Etapa | Aprovado | Problemas apontados | Como foi resolvido |
|---|---|---|---|---|
| 1 | Engenheiro | entregue | - | Painel e histórico refeitos no desenho do fiscal |
| 1 | QA | não | DEFIS repetida no sino; "-R$ 0,00"; linha de CNAE em verde | Ciclo 2: faixa removida; brl sem -0; destaque "alerta" |
| 2 | QA | não | Guia vencida sem existir; destaque vermelho só com previsão; faixa do modo guiado duplicada | Ciclo 3: guiaExiste; faixa só com termo ausente |
| 3 | QA | não | "Nenhuma guia vencida aqui" no modo guiado | Ciclo 4: vencidas sem depender da autorização; mesesComGuiaVencida |
| 4 | QA | não | DARF vencido sem receita apontava para #guias inexistente | Ciclo 5: mostrarGuias |
| 5 | QA | não | Destaque verde com DARF vencido e pró-labore não informado | Ciclo 6: comInss inclui o DARF existente |
| 6 | QA | sim | - | - |
| 6 | Tech lead | sim | - | - |

Ao final: núcleo 369/369 e plataforma 1190/1190; typecheck e lint sem erros. Nenhuma chamada nova à Receita.

### Situação
Aprovada em 20/10/2026, no ciclo 6, pelo QA e pelo tech lead. Sem pendências.

## Ajustes (barra lateral, eSocial, lançar e reconsulta)

### Correções pedidas e como foram resolvidas
1. **Barra lateral em grupos**: lib/abas.ts ganhou o campo `grupo`; app/barra-lateral.tsx monta Empresa (Painel do mês, Roteiro, Guias, Histórico, Situação fiscal, Declaração anual, Mensagens, Avisos), Configuração (Dados da empresa, Autorização, eSocial) e, por último e só para o ADMIN, Plataforma (Usuários, Certificado da plataforma, Plano). Barra larga, recolhida e gaveta do celular usam o mesmo componente `Itens`. O Roteiro continua como aba própria.
2. **Aba eSocial só configuração**: a tabela dos últimos 12 meses (`MesesNoEsocial`, `situacaoDoMes`) e o acompanhamento dos lotes (`acompanharAoAbrir`) foram para o passo 6 do Roteiro, sem duplicação. A tabela abre na página do mês aberto (`paginaInicial` na Tabela e `key={atual}`, para valer também ao trocar de mês). A frase "Não precisa de procuração" foi para o tooltip do passo 6.
3. **Bloco LANÇAR igual ao ../fiscal**: com o mês em andamento, aparece "<Mês> ainda está em andamento. O botão de lançar é liberado em dd/mm/aaaa.", os campos à vista (data com o dia de hoje) e o botão desativado "Lançar a partir de dd/mm/aaaa". É o mesmo `LancarReceita`, com `liberadoEm`; o servidor continua recusando (`mesLancavel`).
4. **Reconsulta das 18:42**: não é defeito. O banco de desenvolvimento (lido só para leitura) grava a importação como motivo "manual", com o plano do botão "Atualizar" do Histórico. O caminho automático respeita 1 dia por tentativa, inclusive após falha; testes em testes/historico.test.ts provam isso.
5. **Código morto** (tech lead): `AbaEmConstrucao` removido de app/(painel)/portao.tsx e dos testes que o mantinham.

### Ciclos desta rodada
| Ciclo | Etapa | Aprovado | Problemas apontados | Como foi resolvido |
|---|---|---|---|---|
| 1 | Engenheiro | entregue | - | Os 4 pedidos entregues |
| 1 | QA | não | Mês aberto escondido na 2ª página da tabela; "Não precisa de procuração" perdido | Ciclo 2: `paginaInicial`; frase no tooltip do passo 6 |
| 2 | QA | não | Página inicial só valia na primeira montagem (troca de ?mes=) | Ciclo 3: `key={atual}` na Tabela |
| 3 | QA | sim | - | - |
| 3 | Tech lead | não | `AbaEmConstrucao` sem uso | Ciclo 4: componente e testes removidos |
| 4 | QA | sim | - | - |
| 4 | Tech lead | sim | - | - |

Ao final: núcleo 375/375 e plataforma 1275/1275; typecheck e lint sem erros. Nenhuma chamada real à Receita.

### Situação
Aprovada em 20/10/2026, no ciclo 4, pelo QA e pelo tech lead. Sem pendências.
