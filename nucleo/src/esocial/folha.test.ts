import { test } from "node:test";
import assert from "node:assert/strict";
import { assinarEsocial, completarAssinaturaRemota, prepararAssinaturaEsocialRemota, verificarAssinatura } from "../assinatura.ts";
import { createSign } from "node:crypto";
import { certificadoDeTeste } from "../certificado-teste.ts";
import { lerPfx } from "../certificado.ts";
import { assinarEValidar, CODIGO_DO_EVENTO, dataPagamentoPadrao, ErroEventoInvalido, ideDmDevDoXml, montarEventosDoMes, montarRetificacao, previa, validarAssinado } from "./folha.ts";
import { PARAMETROS } from "./respostas-exemplo.ts";

const pem = lerPfx(certificadoDeTeste());
const QUANDO = new Date(2026, 10, 3, 9, 0, 0);
const PAGAMENTO = { dtPgto: "2026-10-05", perRef: "2026-09", ideDmDev: "092026MENSAL05102026132358", liquido: 1442.69 };

test("prévia, data do pagamento (o dia 31 vira o último do mês) e ideDmDev", () => {
  assert.deepEqual(previa("2027-01", "122026MENSAL"), { perRef: "2026-12", ideDmDevAnterior: "122026MENSAL", temPagamento: true });
  assert.equal(previa("2026-10", null).temPagamento, false);
  assert.equal(dataPagamentoPadrao("2026-10", 5), "2026-10-05");
  assert.equal(dataPagamentoPadrao("2027-02", 31), "2027-02-28");
  assert.equal(ideDmDevDoXml("<ideDmDev>A1</ideDmDev>"), "A1");
});

test("mês: lote 1 com S-1200 e S-1210 (par do MOD §7.9.7), lote 2 com o S-1299; ids em sequência", () => {
  const eventos = montarEventosDoMes({ mes: "2026-10", ambiente: "producao", parametros: PARAMETROS, pagamento: PAGAMENTO, transDCTFWeb: true, quando: QUANDO });
  assert.deepEqual(eventos.map((e) => [CODIGO_DO_EVENTO[e.tipo], e.lote]), [["S-1200", 1], ["S-1210", 1], ["S-1299", 2]]);
  assert.deepEqual(eventos.map((e) => e.id.slice(-2)), ["01", "02", "03"]);
  assert.equal(ideDmDevDoXml(eventos[0].xml), eventos[0].ideDmDev);
  assert.match(eventos[1].xml, /<perRef>2026-09<\/perRef><ideDmDev>092026MENSAL05102026132358<\/ideDmDev><vrLiq>1442\.69<\/vrLiq>/);
  assert.match(eventos[2].xml, /<evtPgtos>S<\/evtPgtos>.*<transDCTFWeb>S<\/transDCTFWeb>/);
  // Sem pagamento conhecido: só o S-1200 e o fechamento sem pagamentos; sem a transmissão da DCTFWeb, sem a tag.
  const so = montarEventosDoMes({ mes: "2026-10", ambiente: "producao", parametros: PARAMETROS, pagamento: null, transDCTFWeb: false, quando: QUANDO });
  assert.deepEqual(so.map((e) => e.tipo), ["evtRemun", "evtFechaEvPer"]);
  assert.match(so[1].xml, /<evtPgtos>N<\/evtPgtos>/);
  assert.doesNotMatch(so[1].xml, /transDCTFWeb/);
  // Pagamento no próprio mês: o S-1210 aponta o demonstrativo do S-1200 do mesmo lote.
  const mesmo = montarEventosDoMes({ mes: "2026-10", ambiente: "producao", parametros: PARAMETROS, pagamento: { dtPgto: "2026-10-30", perRef: "2026-10", liquido: 1442.69 }, transDCTFWeb: true, quando: QUANDO });
  assert.match(mesmo[1].xml, new RegExp(`<ideDmDev>${mesmo[0].ideDmDev}</ideDmDev>`));
});

test("mês: recusa pagamento fora do mês, de mês posterior ou de outro mês sem o demonstrativo", () => {
  const base = { mes: "2026-10", ambiente: "producao" as const, parametros: PARAMETROS, transDCTFWeb: true, quando: QUANDO };
  assert.throws(() => montarEventosDoMes({ ...base, pagamento: { ...PAGAMENTO, dtPgto: "2026-11-05" } }), /dentro do mês/);
  assert.throws(() => montarEventosDoMes({ ...base, pagamento: { ...PAGAMENTO, perRef: "2026-11" } }), /posterior/);
  assert.throws(() => montarEventosDoMes({ ...base, pagamento: { dtPgto: "2026-10-05", perRef: "2026-09", liquido: 1 } }), /demonstrativo/);
});

