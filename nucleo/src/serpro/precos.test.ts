import { test } from "node:test";
import assert from "node:assert/strict";
import { custoMensal, inicioDoPeriodo, precoUnitario } from "./precos.ts";

test("preço da primeira faixa", () => {
  assert.equal(precoUnitario("consulta", 1), 0.24);
  assert.equal(precoUnitario("emissao", 500), 0.32);
  assert.equal(precoUnitario("declaracao", 100), 0.4);
});

test("todo o consumo do mês paga o preço da faixa atingida", () => {
  assert.equal(precoUnitario("declaracao", 101), 0.36);
  assert.equal(custoMensal({ consulta: 0, emissao: 0, declaracao: 101 }), 36.36);
});

test("última faixa não tem limite", () => {
  assert.equal(precoUnitario("consulta", 1_000_000), 0.06);
});

test("duas guias por mês (declarar, emitir e consultar DAS e DARF) custam R$ 1,92", () => {
  assert.equal(custoMensal({ consulta: 2, emissao: 2, declaracao: 2 }), 1.92);
});

test("período de cobrança vai do dia 21 ao dia 20", () => {
  assert.equal(inicioDoPeriodo(new Date(2026, 9, 20)).toLocaleDateString("sv-SE"), "2026-09-21");
  assert.equal(inicioDoPeriodo(new Date(2026, 9, 21)).toLocaleDateString("sv-SE"), "2026-10-21");
  assert.equal(inicioDoPeriodo(new Date(2026, 0, 5)).toLocaleDateString("sv-SE"), "2025-12-21");
});
