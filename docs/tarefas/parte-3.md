# Parte 3 - Cadastro e diagnóstico

**Situação:** aprovada em 16/10/2026 (QA e tech lead, ciclo 5, sem pendências).

## Resumo da entrega
- **Núcleo:** cliente da BrasilAPI (`brasilapi/cnpj.ts`) com fetch injetável, tempo limite de 15 s e mensagens para 404/400, 429, 5xx, falha de rede e resposta inválida. Também tem CNPJ alfanumérico com dígito verificador (IN RFB 2.229/2024), `diagnostico.ts` (anexo, Fator R com explicação ou "ainda não atendemos" com motivos) e 7490-1/04 fora do escopo, com fundamento. `formatarCnae` e `formatarNatureza` estão em `formato.ts`.
- **Plataforma:** tabela `consultas_cnpj` (migração 0002). `receita.ts` olha o banco primeiro, considera os dados válidos por 30 dias e só deixa "Atualizar" de novo depois de 5 minutos, sempre pela porta `acesso.ts`. `cadastro.ts` usa uma prévia assinada com HMAC, presa ao usuário e válida por 30 minutos, e quem cadastra vira DONO.
- **Telas:** `/empresas/nova`, `/empresa`, diagnóstico no painel, seletor de empresa e item novo na barra lateral. O README foi atualizado.
- Anexo e Fator R só aparecem quando a empresa está no Simples, não é MEI e todos os CNAEs são atendidos.
- Os testes não chamam a BrasilAPI e usam respostas gravadas. Só a do Banco do Brasil é real.

## Arquivos principais
- `nucleo/src/`: `formato.ts`, `cnae.ts`, `diagnostico.ts`, `brasilapi/cnpj.ts`, `brasilapi/exemplos.ts`, `brasilapi/exemplos/*.json`
- `plataforma/banco/`: `esquema.ts`, `migracoes/0002_consultas_cnpj.sql`
- `plataforma/lib/empresas/`: `cnpj.ts`, `servico.ts`, `receita.ts`, `cadastro.ts`
- `plataforma/app/(painel)/`: `empresas/nova/*`, `empresa/*`, `page.tsx`, `seletor-empresa.tsx`
- `plataforma/app/barra-lateral.tsx` e `README.md`

## Testes
- No núcleo: 220/220. Os testes estão em `cnpj.test.ts`, `diagnostico.test.ts`, `formato.test.ts` e `cnae.test.ts`, mais os testes de QA `*.qa.test.ts`.
- Na plataforma: 231/231. Inclui a integração com Postgres em `testes/cadastro.test.ts` e `cadastro.qa.test.ts`.
- typecheck, lint e build passam sem erros.

## Ciclos
| Ciclo | Etapa | Resultado | Problemas apontados | Como foi resolvido |
|---|---|---|---|---|
| 1 | Engenheiro | Entregue | - | Entrega inicial dos passos 12 e 13 |
| 1 | QA | Reprovado | (média) Anexo e Fator R aparecem para MEI e para empresa fora do Simples | Corrigido no ciclo 2 |
| 2 | Engenheiro | Entregue | - | `noSimples` controla anexo e Fator R, e a coluna passou a se chamar "Tributação no Simples" |
| 2 | QA | Aprovado | - | - |
| 2 | Tech lead | Reprovado | (média) Empresa com CNAE fora do escopo recebe anexo "III ou V"; (baixa) teste chamado "CNAE alfanumérico" | Corrigido no ciclo 3 |
| 3 | Engenheiro | Entregue | - | Anexo só quando todos os CNAEs são atendidos, com testes novos (inclusive de integração); teste renomeado |
| 3 | QA | Aprovado | - | - |
| 3 | Tech lead | Reprovado | (baixa) Formatação de CNAE e natureza duplicada; ternário redundante; `TRIBUTACAO` exportado sem uso | Corrigido no ciclo 4 |
| 4 | Engenheiro | Entregue | - | Funções levadas para `formato.ts`, `{d.anexo}` no lugar do ternário e `TRIBUTACAO` como constante local |
| 4 | QA | Aprovado | - | - |
| 4 | Tech lead | Reprovado | (baixa) Linha em branco duplicada em `diagnostico.ts` | Corrigido no ciclo 5 |
| 5 | Engenheiro | Entregue | - | Linha removida |
| 5 | QA | Aprovado | - | - |
| 5 | Tech lead | Aprovado | - | - |

