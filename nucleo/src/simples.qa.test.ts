// Testes do QA (Parte 1): casos de borda do Simples Nacional, Fator R e regras por CNAE.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TRIBUTOS, calcularDas, centavos, faixaDaReceita, fatorR, inssProLabore, janelaDoze, rbt12 } from "./simples.ts";
import { anexoDaAtividade, idAtividadeExportacao, normalizarCnae, regraDoCnae } from "./cnae.ts";

test("QA: 5ª faixa do Anexo III até 2026 segue a nota (*) da LC 123/CGSN 140: (alíquota efetiva - 5%) × percentual", () => {
  // Nota do Anexo III vigente em 2026: com alíquota efetiva > 14,92537%, IRPJ = (efetiva - 5%) × 6,02%,
  // CSLL = (efetiva - 5%) × 5,26%, CPP = (efetiva - 5%) × 65,26%, ISS fixo em 5%.
  const das = calcularDas({ pa: "2026-09", receita: 100_000, rbt12: 3_000_000, anexo: "III", mercado: "externo" });
  const ef = das.aliquotaEfetiva;
  assert.ok(Math.abs(das.percentuais.irpj - (ef - 0.05) * 0.0602) < 1e-12, `IRPJ ${das.percentuais.irpj} != ${(ef - 0.05) * 0.0602}`);
  assert.deepEqual([das.tributos.irpj, das.tributos.csll, das.tributos.cpp], [711.08, 621.31, 7708.51]);
});

test("QA: 5ª faixa do Anexo III logo abaixo do gatilho de 14,92537% não redistribui", () => {
  // efetiva = 21% - 125.640/RBT12; 14,92537% => RBT12 ≈ 2.068.148,15
  const das = calcularDas({ pa: "2026-09", receita: 10_000, rbt12: 2_068_000, anexo: "III", mercado: "interno" });
  assert.ok(das.percentuais.iss < 0.05);
  assert.ok(Math.abs(das.percentuais.irpj - das.aliquotaEfetiva * 0.04) < 1e-15);
});

test("QA: Fator R exatamente 28% fica no Anexo III; 27,99% vai para o V", () => {
  const receitas: Record<string, number> = {};
  const folhas: Record<string, number> = {};
  for (const m of janelaDoze("2026-09")) { receitas[m] = 29_416.57; folhas[m] = 0; }
  // receita 12 × 29.416,57 = 352.998,84; 28% = 98.839,6752 -> folha 98.839,68 atinge, 98.839,67 não
  const meses = janelaDoze("2026-09");
  folhas[meses[0]] = 98_839.68;
  assert.equal(fatorR("2026-09", folhas, receitas).anexo, "III");
  folhas[meses[0]] = 98_839.67;
  assert.equal(fatorR("2026-09", folhas, receitas).anexo, "V");
  // 28% redondo, com valores que dão resíduo em ponto flutuante
  assert.equal(fatorR("2026-09", { [meses[3]]: 0.28 * 3 }, { [meses[3]]: 3 }).anexo, "III");
  assert.equal(fatorR("2026-09", { [meses[3]]: 28_000 }, { [meses[3]]: 100_000 }).anexo, "III");
  assert.equal(fatorR("2026-09", { [meses[3]]: 27_999.99 }, { [meses[3]]: 100_000 }).anexo, "V");
});

test("QA: Fator R com zeros (art. 26, § 7º)", () => {
  assert.deepEqual([fatorR("2026-09", {}, {}).valor, fatorR("2026-09", {}, {}).anexo], [0.01, "V"]);
  const soFolha = fatorR("2026-09", { "2026-01": 1000 }, {});
  assert.deepEqual([soFolha.valor, soFolha.anexo], [0.28, "III"]);
  assert.equal(fatorR("2026-09", {}, { "2026-01": 1000 }).anexo, "V");
});

test("QA: Fator R ignora o próprio PA e meses fora da janela (virada de ano)", () => {
  const r = fatorR("2027-01", { "2027-01": 999_999, "2026-12": 999_999, "2026-11": 100 }, { "2026-11": 1000, "2026-12": 1 });
  // janela de 01/2027 = 12/2025..11/2026: folha 100, receita 1000
  assert.equal(r.folha, 100);
  assert.equal(r.receita, 1000);
  assert.equal(r.anexo, "V");
  const r2 = fatorR("2026-01", { "2025-12": 300 }, { "2025-12": 1000, "2025-01": 1, "2024-12": 50 });
  assert.equal(r2.receita, 1001);
});

