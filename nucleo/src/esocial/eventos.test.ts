import { test } from "node:test";
import assert from "node:assert/strict";
import { assinarEsocial } from "../assinatura.ts";
import { certificadoDeTeste } from "../certificado-teste.ts";
import { lerPfx } from "../certificado.ts";
import { ideEmpregador, novoIdeDmDev, s1000Teste, s1200, s1210, s1298, s1299, valoresDoProLabore } from "./eventos.ts";
import { idEvento } from "./lote.ts";
import { PARAMETROS } from "./respostas-exemplo.ts";
import { validar } from "./validar.ts";

const QUANDO = new Date(2026, 10, 3, 9, 8, 7);

test("valores do pró-labore e identificação do empregador pelo CNPJ raiz", () => {
  assert.deepEqual(valoresDoProLabore(1621), { proLabore: 1621, inss: 178.31, liquido: 1442.69 });
  assert.equal(ideEmpregador({ cnpj: "11.222.333/0001-81" }), "<ideEmpregador><tpInsc>1</tpInsc><nrInsc>11222333</nrInsc></ideEmpregador>");
  assert.throws(() => ideEmpregador({ cnpj: "123" }), /CNPJ/);
  assert.equal(novoIdeDmDev("2026-10", QUANDO), "102026MENSAL03112026090807");
});

test("S-1200 traz o CPF, as rubricas do cliente e os valores", () => {
  const xml = s1200(idEvento(PARAMETROS.empregador.cnpj, 1, QUANDO), "2026-10", "producao", "X", PARAMETROS);
  assert.match(xml, /<cpfTrab>52998224725<\/cpfTrab>/);
  assert.match(xml, /<nrInsc>11222333000181<\/nrInsc><codLotacao>1<\/codLotacao>/);
  assert.match(xml, /<codRubr>100<\/codRubr><ideTabRubr>0001<\/ideTabRubr><qtdRubr>220.00<\/qtdRubr><vrRubr>1621.00<\/vrRubr>/);
  assert.match(xml, /<codRubr>843<\/codRubr><ideTabRubr>0001<\/ideTabRubr><vrRubr>178.31<\/vrRubr>/);
  assert.match(xml, /<tpAmb>1<\/tpAmb>/);
});

test("eventos assinados passam no esquema oficial do eSocial (S-1.3)", async () => {
  const pem = lerPfx(certificadoDeTeste());
  const cnpj = PARAMETROS.empregador.cnpj;
  const id = (n: number) => idEvento(cnpj, n, QUANDO);
  const casos = [
    [s1200(id(1), "2026-10", "restrita", novoIdeDmDev("2026-10", QUANDO), PARAMETROS), "evtRemun"],
    [s1210(id(2), "2026-10", "restrita", { dtPgto: "2026-10-05", perRef: "2026-09", ideDmDev: "092026MENSAL01" }, PARAMETROS), "evtPgtos"],
    [s1299(id(3), "2026-10", "restrita", true, PARAMETROS.empregador), "evtFechaEvPer"],
    [s1299(id(3), "2026-10", "restrita", false, PARAMETROS.empregador, false), "evtFechaEvPer"],
    [s1000Teste(id(4), PARAMETROS.empregador, "2021-08"), "evtInfoEmpregador"],
    [s1298(id(5), "2026-10", "restrita", PARAMETROS.empregador), "evtReabreEvPer"],
    [s1200(id(6), "2026-10", "restrita", "X1", { ...PARAMETROS, qtdProLabore: null }, { nrRecibo: "1.1.0000000000000000101" }), "evtRemun"],
    [s1210(id(7), "2026-10", "restrita", { dtPgto: "2026-10-30", perRef: "2026-10", ideDmDev: "X1", liquido: 1000.5 }, PARAMETROS), "evtPgtos"],
  ] as const;
  for (const [xml, tipo] of casos) assert.deepEqual(await validar(assinarEsocial(xml, pem), tipo), [], tipo);
});

test("o validador recusa evento com campo obrigatório faltando", async () => {
  const pem = lerPfx(certificadoDeTeste());
  const xml = s1299(idEvento(PARAMETROS.empregador.cnpj, 1, QUANDO), "2026-10", "restrita", false, PARAMETROS.empregador).replace(/<perApur>[^<]+<\/perApur>/, "");
  assert.ok((await validar(assinarEsocial(xml, pem), "evtFechaEvPer")).length > 0);
});

test("retificação, reabertura e fechamento com ou sem a transmissão imediata da DCTFWeb", () => {
  const id = idEvento(PARAMETROS.empregador.cnpj, 1, QUANDO);
  const ret = s1200(id, "2026-10", "producao", "X1", PARAMETROS, { nrRecibo: "1.1.9" });
  assert.match(ret, /<ideEvento><indRetif>2<\/indRetif><nrRecibo>1\.1\.9<\/nrRecibo><indApuracao>1<\/indApuracao>/);
  assert.doesNotMatch(s1200(id, "2026-10", "producao", "X1", { ...PARAMETROS, qtdProLabore: null }), /qtdRubr/);
  assert.match(s1299(id, "2026-10", "producao", true, PARAMETROS.empregador), /<transDCTFWeb>S<\/transDCTFWeb>/);
  assert.doesNotMatch(s1299(id, "2026-10", "producao", true, PARAMETROS.empregador, false), /transDCTFWeb/);
  assert.match(s1298(id, "2026-10", "producao", PARAMETROS.empregador), /<evtReabreEvPer Id="ID1[^"]+"><ideEvento><indApuracao>1<\/indApuracao><perApur>2026-10<\/perApur>/);
  // S-1210 com o líquido do demonstrativo pago (não o pró-labore deste mês).
  assert.match(s1210(id, "2026-10", "producao", { dtPgto: "2026-10-05", perRef: "2026-09", ideDmDev: "D", liquido: 999.99 }, PARAMETROS), /<vrLiq>999\.99<\/vrLiq>/);
});