## Observações
- Ao gravar as respostas de exemplo, o engenheiro chamou a BrasilAPI de verdade 2 vezes: uma para o Banco do Brasil e, por engano, uma para 11222333000181. A segunda resposta não foi salva.
- Não foi feito commit.

## Ajustes

### Correções pedidas
1. (Usuário) Transformar "Cadastrar empresa" em passo a passo: primeiro pesquisar o CNPJ, depois avançar etapa por etapa até cadastrar, ensinando o usuário no caminho.
2. (QA, ciclo 1, alta) Prévia vencida (mais de 30 min) prendia o cliente: no passo 1 com o mesmo CNPJ o botão era "Continuar" e reaproveitava a prévia que o servidor recusava.
3. (QA, ciclo 2, média) A idade da prévia comparava o horário do servidor com o relógio do navegador; navegador adiantado gerava laço infinito de novas pesquisas.

### Como foram resolvidas
1. /empresas/nova virou um assistente de 6 etapas (Pesquisar o CNPJ, Conferir a empresa, Atividades, Simples Nacional, Diagnóstico, Próximos passos), com "Passo N de 6", trilha com aria-current="step", Voltar/Continuar sem perder dados, foco no título e layout para celular. Termos com "Saiba mais" (app/saiba-mais.tsx): CNPJ, situação cadastral, natureza jurídica, CNAE, Simples, MEI, DAS, anexo, Fator R, pró-labore e procuração. Exemplo numérico do Fator R no diagnóstico. Cadastro na etapa 5 (DONO, empresa ativa); etapa 6 leva a /automatico ou ao painel. Empresa não atendida não é mais cadastrada (recusa também no servidor, NAO_ATENDIDA) e a etapa final explica o motivo e o que fazer. Endereço passou a ser lido no núcleo; teste de nomes de fornecedor agora cobre BrasilAPI.
2. A idade da prévia entrou na regra das etapas (folga de 1 min antes do servidor): no passo 1 a prévia vencida conta como inexistente e o botão volta a "Pesquisar CNPJ"; no diagnóstico o clique pesquisa de novo ali mesmo sem sair da etapa. O servidor lança PreviaInvalida e a ação devolve expirou: true, fazendo a tela pesquisar de novo.
3. A idade passou a ser medida só pelo relógio do navegador: o evento "consultou" leva o "agora" do navegador, guardado em recebidaEm; previaVencida(recebidaEm, agora) não usa mais consultadaEm. Testado com navegador 3 h adiantado e atrasado.

### Ciclos desta rodada
| Ciclo | Etapa | Resultado | Problemas | Testes |
|---|---|---|---|---|
| 1 | Engenheiro | Entregue | - | núcleo 249/249, plataforma 335/335 |
| 1 | QA | Reprovado | 1 (alta): prévia vencida prendia o cliente | assistente.qa.test.ts falhando |
| 2 | Engenheiro | Entregue | - | núcleo 249/249, plataforma 342/342 |
| 2 | QA | Reprovado | 1 (média): relógio do navegador adiantado causava laço | assistente-relogio.qa.test.ts falhando |
| 3 | Engenheiro | Entregue | - | núcleo 249/249, plataforma 346/346 |
| 3 | QA | Aprovado | - | assistente-borda.qa.test.ts (6/6) |
| 3 | Tech lead | Aprovado | - | núcleo 249/249, plataforma 352/352 |

### Situação
Aprovada. Nenhuma pendência em aberto. Typecheck e lint limpos. Única chamada real à Receita nesta rodada: verificação manual na dev com o CNPJ do usuário. Não foi feito commit.

## Ajustes (tooltip único)

### Correções pedidas
1. (Usuário) As explicações abertas tumultuavam a tela: criar um componente de tooltip único para a aplicação inteira e usá-lo sempre que houver uma explicação. Essa regra entra nas informações que o engenheiro confere antes de codar.
2. (QA, ciclo 1) Motivos do diagnóstico, motivo da atividade não atendida e aviso de anexos diferentes apareciam inteiros na tela (assistente e ficha); trilha sem aria-current no celular; orientação de CNPJ baixado contraditória; rótulos "O que é X?" sem artigo.
3. (QA, ciclo 2) Seletor de empresa estourava a largura no celular e o balão abria fora da área visível; CNPJ baixado/nulo recebia "Entrar no Simples Nacional"; diagnósticos antigos com rótulos artificiais; explicação repetida 3 vezes em /automatico; selo repetido na etapa 5; Fator R explicado só pelo pró-labore.
4. (Tech lead, ciclo 3) Regra do Fator R aberta na etapa 5; fallback morto no núcleo; texto do lucro desatualizado (Lei 15.270/2025); textos de casos ok nunca exibidos e verbete `das` sem uso; "Tudo certo" junto do aviso de saída do Simples; MEI "Não" quando a Receita não informa; EIRELI citada como tipo atual; contagem de motivos com outra fonte; formatação.
5. (Tech lead, ciclo 4) Duas explicações diferentes do Fator R; motivos/avisos mortos no Diagnostico; título "O que fazer" em balões que explicam o porquê; gatilho "Pró-labore e Fator R" fora da WCAG 2.5.3; frase repetida na etapa 5.
6. (QA, ciclo 5) Empresa de anexo fixo: balão do anexo dizia que o Fator R decide.

