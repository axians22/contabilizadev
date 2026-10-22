# Termo de autorização (a "Autorização")

O contrato com o Serpro (Integra Contador) é da plataforma (contratante). Cada cliente assina, aqui no navegador, o
**termo de autorização** do Autentica Procurador com o **e-CNPJ A1 (.pfx) da própria empresa**: o arquivo, a chave e a
senha não saem do computador dele; só o XML assinado sobe. A plataforma confere o termo, envia e recebe um token que vale
até a meia-noite do dia seguinte (Brasília); guarda o termo assinado e o token **cifrados** e reenvia o termo para pegar
outro token enquanto o termo estiver na vigência. Requisitos do cliente: e-CNPJ A1 e conta gov.br prata ou ouro; quem não
tem continua no modo guiado. A empresa da própria plataforma (CNPJ = `PLATAFORMA_CNPJ` **e** um dono que é ADMIN, de
`ADMIN_EMAILS`, com a conta ativa) não precisa de termo: ela é o contratante e autora dos próprios pedidos (já
autorizada, explicado na tela). Só o CNPJ não prova nada: só um ADMIN consegue cadastrar o `PLATAFORMA_CNPJ` no assistente, e
uma empresa com esse CNPJ sem dono ADMIN (cadastro antigo, ou o admin saiu da lista) fica no modo guiado, sem termo e sem
autorização (`lib/termo/plataforma.ts`).

**Regra de produto: o cliente nunca vê o Serpro.** Telas, títulos, sino, mensagens de erro e URLs falam só em "Receita
Federal"; códigos de sistema/serviço e mensagens da API nunca chegam ao navegador (`lib/termo/mensagens.ts` traduz cada
motivo em mensagem própria; o detalhe técnico vai só para o log do servidor, com o prefixo `[serpro]`). O teste
`testes/sem-fornecedor-na-tela.test.ts` lê todo texto literal de `app/` e dos módulos de `lib/` e do núcleo que vão para a
tela e falha se aparecer "Serpro", "Integra Contador", códigos da API ou mensagens cruas. Exceções: a página interna
as páginas da área do administrador só do ADMIN (`/admin/plano` e `/admin/plataforma`) e o **texto oficial do termo** (que cita a "API INTEGRA CONTADOR"), mostrado por inteiro antes da
assinatura no bloco "Texto oficial do termo" (`app/(painel)/autorizacao/texto-oficial.tsx`): só os textos oficiais exatos,
só onde são definidos e nesse componente (exceção testada).

**Fontes oficiais** (https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-contador-gerenciador/autenticaprocurador/):

- "Padrões técnicos de assinatura": modelo e layout do XML, textos oficiais, certificado ICP-Brasil série A (A1 ou A3,
  e-CPF ou e-CNPJ), chave de 2048 bits, XMLDSig enveloped, C14N, RSA-SHA256, só o `X509Certificate` no `KeyInfo`.
  **Textos fixos:** no modelo XML da página as quebras de linha do HTML grudam palavras ("deautorização", "AUTORPEDIDO",
  "APIINTEGRA"...); usamos a versão com os espaços certos, igual à da tabela "Layout XML" e de "Dados de Domínio".
  **Ponto a confirmar no primeiro teste real** (se vier AUTENTICAPROCURADOR-013/016, comparar com a versão grudada).
- "Envio de XML assinado": `AUTENTICAPROCURADOR` / `ENVIOXMLASSINADO81`, versão `"1.0"`, `dados = {"xml": base64}`;
  saída `autenticar_procurador_token` e `data_hora_expiracao`. O token vai no header `autenticar_procurador_token`.
- "Cache": termo repetido com o token ainda válido devolve 304, com o token no `etag` e a expiração no `expires`.
- "Mensagens": os códigos AUTENTICAPROCURADOR-0xx, classificados em motivos em `nucleo/src/serpro/autentica-procurador.ts`.
- **Vigência:** a documentação não fixa prazo máximo (só exige vigência ≥ hoje, AUTENTICAPROCURADOR-017). Escolha da
  plataforma: **1 ano** a partir da assinatura, limitado ao último dia de validade do certificado.

**Quem é quem no termo:** `destinatario` = `PLATAFORMA_CNPJ` com a razão social da plataforma (`PLATAFORMA_RAZAO_SOCIAL`
ou a razão social guardada da empresa com esse CNPJ; nunca fixa no código), papel "contratante"; `assinadoPor` = CNPJ da
empresa ativa, tipo PJ, papel "autor pedido de dados". Nas chamadas: contratante = plataforma; autor do pedido =
contribuinte = a empresa; token do Autentica Procurador no header. Só o **e-CNPJ A1 da própria empresa** é aceito
(política ICP-Brasil 2.16.76.1.2.1.n e CNPJ do certificado = CNPJ da empresa): e-CPF e A3 (token ou cartão) são
recusados com mensagem clara, no navegador e de novo no servidor.

