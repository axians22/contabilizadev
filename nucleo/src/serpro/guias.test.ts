import { test } from "node:test";
import assert from "node:assert/strict";
import { guiasVencidas, problemaNaDataDePagamento, proximoDiaUtil, vencida } from "./guias.ts";

test("próximo dia útil sem passar do fim do mês", () => {
  assert.equal(proximoDiaUtil("2026-10-16"), "2026-10-16"); // sexta
  assert.equal(proximoDiaUtil("2026-10-17"), "2026-10-19"); // sábado -> segunda
  assert.equal(proximoDiaUtil("2026-10-31"), "2026-10-31"); // sábado no último dia: não pula para novembro
  assert.equal(proximoDiaUtil("2026-10-10"), "2026-10-13"); // sábado, domingo e segunda 12/10 (Aparecida)
  assert.equal(proximoDiaUtil("2026-11-20"), "2026-11-23"); // Consciência Negra na sexta
  assert.equal(proximoDiaUtil("2026-10-28", ["2026-10-28"]), "2026-10-29"); // feriado local informado
});

test("data de pagamento em feriado nacional ou local é recusada", () => {
  assert.match(problemaNaDataDePagamento("2026-11-02", "2026-11-01")!, /dia útil/); // Finados
  assert.match(problemaNaDataDePagamento("2026-11-20", "2026-11-16")!, /dia útil/);
  assert.equal(problemaNaDataDePagamento("2026-11-03", "2026-11-01"), null);
  assert.match(problemaNaDataDePagamento("2026-11-03", "2026-11-01", ["2026-11-03"])!, /dia útil/);
});

test("data de pagamento: de hoje até o fim do mês, dia útil", () => {
  assert.equal(problemaNaDataDePagamento("2026-10-21", "2026-10-21"), null);
  assert.match(problemaNaDataDePagamento("2026-10-20", "2026-10-21")!, /hoje até o fim/);
  assert.match(problemaNaDataDePagamento("2026-11-02", "2026-10-21")!, /hoje até o fim/);
  assert.match(problemaNaDataDePagamento("2026-10-25", "2026-10-21")!, /dia útil/);
  assert.match(problemaNaDataDePagamento("2026-02-30", "2026-02-01")!, /inválida/);
  assert.match(problemaNaDataDePagamento("21/10/2026", "2026-10-21")!, /inválida/);
});

test("vencida só depois do dia 20 do mês seguinte, sem pagamento e com guia existente", () => {
  const base = { mes: "2026-09", pagoEm: null, existe: true };
  assert.equal(vencida({ ...base, hoje: "2026-10-20" }), false);
  assert.equal(vencida({ ...base, hoje: "2026-10-21" }), true);
  assert.equal(vencida({ ...base, hoje: "2026-10-21", pagoEm: "2026-10-20" }), false);
  assert.equal(vencida({ ...base, hoje: "2026-10-21", existe: false }), false);
  // Virada de ano: DAS de 12/2026 vence em 20/01/2027.
  assert.equal(vencida({ ...base, mes: "2026-12", hoje: "2027-01-20" }), false);
  assert.equal(vencida({ ...base, mes: "2026-12", hoje: "2027-01-21" }), true);
  // 20/06/2026 é sábado: a guia de 05/2026 vence na sexta 19 e já está vencida no dia 20.
  assert.equal(vencida({ ...base, mes: "2026-05", hoje: "2026-06-19" }), false);
  assert.equal(vencida({ ...base, mes: "2026-05", hoje: "2026-06-20" }), true);
  // Março de 2025: vence em 17/04/2025 (Páscoa no dia 20 e Sexta-feira Santa em 18/04).
  assert.equal(vencida({ ...base, mes: "2025-03", hoje: "2025-04-17" }), false);
  assert.equal(vencida({ ...base, mes: "2025-03", hoje: "2025-04-18" }), true);
  // Feriado local no dia 20 antecipa o vencimento.
  assert.equal(vencida({ ...base, hoje: "2026-10-20", extras: ["2026-10-20"] }), true);
});

test("lista as guias vencidas dos 12 meses anteriores", () => {
  const lista = guiasVencidas("2026-10", "2026-10-21", (mes, tipo) => ({
    existe: mes === "2026-09" || (mes === "2025-10" && tipo === "INSS"),
    pagoEm: null,
  }));
  assert.deepEqual(lista, [
    { mes: "2025-10", tipo: "INSS" },
    { mes: "2026-09", tipo: "DAS" },
    { mes: "2026-09", tipo: "INSS" },
  ]);
  // Com feriado local em 20/10/2026, o DARF do INSS de 09/2026 vence no dia 19 e já está vencido no dia 20; o DAS vai
  // para o dia 21 e ainda está no prazo.
  const situacao = (mes: string) => ({ existe: mes === "2026-09", pagoEm: null });
  assert.deepEqual(guiasVencidas("2026-10", "2026-10-20", situacao), []);
  assert.deepEqual(guiasVencidas("2026-10", "2026-10-20", situacao, ["2026-10-20"]), [{ mes: "2026-09", tipo: "INSS" }]);
  assert.equal(guiasVencidas("2026-10", "2026-10-22", situacao, ["2026-10-20"]).length, 2);
});

test("DAS vence no dia útil seguinte ao dia 20 sem expediente; o DARF do INSS, no anterior", () => {
  const base = { mes: "2026-08", pagoEm: null, existe: true };
  // 20/09/2026 é domingo: DAS vence na segunda 21, DARF na sexta 18.
  assert.equal(vencida({ ...base, tipo: "DAS", hoje: "2026-09-21" }), false);
  assert.equal(vencida({ ...base, tipo: "DAS", hoje: "2026-09-22" }), true);
  assert.equal(vencida({ ...base, tipo: "INSS", hoje: "2026-09-19" }), true);
  assert.equal(vencida({ ...base, tipo: "INSS", hoje: "2026-09-18" }), false);
  // 20/04/2025 é domingo de Páscoa e 21/04 é Tiradentes: DAS de 03/2025 vence na terça 22.
  assert.equal(vencida({ ...base, mes: "2025-03", tipo: "DAS", hoje: "2025-04-22" }), false);
  assert.equal(vencida({ ...base, mes: "2025-03", tipo: "DAS", hoje: "2025-04-23" }), true);
});