### Como foram resolvidas
1. Componente único `app/explicacao.tsx` (`<Explicacao>`/`<ExplicacaoDoTermo>`), com a lógica pura em `lib/explicacao.ts`: botão real com aria-label em pergunta, aria-expanded/controls/describedby; abre com mouse, foco e toque; fecha com Esc, clique fora e Tab; não some com o mouse no balão; posição pela visualViewport, largura total no celular; cores do tema e motion-reduce; sem dependências. `app/saiba-mais.tsx` e o `Nota` foram apagados. Assistente com "Passo N de 6 · Nome" e barra fina; portão, painel, /automatico, /empresa, /planos, /config, /usuarios, sino e login passaram a usar o tooltip.
2. Notas com `curto`/`detalhe`/`pergunta` no núcleo (`impedimentos`/`observacoes`), ListaDeNotas na tela; linha curta por atividade com tooltip específico; trilha com `sr-only lg:not-sr-only`; `orientacaoDaSituacao`; `rotulo` obrigatório com a pergunta inteira.
3. Seletor com `min-w-0`/reticências e `janelaVisivel()` pela visualViewport; BAIXADA/NULA param na orientação da situação; `completarDiagnostico` refaz diagnósticos antigos na leitura; /automatico com frase curta e um tooltip; selo removido; Fator R pela folha de pagamento.
4. Etapa 5 só com "Anexo III ou V, conforme o Fator R ⓘ · Ver exemplo"; fallback apagado; texto do lucro conforme Lei 15.270/2025; Explicacao virou união (ok sem texto) e `das` saiu; saída futura só como aviso na etapa 5; MEI "Não informado" neutro; texto "sociedade limitada (inclusive a unipessoal, antiga EIRELI)"; contagem por `d.impedimentos`; formatação corrigida.
5. Fator R com fonte única no glossário (explicarFatorR e explicacaoFatorR apagados; alíquotas do verbete anexo via tabelaVigente); motivos/avisos apagados; caso `ok:false` com `titulo` em pergunta e texto "por que + O que fazer:"; `ExplicacaoDoTermo` com `rotulo` opcional; frase repetida removida.
6. Verbete `anexoFixo` (`verbeteAnexo(pa, true)`) com a frase única `SEMPRE_ANEXO_III`, usado na ficha e na etapa Diagnóstico quando `dependeFatorR` é falso.

### Ciclos desta rodada
| Ciclo | Etapa | Resultado | Problemas | Testes |
|---|---|---|---|---|
| 1 | Engenheiro | Entregue | - | núcleo 249/249, plataforma 430/430 |
| 1 | QA | Reprovado | 3 altas, 1 média, 3 baixas | telas-enxutas.qa.test.ts (7 falhando) |
| 2 | Engenheiro | Entregue | - | núcleo 251/251, plataforma 448/448 |
| 2 | QA | Reprovado | 1 alta, 3 médias, 2 baixas | explicacao-ciclo3.qa.test.ts (7 falhando) |
| 3 | Engenheiro | Entregue | - | núcleo 252/252, plataforma 469/469 |
| 3 | QA | Aprovado | - | explicacao-ciclo4.qa.test.ts (12/12) |
| 3 | Tech lead | Reprovado | 3 médias, 6 baixas | 481/481 |
| 4 | Engenheiro | Entregue | - | núcleo 252/252, plataforma 482/482 |
| 4 | QA | Aprovado | - | explicacao-ciclo5.qa.test.ts (18/18) |
| 4 | Tech lead | Reprovado | 1 média, 4 baixas | núcleo 252/252, plataforma 500/500 |
| 5 | Engenheiro | Entregue | - | núcleo 250/250, plataforma 505/505 |
| 5 | QA | Reprovado | 1 média | explicacao-ciclo6.qa.test.ts (2 falhando) |
| 6 | Engenheiro | Entregue | - | núcleo 250/250, plataforma 515/515 |
| 6 | QA | Aprovado | - | explicacao-ciclo7.qa.test.ts (18/18) |
| 6 | Tech lead | Aprovado | - | núcleo 250/250, plataforma 533/533 |