**Tela** (`app/(painel)/autorizacao/`, a mesma no passo 7 do cadastro): o cartão da situação ("Autorização pendente",
"Autorização ativa até dd/mm/aaaa", "Autorização vence em N dias", vencida, recusada ou empresa da própria plataforma); os requisitos com tooltip (o que é o e-CNPJ A1, que o A3 não serve, onde
conseguir com o link da lista oficial do ITI, emissão por videoconferência e custo na faixa de centenas de reais por ano;
o que é a conta gov.br prata ou ouro, para que serve aqui e como subir o nível, com o link do gov.br); o cliente marca os
dois para liberar o assinador (abaixo); depois de abrir o certificado (ou clicar em Assinar, com ele guardado),
confere quem assina, quem fica autorizado, a vigência e o texto oficial, e clica "Assinar e autorizar"; assinado, "Autorização concluída". Só o
dono da empresa assina. `prepararAutorizacao` (`lib/termo/termo.ts`, só banco) dá à página e ao passo 7 a situação e os
parâmetros do termo (ou o motivo de não poder assinar).

**Prova de posse, antes de gastar a chamada** (21/10/2026; `nucleo/src/serpro/conferir-termo.ts` e `cadeia-icp.ts`): o
servidor confere a cadeia do certificado do termo assinatura por assinatura até uma das AC raiz da ICP-Brasil guardadas em
`nucleo/certificados/icp-brasil/raizes` (baixadas do ITI; origem, impressões digitais e como atualizar no `ORIGEM.md` de
lá), com o caminho pelas ACs oficiais de `acs/` (o termo traz só o certificado de quem assina); a validade de cada um; que
o CNPJ do OID 2.16.76.1.3.3 é o da empresa; e que o CPF do responsável no OID 2.16.76.1.3.4 (posições 9 a 19, depois do
nascimento DDMMAAAA) é o CPF de "Seus dados" de quem envia. e-CNPJ em nome de outra pessoa: "Este e-CNPJ está em nome de
outro responsável (CPF ***.xxx.xxx-**). Quem assina o termo precisa entrar com a própria conta." Assina o DONO ou quem tem o
cadastro provisório da empresa (docs/empresas.md); aceito, o provisório vira DONO e os provisórios dos outros caem. Os
envios que passam nessa conferência e vão para a Receita contam no limite por empresa (`LIMITE_DE_ENVIOS`: 3 por hora e 10
por dia, tabela `envios_termo`, gravada antes do envio e fora da transação dele, então a tentativa que falha também conta).
Nos testes, a confiança é a AC de teste (`confiancaDeTeste`, `nucleo/src/certificado-teste.ts`); sem ela, valem as raízes
oficiais e o certificado de teste é recusado.

**Servidor, banco primeiro** (`lib/termo/termo.ts`, tabela `termos_autorizacao`): `registrarTermo` confere o termo de novo
(`conferirTermo`), trava a empresa (`FOR UPDATE`, então duplo clique ou duas abas chamam uma vez só), envia e guarda o
termo e o token cifrados com AES-256-GCM (`lib/termo/cifra.ts`, `TOKEN_CHAVE`, IV por registro, empresa e registro como
dado autenticado). O mesmo termo com o token válido não é reenviado. `contextoSerpro` (para as Partes 5 em diante) devolve
`{ contribuinte, autorPedidoDados, tokenProcurador }`: token guardado e válido sai do banco; expirado, reenvia o termo
guardado com a linha travada (sem margem antes da meia-noite: reenviar antes só traria 304 e gastaria a cota). Recusa
definitiva ao renovar (certificado vencido ou revogado, termo inválido) marca o termo como recusado: a autorização deixa de
valer e o sino avisa; falha passageira não marca nada. Termo vencido, recusado, de outro contratante ou ausente: erro pedindo
para assinar. Envio com falha não guarda nada.

**Aviso de vencimento** (`lib/termo/situacao.ts`): o painel e o sino avisam quando o termo (ou o certificado usado nele)
vence em 30 dias ou menos, quando venceu e quando foi recusado, com o link "Assinar de novo".

**Modo guiado** (`lib/termo/guiado.ts`, `app/(painel)/faca-no-portal.tsx`): `liberada(situacao)` diz se a autorização está
em dia (termo vigente ou perto de vencer, ou a empresa da própria plataforma); se não, `<FacaNoPortal funcao=...>` (ou
`<SeAutomatico>`, que escolhe entre os dois) mostra o motivo, o passo a passo, o link do Portal do Simples ou do e-CAC e "Disponível aqui depois da
autorização: Autorizar".
**Para as Partes 5 em diante:** `situacaoTermo(await termoDoServidor(), acesso)` (só banco) e, com `liberada`, chame com
`await contextoSerpro(deps, acesso)` como `OpcoesChamada`; sem liberação, `<FacaNoPortal funcao=...>{valores calculados}</FacaNoPortal>`.

