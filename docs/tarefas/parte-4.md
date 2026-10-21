# PARTE 4 - Termo de autorização (Autorização)

**Situação:** aprovada (ciclo 3, QA e tech lead), em 18/10/2026.

## Resumo da entrega
- A autorização no e-CAC (OBTERPROCURACAO41, fila de aceites, "Já aceitei") foi removida. O modelo voltou a ser o **termo de autorização** (Autentica Procurador), assinado no navegador com o e-CNPJ A1 da própria empresa.
- Requisitos com duas caixas de marcar e tooltips: e-CNPJ A1 (A3 não serve, link da lista de ACs do ITI) e conta gov.br prata ou ouro. Quem não tem continua no modo guiado.
- Termo canônico (node-forge), conferido nó a nó no servidor. Só aceita e-CNPJ A1 ICP-Brasil do mesmo CNPJ e chave de 2048 bits ou mais. Vigência de 1 ano, limitada à validade do certificado.
- Envio ENVIOXMLASSINADO81. Termo e token ficam cifrados (AES-256-GCM, TOKEN_CHAVE validada na subida). Banco primeiro com FOR UPDATE, renovação ao expirar, trata 200, 304 e recusas, e marca a recusa definitiva.
- Avisos no painel e no sino (vence em 30 dias ou menos, vencido, recusado).
- Empresa da plataforma: automático sem termo só com o PLATAFORMA_CNPJ **e** um dono ADMIN ativo. Fora disso o CNPJ fica reservado, e só um ADMIN pode cadastrá-lo.
- O texto oficial com o nome do fornecedor aparece só no bloco "Texto oficial do termo", e essa exceção é testada.
- Migração única nova: 0006_termo_autorizacao.sql.

## Arquivos principais
- nucleo/src/serpro/: termo-autorizacao.ts, conferir-termo.ts, autentica-procurador.ts, cliente.ts
- plataforma/lib/termo/: termo, situacao, aviso, guiado, mensagens, cifra, plataforma, servidor
- plataforma/app/(painel)/autorizacao/ (era /automatico, renomeada para "Autorização" em 18/10/2026, com redirect 308): page, acoes, assinar-termo, requisitos, texto-oficial, cartao-autorizacao
- plataforma/lib/empresas/cadastro.ts, sino.tsx, page.tsx, instrumentation.ts
- plataforma/banco/migracoes/0006_termo_autorizacao.sql, README.md, .env.exemplo
- Arquivos removidos: listados em docs/tarefas/parte-4-autorizacao-ecac-descartada.md

## Testes
- Novos: termo-autorizacao, conferir-termo, autentica-procurador, situacao, cifra e termo.test.ts (ponta a ponta).
- De QA: termo-autorizacao.qa, termo.qa, termo-plataforma.qa e termo-aviso-dias.qa.
- Resultado final: núcleo 267/267, plataforma 518/518, typecheck e lint sem erros. Migrações conferidas do zero e no banco atual.

## Ciclos
| Ciclo | Etapa | Resultado | Problemas apontados | Como foram resolvidos |
|---|---|---|---|---|
| 1 | Engenheiro | Entregue | - | - |
| 1 | QA | Reprovado | (alta) Qualquer usuário que cadastrasse o PLATAFORMA_CNPJ ganhava o automático sem termo. (baixa) O tooltip do painel dizia que a plataforma não guarda certificado. | Ciclo 2 |
| 2 | Engenheiro | Entregue | - | "propria" passou a exigir um dono ADMIN ativo; sem isso a empresa fica "reservada" (modo guiado e recusas). O cadastro do CNPJ ficou restrito a ADMIN. Tooltip reescrito. |
| 2 | QA | Aprovado | - | Testes extras (ADMIN só como membro, token antigo) passaram |
| 2 | Tech lead | Reprovado | (baixa) O comentário de texto-oficial.tsx estava errado sobre os textos irem ao navegador. (baixa) Os "30 dias" estavam fixos na mensagem de sucesso. | Ciclo 3 |
| 3 | Engenheiro | Entregue | - | Comentário reescrito. AVISO_DIAS foi para lib/termo/aviso.ts (sem imports) e é usado na mensagem. |
| 3 | QA | Aprovado | - | - |
| 3 | Tech lead | Aprovado | - | - |

