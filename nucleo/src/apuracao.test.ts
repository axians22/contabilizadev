import { test } from "node:test";
import assert from "node:assert/strict";
import { apurar, FAIXA_ATENCAO_FATOR_R, naFaixaDeAtencao, sugestaoFatorR } from "./apuracao.ts";
import { regraDoCnae } from "./cnae.ts";
import { calcularDas } from "./simples.ts";

// Receitas de exportação de 09/2025 a 08/2026 da empresa de referência (item 2.2 do extrato real de 09/2026): somam a
// RBT12 de R$ 352.998,85 do extrato.
const RECEITAS_REAIS = {
  "2025-09": 25_228.39, "2025-10": 19_224.3, "2025-11": 27_350.21, "2025-12": 24_655.48, "2026-01": 21_869.17, "2026-02": 25_798.12,
  "2026-03": 37_582, "2026-04": 24_985.4, "2026-05": 45_494.12, "2026-06": 47_400, "2026-07": 26_503.41, "2026-08": 26_908.25,
};
const SUPORTE = regraDoCnae("6209100"); // Anexo III fixo (atividade 30)
const DESENVOLVIMENTO = regraDoCnae("6201501"); // Fator R (atividade 29)

test("caso real: DAS de 09/2026 = R$ 1.000,76 no Anexo III, exportação (atividade 30)", () => {
  const a = apurar({ pa: "2026-09", receita: 23_000, receitas: RECEITAS_REAIS, folhas: {}, regra: SUPORTE });
  assert.equal(a.rbt12.valor, 352_998.85);
  assert.equal(a.anexo, "III");
  assert.equal(a.idAtividade, 30);
  assert.equal(a.fatorR, null);
  assert.equal(a.das.total, 1000.76);
  assert.deepEqual([a.das.tributos.irpj, a.das.tributos.csll, a.das.tributos.cpp], [78.65, 68.81, 853.3]);
  assert.deepEqual(a.mesesSemReceita, []);
  assert.deepEqual(a.folhasDaDeclaracao, {});
});

test("Fator R: com folha de 28% fica no Anexo III (atividade 29), abaixo cai no V; folha da declaração nos 12 meses", () => {
  const folhaIII = Object.fromEntries(Object.entries(RECEITAS_REAIS).map(([m, v]) => [m, Math.ceil(v * 28) / 100]));
  const iii = apurar({ pa: "2026-09", receita: 23_000, receitas: RECEITAS_REAIS, folhas: folhaIII, regra: DESENVOLVIMENTO });
  assert.equal(iii.anexo, "III");
  assert.equal(iii.idAtividade, 29);
  assert.equal(iii.das.total, 1000.76);
  assert.equal(Object.keys(iii.folhasDaDeclaracao).length, 12);
  assert.ok(iii.fatorR!.valor >= 0.28);

  const v = apurar({ pa: "2026-09", receita: 23_000, receitas: RECEITAS_REAIS, folhas: { "2026-08": 1_518 }, regra: DESENVOLVIMENTO });
  assert.equal(v.anexo, "V");
  assert.equal(v.das.total, calcularDas({ pa: "2026-09", receita: 23_000, rbt12: 352_998.85, anexo: "V", mercado: "externo" }).total);
  assert.equal(v.folhasDaDeclaracao["2026-08"], 1_518);
  assert.equal(v.folhasDaDeclaracao["2025-09"], 0);
});

test("meses sem receita conhecida aparecem para o aviso de histórico incompleto (contados como zero)", () => {
  const { "2025-09": _fora, ...semSetembro } = RECEITAS_REAIS;
  void _fora;
  const a = apurar({ pa: "2026-09", receita: 23_000, receitas: semSetembro, folhas: {}, regra: SUPORTE });
  assert.deepEqual(a.mesesSemReceita, ["2025-09"]);
  assert.equal(a.rbt12.valor, Math.round((352_998.85 - 25_228.39) * 100) / 100);
});

test("início de atividade dentro da janela usa a regra de começo; antes, a janela cheia; PA antes do início é erro", () => {
  const novo = apurar({ pa: "2026-09", receita: 10_000, receitas: { "2026-07": 8_000, "2026-08": 12_000 }, folhas: {}, regra: SUPORTE, inicioAtividade: "2026-07" });
  assert.equal(novo.rbt12.regra, "inicio-media-x12");
  assert.equal(novo.rbt12.valor, 120_000);
  assert.deepEqual(novo.mesesSemReceita, []);
  const antigo = apurar({ pa: "2026-09", receita: 23_000, receitas: RECEITAS_REAIS, folhas: {}, regra: SUPORTE, inicioAtividade: "2021-08" });
  assert.equal(antigo.rbt12.regra, "doze-meses");
  assert.throws(() => apurar({ pa: "2026-06", receita: 1, receitas: {}, folhas: {}, regra: SUPORTE, inicioAtividade: "2026-07" }), /anterior ao início/);
  assert.throws(() => apurar({ pa: "2026-09", receita: 1, receitas: {}, folhas: {}, regra: regraDoCnae("4711302") }), /não atendido/);
});

