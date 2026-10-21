import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TABELAS,
  TRIBUTOS,
  aliquotaEfetiva,
  calcularDas,
  centavos,
  faixaDaReceita,
  fatorR,
  inssProLabore,
  inssProLaboreDoMes,
  tributosDoDas,
  tetoInss,
  janelaDoze,
  percentuaisEfetivos,
  rbt12,
  tabelaVigente,
} from "./simples.ts";

// Receitas de exportação da empresa de referência, copiadas do extrato oficial do PGDAS-D de 09/2026.
const HISTORICO = {
  "2025-01": 19878.04, "2025-02": 28262.33, "2025-03": 25896.68, "2025-04": 27200.35, "2025-05": 43184.69,
  "2025-06": 44335.65, "2025-07": 51784.27, "2025-08": 54114.98, "2025-09": 25228.39, "2025-10": 19224.3,
  "2025-11": 27350.21, "2025-12": 24655.48, "2026-01": 21869.17, "2026-02": 25798.12, "2026-03": 37582.0,
  "2026-04": 24985.4, "2026-05": 45494.12, "2026-06": 47400.0, "2026-07": 26503.41, "2026-08": 26908.25,
  "2026-09": 23000.0,
};

test("caso real: DAS de 09/2026 = R$ 1.000,76 (Anexo III, exportação)", () => {
  const r = rbt12("2026-09", HISTORICO);
  assert.equal(r.regra, "doze-meses");
  assert.equal(centavos(r.valor), 352_998.85); // RBT12 do extrato
  const das = calcularDas({ pa: "2026-09", receita: 23_000, rbt12: r.valor, anexo: "III", mercado: "externo" });
  assert.equal(das.faixa, 2);
  assert.equal(das.tributos.irpj, 78.65);
  assert.equal(das.tributos.csll, 68.81);
  assert.equal(das.tributos.cpp, 853.3);
  assert.equal(das.total, 1000.76);
  // Na exportação não entram ISS, PIS e COFINS.
  assert.equal(das.tributos.iss + das.tributos.pis + das.tributos.cofins, 0);
});

test("partilha do site antigo continua igual (valores hipotéticos do ../fiscal)", () => {
  const das = calcularDas({ pa: "2026-09", receita: 24_519, rbt12: 294_228, anexo: "III", mercado: "externo" });
  assert.deepEqual([das.tributos.irpj, das.tributos.csll, das.tributos.cpp, das.total], [78.65, 68.81, 853.3, 1000.76]);
});

test("Anexo III, faixa 1: 6% sem dedução", () => {
  const das = calcularDas({ pa: "2026-09", receita: 10_000, rbt12: 120_000, anexo: "III", mercado: "externo" });
  assert.equal(das.faixa, 1);
  assert.equal(das.total, 305.4);
});

test("Anexo V: faixas 1 e 3 na exportação", () => {
  const f1 = calcularDas({ pa: "2026-09", receita: 10_000, rbt12: 120_000, anexo: "V", mercado: "externo" });
  assert.equal(f1.aliquotaEfetiva, 0.155);
  assert.deepEqual([f1.tributos.irpj, f1.tributos.csll, f1.tributos.cpp], [387.5, 232.5, 447.18]);
  const f3 = calcularDas({ pa: "2026-09", receita: 30_000, rbt12: 500_000, anexo: "V", mercado: "externo" });
  assert.equal(f3.faixa, 3);
  assert.deepEqual([f3.tributos.irpj, f3.tributos.csll, f3.tributos.cpp, f3.total], [1261.44, 788.4, 1253.56, 3303.4]);
});

test("mercado interno inclui ISS, PIS e COFINS", () => {
  const das = calcularDas({ pa: "2026-09", receita: 10_000, rbt12: 120_000, anexo: "III", mercado: "interno" });
  assert.equal(das.tributos.iss, 201); // 6% × 33,5%
  assert.equal(das.total, 600);
});

test("limites de faixa são inclusivos", () => {
  assert.equal(faixaDaReceita(180_000), 1);
  assert.equal(faixaDaReceita(180_000.01), 2);
  assert.equal(faixaDaReceita(360_000), 2);
  assert.equal(faixaDaReceita(1_800_000), 4);
  assert.equal(faixaDaReceita(3_600_000), 5);
  assert.equal(faixaDaReceita(3_600_000.01), 6);
  assert.throws(() => faixaDaReceita(4_800_000.01), /4,8 milhões/);
  assert.throws(() => faixaDaReceita(-1));
});