## Pendências de ambiente (não são defeitos)
- Contêiner da 3002: precisa de `npm run docker:subir` para aplicar a migração 0006.
- Falta PLATAFORMA_RAZAO_SOCIAL. O certificado da plataforma e as chaves do contrato precisam ser enviados pelo ADMIN em /config/plataforma (o CERT_PFX_PATH em /mnt/f deixou de ser obrigatório).
- Teste real: seguir o roteiro do README com outra empresa como cliente 1. Confirmar os espaços dos textos oficiais (se vier AUTENTICAPROCURADOR-013/016).

## Ajustes

### Correções pedidas
1. Pedir o certificado da plataforma (e-CNPJ A1 do PLATAFORMA_CNPJ) e as chaves do contrato pela aplicação, guardando cifrado no banco, sem depender do CERT_PFX_PATH.
2. Tela interna só para ADMIN, com as conferências do certificado, aviso de vencimento no sino e secret nunca devolvido.
3. Segurança: só ADMIN vê/altera, log de quem trocou, leitura banco primeiro e ambiente como alternativa por uma única função.

### Como foram resolvidas
- Tela /config/plataforma (exigirAdmin na página e nas ações, conferirAdmin no serviço; 403 para COMMON_USER e MANAGER). Confere e-CNPJ A1 ICP-Brasil, CNPJ = PLATAFORMA_CNPJ, validade, senha e chave >= 2048 bits.
- Tabela plataforma_segredos (migração 0014), AES-256-GCM com IV por registro, nome do segredo como AAD e a nova PLATAFORMA_CHAVE (validada na subida, diferente da TOKEN_CHAVE, documentada no .env.exemplo e no README). O certificado é guardado em PEM e a senha é descartada.
- resolverCertificadoDaPlataforma (lib/serpro/config.ts) e montarPlataforma (lib/plataforma/montagem.ts): banco primeiro, ambiente como alternativa, certificado resolvido uma vez por montagem; Serpro, eSocial, rotina, histórico e Caixa Postal leem por plataformaDoServidor.
- Sino do ADMIN (lib/plataforma/aviso.ts): dias de calendário em Brasília, aviso 30 dias antes e no vencimento; estado vem do motivo da recusa (`falha`: vencido, outro-cnpj, invalido, ilegivel, falta), inclusive para o certificado do ambiente; texto neutro para o "recusado".
- Cache da montagem refeito no validoAte do certificado ou a cada 15 s enquanto algo não está pronto.
- Validade e CNPJ do guardado saem do PEM decifrado (autenticado), não da coluna info.
- Ambiente e guardado usam o mesmo critério de titular (lerInfoDoCertificado; e-CPF/CNPJ nulo recusado; CNPJ alfanumérico aceito).
- Removido código morto de compatibilidade em aviso.ts e servidor.ts.

### Ciclos desta rodada
| Ciclo | Etapa | Resultado | Principal ponto |
|---|---|---|---|
| 1 | engenheiro | entregue | tela, cifra, PLATAFORMA_CHAVE, sino |
| 1 | QA | reprovado | "amanhã" para vence hoje; outro CNPJ sem aviso; cache até meia-noite |
| 2 | engenheiro | entregue | calendário de Brasília, estado "recusado", montagem.ts |
| 2 | QA | reprovado | certificado do ambiente vencido/outro CNPJ dizia "Falta" |
| 3 | engenheiro | entregue | motivo `falha` no resolvedor |
| 3 | QA | reprovado | texto "certificado guardado" sem nada guardado |
| 4 | engenheiro | entregue | texto neutro |
| 4 | QA | aprovado | - |
| 4 | tech lead | reprovado | código morto; certificado resolvido 3 vezes; info não autenticada |
| 5 | engenheiro | entregue | montarPlataforma; validade/CNPJ do PEM |
| 5 | QA | reprovado | e-CPF aceito pelo CERT_PFX_PATH |
| 6 | engenheiro | entregue | mesmo critério de titular nos dois caminhos |
| 6 | QA | aprovado | - |
| 6 | tech lead | reprovado | desvio inalcançável em lib/esocial/config.ts e campo `cnpj` sem uso |

Testes ao fim: núcleo 368/368, plataforma 1128/1128; typecheck e lint sem erros.