test("faixa de atenção: de 25% (inclusive) a 30% (exclusive)", () => {
  assert.deepEqual(FAIXA_ATENCAO_FATOR_R, { de: 0.25, ate: 0.3 });
  assert.equal(naFaixaDeAtencao(0.2499), false);
  assert.equal(naFaixaDeAtencao(0.25), true);
  assert.equal(naFaixaDeAtencao(0.2799), true);
  assert.equal(naFaixaDeAtencao(0.2999), true);
  assert.equal(naFaixaDeAtencao(0.3), false);
});

// 12 meses de R$ 25.000 (RBT12 de R$ 300 mil, 2ª faixa) e folha de R$ 6.750 por mês: Fator R 27%.
const MESES = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const RECEITAS = Object.fromEntries(MESES.map((m) => [m, 25_000]));
const FOLHAS = Object.fromEntries(MESES.map((m) => [m, 6_750]));

test("sugestão de pró-labore: PA afetado é o do mês seguinte (até 2026); pró-labore para 28% exato e a economia", () => {
  const s = sugestaoFatorR({ mesAtual: "2026-10", receitas: RECEITAS, folhas: FOLHAS, regra: DESENVOLVIMENTO, proLaboreAtual: 6_750 })!;
  assert.equal(s.paAfetado, "2026-11");
  assert.equal(s.receitaPrevista, 25_000);
  assert.equal(s.anexo, "V");
  assert.ok(Math.abs(s.fatorR - 0.27) < 1e-9);
  assert.equal(s.emAtencao, true);
  // Janela do PA 11/2026: 11/2025 a 10/2026; receita 300.000 → folha mínima 84.000; 11 meses × 6.750 = 74.250.
  assert.equal(s.proLaboreSugerido, 9_750);
  assert.equal(s.aumento, 3_000);
  // INSS a mais: 11% até o teto de 2026 (R$ 8.475,55 → 932,31) menos 11% de 6.750 (742,50); sem teto seriam 330.
  assert.equal(s.custoInss, 189.81);
  const iii = calcularDas({ pa: "2026-11", receita: 25_000, rbt12: 300_000, anexo: "III", mercado: "externo" }).total;
  const v = calcularDas({ pa: "2026-11", receita: 25_000, rbt12: 300_000, anexo: "V", mercado: "externo" }).total;
  assert.deepEqual([s.dasAnexoIII, s.dasAnexoV], [iii, v]);
  assert.equal(s.economia, Math.round((v - iii - 189.81) * 100) / 100);
  assert.ok(s.economia > 0);

  // Com o sugerido, o PA afetado fica no Anexo III (28% exato não cai no V).
  const depois = sugestaoFatorR({ mesAtual: "2026-10", receitas: RECEITAS, folhas: FOLHAS, regra: DESENVOLVIMENTO, proLaboreAtual: 9_750 })!;
  assert.equal(depois.anexo, "III");
  assert.equal(depois.aumento, 0);
  assert.equal(depois.economia, 0);
  assert.equal(depois.emAtencao, true); // 28%: no III, mas com margem pequena
  const umCentavoAMenos = sugestaoFatorR({ mesAtual: "2026-10", receitas: RECEITAS, folhas: FOLHAS, regra: DESENVOLVIMENTO, proLaboreAtual: 9_749.99 })!;
  assert.equal(umCentavoAMenos.anexo, "V");
  assert.equal(umCentavoAMenos.aumento, 0.01);
});

test("sugestão: a partir de 2027 a folha do mês atual entra no PA de dois meses à frente (CGSN 190/2026)", () => {
  const meses = Array.from({ length: 13 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`).slice(0, 12).concat("2027-01");
  const receitas = Object.fromEntries(meses.map((m) => [m, 25_000]));
  const s = sugestaoFatorR({ mesAtual: "2027-02", receitas, folhas: {}, regra: DESENVOLVIMENTO, proLaboreAtual: 0 })!;
  assert.equal(s.paAfetado, "2027-04");
});

test("sugestão: nada para atividade sem Fator R, sem receita para prever ou no começo de atividade", () => {
  assert.equal(sugestaoFatorR({ mesAtual: "2026-10", receitas: RECEITAS, folhas: FOLHAS, regra: SUPORTE, proLaboreAtual: 1 }), null);
  assert.equal(sugestaoFatorR({ mesAtual: "2026-10", receitas: {}, folhas: {}, regra: DESENVOLVIMENTO, proLaboreAtual: 1 }), null);
  assert.equal(sugestaoFatorR({ mesAtual: "2026-10", receitas: { "2026-10": 1 }, folhas: {}, regra: DESENVOLVIMENTO, proLaboreAtual: 1, inicioAtividade: "2026-10" }), null);
  // Receita prevista informada vale sobre a do último mês.
  const s = sugestaoFatorR({ mesAtual: "2026-10", receitas: RECEITAS, folhas: FOLHAS, regra: DESENVOLVIMENTO, proLaboreAtual: 6_750, receitaPrevista: 30_000 })!;
  assert.equal(s.receitaPrevista, 30_000);
  assert.ok(s.proLaboreSugerido > 9_750);
});
