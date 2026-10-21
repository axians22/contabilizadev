import { test } from "node:test";
import assert from "node:assert/strict";
import { verificarAssinatura } from "../assinatura.ts";
import { certificadoDeTeste, certificadoIcpDeTeste } from "../certificado-teste.ts";
import { lerPfx } from "../certificado.ts";
import {
  abrirCertificado,
  assinarTermo,
  BITS_MINIMOS_CHAVE,
  conferirAntesDeAssinar,
  dataEmBrasilia,
  dataValida,
  DECLARACAO,
  ErroCertificado,
  lerCertificado,
  limparTexto,
  montarTermo,
  pemDoCertificado,
  somarDias,
  TEXTO_AVISO_LEGAL,
  TEXTO_FINALIDADE,
  TEXTO_TERMO,
  vigenciaPadrao,
  vigenciaPara,
  type DadosTermo,
} from "./termo-autorizacao.ts";

const PLATAFORMA = { numero: "11444777000161", nome: "PLATAFORMA DE TESTE LTDA" };
const EMPRESA = { numero: "11222333000181", nome: "EMPRESA DE TESTE LTDA" };
const ECNPJ = { tipo: "PJ" as const, ...EMPRESA };
const DIA = 24 * 60 * 60 * 1000;
const dados = (extra: Partial<DadosTermo> = {}): DadosTermo => ({
  destinatario: PLATAFORMA,
  assinadoPor: EMPRESA,
  dataAssinatura: "20261016",
  vigencia: "20271016",
  ...extra,
});

test("monta o termo na estrutura oficial, sem indentação, com a declaração e na forma canônica", () => {
  const xml = montarTermo(dados());
  assert.ok(xml.startsWith(`${DECLARACAO}<termoDeAutorizacao><dados><sistema id="API Integra Contador"></sistema>`));
  assert.ok(xml.endsWith("</dados></termoDeAutorizacao>"));
  assert.doesNotMatch(xml, /\n|\r|\t|\/>/);
  assert.ok(xml.includes(`<termo texto="${TEXTO_TERMO}"></termo>`));
  assert.ok(xml.includes('<dataAssinatura data="20261016"></dataAssinatura><vigencia data="20271016"></vigencia>'));
  // C14N: atributos em ordem alfabética (nome, numero, papel, tipo). Destinatário = plataforma (contratante);
  // assinadoPor = a empresa (PJ, autor pedido de dados).
  assert.ok(xml.includes('<destinatario nome="PLATAFORMA DE TESTE LTDA" numero="11444777000161" papel="contratante" tipo="PJ"></destinatario>'));
  assert.ok(xml.includes('<assinadoPor nome="EMPRESA DE TESTE LTDA" numero="11222333000181" papel="autor pedido de dados" tipo="PJ"></assinadoPor>'));
  const ordem = ["sistema", "termo", "avisoLegal", "finalidade", "dataAssinatura", "vigencia", "destinatario", "assinadoPor"].map((t) => xml.indexOf(`<${t} `));
  assert.deepEqual([...ordem].sort((a, b) => a - b), ordem);
});