### Situação
Aprovada em 20/10/2026. O último apontamento do tech lead (ciclo 6, gravidade baixa) foi corrigido depois da rodada:
o desvio inalcançável `if (c.cnpj !== plataforma.cnpj)` saiu de plataforma/lib/esocial/config.ts (o comentário do topo
explica que resolverCertificadoDaPlataforma já garante o titular, MOD v1.16 §7.5.9), e o campo `cnpj` sem uso saiu de
`CertificadoDaPlataforma` (lib/serpro/config.ts) e dos testes que o preenchiam. Núcleo 368/368, plataforma 1128/1128;
typecheck e lint sem erros. Nenhuma pendência.

## Ajustes (20/10/2026)

Pedido do usuário: "Quero que apareça os botões guia e baixar".

### Correções pedidas
1. Campo único de envio do .pfx/.p12 e /config/plataforma em passos, sem vermelho, com o detalhe técnico no tooltip.
2. Botões da guia ("Ver guia" / "Abrir guia" / "Guia original") e "Baixar" no painel, na aba Guias, no Histórico e na rotina, buscando na Receita uma única vez quando o PDF não está no banco.
3. Auditoria da empresa da plataforma: nenhuma função pode deixá-la de fora.
4. Não reiniciar o servidor da porta 3003 nem mexer no banco de desenvolvimento.
5. (QA) Guia vencida sem o PDF original não mostrava botão.
6. (QA) "Baixar" no modo busca baixava a página de erro.
7. (QA) Script temporário zz-semear-temporario.ts deixado no projeto.
8. (QA) Resposta da Receita que não é PDF ficava guardada como a guia.
9. (Tech lead) "valor pago" mostrava o principal, não o total pago.

### Como foram resolvidas
1. app/campo-arquivo.tsx + lib/arquivo.ts (único input de arquivo, acessível, limite de 100 KB), usado na tela da plataforma e no Assinador; tela em 3 passos com cartão "Trocar certificado".
2. lib/rotina/botoes-guia.ts + app/(painel)/botoes-da-guia.tsx; rota /documentos/guia-do-mes/<tipo>/<mês> (banco primeiro, busca única, sem chamada paga vinda de outro site); PAGTOWEB/COMPARRECADACAO72 para guia paga, GERARDAS12 ou GERARGUIA31 em aberto; custo em serpro_chamadas.
3. Auditoria lugar por lugar: só a dispensa do termo, a assinatura no servidor (DCTFWeb e eSocial) e a reserva do CNPJ a um ADMIN; nada removido.
4. Servidor 3003 intacto, lendo o .env.local; testes só no contabilizadev_teste; nenhuma chamada real.
5. Vencida sem original mostra "Guia original" que leva ao portal (PGDAS-D ou DCTFWeb no e-CAC), com o motivo no tooltip, ao lado de "Gerar guia com multa e juros".
6. No modo busca, "Baixar" abre em nova aba sem o atributo download; o sucesso continua vindo como attachment.
7. Script apagado.
8. pdfDoBase64 (nucleo/src/pdf.ts) confere %PDF- nos primeiros 1024 bytes antes de guardar (DAS, DARF e comprovante); se falhar, registra no log, mostra a mensagem naoEPdf e não guarda nada.
9. valorPago(documento) usa o valorTotal do PAGTOWEB (com multa e juros) no cartão e no comprovante; pagamentos.valor continua com o principal; sem migração.

### Ciclos desta rodada
| Ciclo | Etapa | Resultado | Principal ponto |
|---|---|---|---|
| 1 | Engenheiro | Entregue | Itens 1 a 4 |
| 1 | QA | Reprovado | Vencida sem original sem botão; Baixar no modo busca; script temporário |
| 2 | Engenheiro | Entregue | Os 3 pontos corrigidos |
| 2 | QA | Reprovado | Resposta que não é PDF ficava guardada |
| 3 | Engenheiro | Entregue | Conferência de PDF nos três caminhos |
| 3 | QA | Aprovado | - |
| 3 | Tech lead | Reprovado | "valor pago" mostrava o principal |
| 4 | Engenheiro | Entregue | valorPago com o total do documento |
| 4 | QA | Aprovado | - |
| 4 | Tech lead | Aprovado | - |

### Situação
Aprovada em 20/10/2026. npm test (núcleo 375/375, plataforma 1251/1251), typecheck e lint sem erros. Nenhuma pendência nova.