### Situação
Aprovada. Nenhuma pendência em aberto. Typecheck e lint limpos. Nenhuma chamada a BrasilAPI ou Serpro nesta rodada. Não foi feito commit.

## Ajustes (passo 7 e nome Autorização)

### Correções pedidas
1. (Usuário) Acrescentar ao assistente /empresas/nova o passo 7 "Autorização", reaproveitando os componentes e ações de /autorizacao, opcional ("Fazer depois").
2. (Usuário) Chamar de "Autorização" (não "automático") em todo texto que o cliente vê, com rota /autorizacao.
3. (Usuário) Manter trilha enxuta, acessibilidade, celular, explicações só em tooltip e nenhum fornecedor na tela.
4. (QA, ciclo 1, média) Voltar durante "Assinando e enviando…" descartava a confirmação da assinatura; o passo 7 voltava a pedir a assinatura.

### Como foram resolvidas
1. Assistente com 7 etapas: cadastro no passo 5, passo 6 "Empresa cadastrada", passo 7 com AssinarTermo, Requisitos, TextoOficial, enviarTermoAcao e a nova prepararAutorizacaoAcao (usa prepararAutorizacao). Passo 7 fora do `<form>`; casos plataforma, indisponível e concluída ("Tudo pronto"); não atendida termina em "Passo 6 de 6 · O que fazer"; depois do cadastro os passos 1 a 5 ficam só para leitura.
2. /automatico virou /autorizacao (redirect 308 em lib/redirecionamentos.ts, mantendo a query string); barra, título, cartão CartaoAutorizacao, sino, avisos, modo guiado e botões renomeados; README, plano.txt e docs/tarefas/parte-4.md atualizados.
3. Mantidos; testes de tela e de textos visíveis passam.
4. O redutor aceita "autorizou" em qualquer etapa depois do cadastro quando o preparo é "assinar" e ainda não concluído; na tela, AssinarTermo ganhou `aoMudarEnvio`, que desliga Voltar e "Fazer depois" durante o envio.

### Ciclos desta rodada
| Ciclo | Etapa | Resultado | Problemas | Testes |
|---|---|---|---|---|
| 1 | Engenheiro | Entregue | - | núcleo 267/267, plataforma 581/581 |
| 1 | QA | Reprovado | 1 (média): assinatura perdida ao voltar durante o envio | assistente-passo7.qa.test.ts (1 falhando) |
| 2 | Engenheiro | Entregue | - | núcleo 267/267, plataforma 586/586 |
| 2 | QA | Aprovado | - | assistente-passo7-ciclo3.qa.test.ts (6/6) |
| 2 | Tech lead | Aprovado | - | núcleo 267/267, plataforma 592/592 |

### Situação
Aprovada. Nenhuma pendência em aberto. Typecheck e lint limpos. Nenhuma chamada a BrasilAPI ou Serpro nesta rodada. Não foi feito commit.

## Ajustes (cadastro pessoal e prova de posse da empresa, 21/10/2026)

Uma primeira tentativa desta rodada foi interrompida (duas cópias do engenheiro rodaram juntas por engano de
orquestração). O trabalho dela ficou no working tree e foi conferido e completado nesta rodada, sem recomeçar.

### Correções pedidas
1. (Usuário) "Seus dados" obrigatório no primeiro login, só para COMMON_USER (ADMIN e MANAGER livres; pedem os dados só
   para cadastrar empresa de cliente ou assinar o termo), conferido no servidor (páginas, ações e rotas).
2. (Usuário) Busca de CEP com banco primeiro, fonte pública gratuita, digitação se falhar, fonte nunca nomeada.
3. (Usuário) Cadastro da empresa exige "Seus dados" e confere o usuário com o quadro de sócios; empresa nasce
   aguardando comprovação, CNPJ não bloqueado, sem revelar quem cadastrou.
4. (Usuário) Aguardando comprovação: só Autorização, nenhum conteúdo nem chamada à Receita, provisórios isolados.
5. (Usuário) Prova pelo termo: cadeia ICP-Brasil, validade, CNPJ e CPF do responsável; limite de envios; promoção a DONO.
6. (Usuário) LGPD: dados pessoais nunca para outros usuários, logs ou área do admin (lá, só nome e e-mail).
7. (Usuário) Testes, docs e README.