**Configuração** (no `plataforma/.env.local`, veja `.env.exemplo`):

- `TOKEN_CHAVE` — 32 bytes em base64 (`openssl rand -base64 32`) ou hexadecimal: cifra o termo e o token de cada empresa.
  Obrigatória: ausente ou inválida, o servidor não sobe. Trocar a chave invalida os termos guardados (os clientes
  assinam de novo).
- `PLATAFORMA_CNPJ` — o CNPJ da plataforma: contratante e destinatário do termo.
- `PLATAFORMA_RAZAO_SOCIAL` — a razão social do `PLATAFORMA_CNPJ`, como a Receita mostra. Opcional: sem ela, vale a razão
  social guardada da empresa com esse CNPJ, se o dono dela for ADMIN; sem nenhuma das duas, a assinatura fica indisponível.
- `SERPRO_CONSUMER_KEY`, `SERPRO_CONSUMER_SECRET` — chaves do contrato (Área do Cliente do Serpro).
- `CERT_PFX_PATH`, `CERT_PFX_SENHA` — e-CNPJ da plataforma para o TLS mútuo, aberto só em memória (openssl). Se o CN do
  certificado trouxer um CNPJ, ele tem de ser o `PLATAFORMA_CNPJ`. Guarde o .pfx fora do projeto e use caminho
  **absoluto**. No Docker (`npm run docker:subir`) os scripts passam o `plataforma/.env.local` ao Compose, que monta o
  arquivo só de leitura em `/run/secrets/plataforma.pfx`. No Docker Desktop com WSL, o caminho é o do Linux.
- `SERPRO_LIMITE_POR_PERIODO` — opcional (padrão 40): limite de chamadas cobradas por período de cobrança.

Sem o contrato, o CNPJ ou a razão social da plataforma, a tela diz que a assinatura "ainda não está disponível" e o modo
guiado continua; o motivo técnico sai no log ao subir o servidor (o administrador vê só um aviso para olhar o log).

**Testes.** O Serpro nunca é chamado. Núcleo: `termo-autorizacao.test.ts` (montagem, textos, certificado A1/A3/e-CPF,
assinatura conferida pelo xml-crypto), `conferir-termo.test.ts` (layout nó a nó, certificado, datas),
`autentica-procurador.test.ts` (envio, 200/304, recusas por código) e `cliente.test.ts` (header do token).
Plataforma: `lib/termo/*.test.ts` (situação, aviso, modo guiado, mensagens, cifra) e `testes/termo.test.ts`, o passo 16
de ponta a ponta com a empresa cadastrada pela Parte 3 como cliente 1, certificado de teste gerado na hora e envio falso:
assinatura, envio, guarda cifrada, banco primeiro, renovação, vencimento, recusa, duplo clique, isolamento, chave
trocada, empresa da própria plataforma e o cliente real com transporte falso registrando em `serpro_chamadas`.

## Roteiro do teste real (passo 16, feito pelo usuário com o engenheiro)

Cada envio do termo é uma chamada cobrada do contrato. A empresa da própria plataforma não assina termo (é o
contratante): use **outra empresa** como cliente 1, com o e-CNPJ A1 dela.

1. No `plataforma/.env.local`, confira `PLATAFORMA_CNPJ`, `PLATAFORMA_RAZAO_SOCIAL` (ou cadastre a empresa da plataforma
   entrando com uma conta de `ADMIN_EMAILS`),
   `SERPRO_CONSUMER_KEY`, `SERPRO_CONSUMER_SECRET`, `CERT_PFX_PATH` (absoluto), `CERT_PFX_SENHA` e `TOKEN_CHAVE`.
2. Reinicie o `npm run dev`. O log não deve mostrar linha `[serpro]`.
3. Cadastre a empresa cliente em "Cadastrar empresa" (você como dono) e deixe-a ativa.
4. No passo 7 do cadastro (ou depois, em http://localhost:3001/autorizacao), marque os dois requisitos, escolha o .pfx
   do e-CNPJ A1 da empresa e a senha, confira o resumo e o texto oficial e clique "Assinar e autorizar".
5. Esperado: "Autorização concluída" com a vigência; no banco, `select signatario_cnpj, vigencia, token_expira_em,
   recusado_em from termos_autorizacao;` (termo e token só cifrados) e `select acao, servico, status from serpro_chamadas;`
   com `Apoiar AUTENTICAPROCURADOR/ENVIOXMLASSINADO81` status 200.
6. Se vier recusa de layout (AUTENTICAPROCURADOR-013/015/016), o log `[serpro]` traz o texto da API: confira primeiro os
   textos fixos (ponto a confirmar acima).
7. Assine de novo o mesmo termo no mesmo dia (recarregue e assine): esperado 304 ou nenhuma chamada nova (token ainda
   válido). No dia seguinte, a primeira chamada das próximas partes renova o token sozinha (reenvio do termo guardado).