test("textos oficiais com os espaços corrigidos (a página oficial gruda palavras no modelo XML)", () => {
  for (const texto of [TEXTO_TERMO, TEXTO_AVISO_LEGAL, TEXTO_FINALIDADE]) {
    assert.doesNotMatch(texto, /deautorização|AUTORPEDIDO|webdisponibilizados|certificadodigital|identificadocomo|próprioPROCURADOR|viaassinatura|consumidordeste|dadosrecebidos|deagosto|daLGPD|Brasil\(|DEAUTORIZAÇÃO|CONTADORes|assinadodigitalmente|APIINTEGRA|OUTORGADODO|web\.Esse/);
    assert.equal(limparTexto(texto), texto, "sem espaço duplo nem caractere oculto");
  }
  assert.match(TEXTO_TERMO, /^Autorizo a empresa CONTRATANTE, identificada neste termo de autorização como DESTINATÁRIO/);
  assert.match(TEXTO_FINALIDADE, /em nome do AUTOR PEDIDO DE DADOS \(PROCURADOR ou OUTORGADO DO CONTRIBUINTE\)\.$/);
});

test("escapa caracteres especiais e tira caracteres ocultos dos nomes", () => {
  const xml = montarTermo(dados({ destinatario: { numero: PLATAFORMA.numero, nome: 'A & B "C" <D> \'E\'' } }));
  assert.ok(xml.includes('nome="A &amp; B &quot;C&quot; &lt;D> \'E\'"'));
  const oculto = `EMPRESA${String.fromCharCode(0x200b)}  DE${String.fromCharCode(0xfeff)}\nTESTE`;
  assert.equal(limparTexto(oculto), "EMPRESA DE TESTE");
  assert.ok(montarTermo(dados({ assinadoPor: { ...EMPRESA, nome: oculto } })).includes('nome="EMPRESA DE TESTE"'));
});

test("recusa números, nomes e datas inválidos", () => {
  assert.throws(() => montarTermo(dados({ destinatario: { numero: "11444777000162", nome: "X" } })), /CNPJ da plataforma/);
  assert.throws(() => montarTermo(dados({ destinatario: { numero: PLATAFORMA.numero, nome: " " } })), /razão social da plataforma/);
  assert.throws(() => montarTermo(dados({ assinadoPor: { ...EMPRESA, numero: "11.222.333/0001-81" } })), /CNPJ da empresa/);
  assert.throws(() => montarTermo(dados({ assinadoPor: { ...EMPRESA, numero: "12ABC34501DE35" } })), /só números/);
  assert.throws(() => montarTermo(dados({ assinadoPor: { ...EMPRESA, numero: "52998224725" } })), /CNPJ da empresa/);
  assert.throws(() => montarTermo(dados({ assinadoPor: { ...EMPRESA, nome: "" } })), /razão social da empresa/);
  assert.throws(() => montarTermo(dados({ dataAssinatura: "20260230" })), /assinatura inválida/);
  assert.throws(() => montarTermo(dados({ vigencia: "2027-10-16" })), /vigência inválida/);
  assert.throws(() => montarTermo(dados({ vigencia: "20261015" })), /anterior/);
  assert.ok(montarTermo(dados({ vigencia: "20261016" }))); // vigência no próprio dia é aceita
  assert.equal(dataValida("20280229"), true);
  assert.equal(dataValida("20270229"), false);
});

test("abre o e-CNPJ A1 (.pfx AES-256) e acha o CNPJ, o nome com acento, a política e a validade", () => {
  const validoAte = new Date(Date.now() + 200 * DIA);
  const c = abrirCertificado(certificadoIcpDeTeste({ ...ECNPJ, nome: "AÇÃO & CIA SOFTWARE LTDA", validoAte }).pfx, "senha-de-teste");
  assert.deepEqual(c.titular, { tipo: "PJ", numero: EMPRESA.numero, nome: "AÇÃO & CIA SOFTWARE LTDA" });
  assert.equal(c.icpBrasil, true);
  assert.equal(c.politica, "A1");
  assert.equal(c.autoassinado, false);
  assert.equal(c.emissor, "AC DE TESTE CONTABILIZADEV");
  assert.equal(Math.abs(c.validoAte.getTime() - validoAte.getTime()) < 1000, true);
  assert.doesNotMatch(c.certificadoBase64, /\s|BEGIN/);
  assert.equal(typeof c.assinar, "function");
  assert.equal("chave" in c, false); // a chave privada não fica exposta no objeto
});

test("abre .pfx antigo (3DES), otherName em PrintableString, e-CPF e certificado A3", () => {
  const legado = abrirCertificado(certificadoIcpDeTeste({ ...ECNPJ, legado: true, textoImprimivel: true }).pfx, "senha-de-teste");
  assert.deepEqual(legado.titular, ECNPJ);
  const pf = abrirCertificado(certificadoIcpDeTeste({ tipo: "PF", numero: "52998224725", nome: "JOSÉ DA SILVA" }).pfx, "senha-de-teste");
  assert.deepEqual(pf.titular, { tipo: "PF", numero: "52998224725", nome: "JOSÉ DA SILVA" });
  assert.equal(abrirCertificado(certificadoIcpDeTeste({ ...ECNPJ, politica: "A3" }).pfx, "senha-de-teste").politica, "A3");
  assert.equal(abrirCertificado(certificadoIcpDeTeste({ ...ECNPJ, politica: null }).pfx, "senha-de-teste").politica, null);
});

test("sem as extensões da ICP-Brasil, usa o CN no padrão NOME:NÚMERO (também com o .pfx do OpenSSL)", () => {
  const openssl = abrirCertificado(certificadoDeTeste().pfx, certificadoDeTeste().senha);
  assert.deepEqual(openssl.titular, ECNPJ);
  assert.equal(openssl.autoassinado, true);
  assert.equal(openssl.icpBrasil, false);
  assert.equal(openssl.politica, null);
  assert.throws(
    () => abrirCertificado(certificadoIcpDeTeste({ tipo: "PF", numero: "123", nome: "SEM NÚMERO", semIcp: true }).pfx, "senha-de-teste"),
    (e) => e instanceof ErroCertificado && /não é um e-CNPJ/.test(e.message),
  );
});

test("senha errada, arquivo vazio, arquivo que não é .pfx e falta de senha dão mensagem clara", () => {
  const { pfx } = certificadoIcpDeTeste(ECNPJ);
  assert.throws(() => abrirCertificado(pfx, "errada"), /confira o arquivo .* e a senha/);
  assert.throws(() => abrirCertificado(new Uint8Array(), "x"), /vazio/);
  assert.throws(() => abrirCertificado(new TextEncoder().encode("não sou um pfx"), "x"), /confira o arquivo/);
  assert.throws(() => abrirCertificado(pfx, ""), /senha/);
  // ArrayBuffer (como vem do File.arrayBuffer() no navegador) também serve.
  const buffer = pfx.buffer.slice(pfx.byteOffset, pfx.byteOffset + pfx.byteLength) as ArrayBuffer;
  assert.equal(abrirCertificado(buffer, "senha-de-teste").titular.numero, EMPRESA.numero);
});

test("assina (enveloped, URI vazia, C14N, RSA-SHA256) e o xml-crypto confere a assinatura de forma independente", () => {
  const cert = certificadoIcpDeTeste(ECNPJ);
  const aberto = abrirCertificado(cert.pfx, cert.senha);
  const assinado = assinarTermo(montarTermo(dados({ assinadoPor: aberto.titular })), aberto);
  assert.match(assinado, /<\/dados><Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#"><SignedInfo><CanonicalizationMethod/);
  assert.match(assinado, /<\/SignedInfo><SignatureValue>[^<]+<\/SignatureValue><KeyInfo><X509Data><X509Certificate>[^<]+<\/X509Certificate><\/X509Data><\/KeyInfo><\/Signature><\/termoDeAutorizacao>$/);
  assert.equal(assinado.match(/<Reference /g)?.length, 1);
  assert.match(assinado, /<Reference URI="">/);
  assert.match(assinado, /enveloped-signature.*REC-xml-c14n-20010315.*xmlenc#sha256/);
  assert.match(assinado, /xmldsig-more#rsa-sha256/);
  assert.ok(assinado.includes(`<X509Certificate>${aberto.certificadoBase64}</X509Certificate>`));
  assert.doesNotMatch(assinado, /\n/);
  const pem = lerPfx(cert).certificado; // o certificado lido pelo OpenSSL, sem passar pelo forge
  assert.equal(verificarAssinatura(assinado, pem), true);
  assert.equal(verificarAssinatura(assinado.replace("20271016", "20281016"), pem), false);
  assert.equal(verificarAssinatura(assinado.replace("EMPRESA DE TESTE", "OUTRA EMPRESA DE"), pem), false);
});

test("assinatura de nome com acento e & confere (UTF-8 e escape iguais aos do C14N)", () => {
  const cert = certificadoIcpDeTeste({ ...ECNPJ, nome: "SOLUÇÕES & AÇÃO LTDA" });
  const aberto = abrirCertificado(cert.pfx, cert.senha);
  const assinado = assinarTermo(montarTermo(dados({ assinadoPor: aberto.titular, destinatario: { ...PLATAFORMA, nome: 'X "Y" <Z>' } })), aberto);
  assert.equal(verificarAssinatura(assinado, pemDoCertificado(aberto.certificadoBase64)), true);
});

test("só assina o termo montado por montarTermo e ainda não assinado", () => {
  const cert = certificadoIcpDeTeste(ECNPJ);
  const aberto = abrirCertificado(cert.pfx, cert.senha);
  const xml = montarTermo(dados());
  const assinado = assinarTermo(xml, aberto);
  assert.throws(() => assinarTermo(assinado, aberto), /sem assinatura/);
  assert.throws(() => assinarTermo(xml.slice(DECLARACAO.length), aberto), /montarTermo/);
  assert.throws(() => assinarTermo("<outro/>", aberto), /montarTermo/);
});

test("lê o certificado do X509Certificate e recusa o que não é certificado", () => {
  const aberto = abrirCertificado(certificadoIcpDeTeste(ECNPJ).pfx, "senha-de-teste");
  const lido = lerCertificado(aberto.certificadoBase64);
  assert.deepEqual(lido.titular, aberto.titular);
  assert.equal(lido.politica, "A1");
  assert.equal(lido.validoAte.getTime(), aberto.validoAte.getTime());
  assert.throws(() => lerCertificado("bm9wZQ=="), /ilegível/);
});

test("datas: dia de Brasília, soma de dias, vigência padrão de 1 ano limitada pela validade do certificado", () => {
  assert.equal(dataEmBrasilia(new Date("2026-10-17T02:59:59Z")), "20261016");
  assert.equal(dataEmBrasilia(new Date("2026-10-17T03:00:00Z")), "20261017");
  assert.equal(somarDias("20261231", 1), "20270101");
  assert.equal(somarDias("20280228", 1), "20280229");
  assert.equal(vigenciaPadrao("20261018"), "20271018");
  assert.equal(vigenciaPadrao("20280229"), "20290228");
  assert.equal(vigenciaPadrao("20261231"), "20271231");
  assert.equal(vigenciaPara("20271016", { validoAte: new Date("2027-03-01T12:00:00Z") }), "20270301");
  assert.equal(vigenciaPara("20271016", { validoAte: new Date("2028-03-01T12:00:00Z") }), "20271016");
  // Certificado que vence às 01:00 UTC do dia 2: em Brasília ainda é dia 1.
  assert.equal(vigenciaPara("20271016", { validoAte: new Date("2027-03-02T01:00:00Z") }), "20270301");
});

test("pemDoCertificado: linhas de 64 sem linha em branco, inclusive com tamanho múltiplo de 64 (o OpenSSL abre)", async () => {
  const { X509Certificate } = await import("node:crypto");
  assert.equal(pemDoCertificado("A".repeat(128)), `-----BEGIN CERTIFICATE-----\n${"A".repeat(64)}\n${"A".repeat(64)}\n-----END CERTIFICATE-----\n`);
  assert.equal(pemDoCertificado("A".repeat(70)), `-----BEGIN CERTIFICATE-----\n${"A".repeat(64)}\n${"A".repeat(6)}\n-----END CERTIFICATE-----\n`);
  assert.doesNotMatch(pemDoCertificado("A".repeat(64 * 17)), /\n\n/);
  // Um certificado real, preenchido no nome até o DER em base64 dar múltiplo de 64: o PEM abre no OpenSSL.
  for (let i = 0; i < 64; i++) {
    const c = certificadoIcpDeTeste({ ...ECNPJ, nome: `EMPRESA ${"X".repeat(i)}` });
    const b64 = abrirCertificado(c.pfx, c.senha).certificadoBase64;
    if (b64.length % 64 !== 0) continue;
    assert.equal(new X509Certificate(pemDoCertificado(b64)).raw.toString("base64"), b64);
    return;
  }
  assert.fail("nenhum certificado com tamanho múltiplo de 64");
});

test("tamanho da chave: lê os bits do módulo RSA; conferirAntesDeAssinar recusa chave menor que 2048 bits", () => {
  const c2048 = abrirCertificado(certificadoIcpDeTeste(ECNPJ).pfx, "senha-de-teste");
  assert.equal(c2048.bitsChave, 2048);
  assert.equal(BITS_MINIMOS_CHAVE, 2048);
  const c4096 = abrirCertificado(certificadoIcpDeTeste({ ...ECNPJ, bits: 4096 }).pfx, "senha-de-teste");
  assert.equal(c4096.bitsChave, 4096);
  conferirAntesDeAssinar(c4096, EMPRESA.numero, new Date());
  const c1024 = abrirCertificado(certificadoIcpDeTeste({ ...ECNPJ, bits: 1024 }).pfx, "senha-de-teste");
  assert.equal(c1024.bitsChave, 1024);
  assert.throws(() => conferirAntesDeAssinar(c1024, EMPRESA.numero, new Date()), (e) => e instanceof ErroCertificado && /1024 bits.*2048/.test(e.message));
});

test("conferirAntesDeAssinar: só e-CNPJ A1 da própria empresa, dentro da validade; e-CPF e A3 recusados com mensagem clara", () => {
  const agora = new Date();
  const c = abrirCertificado(certificadoIcpDeTeste(ECNPJ).pfx, "senha-de-teste");
  conferirAntesDeAssinar(c, EMPRESA.numero, agora);
  assert.throws(() => conferirAntesDeAssinar(c, "11444777000161", agora), /11\.222\.333\/0001-81.*11\.444\.777\/0001-61/);
  assert.throws(() => conferirAntesDeAssinar(c, EMPRESA.numero, new Date(c.validoAte.getTime() + 1)), /vencido/);
  assert.throws(() => conferirAntesDeAssinar(c, EMPRESA.numero, new Date(c.validoDe.getTime() - 1)), /ainda não está valendo/);
  const pf = abrirCertificado(certificadoIcpDeTeste({ tipo: "PF", numero: "52998224725", nome: "JOSE DA SILVA" }).pfx, "senha-de-teste");
  assert.throws(() => conferirAntesDeAssinar(pf, EMPRESA.numero, agora), /e-CPF.*e-CNPJ A1/);
  const a3 = abrirCertificado(certificadoIcpDeTeste({ ...ECNPJ, politica: "A3" }).pfx, "senha-de-teste");
  assert.throws(() => conferirAntesDeAssinar(a3, EMPRESA.numero, agora), /A3 \(token ou cartão\)/);
  const semPolitica = abrirCertificado(certificadoIcpDeTeste({ ...ECNPJ, politica: null }).pfx, "senha-de-teste");
  assert.throws(() => conferirAntesDeAssinar(semPolitica, EMPRESA.numero, agora), /não é um e-CNPJ A1/);
  // As mensagens chegam à tela do cliente: nada de fornecedor.
  for (const cert of [pf, a3, semPolitica]) {
    try {
      conferirAntesDeAssinar(cert, EMPRESA.numero, agora);
    } catch (e) {
      assert.doesNotMatch((e as Error).message, /serpro|integra/i);
    }
  }
});

test("e-CNPJ com CNPJ alfanumérico: pela extensão da ICP-Brasil e pelo CN; e-CPF continua PF", () => {
  const alfa = "12ABC34501DE35";
  const icp = abrirCertificado(certificadoIcpDeTeste({ tipo: "PJ", numero: alfa, nome: "EMPRESA ALFA LTDA" }).pfx, "senha-de-teste");
  assert.deepEqual(icp.titular, { tipo: "PJ", numero: alfa, nome: "EMPRESA ALFA LTDA" });
  const semIcp = abrirCertificado(certificadoIcpDeTeste({ tipo: "PJ", numero: alfa.toLowerCase(), nome: "EMPRESA ALFA LTDA", semIcp: true }).pfx, "senha-de-teste");
  assert.deepEqual(semIcp.titular, { tipo: "PJ", numero: alfa, nome: "EMPRESA ALFA LTDA" });
  const pf = abrirCertificado(certificadoIcpDeTeste({ tipo: "PF", numero: "12345678909", nome: "FULANO" }).pfx, "senha-de-teste");
  assert.deepEqual(pf.titular, { tipo: "PF", numero: "12345678909", nome: "FULANO" });
});
