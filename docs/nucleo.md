# Núcleo (`nucleo/src`)

Nada é fixo de empresa: CNPJ, CNAE, receitas, folha, cadastros do eSocial, certificado e chaves vêm por parâmetro.
As funções não gravam nada; devolvem o resultado para a plataforma guardar (no banco).

- `simples.ts` — Anexos III e V (tabela até 2026 e a de 2027–2028 da Resolução CGSN 190/2026), repartição por
  faixa com o teto de 5% do ISS, RBT12 (inclusive início de atividade), Fator R e cálculo do DAS de exportação.
- `cnae.ts` — regra por CNAE de TI: Anexo III fixo, depende do Fator R ou não atendido, e o código da atividade no
  PGDAS-D (`serpro/atividades-pgdasd.ts`, catálogo oficial do Serpro: 29 = exterior com fator r, 30 = exterior Anexo III).
  `CNAES_FORA_DO_ESCOPO` guarda os conferidos na fonte e deixados de fora com o motivo (ex.: 7490-1/04, intermediação).
- `brasilapi/cnpj.ts` — consulta pública de CNPJ na BrasilAPI (numérico e alfanumérico), com o fetch por parâmetro:
  razão social, CNAEs, Simples/MEI, sócios, natureza jurídica e situação cadastral. 404/400, 429, 5xx, falha de rede e
  tempo esgotado viram `ErroConsultaCnpj` com mensagem para o cliente. Respostas gravadas em `brasilapi/exemplos/`
  (Banco do Brasil real, o resto fictício) e o fetch falso em `brasilapi/exemplos.ts`.
- `diagnostico.ts` — diagnóstico da empresa pelos dados da Receita, sobre o CNAE principal e os secundários: anexo (III,
  ou III ou V pelo Fator R, com a explicação em linguagem simples) ou "ainda não atendemos" com os motivos (CNAE fora do
  escopo, não optante do Simples, MEI, CNPJ não ativo, natureza jurídica não atendida).
- `serpro/` — cliente do Integra Contador (limite, confirmação e registro de cada chamada), PGDAS-D, DCTFWeb, guias
  (inclusive vencida com multa e juros), pagamentos, situação fiscal, Caixa Postal e DEFIS.
- `serpro/termo-autorizacao.ts` — termo de autorização do Autentica Procurador, isomórfico (só node-forge, roda no
  navegador): abertura do .pfx em memória (`abrirChaveDoCertificado` devolve a chave em PKCS#8 para o WebCrypto) e
  leitura do certificado. A parte sem node-forge fica em `serpro/termo-xml.ts` (reexportada): textos oficiais, montagem
  na forma canônica, conferência do e-CNPJ A1 (política ICP-Brasil, CNPJ, validade, chave de 2048 bits ou mais) e
  assinatura XMLDSig enveloped com qualquer chave (`assinarTermoCom`, assíncrona, para a chave do WebCrypto).
  `serpro/conferir-termo.ts` confere no servidor o termo assinado, nó a nó; `serpro/autentica-procurador.ts` envia
  (`AUTENTICAPROCURADOR/ENVIOXMLASSINADO81`), lê o token (200 e 304) e classifica as recusas em motivos.
- `serpro/pgdasd-consultas.ts` — histórico do PGDAS-D: lista de declarações e DAS de um ano (`CONSDECLARACAO13`) e o
  extrato de um DAS (`CONSEXTRATO16`); a declaração vigente do mês (a última retificadora) e o DAS cujo extrato a mostra.
  `serpro/extrato.ts` lê o PDF do extrato (receita, RBT12, Fator R, atividades com o código do catálogo, débito, DAS,
  pagamento e os itens 2.2 e 2.3: receitas e folhas dos meses anteriores, a base da RBT12 e do Fator R). `conferencia-anexo.ts` confere a atividade declarada com o diagnóstico do CNAE (Fator R x Anexo III fixo)
  e monta o aviso "Em MM/AAAA a declaração usou X; pelo seu CNAE seria Y". Respostas gravadas em
  `serpro/historico-exemplo.ts` (extrato com o texto do extrato real de 09/2026, anonimizado).
- `esocial/` — eventos do pró-labore (S-1200, S-1210, S-1299; S-1298 e o S-1200 retificador para a retificação), lote
  (empregador = o cliente, transmissor = a plataforma), webservice, leitura (pedidos sem assinatura, para o cliente
  assinar; leitura dos cadastros no S-1200/S-1210 baixados) e validação pelos esquemas oficiais (`nucleo/esquemas/esocial`).
  `folha.ts` monta os eventos do mês sem assinar (`montarEventosDoMes`: o par S-1200 + S-1210 num lote e o S-1299
  noutro, só o que falta; `montarRetificacao`), e `assinatura.ts` tem `prepararAssinaturaEsocialRemota` (a assinatura
  em duas etapas no padrão do eSocial, Reference URI="").
- `assinatura.ts` e `certificado.ts` — XMLDSig com o certificado lido do .pfx só em memória; e a assinatura em duas
  etapas (`prepararAssinaturaRemota` / `completarAssinaturaRemota`): o servidor monta a assinatura com um marcador e
  devolve o SignedInfo canônico, o navegador assina com a chave do e-CNPJ no WebCrypto e o servidor troca o marcador e
  confere. É assim que a DCTFWeb de um cliente é assinada com o e-CNPJ dele (`serpro/dctfweb.ts`,
  `transmitirDctfAssinada`; a Receita exige o certificado do autor do pedido).
- `serpro/pgdasd.ts` — simular, transmitir (original ou retificadora, pedida explicitamente) e emitir o DAS; uma chamada
  que saiu sem resposta volta como `semResposta` (`ErroSemResposta` do cliente) para a plataforma não transmitir às cegas.
- `apuracao.ts` — apuração do mês (rotina do mês): com a regra do CNAE, a receita do mês e as receitas e folhas dos meses
  anteriores, a RBT12, o Fator R, o anexo, o código da atividade e o DAS; e a sugestão de pró-labore do Fator R perto de
  28% (faixa de atenção de 25% a 30%, o PA afetado pela folha do mês atual, o pró-labore que dá 28% e a economia: DAS no V
  menos DAS no III menos o INSS de 11% sobre o aumento).
- `ptax.ts` — cotação PTAX do Banco Central (API pública Olinda, fetch por parâmetro): boletim de fechamento do dia ou do
  último dia útil antes, taxa de compra, para converter em reais a receita recebida em moeda estrangeira.
- `feriados.ts` — feriados bancários nacionais (fixos e móveis pela Páscoa) e dia útil; quando o dia 20 não tem
  expediente bancário, o vencimento do DAS (`meses.ts`, `vencimentoDas`) passa para o dia útil seguinte (CGSN 140/2018,
  art. 40, § 3º) e o do DARF do INSS (`vencimentoDarf`) é antecipado para o dia útil anterior (Lei 8.212/1991, art. 30).
- `pdf.ts`, `xlsx.ts`, `prolabore.ts`, `meses.ts`, `formato.ts` — leitores e utilitários (`cnpjValido` confere os
  dígitos verificadores do CNPJ numérico e do alfanumérico).

Os testes não chamam Serpro nem eSocial: usam respostas gravadas e certificados de teste gerados na hora
(`certificado-teste.ts`: o do OpenSSL e o e-CNPJ/e-CPF A1 ou A3 de teste, emitido por uma AC de teste). Os
documentos reais da empresa de referência são lidos de `../fiscal` quando a pasta existe (senão, o teste é pulado).