test("QA: valores negativos ou NaN no histórico são recusados", () => {
  assert.throws(() => rbt12("2026-09", { "2026-01": -1 }), /inválido/);
  assert.throws(() => rbt12("2026-09", { "2026-01": NaN }), /inválido/);
  assert.throws(() => fatorR("2026-09", { "2026-01": -5 }, {}), /inválido/);
  assert.throws(() => calcularDas({ pa: "2026-09", receita: NaN, rbt12: 1, anexo: "III", mercado: "externo" }));
  assert.throws(() => faixaDaReceita(NaN));
});

test("QA: receita zero dá DAS zero; centavos arredondam meio para cima", () => {
  const das = calcularDas({ pa: "2026-09", receita: 0, rbt12: 352_998.85, anexo: "III", mercado: "externo" });
  assert.equal(das.total, 0);
  assert.equal(centavos(447.175), 447.18);
  assert.equal(centavos(1.005), 1.01);
  assert.equal(centavos(0.125), 0.13);
});

test("QA: total do DAS é a soma dos tributos arredondados", () => {
  for (const rb of [10_000, 180_000, 180_000.01, 352_998.85, 720_000, 1_800_000, 2_500_000, 3_600_000]) {
    for (const anexo of ["III", "V"] as const) {
      const das = calcularDas({ pa: "2026-09", receita: 12_345.67, rbt12: rb, anexo, mercado: "interno" });
      assert.equal(das.total, centavos(TRIBUTOS.reduce((s, t) => s + das.tributos[t], 0)));
      assert.ok(Math.abs(das.aliquotaPaga - das.aliquotaEfetiva) < 1e-12, `${anexo} ${rb}`);
    }
  }
});

test("QA: faixa 1 no limite exato e alíquota efetiva contínua entre faixas", () => {
  const f1 = calcularDas({ pa: "2026-09", receita: 1000, rbt12: 180_000, anexo: "III", mercado: "externo" });
  const f2 = calcularDas({ pa: "2026-09", receita: 1000, rbt12: 180_000.01, anexo: "III", mercado: "externo" });
  assert.equal(f1.faixa, 1);
  assert.equal(f2.faixa, 2);
  assert.ok(Math.abs(f1.aliquotaEfetiva - f2.aliquotaEfetiva) < 1e-6);
});

test("QA: INSS do pró-labore", () => {
  assert.equal(inssProLabore(0), 0);
  assert.equal(inssProLabore(10_000, 8_157.41), centavos(8_157.41 * 0.11));
  assert.throws(() => inssProLabore(-1));
});

test("QA: CNAE em formatos variados e casos não atendidos", () => {
  assert.equal(regraDoCnae("6209-1/00").tributacao, "anexo-fixo");
  assert.equal(regraDoCnae(6209100).anexo, "III");
  assert.equal(regraDoCnae("6201-5/01").tributacao, "fator-r");
  assert.equal(regraDoCnae("4751-2/01").tributacao, "nao-atendido");
  assert.equal(normalizarCnae(111301), "0111301");
  assert.throws(() => regraDoCnae("62091000"), /inválido/);
  assert.throws(() => anexoDaAtividade(regraDoCnae("6201501")), /Fator R/);
  assert.throws(() => anexoDaAtividade(regraDoCnae("4751201")), /não atendido/);
  const fr = fatorR("2026-09", { "2026-01": 28_000 }, { "2026-01": 100_000 });
  assert.equal(anexoDaAtividade(regraDoCnae("6201501"), fr), "III");
  assert.equal(idAtividadeExportacao(regraDoCnae("6209100")), 30);
  assert.equal(idAtividadeExportacao(regraDoCnae("6204000")), 29); // catálogo do Serpro: exterior, sujeitos ao fator r
});

test("QA: RBT12 início de atividade em 2027 (1º e 2º mês na primeira faixa)", () => {
  const r = rbt12("2027-02", { "2027-01": 500_000 }, "2027-01");
  assert.equal(r.regra, "inicio-primeira-faixa");
  const das = calcularDas({ pa: "2027-02", receita: 10_000, rbt12: r.valor, anexo: "III", mercado: "externo" });
  assert.equal(das.faixa, 1);
  const r3 = rbt12("2027-03", { "2027-01": 30_000 }, "2027-01");
  assert.equal(r3.valor, 360_000);
});