test("6ª faixa e receita inválida falham em vez de calcular errado", () => {
  assert.throws(() => calcularDas({ pa: "2026-09", receita: 1, rbt12: 3_600_000.01, anexo: "III", mercado: "externo" }), /6ª faixa/);
  assert.throws(() => calcularDas({ pa: "2026-09", receita: -1, rbt12: 100, anexo: "III", mercado: "externo" }));
  assert.throws(() => calcularDas({ pa: "2026-13", receita: 1, rbt12: 100, anexo: "III", mercado: "externo" }), /inválido/);
});

test("RBT12 zero conta como R$ 1,00: alíquota nominal da faixa 1", () => {
  const das = calcularDas({ pa: "2026-09", receita: 10_000, rbt12: 0, anexo: "III", mercado: "externo" });
  assert.equal(das.aliquotaEfetiva, 0.06);
  assert.equal(aliquotaEfetiva(0, tabelaVigente("V", "2026-09").faixas[0]), 0.155);
});

test("todas as repartições somam 100%", () => {
  for (const t of TABELAS) {
    t.faixas.forEach((f, i) => {
      const soma = TRIBUTOS.reduce((s, x) => s + (f.reparticao[x] ?? 0), 0);
      assert.ok(Math.abs(soma - 1) < 1e-9, `Anexo ${t.anexo} ${t.vigencia.de} faixa ${i + 1}: ${soma}`);
    });
    if (t.redistribuicao.percentuais) {
      const soma = Object.values(t.redistribuicao.percentuais).reduce((s, v) => s + v, 0);
      assert.ok(Math.abs(soma - 1) < 1e-9);
    }
  }
});

test("5ª faixa do Anexo III em 2026: ISS limitado a 5% e (alíquota efetiva - 5%) × percentual", () => {
  const das = calcularDas({ pa: "2026-09", receita: 100_000, rbt12: 3_000_000, anexo: "III", mercado: "externo" });
  assert.equal(das.faixa, 5);
  assert.ok(Math.abs(das.aliquotaEfetiva - 0.16812) < 1e-12);
  assert.equal(das.percentuais.iss, 0.05);
  const soma = TRIBUTOS.reduce((s, t) => s + das.percentuais[t], 0);
  assert.ok(Math.abs(soma - das.aliquotaEfetiva) < 1e-12);
  assert.deepEqual([das.tributos.irpj, das.tributos.csll, das.tributos.cpp], [711.08, 621.31, 7708.51]);
});

test("Anexo V até 2026: o ISS da 5ª faixa não passa do teto de 5%, então não há redistribuição", () => {
  const das = calcularDas({ pa: "2026-09", receita: 100_000, rbt12: 3_600_000, anexo: "V", mercado: "interno" });
  assert.equal(das.faixa, 5);
  assert.ok(das.percentuais.iss < 0.05);
  assert.ok(Math.abs(das.percentuais.irpj - das.aliquotaEfetiva * 0.23) < 1e-12);
});

test("Anexo V até 2026 sem percentuais de redistribuição: resultado igual ao dos percentuais antigos sem fonte", () => {
  const tabela = tabelaVigente("V", "2026-09");
  assert.deepEqual(tabela.redistribuicao, {});
  const antiga = { ...tabela, redistribuicao: { percentuais: { irpj: 0.3007, csll: 0.1634, cofins: 0.1843, pis: 0.0399, cpp: 0.3117 } } };
  for (let rb = 0; rb <= 3_600_000; rb += 12_345.67) {
    const faixa = tabela.faixas[faixaDaReceita(rb) - 1];
    const ef = aliquotaEfetiva(rb, faixa);
    assert.deepEqual(percentuaisEfetivos(ef, faixa, tabela), percentuaisEfetivos(ef, faixa, antiga), `RBT12 ${rb}`);
  }
  // Topo da 5ª faixa, mercado interno: ISS de 4,9996%, abaixo do teto.
  const das = calcularDas({ pa: "2026-12", receita: 100_000, rbt12: 3_600_000, anexo: "V", mercado: "interno" });
  assert.equal(das.tributos.iss, 4999.63);
  assert.equal(das.total, 21275.02); // soma dos tributos arredondados (100.000 × 21,275% = 21.275,00)
});

