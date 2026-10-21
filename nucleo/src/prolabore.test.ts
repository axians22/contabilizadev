import { test } from "node:test";
import assert from "node:assert/strict";
import { pagamentoDoMes, proLaboreDoDarf, proLaboreDoEsocial, proLaborePrevisto } from "./prolabore.ts";

const RUBRICAS = { proLabore: "100", inss: "843" };
const s1200 = (mes: string, bruto: string, inss: string) =>
  `<evtRemun><ideEvento><perApur>${mes}</perApur></ideEvento><itensRemun><codRubr>100</codRubr><vrRubr>${bruto}</vrRubr></itensRemun>` +
  `<itensRemun><codRubr>843</codRubr><vrRubr>${inss}</vrRubr></itensRemun></evtRemun>`;
const s1210 = (perRef: string, dtPgto: string, vrLiq: string) =>
  `<evtPgtos><infoPgto><dtPgto>${dtPgto}</dtPgto><perRef>${perRef}</perRef><vrLiq>${vrLiq}</vrLiq></infoPgto></evtPgtos>`;

test("caso real: pró-labore de 09/2026 pelo eSocial (R$ 1.621,00, INSS R$ 178,31)", () => {
  const eventos = [
    { tipo: "evtPgtos", xml: s1210("2026-09", "2026-10-05", "1442.69") },
    { tipo: "evtRemun", xml: s1200("2026-09", "1621.00", "178.31") },
  ];
  assert.deepEqual(proLaboreDoEsocial(eventos, "2026-09", RUBRICAS), {
    mes: "2026-09", bruto: 1621, inss: 178.31, liquido: 1442.69, pagoEm: "2026-10-05", fonte: "esocial",
  });
});

test("retificação: vale o S-1200 mais recente; sem S-1210 o líquido é calculado", () => {
  const eventos = [
    { tipo: "evtRemun", xml: s1200("2026-08", "2000.00", "220.00") },
    { tipo: "evtRemun", xml: s1200("2026-08", "1621.00", "178.31") },
  ];
  const p = proLaboreDoEsocial(eventos, "2026-08", RUBRICAS)!;
  assert.equal(p.bruto, 2000);
  assert.equal(p.liquido, 1780);
  assert.equal(p.pagoEm, null);
  assert.equal(proLaboreDoEsocial(eventos, "2026-07", RUBRICAS), null);
  assert.equal(proLaboreDoEsocial([{ tipo: "evtRemun", xml: s1200("2026-08", "0", "0") }], "2026-08", RUBRICAS), null);
  assert.equal(pagamentoDoMes(eventos, "2026-08"), null);
});

test("reserva pelo DARF e previsão", () => {
  assert.deepEqual(proLaboreDoDarf("2026-09", 178.31), { mes: "2026-09", bruto: 1621, inss: 178.31, liquido: 1442.69, pagoEm: null, fonte: "serpro" });
  assert.equal(proLaborePrevisto("2026-11", 1621).liquido, 1442.69);
});

test("pró-labore pelo DARF no teto do INSS: o teto é o mínimo garantido e o valor real precisa ser informado", () => {
  const p = proLaboreDoDarf("2026-09", 932.31);
  assert.equal(p.bruto, 8_475.55);
  assert.equal(p.noTeto, true);
  assert.equal(proLaboreDoDarf("2026-09", 178.31).noTeto, undefined);
  assert.equal(proLaborePrevisto("2026-11", 20_000).inss, 932.31);
});