### Como foram resolvidas
1. Tela `/meus-dados` (com `/termos`) em `app/(conta)`, fora do painel; tabela `dados_pessoais` (CPF único, versão e
   data do aceite). `exigirSessao` manda o COMMON_USER pendente para `/meus-dados` (vale em página, layout e server
   action); `comSessao` devolve 403 nas rotas; só `/entrar`, sair, `/termos` e a própria tela ficam livres
   (`lib/usuarios/portao-dos-dados.ts`). ADMIN e MANAGER não passam pelo portão; `FaltamDadosPessoais` no cadastro de
   empresa de cliente e `sem-dados-pessoais` no termo. "Seus dados" no menu do usuário.
2. `nucleo/src/brasilapi/cep.ts` e `lib/usuarios/cep.ts` (tabela `ceps`, guarda também o "não encontrado" por um tempo).
3. `lib/empresas/qsa.ts` (nome normalizado e dígitos visíveis do CPF) sobre a consulta pública guardada em
   `cnpjs_consultados` (`consulta-publica.ts`); recusa com `NaoConfereComQsa` e o motivo no `<Explicacao>`; sem quadro,
   aviso `QSA_INDISPONIVEL`; vínculo `PROVISORIO` (`cadastrarProvisorio`), sem bloquear o CNPJ.
4. Portão `aguardando` (só leva à Autorização); `AcessoProvisorio` em `lib/empresas/acesso.ts`, recusado por
   `exigirAcessoEmpresa`, `dadosDaEmpresa` e `daEmpresa`. Empresa da plataforma nasce DONO; vínculos antigos ficam como
   estão (migração 0016 só acrescenta).
5. `nucleo/src/serpro/cadeia-icp.ts` com as raízes v4, v5, v6, v7, v12, v13 e as ACs oficiais em
   `nucleo/certificados/icp-brasil/` (origem e hashes no `ORIGEM.md`); `conferirTermo` confere CNPJ (2.16.76.1.3.3) e
   CPF do responsável (2.16.76.1.3.4) antes de enviar; limite 3/hora e 10/dia em `envios_termo`; `comprovarPosse`
   (`lib/empresas/posse.ts`) promove a DONO e derruba os outros provisórios (aviso "comprovada por outra conta").
6. Dados pessoais só lidos pelo próprio usuário (`lib/usuarios/dados-pessoais.ts`); nada vai para log; a lista de
   usuários do admin não traz nada além de nome e e-mail (teste).
7. Testes: `nucleo/src/brasilapi/cep.test.ts`, `nucleo/src/serpro/cadeia-icp.test.ts`, `conferir-termo.test.ts`,
   `lib/usuarios/validacao.test.ts`, `lib/empresas/qsa.test.ts`, `testes/dados-pessoais.test.ts`,
   `testes/portao-dos-dados.test.ts`, `testes/posse.test.ts`, `testes/seus-dados-telas.test.ts`; docs `login.md`,
   `empresas.md`, `autorizacao.md`, `nucleo.md` e README.

### Ciclos desta rodada
| Ciclo | Etapa | Resultado | Problemas | Testes |
|---|---|---|---|---|
| 1 | Engenheiro | Entregue | - | núcleo 395/395, plataforma 1473/1473 |
| 1 | QA | Reprovado | 1 (média): desistir do cadastro apagava a empresa sem anonimizar `serpro_chamadas` | plataforma 1473/1473; teste QA novo falhou |
| 2 | Engenheiro | Entregue | Corrigido: `apagarEmpresaETudo` (`lib/empresas/apagar-empresa.ts`) usado pela remoção e pela desistência | núcleo 395/395, plataforma 1484/1484 (duas vezes) |
| 2 | QA | Aprovado | - | plataforma 1486/1486 com `testes/parte3-desistencia-ciclo2.qa.test.ts` |
| 2 | Tech lead | Aprovado | - | núcleo 395/395, plataforma 1486/1486 |

Correção extra (apontada pelo QA no ciclo 1): quando o último provisório desiste, `desistirDoCadastro` apaga a empresa
com o mesmo código da remoção definitiva, na mesma transação e com a empresa travada; o gasto em `serpro_chamadas` fica
sem `empresa_id`, sem contribuinte, sem mensagens e sem o CNPJ na finalidade. Com dois provisórios, a desistência do
primeiro não toca nada do outro.

### Situação
Aprovada. Nenhuma pendência em aberto. `npm test` passou duas vezes, typecheck e lint limpos. Nenhuma chamada real nova
(`serpro_chamadas` continua com 30 linhas). Não foi feito commit.