test("arredondamento como no PGDAS-D: cada tributo ao centavo e total = soma (exemplos do manual)", () => {
  // Manual do PGDAS-D 2018 v4, exemplo 4: Anexo III, 3ª faixa, RBT12 500.000, RPA 10.000.
  const iii = calcularDas({ pa: "2018-07", receita: 10_000, rbt12: 500_000, anexo: "III", mercado: "interno" });
  assert.deepEqual(
    [iii.tributos.irpj, iii.tributos.csll, iii.tributos.cofins, iii.tributos.pis, iii.tributos.cpp, iii.tributos.iss],
    [39.89, 34.9, 136.02, 29.52, 432.78, 324.09],
  );
  assert.equal(iii.total, 997.2);
  // Exemplo 5: Anexo V, 3ª faixa, mesmos valores.
  const v = calcularDas({ pa: "2018-07", receita: 10_000, rbt12: 500_000, anexo: "V", mercado: "interno" });
  assert.deepEqual(
    [v.tributos.irpj, v.tributos.csll, v.tributos.cofins, v.tributos.pis, v.tributos.cpp, v.tributos.iss],
    [420.48, 262.8, 261.4, 56.59, 417.85, 332.88],
  );
  assert.equal(v.total, 1752);
});

test("arredondamento: casos em que receita × alíquota daria 1 centavo de diferença usam a soma dos tributos", () => {
  const soma = (d: ReturnType<typeof calcularDas>) => centavos(TRIBUTOS.reduce((s, t) => s + d.tributos[t], 0));
  // Caso real de 09/2026: o extrato traz 1.000,76 (soma); receita × alíquota paga daria 1.000,77.
  const real = calcularDas({ pa: "2026-09", receita: 23_000, rbt12: 352_998.85, anexo: "III", mercado: "externo" });
  assert.equal(centavos(23_000 * real.aliquotaPaga), 1000.77);
  assert.equal(real.total, 1000.76);
  // Mercado interno, 5ª faixa do Anexo III com ISS no teto: soma 16.811,99 contra 16.812,00.
  const quinta = calcularDas({ pa: "2026-09", receita: 100_000, rbt12: 3_000_000, anexo: "III", mercado: "interno" });
  assert.equal(centavos(100_000 * quinta.aliquotaPaga), 16812);
  assert.equal(quinta.total, 16811.99);
  assert.equal(quinta.total, soma(quinta));
  // 2027 (com CBS e IBS), diferença para o outro lado: soma 920,50 contra 920,49.
  const n2027 = calcularDas({ pa: "2027-02", receita: 12_345.67, rbt12: 250_000, anexo: "III", mercado: "interno" });
  assert.equal(centavos(12_345.67 * n2027.aliquotaPaga), 920.49);
  assert.equal(n2027.total, 920.5);
  // O mesmo método em todos os anexos, faixas 1 a 5, mercados e tabelas.
  for (const pa of ["2026-09", "2027-09"]) {
    for (const anexo of ["III", "V"] as const) {
      for (const mercado of ["interno", "externo"] as const) {
        for (let rb = 0; rb <= 3_600_000; rb += 97_531.13) {
          const receita = 1_234.565 + rb / 37;
          const d = calcularDas({ pa, receita, rbt12: rb, anexo, mercado });
          const fora = mercado === "externo" ? ["iss", "pis", "cofins", "cbs", "ibs"] : [];
          for (const t of TRIBUTOS) assert.equal(d.tributos[t], fora.includes(t) ? 0 : centavos(receita * d.percentuais[t]));
          assert.equal(d.total, soma(d));
        }
      }
    }
  }
});

test("5ª faixa do Anexo III em 2027: (alíquota efetiva - 5%) × percentual", () => {
  const das = calcularDas({ pa: "2027-03", receita: 100_000, rbt12: 3_000_000, anexo: "III", mercado: "externo" });
  assert.deepEqual([das.tributos.irpj, das.tributos.csll, das.tributos.cpp], [711.08, 621.31, 7708.51]);
  assert.equal(das.tributos.cbs + das.tributos.ibs, 0); // exportação
});

