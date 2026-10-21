// Testes do QA (Parte 1, rodada de correções): catálogo de atividades do PGDAS-D, folhasSalario, feriados,
// vencimento, Anexo V sem percentuais e arredondamento.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REGRAS_CNAE, idAtividadeExportacao, idAtividadeInterno, regraDoCnae } from "./cnae.ts";
import { ATIVIDADES_PGDASD, atividadePgdasd, sujeitaAoFatorR } from "./serpro/atividades-pgdasd.ts";
import { dadosDeclaracao, folhasDaDeclaracao } from "./serpro/pgdasd.ts";
import { feriadosNacionais, pascoa, diaUtil } from "./feriados.ts";
import { vencimento } from "./meses.ts";
import { TABELAS, TRIBUTOS, calcularDas, centavos, fatorR } from "./simples.ts";

const CNPJ = "12345678000195";

test("QA: idAtividadeExportacao = 29 para 6201-6204 e 30 para 6209/6311/6319, sem erro", () => {
  for (const r of REGRAS_CNAE) {
    const esperado = r.tributacao === "fator-r" ? 29 : 30;
    assert.equal(idAtividadeExportacao(r), esperado, r.cnae);
  }
  assert.throws(() => idAtividadeExportacao(regraDoCnae("4781400")), /não atendido/);
  assert.throws(() => idAtividadeInterno(regraDoCnae("4781400"), "proprio-municipio"), /não atendido/);
});

test("QA: catálogo confere com a página oficial do Serpro nos códigos de serviço (9 a 18 e 28 a 31)", () => {
  assert.equal(ATIVIDADES_PGDASD.length, 43);
  assert.deepEqual(ATIVIDADES_PGDASD.map((a) => a.id), Array.from({ length: 43 }, (_, i) => i + 1));
  assert.match(atividadePgdasd(29).grupo, /para o exterior/);
  assert.match(atividadePgdasd(29).descricao, /Sujeitos ao fator "r"/);
  assert.match(atividadePgdasd(30).descricao, /Não sujeitos ao fator "r" e tributados pelo Anexo III/);
  assert.match(atividadePgdasd(31).descricao, /Anexo IV/);
  assert.match(atividadePgdasd(28).descricao, /contábeis/);
  assert.match(atividadePgdasd(10).descricao, /outro\(s\) Município/);
  assert.match(atividadePgdasd(11).descricao, /próprio Município/);
  assert.match(atividadePgdasd(12).descricao, /com retenção/);
  assert.deepEqual(ATIVIDADES_PGDASD.filter((a) => a.fatorR).map((a) => a.id), [10, 11, 12, 29]);
  assert.equal(sujeitaAoFatorR(30), false);
  assert.throws(() => atividadePgdasd(44), /não existe/);
  assert.throws(() => atividadePgdasd(0), /não existe/);
});

test("QA: atividade 30 não manda folhasSalario; atividade 29 manda 12 meses na ordem e em centavos", () => {
  const d30 = dadosDeclaracao({ cnpj: CNPJ, pa: "2026-09", receitaExterna: 1000, idAtividade: 30, folhasSalario: { "2026-08": 1 }, transmitir: false, retificadora: false });
  assert.equal("folhasSalario" in d30.declaracao, false);
  const folhas = { "2025-09": 1000.005, "2026-08": 2000.1, "2026-09": 999 }; // 2026-09 é o próprio PA: fora da FS12
  const lista = folhasDaDeclaracao("2026-09", folhas);
  assert.deepEqual(lista.map((f) => f.pa), [202509, 202510, 202511, 202512, 202601, 202602, 202603, 202604, 202605, 202606, 202607, 202608]);
  assert.equal(lista[0].valor, 1000.01);
  assert.equal(lista[11].valor, 2000.1);
  assert.throws(() => folhasDaDeclaracao("2026-09", { "2026-01": -1 }), /inválido/);
  assert.throws(() => folhasDaDeclaracao("2026-09", { "2026-01": Number.NaN }), /inválido/);
  // Virada de ano no PA de janeiro (regra até 2026): 12 meses do ano anterior, como no exemplo oficial (PA 202101).
  assert.deepEqual(folhasDaDeclaracao("2026-01", {}).map((f) => f.pa)[0], 202501);
  assert.deepEqual(folhasDaDeclaracao("2026-01", {}).map((f) => f.pa)[11], 202512);
});

test("QA: mês de abertura com atividade 29 manda a folha do próprio PA (FSPA), usada pelo PGDAS-D no fator r", () => {
  // Manual do PGDAS-D 2018 v4, 8.2.1: "Para o cálculo do fator r do mês de abertura da empresa será considerada a
  // folha de salários do PA (FSPA) e a receita bruta do PA (RPA)". O núcleo calcula Anexo III com a FSPA, mas a
  // declaração só leva os 12 meses anteriores (todos zero numa empresa nova): o PGDAS-D daria fator r 0,01 (Anexo V).
  const pa = "2026-09";
  const folhas = { [pa]: 5_000 };
  const receitas = { [pa]: 10_000 };
  assert.equal(fatorR(pa, folhas, receitas, pa).anexo, "III");
  const d = dadosDeclaracao({ cnpj: CNPJ, pa, receitaExterna: 10_000, idAtividade: 29, folhasSalario: folhas, inicioAtividade: pa, transmitir: false, retificadora: false });
  const doPa = d.declaracao.folhasSalario?.find((f) => f.pa === 202609);
  assert.ok(doPa && doPa.valor === 5_000, `folhasSalario sem a folha do PA de abertura: ${JSON.stringify(d.declaracao.folhasSalario)}`);
});

