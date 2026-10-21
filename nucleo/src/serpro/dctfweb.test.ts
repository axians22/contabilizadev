import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { verificarAssinatura } from "../assinatura.ts";
import { documentoReal } from "../casos-reais.ts";
import { certificadoDeTeste, certificadoIcpDeTeste } from "../certificado-teste.ts";
import { completarAssinaturaRemota, MARCADOR_ASSINATURA } from "../assinatura.ts";
import { abrirCertificado, pemDoCertificado } from "./termo-autorizacao.ts";
import { lerPfx } from "../certificado.ts";
import { CONTRIBUINTE, clienteFalso } from "./cliente-falso.ts";
import { pdfComTexto, xmlDctf } from "./dctf-exemplo.ts";
import { bloqueioTransmissaoDctf, conferir, gerarDarf, lerXmlDctf, periodoDctf, prepararAssinaturaDctf, transmitirDctf, transmitirDctfAssinada, valorDoDarf } from "./dctfweb.ts";

const ok = (dados: unknown) => ({ status: 200, dados, mensagens: [] });
const base64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

test("lê valor a pagar, recibo e declaração zerada do XML", () => {
  assert.deepEqual(lerXmlDctf(xmlDctf({ recibo: "123", saldo: [100.1, 78.21] })), {
    aPagar: 178.31,
    recibo: "123",
    transmissao: "20261005133010",
    zerada: false,
  });
  const zerada = lerXmlDctf(xmlDctf({ saldo: [] }).replace("<indZerada>0", "<indZerada>1"));
  assert.equal(zerada.aPagar, 0);
  assert.equal(zerada.zerada, true);
  assert.deepEqual(periodoDctf("2026-09"), { categoria: "GERAL_MENSAL", anoPA: "2026", mesPA: "09" });
});

const REAL = documentoReal("DCTFWEB-XML-202609.xml");
test("caso real: DCTFWeb de 09/2026 transmitida, R$ 178,31", { skip: !REAL && "XML do ../fiscal não encontrado" }, () => {
  const info = lerXmlDctf(fs.readFileSync(REAL!, "utf8"));
  assert.equal(info.aPagar, 178.31);
  assert.equal(info.recibo, "50000534643844");
});

test("conferir: devolve o XML e a situação", async () => {
  const cliente = clienteFalso(ok({ XMLStringBase64: base64(xmlDctf()) }), ok({}));
  const r = await conferir(cliente, CONTRIBUINTE, { pa: "2026-09", mesAtual: "2026-10" });
  assert.ok(r.ok);
  assert.equal(r.situacao, "em andamento");
  assert.equal(r.aPagar, 178.31);
  assert.equal((await conferir(cliente, CONTRIBUINTE, { pa: "2026-09", mesAtual: "2026-10" })).ok, false);
  assert.equal((await conferir(cliente, CONTRIBUINTE, { pa: "2026-10", mesAtual: "2026-10" })).ok, false);
});

test("bloqueios da transmissão da DCTFWeb", () => {
  const conferencia = { situacao: "em andamento" as const, aPagar: 178.31, xml: "<x/>" };
  assert.match(bloqueioTransmissaoDctf(null, 178.31)!, /Confira/);
  assert.match(bloqueioTransmissaoDctf({ ...conferencia, situacao: "transmitida" }, 178.31)!, /já foi transmitida/);
  assert.match(bloqueioTransmissaoDctf(conferencia, 178.32)!, /não bate/);
  assert.match(bloqueioTransmissaoDctf({ ...conferencia, xml: "" }, 178.31)!, /XML/);
  assert.equal(bloqueioTransmissaoDctf(conferencia, 178.314), null);
});

test("transmitir: assina o ConteudoDeclaracao com o certificado e envia com confirmação", async () => {
  const pem = lerPfx(certificadoDeTeste());
  const conferencia = { situacao: "em andamento" as const, aPagar: 178.31, xml: xmlDctf() };
  const nada = clienteFalso();
  assert.match((await transmitirDctf(nada, CONTRIBUINTE, { pa: "2026-09", conferencia, inssEsperado: 178.31, pem, confirmado: false })).detalhe, /confirmação/);
  assert.equal(nada.chamadas.length, 0);

  const cliente = clienteFalso(ok({ numeroRecibo: "1" }));
  const r = await transmitirDctf(cliente, CONTRIBUINTE, { pa: "2026-09", conferencia, inssEsperado: 178.31, pem, confirmado: true });
  assert.ok(r.ok);
  const enviado = Buffer.from((cliente.chamadas[0].pedido.dados as { xmlAssinadoBase64: string }).xmlAssinadoBase64, "base64").toString("utf8");
  assert.match(enviado, /<\/ConteudoDeclaracao><Signature/);
  assert.equal(verificarAssinatura(enviado, pem.certificado), true);
  assert.equal(cliente.chamadas[0].opcoes.confirmado, true);
});

