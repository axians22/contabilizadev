import { test } from "node:test";
import assert from "node:assert/strict";
import { TABELAS, TRIBUTOS, aliquotaEfetiva, calcularDas, percentuaisEfetivos, tabelaVigente } from "./simples.ts";

const perto = (a: number, b: number, eps = 1e-12) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("QA ciclo 2: cada repartição e cada tabela de redistribuição soma 100%", () => {
  for (const t of TABELAS) {
    for (const f of t.faixas) perto(Object.values(f.reparticao).reduce((s, v) => s + (v ?? 0), 0), 1, 1e-9);
    const p = t.redistribuicao.percentuais;
    if (p) perto(Object.values(p).reduce((s, v) => s + (v ?? 0), 0), 1, 1e-9);
  }
});

test("QA ciclo 2: soma dos percentuais efetivos = alíquota efetiva em todas as tabelas, faixas 1 a 5", () => {
  for (const t of TABELAS) {
    for (let rb = 0; rb <= 3_600_000; rb += 7_919.37) {
      const n = [180_000, 360_000, 720_000, 1_800_000, 3_600_000].findIndex((a) => rb <= a);
      const f = t.faixas[n];
      const ef = aliquotaEfetiva(rb, f);
      const p = percentuaisEfetivos(ef, f, t);
      perto(TRIBUTOS.reduce((s, x) => s + p[x], 0), ef, 1e-12);
      assert.ok(p.iss <= t.tetoIss + 1e-15);
    }
  }
});

test("QA ciclo 2: Anexo III 2026, RBT12 R$ 3,6 mi (topo da 5ª faixa), exportação", () => {
  const d = calcularDas({ pa: "2026-12", receita: 100_000, rbt12: 3_600_000, anexo: "III", mercado: "externo" });
  // efetiva = (3.600.000 × 21% - 125.640) / 3.600.000 = 0,1751; base = 0,1251
  perto(d.aliquotaEfetiva, 0.1751);
  assert.deepEqual([d.tributos.irpj, d.tributos.csll, d.tributos.cpp], [753.1, 658.03, 8164.03]);
  assert.equal(d.total, 9575.16);
  assert.equal(d.tributos.iss + d.tributos.pis + d.tributos.cofins, 0);
});

test("QA ciclo 2: Anexo III 2026 mercado interno 5ª faixa: ISS = 5% exato e PIS/COFINS pela nota", () => {
  const d = calcularDas({ pa: "2026-09", receita: 100_000, rbt12: 3_000_000, anexo: "III", mercado: "interno" });
  // efetiva 0,16812; excedente 0,11812
  assert.equal(d.tributos.iss, 5000);
  assert.equal(d.tributos.cofins, 2277.35); // 0,11812 × 19,28% × 100.000 = 2277,3536
  assert.equal(d.tributos.pis, 493.74); // 0,11812 × 4,18% = 493,7416
  assert.equal(d.total, 16811.99); // soma dos tributos arredondados um a um, como no PGDAS-D
});

test("QA ciclo 2: Anexo V 2026 e 2027 no topo da 5ª faixa não redistribuem (ISS < 5%)", () => {
  for (const pa of ["2026-12", "2027-01"]) {
    const t = tabelaVigente("V", pa);
    const f = t.faixas[4];
    const ef = aliquotaEfetiva(3_600_000, f);
    perto(ef, 0.21275);
    const p = percentuaisEfetivos(ef, f, t);
    perto(p.iss, ef * 0.235);
    assert.ok(p.iss < 0.05);
    perto(p.irpj, ef * 0.23);
  }
});

test("QA ciclo 2: virada 2026-12 -> 2027-01 no Anexo III 5ª faixa: IRPJ/CSLL/CPP iguais", () => {
  const a = calcularDas({ pa: "2026-12", receita: 100_000, rbt12: 3_000_000, anexo: "III", mercado: "externo" });
  const b = calcularDas({ pa: "2027-01", receita: 100_000, rbt12: 3_000_000, anexo: "III", mercado: "externo" });
  assert.deepEqual([a.tributos.irpj, a.tributos.csll, a.tributos.cpp], [b.tributos.irpj, b.tributos.csll, b.tributos.cpp]);
});
