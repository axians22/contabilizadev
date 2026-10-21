# eSocial (Parte 7)

O pró-labore do sócio vai ao eSocial todo mês: a remuneração (S-1200), o pagamento feito no mês (S-1210) e o fechamento
(S-1299). **O cliente assina os eventos no navegador** com o e-CNPJ A1 da empresa, pelo assinador único (`app/assinador`:
"Usar só agora" ou "Guardar neste navegador", chave não exportável no WebCrypto), e **a plataforma transmite com o próprio
certificado** (`CERT_PFX_PATH`/`CERT_PFX_SENHA`, TLS mútuo, transmissor = `PLATAFORMA_CNPJ`). A chave do cliente nunca vai
para o servidor e a senha não é guardada. A empresa da própria plataforma assina no servidor.

**Fonte (conferida em 19/10/2026):** Manual de Orientação do Desenvolvedor do eSocial **v1.16 (agosto de 2026)**, a versão
vigente em https://www.gov.br/esocial/pt-br/documentacao-tecnica/documentacao-tecnica
(`manuais/996775-manualorientacaodesenvolvedoresocialv1-16.pdf`):

- §7.5.7 (envio de lote), §7.7.7 (identificadores) e §7.8.7 (download): "Não é necessário qualquer tipo de vínculo formal
  (ex: procuração) entre o transmissor e o empregador".
- §7.5.9: o `ideEmpregador` do lote é comparado ao dos eventos (diferente, o evento é rejeitado) e o `ideTransmissor` ao
  certificado da conexão TLS (diferente, o lote é rejeitado).
- §8.4 e código 411 do retorno do evento: cada evento é assinado com e-CNPJ ou e-CPF; o assinante tem de ser o empregador,
  o representante legal ou um procurador com procuração eletrônica. Por isso o cliente assina com o e-CNPJ dele.
- §7.6.13: só o transmissor consulta o resultado do lote (30 dias); mandar de novo o mesmo evento devolve o recibo original.
- Código 411 da consulta/download: os pedidos de leitura são assinados pelo e-CNPJ do mesmo CNPJ raiz (ou representante
  legal ou procurador) — a importação dos cadastros também é assinada pelo cliente.
- Limites (§7.7.7, §7.8.7): consultas de identificadores e downloads no máximo 10 por dia e por empregador, nenhuma do dia
  1 ao 7, uma de cada vez; até 50 eventos por lote; §7.9.7, alternativa 2: o par S-1200 + S-1210 num lote e depois o S-1299.
- Prazo: dia 15 do mês seguinte, passando para o dia útil seguinte se não for dia útil (MOS, S-1299).

**Cadastros por empresa** (`esocial_config`, `lib/esocial/configuracao.ts`, aba **eSocial** em `/esocial`): CPF do sócio,
categoria, matrícula, lotação, tabela e rubricas do pró-labore e do INSS, quantidade (opcional), dia do pagamento e se é
pago no mês seguinte ou no próprio mês. Nada fixo no código. Dois caminhos: **importar do eSocial** (o cliente escolhe um
mês que o contador já enviou; a tela assina as duas consultas — identificadores do sócio na janela de recepção do mês
seguinte e o download dos eventos — e a plataforma tira os cadastros do S-1200 e do S-1210 baixados, que ficam guardados:
o S-1200 de um mês dá o demonstrativo que o S-1210 do mês seguinte paga) ou **formulário**, com a explicação de onde achar
cada dado no tooltip. A empresa sem o cadastro inicial no eSocial (S-1000, rubricas, lotação, S-2300 do sócio) vê o
caminho no portal; o cadastro inicial pelo webservice não é feito aqui. A aba eSocial (grupo "Configuração") é só essa
configuração: a situação dos últimos 12 meses no eSocial fica no passo 6 do Roteiro, junto do envio.

**Envio do mês** (`lib/esocial/envio.ts`, passo 6 da aba Roteiro, antes da DCTFWeb): o servidor prepara os eventos (só o
que falta no mês: S-1200 se ainda não há, S-1210 se o demonstrativo pago é conhecido, S-1299), devolve o SignedInfo de
cada um e o resumo; a confirmação abre com o resumo (mês, CPF, pró-labore, INSS, líquido, pagamento, eventos, DCTFWeb) e,
confirmado, o navegador assina todos de uma vez e o servidor completa, confere a assinatura e o esquema oficial e envia o
lote 1. O resultado é consultado em segundo plano (`after()`) e ao abrir a tela; aceito o lote, o seguinte (o S-1299) vai
sozinho. **Uma assinatura por mês**: o cliente assina de uma vez todos os eventos do mês, o fechamento inclusive, e
**todo** S-1299 vai com `transDCTFWeb = S`: o próprio eSocial transmite a DCTFWeb. Fonte: Manual de Orientação da DCTFWeb
(Receita Federal, atualização de janeiro/2025, `manual-dctfweb-atualizacao-janeiro2025_versao_final.pdf` em
gov.br/receitafederal), §14.5 (p. 83): o novo fechamento com transmissão imediata gera e transmite a declaração, e a
retificadora se a anterior já tinha sido transmitida (mas não transmite se houver débito com exigibilidade suspensa); e
§17.1.1 (p. 99): a retificadora "Em andamento" tem de ser transmitida mesmo sem mudança de valores. Por isso pedir a
transmissão em todo fechamento não transmite em dobro (cada fechamento gera uma declaração nova) e nunca deixa a
retificadora sem transmitir: **a retificadora é transmitida pelo novo fechamento**. Em dobro seria a plataforma
transmitir a mesma declaração que o eSocial vai transmitir, e isso é barrado por uma **trava de mão dupla**:
- a DCTFWeb daqui (`lib/rotina/dctfweb.ts`) fica bloqueada enquanto o envio do eSocial do mês está a caminho (preparado
  ainda válido, enviando, aguardando o resultado ou sem resposta: `esocialEmCurso`) e depois do fechamento aceito
  (`esperandoOEsocial`): a conferência mostra a declaração transmitida e o DARF sai normalmente. Só se uma conferência
  feita `ESPERA_DCTF_PELO_ESOCIAL_MINUTOS` (1 hora) depois do fechamento ainda mostra a declaração em andamento (a
  transmissão automática não aconteceu, como no caso da exigibilidade suspensa do §14.5), a transmissão daqui volta a
  ser liberada, para não deixar de transmitir;
