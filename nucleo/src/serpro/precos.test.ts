import { test } from "node:test";
import assert from "node:assert/strict";
import { custoMensal, ehChaveDePeriodo, inicioDoPeriodo, limitesDoPeriodo, periodoDe, precoUnitario, ultimoDiaDoPeriodo } from "./precos.ts";

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

test("período de cobrança vai do dia 21 ao dia 20, no horário de Brasília (qualquer fuso do servidor)", () => {
  assert.equal(periodoDe(new Date("2026-10-20T12:00:00-03:00")), "2026-09-21");
  assert.equal(periodoDe(new Date("2026-10-21T12:00:00-03:00")), "2026-10-21");
  assert.equal(periodoDe(new Date("2026-01-05T12:00:00-03:00")), "2025-12-21");
  // A virada é à meia-noite de Brasília: 20/10 23:59:59 ainda é o período anterior (já 21/10 em UTC).
  assert.equal(periodoDe(new Date("2026-10-20T23:59:59.999-03:00")), "2026-09-21");
  assert.equal(periodoDe(new Date("2026-10-21T02:59:59.999Z")), "2026-09-21");
  assert.equal(periodoDe(new Date("2026-10-21T00:00:00-03:00")), "2026-10-21");
  assert.equal(inicioDoPeriodo(new Date("2026-10-20T23:00:00-03:00")).toISOString(), "2026-09-21T03:00:00.000Z");
  assert.equal(inicioDoPeriodo(new Date("2026-10-21T00:00:00-03:00")).toISOString(), "2026-10-21T03:00:00.000Z");
});

test("limites do período: início incluído, fim excluído, virando o ano", () => {
  const { inicio, fim } = limitesDoPeriodo("2026-12-21");
  assert.equal(inicio.toISOString(), "2026-12-21T03:00:00.000Z");
  assert.equal(fim.toISOString(), "2027-01-21T03:00:00.000Z");
  assert.equal(ultimoDiaDoPeriodo("2026-12-21"), "2027-01-20");
  assert.equal(ultimoDiaDoPeriodo("2026-01-21"), "2026-02-20");
  assert.throws(() => limitesDoPeriodo("2026-10-20"));
  assert.throws(() => limitesDoPeriodo("2026-13-21"));
  assert.equal(ehChaveDePeriodo("2026-10-21"), true);
  assert.equal(ehChaveDePeriodo("inicio"), false);
});