test("gerar DARF: só para transmitida; lê o total do PDF no DARF atualizado", async () => {
  const pdf = pdfComTexto("Documento de Arrecadacao", "Valor Total do Documento", "1.234,56").toString("base64");
  const cliente = clienteFalso(ok({ PDFByteArrayBase64: pdf }), ok({ PDFByteArrayBase64: pdf }));
  assert.match((await gerarDarf(cliente, CONTRIBUINTE, { pa: "2026-09", transmitida: false })).detalhe, /transmitida/);
  const r = await gerarDarf(cliente, CONTRIBUINTE, { pa: "2026-09", transmitida: true });
  assert.ok(r.ok);
  assert.equal(r.total, 1234.56);
  const atualizado = await gerarDarf(cliente, CONTRIBUINTE, { pa: "2026-09", transmitida: true, pagarEm: "2026-10-30", hoje: "2026-10-21" });
  assert.ok(atualizado.ok);
  assert.equal((cliente.chamadas[1].pedido.dados as { DataAcolhimentoProposta: number }).DataAcolhimentoProposta, 20261030);
  assert.match((await gerarDarf(cliente, CONTRIBUINTE, { pa: "2026-09", transmitida: true, pagarEm: "2026-11-03", hoje: "2026-10-21" })).detalhe, /fim deste mês/);
  assert.equal(valorDoDarf("sem valor"), null);
});

// Assinatura no navegador do cliente: o servidor prepara (com o certificado que o navegador mandou), o navegador assina o
// SignedInfo com a chave do .pfx aberto na memória (o mesmo código do termo de autorização) e o servidor completa e confere.
function assinarNoNavegador(xml: string) {
  const pfx = certificadoIcpDeTeste({ tipo: "PJ", numero: "11222333000181", nome: "EMPRESA DE TESTE LTDA" });
  const aberto = abrirCertificado(new Uint8Array(pfx.pfx), pfx.senha);
  const pem = pemDoCertificado(aberto.certificadoBase64);
  const preparada = prepararAssinaturaDctf(xml, pem);
  return { pem, preparada, valor: aberto.assinar(preparada.signedInfo) };
}

test("assinatura no navegador: SignedInfo preparado no servidor, assinado com a chave do cliente, conferido e transmitido", async () => {
  const xml = xmlDctf();
  const { pem, preparada, valor } = assinarNoNavegador(xml);
  assert.match(preparada.xml, new RegExp(`<SignatureValue>${MARCADOR_ASSINATURA}</SignatureValue>`));
  assert.match(preparada.signedInfo, /^<SignedInfo xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#"[^>]*>.*<DigestValue>/);
  assert.throws(() => prepararAssinaturaDctf(preparada.xml, pem), /já tem uma assinatura preparada/);
  const assinado = completarAssinaturaRemota(preparada.xml, valor);
  assert.equal(verificarAssinatura(assinado, pem), true);
  assert.throws(() => completarAssinaturaRemota(preparada.xml, "abc"), /inválido/);

  const conferencia = { situacao: "em andamento" as const, aPagar: 178.31, xml };
  const cliente = clienteFalso(ok({ numeroRecibo: "2" }));
  const r = await transmitirDctfAssinada(cliente, CONTRIBUINTE, { pa: "2026-09", conferencia, inssEsperado: 178.31, xmlAssinado: assinado, certificadoPem: pem, confirmado: true });
  assert.ok(r.ok);
  assert.equal(cliente.chamadas[0].opcoes.confirmado, true);

  // Assinatura de outra chave (valor trocado), conteúdo diferente do conferido ou sem confirmação: nada é enviado.
  const nada = clienteFalso();
  const outra = assinarNoNavegador(xml);
  const trocada = completarAssinaturaRemota(preparada.xml, outra.valor);
  assert.match((await transmitirDctfAssinada(nada, CONTRIBUINTE, { pa: "2026-09", conferencia, inssEsperado: 178.31, xmlAssinado: trocada, certificadoPem: pem, confirmado: true })).detalhe, /não passou na verificação/);
  const outroConteudo = { ...conferencia, xml: xmlDctf({ saldo: [178.31] }).replace("092026", "082026") };
  assert.match((await transmitirDctfAssinada(nada, CONTRIBUINTE, { pa: "2026-09", conferencia: outroConteudo, inssEsperado: 178.31, xmlAssinado: assinado, certificadoPem: pem, confirmado: true })).detalhe, /não é o da declaração conferida/);
  assert.match((await transmitirDctfAssinada(nada, CONTRIBUINTE, { pa: "2026-09", conferencia, inssEsperado: 178.31, xmlAssinado: xml, certificadoPem: pem, confirmado: true })).detalhe, /não é o da declaração conferida/);
  assert.match((await transmitirDctfAssinada(nada, CONTRIBUINTE, { pa: "2026-09", conferencia, inssEsperado: 178.31, xmlAssinado: assinado, certificadoPem: pem, confirmado: false })).detalhe, /confirmação/);
  assert.equal(nada.chamadas.length, 0);
});

test("caso real: o XML da DCTFWeb de 09/2026 é assinado em duas etapas sem mudar o conteúdo", { skip: !REAL && "XML do ../fiscal não encontrado" }, () => {
  const xml = fs.readFileSync(REAL!, "utf8");
  const { pem, preparada, valor } = assinarNoNavegador(xml);
  const assinado = completarAssinaturaRemota(preparada.xml, valor);
  assert.equal(verificarAssinatura(assinado, pem), true);
  assert.equal(assinado.replace(/<Signature[\s>][\s\S]*?<\/Signature>/, ""), xml.replace(/^<\?xml[^>]*\?>\s*/, ""));
});