- o eSocial fica bloqueado enquanto uma transmissão da DCTFWeb por aqui está em andamento ou sem resposta
  (`dctfTransmitindo`), no preparo e no envio;
- as duas travas são conferidas **de novo depois de gravadas** (a DCTFWeb marca a transmissão "enviando" e só então olha
  o eSocial; o eSocial marca o envio "enviando" e só então olha a DCTFWeb): se as duas começam ao mesmo tempo, pelo
  menos uma vê a outra e desiste sem transmitir.

Cada fechamento ou reabertura aceitos geram uma declaração nova: em `situacaoDctf`, **o que veio antes do último
fechamento ou reabertura não conta** (conferência e transmissão anteriores são da declaração antiga; filtro pelo
`desde` de `esocialDaDctf`, exceto a transmissão ainda viva). O cliente sem a autorização da Receita vê, no passo da
DCTFWeb, que ela já foi enviada pelo eSocial e só emite o DARF no e-CAC.

**Pagamento do mês anterior**: quando o pró-labore é pago no mês seguinte e o mês anterior teve pró-labore, mas o
demonstrativo (o S-1200) dele não está aqui (nem enviado pela plataforma, nem importado do eSocial), o pagamento feito
neste mês ficaria de fora em silêncio (`semDemonstrativoAnterior`). O envio é **recusado** com o pedido de importar o mês
anterior do eSocial (aba eSocial) ou de o cliente marcar explicitamente que o mês vai sem esse pagamento
(`semPagamentoAnterior`); nesse caso a confirmação mostra a linha "Pagamento: o do pró-labore de … não vai".

**Idempotência**: um envio em andamento por empresa e mês (índice único); um S-1200 original por sócio e mês (índice
único: corrigir só com **retificação explícita**, que manda S-1298, o S-1200 retificador com o recibo e um novo S-1299);
envio sem resposta fica "incerto" e "Enviar de novo" repete o MESMO lote assinado (o eSocial devolve o recibo original);
duas consultas ao mesmo tempo não mandam o lote seguinte duas vezes (troca condicional). Recusa do eSocial: a mensagem
própria e o que o eSocial respondeu no tooltip; o mês pode ser enviado de novo (só o que falta).

**Passo 21, portal do eSocial**: no mesmo passo, "Prefere lançar no portal do eSocial?" mostra o modo guiado
(`<FacaNoPortal funcao="esocial">`) com as rubricas, os valores e as datas prontos e "Já lancei no portal" (o mês conta
como feito, sem aviso). Sem o certificado da plataforma ou sem cadastros, ele aparece aberto.

**Avisos**: o painel mostra o cartão "eSocial do mês" com o prazo; o painel e o sino avisam a partir de 5 dias antes do
prazo (e quando venceu) para a empresa que usa o eSocial por aqui (`lib/esocial/prazo.ts`).

Tabelas novas (todas com `empresa_id`, apagadas com a empresa): `esocial_config`, `esocial_envios`, `esocial_eventos`,
`esocial_pedidos` (consultas preparadas para o cliente assinar) e `esocial_chamadas` (registro das chamadas e o limite
diário por empresa). Migração `0012_esocial`. Esquema `evtReabreEvPer.xsd` (S-1298) copiado do pacote oficial de
26/10/2026; os outros conferem byte a byte com ele.

Testes (nada chama o eSocial; respostas gravadas no `nucleo/src/esocial/respostas-exemplo.ts`, inclusive as do ../fiscal
anonimizadas): `nucleo/src/esocial/*.test.ts` (eventos e retificação no esquema oficial, lote com transmissor, montagem
do mês, assinatura em duas etapas, leitura dos cadastros); `plataforma/testes/esocial.test.ts` (ponta a ponta no banco de
teste: importação assinada no navegador com chave não exportável, limites, formulário, envio e lotes em ordem,
confirmação, duplo clique, original único, sem resposta, recusa, mês parado no meio, retificação, DCTFWeb pelo
fechamento e DARF, empresa da plataforma, registro das chamadas, isolamento e remoção sem órfãs),
`testes/esocial-telas.test.ts` e `lib/esocial/*.test.ts`.

Sugestão (fora do escopo desta parte): o cadastro inicial pelo webservice (S-1000, S-1010, S-1020, S-2300), para a empresa
que ainda não tem nada no eSocial.