test("QA: Páscoa e feriados móveis conferem com datas conhecidas", () => {
  const conhecidas: Record<number, string> = {
    2019: "2019-04-21", 2023: "2023-04-09", 2024: "2024-03-31", 2025: "2025-04-20", 2026: "2026-04-05",
    2027: "2027-03-28", 2030: "2030-04-21", 2038: "2038-04-25", 2008: "2008-03-23",
  };
  for (const [ano, data] of Object.entries(conhecidas)) assert.equal(pascoa(Number(ano)), data, ano);
  const f2026 = feriadosNacionais(2026).map((f) => f.data);
  for (const d of ["2026-02-16", "2026-02-17", "2026-04-03", "2026-06-04", "2026-11-20", "2026-01-01", "2026-12-25"]) {
    assert.ok(f2026.includes(d), d);
  }
  assert.equal(f2026.includes("2026-02-18"), false); // Quarta-feira de Cinzas tem expediente
  assert.equal(feriadosNacionais(2023).some((f) => f.data === "2023-11-20"), false);
  assert.equal(diaUtil("2026-10-12"), false);
  assert.equal(diaUtil("2026-10-13"), true);
});

test("QA: vencimento antecipado em datas reais (feriados móveis no dia 20, virada de ano, feriado extra)", () => {
  assert.equal(vencimento("2030-05"), "2030-06-19"); // Corpus Christi 20/06/2030 (quinta)
  assert.equal(vencimento("2007-01"), "2007-02-16"); // Carnaval 19 e 20/02/2007 + fim de semana
  assert.equal(vencimento("2025-10"), "2025-11-19"); // 20/11/2025 (quinta), Consciência Negra
  assert.equal(vencimento("2026-12"), "2027-01-20"); // virada de ano, quarta útil
  assert.equal(vencimento("2026-02"), "2026-03-20"); // sexta útil
  assert.equal(vencimento("2026-02", ["2026-03-20", "2026-03-19"]), "2026-03-18");
  assert.equal(vencimento("2025-03"), "2025-04-17");
  assert.equal(vencimento("2026-09"), "2026-10-20");
});

test("QA: Anexo V até 2026 sem percentuais de redistribuição e ISS nunca acima de 5%", () => {
  const v = TABELAS.find((t) => t.anexo === "V" && t.vigencia.ate === "2026-12")!;
  assert.deepEqual(v.redistribuicao, {});
  for (const rbt of [1_800_000.01, 2_500_000, 3_600_000]) {
    const das = calcularDas({ pa: "2026-09", receita: 50_000, rbt12: rbt, anexo: "V", mercado: "interno" });
    assert.ok(das.percentuais.iss <= 0.05);
    assert.ok(Math.abs(TRIBUTOS.reduce((s, t) => s + das.percentuais[t], 0) - das.aliquotaEfetiva) < 1e-12);
  }
});

test("QA: total do DAS é sempre a soma exata dos tributos arredondados (5ª faixa interna, com teto do ISS)", () => {
  for (const anexo of ["III", "V"] as const) {
    for (const pa of ["2026-09", "2027-03"]) {
      for (const rbt of [1_800_000.01, 2_000_000, 2_777_777.77, 3_600_000]) {
        for (const receita of [0.01, 33.33, 1234.56, 23_000, 98_765.43]) {
          const das = calcularDas({ pa, receita, rbt12: rbt, anexo, mercado: "interno" });
          const soma = TRIBUTOS.reduce((s, t) => s + das.tributos[t], 0);
          assert.equal(das.total, centavos(soma));
          for (const t of TRIBUTOS) assert.equal(das.tributos[t], centavos(receita * das.percentuais[t]));
        }
      }
    }
  }
});

test("QA: manual PGDAS-D exemplo 6 (5ª faixa, Anexo I) mostra soma por tributo 9.935,02, método igual ao do núcleo", () => {
  // Repartição da 5ª faixa do Anexo I e alíquota efetiva 9,935%: refazendo o método do núcleo dá o mesmo total.
  const ef = (2_000_000 * 0.143 - 87_300) / 2_000_000;
  const rep = [0.055, 0.035, 0.1274, 0.0276, 0.42, 0.335];
  const valores = rep.map((p) => centavos(100_000 * ef * p));
  assert.deepEqual(valores, [546.43, 347.73, 1265.72, 274.21, 4172.7, 3328.23]);
  assert.equal(centavos(valores.reduce((s, v) => s + v, 0)), 9935.02);
});
