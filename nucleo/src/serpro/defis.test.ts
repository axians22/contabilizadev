import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularDas } from "../simples.ts";
import { CONTRIBUINTE, clienteFalso } from "./cliente-falso.ts";
import { avisoDefis, buscarDefis, prazoDefis, resumoDoAno } from "./defis.ts";

test("prazo e aviso anual da DEFIS", () => {
  assert.equal(prazoDefis(2026), "2027-03-31");
  assert.equal(avisoDefis(new Date(2027, 0, 15), false), null);
  assert.deepEqual(avisoDefis(new Date(2027, 1, 1), true), { ano: 2026, prazo: "2027-03-31" });
  assert.deepEqual(avisoDefis(new Date(2027, 2, 31), false), { ano: 2026, prazo: "2027-03-31" });
  assert.equal(avisoDefis(new Date(2027, 2, 1), true), null);
});

test("busca a DEFIS entregue, não encontrada ou com erro", async () => {
  const cliente = clienteFalso(
    { status: 200, dados: [{ idDefis: 123, declaracao: "REVD", recibo: "UkVD" }], mensagens: [] },
    { status: 404, dados: null, mensagens: [] },
    { status: 500, dados: null, mensagens: [{ codigo: "E", texto: "fora do ar" }] },
  );
  const entregue = await buscarDefis(cliente, CONTRIBUINTE, 2025);
  assert.ok(entregue.ok && entregue.situacao === "entregue" && entregue.idDefis === "123");
  const nada = await buscarDefis(cliente, CONTRIBUINTE, 2025);
  assert.ok(nada.ok && nada.situacao === "nao-encontrada");
  assert.deepEqual(await buscarDefis(cliente, CONTRIBUINTE, 2025), { ok: false, detalhe: "E: fora do ar" });
  assert.equal((await buscarDefis(cliente, CONTRIBUINTE, 1.5)).ok, false);
});

test("resumo do ano: IRPJ do DAS pago na proporção do cálculo e lucro isento", () => {
  const das = calcularDas({ pa: "2026-09", receita: 23_000, rbt12: 352_998.85, anexo: "III", mercado: "externo" });
  const zero = calcularDas({ pa: "2026-10", receita: 0, rbt12: 352_998.85, anexo: "III", mercado: "externo" });
  const r = resumoDoAno([
    { mes: "2026-09", receita: 23_000, dasCalculado: das, dasPago: 1000.76, proLabore: { bruto: 1621, inss: 178.31, previsto: false } },
    { mes: "2026-10", receita: 0, dasCalculado: zero, dasPago: null, proLabore: { bruto: 1621, inss: 178.31, previsto: true } },
  ]);
  assert.equal(r.das, 1000.76);
  assert.ok(Math.abs(r.irpj - 78.65) < 0.001);
  assert.ok(Math.abs(r.limiteLucroIsento - (23_000 * 0.32 - 78.65)) < 0.001);
  assert.deepEqual(r.semReceita, ["2026-10"]);
  assert.deepEqual(r.semProLabore, ["2026-10"]);
  assert.equal(r.inss, 356.62);
});