test("tabelas: vigência por PA e ano sem tabela cadastrada", () => {
  assert.equal(tabelaVigente("III", "2026-12").vigencia.ate, "2026-12");
  assert.equal(tabelaVigente("III", "2027-01").faixas[5].aliquota, 0.329);
  assert.equal(tabelaVigente("V", "2028-12").faixas[5].aliquota, 0.304);
  assert.throws(() => tabelaVigente("III", "2029-01"), /não cadastrada/);
});

test("2027: a partilha do IRPJ, CSLL e CPP na faixa 2 não muda para a exportação", () => {
  const antes = calcularDas({ pa: "2026-12", receita: 23_000, rbt12: 352_998.85, anexo: "III", mercado: "externo" });
  const depois = calcularDas({ pa: "2027-01", receita: 23_000, rbt12: 352_998.85, anexo: "III", mercado: "externo" });
  assert.equal(depois.total, antes.total);
});

test("janela da RBT12: 12 meses anteriores até 2026 e antecedentes ao mês anterior a partir de 2027", () => {
  assert.deepEqual([janelaDoze("2026-12")[0], janelaDoze("2026-12")[11]], ["2025-12", "2026-11"]);
  // Virada de ano: o PA 01/2027 usa a mesma janela do PA 12/2026.
  assert.deepEqual(janelaDoze("2027-01"), janelaDoze("2026-12"));
  assert.deepEqual([janelaDoze("2027-02")[0], janelaDoze("2027-02")[11]], ["2026-01", "2026-12"]);
  assert.equal(rbt12("2027-01", { "2026-12": 1_000, "2026-11": 500, "2025-11": 9_999 }).valor, 500);
});

test("RBT12 no início de atividade (regra até 2026)", () => {
  const receitas = { "2026-03": 10_000, "2026-04": 20_000, "2026-05": 30_000 };
  assert.deepEqual(rbt12("2026-03", receitas, "2026-03"), { valor: 120_000, meses: ["2026-03"], regra: "inicio-mes-x12" });
  const terceiro = rbt12("2026-05", receitas, "2026-03");
  assert.equal(terceiro.regra, "inicio-media-x12");
  assert.equal(terceiro.valor, 180_000); // média de 10 e 20 mil × 12
  // 13º mês de atividade: volta aos 12 meses anteriores.
  assert.equal(rbt12("2026-12", receitas, "2025-12").regra, "doze-meses");
  assert.equal(rbt12("2026-11", receitas, "2025-12").regra, "inicio-media-x12");
  assert.throws(() => rbt12("2026-02", receitas, "2026-03"), /anterior ao início/);
  // Começou em 03/2026 e o PA já é de 2027: vale a regra nova (média até o 13º mês de atividade).
  const transicao = rbt12("2027-03", receitas, "2026-03");
  assert.equal(transicao.regra, "inicio-media-x12");
  assert.equal(transicao.meses.at(-1), "2027-01");
  assert.equal(rbt12("2027-04", receitas, "2026-03").regra, "doze-meses");
});

test("RBT12 no início de atividade (regra a partir de 2027)", () => {
  const receitas = { "2027-01": 10_000, "2027-02": 20_000, "2027-03": 30_000 };
  assert.equal(rbt12("2027-01", receitas, "2027-01").regra, "inicio-primeira-faixa");
  assert.equal(rbt12("2027-02", receitas, "2027-01").valor, 0);
  const terceiro = rbt12("2027-03", receitas, "2027-01");
  assert.deepEqual(terceiro, { valor: 120_000, meses: ["2027-01"], regra: "inicio-media-x12" });
  assert.equal(rbt12("2028-01", receitas, "2027-01").regra, "inicio-media-x12"); // 13º mês
  assert.equal(rbt12("2028-02", receitas, "2027-01").regra, "doze-meses"); // 14º mês
});