test("retificação: S-1298 (mês fechado), S-1200 retificador com o recibo e o mesmo demonstrativo, e S-1299, um lote cada", () => {
  const original = { nrRecibo: "1.1.0000000000000000101", ideDmDev: "092026MENSAL05102026132358" };
  const r = montarRetificacao({ mes: "2026-09", ambiente: "producao", parametros: { ...PARAMETROS, proLabore: 2000 }, original, reabrir: true, temPagamento: true, transDCTFWeb: true, quando: QUANDO });
  assert.deepEqual(r.map((e) => [CODIGO_DO_EVENTO[e.tipo], e.lote]), [["S-1298", 1], ["S-1200", 2], ["S-1299", 3]]);
  assert.match(r[1].xml, /<indRetif>2<\/indRetif><nrRecibo>1\.1\.0000000000000000101<\/nrRecibo>/);
  assert.match(r[1].xml, /<ideDmDev>092026MENSAL05102026132358<\/ideDmDev>.*<vrRubr>2000\.00<\/vrRubr>/);
  const aberto = montarRetificacao({ mes: "2026-09", ambiente: "producao", parametros: PARAMETROS, original, reabrir: false, temPagamento: false, transDCTFWeb: false, quando: QUANDO });
  assert.deepEqual(aberto.map((e) => [e.tipo, e.lote]), [["evtRemun", 1], ["evtFechaEvPer", 2]]);
  assert.throws(() => montarRetificacao({ mes: "2026-09", ambiente: "producao", parametros: PARAMETROS, original: { nrRecibo: "", ideDmDev: "x" }, reabrir: false, temPagamento: false, transDCTFWeb: false }), /recibo/);
});

test("assinatura em duas etapas no padrão do eSocial: o SignedInfo assinado fora, a assinatura confere e o evento passa no esquema", async () => {
  const eventos = montarEventosDoMes({ mes: "2026-10", ambiente: "producao", parametros: PARAMETROS, pagamento: PAGAMENTO, transDCTFWeb: true, quando: QUANDO });
  for (const e of eventos) {
    const preparado = prepararAssinaturaEsocialRemota(e.xml, pem.certificado);
    // O "navegador": RSA-SHA256 do SignedInfo com a chave do certificado.
    const valor = createSign("RSA-SHA256").update(preparado.signedInfo).sign(pem.chave, "base64");
    const assinado = completarAssinaturaRemota(preparado.xml, valor);
    assert.equal(verificarAssinatura(assinado, pem.certificado), true);
    // O mesmo resultado da assinatura no servidor (mesmo digest, mesma posição: último filho da raiz, Reference URI="").
    assert.equal(assinado, assinarEsocial(e.xml, pem));
    await validarAssinado(assinado, e.tipo);
  }
  // Valor de outra chave não confere.
  const outro = lerPfx(certificadoDeTeste({ titular: "OUTRA EMPRESA:11444777000161" }));
  const preparado = prepararAssinaturaEsocialRemota(eventos[0].xml, pem.certificado);
  const falso = completarAssinaturaRemota(preparado.xml, createSign("RSA-SHA256").update(preparado.signedInfo).sign(outro.chave, "base64"));
  assert.equal(verificarAssinatura(falso, pem.certificado), false);
  assert.throws(() => prepararAssinaturaEsocialRemota(preparado.xml, pem.certificado), /já tem/);
});

test("evento assinado no servidor é conferido no esquema; evento quebrado é recusado antes de sair", async () => {
  const [remuneracao] = montarEventosDoMes({ mes: "2026-10", ambiente: "producao", parametros: PARAMETROS, pagamento: null, transDCTFWeb: true, quando: QUANDO });
  assert.ok(verificarAssinatura(await assinarEValidar(remuneracao.xml, "evtRemun", pem), pem.certificado));
  await assert.rejects(assinarEValidar(remuneracao.xml.replace(/<cpfTrab>[^<]+<\/cpfTrab>/, ""), "evtRemun", pem), ErroEventoInvalido);
});

test("mês que parou no meio: só vai o que falta (o S-1299 sozinho no lote 1, ou o S-1210 que faltou com o fechamento)", () => {
  const base = { mes: "2026-10", ambiente: "producao" as const, parametros: PARAMETROS, transDCTFWeb: true, quando: QUANDO };
  const soFechar = montarEventosDoMes({ ...base, pagamento: PAGAMENTO, remuneracaoAceita: { ideDmDev: "D10" }, pagamentoAceito: true });
  assert.deepEqual(soFechar.map((e) => [e.tipo, e.lote, e.id.slice(-2)]), [["evtFechaEvPer", 1, "01"]]);
  assert.match(soFechar[0].xml, /<evtPgtos>S<\/evtPgtos>/);
  const pagamentoNoMesmo = montarEventosDoMes({ ...base, pagamento: { dtPgto: "2026-10-30", perRef: "2026-10", liquido: 10 }, remuneracaoAceita: { ideDmDev: "D10" } });
  assert.deepEqual(pagamentoNoMesmo.map((e) => [e.tipo, e.lote]), [["evtPgtos", 1], ["evtFechaEvPer", 2]]);
  assert.match(pagamentoNoMesmo[0].xml, /<ideDmDev>D10<\/ideDmDev>/);
});