test("Fator R: 28% exato fica no Anexo III; abaixo vai para o V", () => {
  const meses = janelaDoze("2026-09");
  const receitas = Object.fromEntries(meses.map((m) => [m, 10_000]));
  const folha = (valor: number) => Object.fromEntries(meses.map((m) => [m, valor]));
  const exato = fatorR("2026-09", folha(2_800), receitas);
  assert.equal(exato.anexo, "III");
  assert.equal(centavos(exato.valor * 100), 28);
  assert.equal(fatorR("2026-09", folha(2_799.99), receitas).anexo, "V");
  // Centavos que, em ponto flutuante, dariam 0,27999...: 98.840,00 / 353.000,00 = 0,28.
  assert.equal(fatorR("2026-09", { "2026-01": 98_840 }, { "2026-01": 353_000 }).anexo, "III");
});

test("Fator R: casos de zero do art. 26", () => {
  assert.deepEqual([fatorR("2026-09", {}, {}).valor, fatorR("2026-09", {}, {}).anexo], [0.01, "V"]);
  assert.deepEqual([fatorR("2026-09", { "2026-01": 1 }, {}).valor, fatorR("2026-09", { "2026-01": 1 }, {}).anexo], [0.28, "III"]);
  assert.equal(fatorR("2026-09", {}, { "2026-01": 1 }).valor, 0.01);
  // Mês de início (até 2026): folha e receita do próprio PA.
  assert.equal(fatorR("2026-05", { "2026-05": 3_000 }, { "2026-05": 10_000 }, "2026-05").anexo, "III");
  assert.equal(fatorR("2026-05", {}, { "2026-05": 10_000 }, "2026-05").valor, 0.01);
  // A partir de 2027: os 2 primeiros meses são 0,28.
  assert.equal(fatorR("2027-02", {}, { "2027-02": 10_000 }, "2027-01").valor, 0.28);
  assert.equal(fatorR("2027-03", {}, { "2027-01": 10_000 }, "2027-01").valor, 0.01);
});

test("Fator R a partir de 2027 usa a janela que termina no mês antes do anterior", () => {
  // Folha só em 2026-12 (fora da janela do PA 01/2027) e receita na janela.
  const r = fatorR("2027-01", { "2026-12": 50_000 }, { "2026-11": 10_000 });
  assert.equal(r.folha, 0);
  assert.equal(r.anexo, "V");
});

test("INSS do pró-labore bate com o DARF de 09/2026 e respeita o teto", () => {
  assert.equal(inssProLabore(1621), 178.31);
  assert.equal(inssProLabore(10_000, 8_000), 880);
  assert.throws(() => inssProLabore(-1));
});

test("INSS do pró-labore no teto do ano (2026: R$ 8.475,55 -> R$ 932,31)", () => {
  assert.equal(tetoInss("2026-09"), 8_475.55);
  assert.equal(tetoInss("2025-01"), 8_157.41);
  assert.equal(tetoInss("2030-01"), 8_475.55); // ano sem portaria na tabela: o último publicado
  assert.equal(tetoInss("2010-01"), 5_531.31); // antes da tabela: o mais antigo
  assert.equal(inssProLaboreDoMes("2026-09", 20_000), 932.31);
  assert.equal(inssProLaboreDoMes("2026-09", 8_475.55), 932.31);
  assert.equal(inssProLaboreDoMes("2026-09", 1_621), 178.31); // caso real do DARF de 09/2026, abaixo do teto
  assert.equal(inssProLaboreDoMes("2025-12", 20_000), 897.32); // teto de 2025
});

test("tributos do DAS pelo percentual: exportação sem ISS, PIS e COFINS, também com receita zero", () => {
  const com = calcularDas({ pa: "2026-09", receita: 23_000, rbt12: 352_998.85, anexo: "III", mercado: "externo" });
  const zero = calcularDas({ pa: "2026-09", receita: 0, rbt12: 0, anexo: "III", mercado: "externo" });
  assert.deepEqual(tributosDoDas(com), ["irpj", "csll", "cpp"]);
  assert.deepEqual(tributosDoDas(zero), ["irpj", "csll", "cpp"]);
  assert.equal(zero.total, 0);
  assert.ok(tributosDoDas(calcularDas({ pa: "2026-09", receita: 1, rbt12: 0, anexo: "III", mercado: "interno" })).includes("iss"));
});
