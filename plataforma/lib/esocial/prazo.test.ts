import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AVISO_PRAZO_DIAS, avisoDoPrazo, prazoDoEsocial } from "./prazo";

describe("prazo do eSocial: dia 15 do mês seguinte, ou o dia útil seguinte", () => {
  it("dia útil fica; domingo, sábado e feriado passam para o dia útil seguinte", () => {
    assert.equal(prazoDoEsocial("2026-09"), "2026-10-15"); // quinta-feira
    assert.equal(prazoDoEsocial("2026-10"), "2026-11-16"); // 15/11 é domingo e feriado
    assert.equal(prazoDoEsocial("2026-07"), "2026-08-17"); // 15/08 é sábado
    assert.equal(prazoDoEsocial("2026-12"), "2027-01-15"); // virada de ano
  });

  it("aviso a partir de 5 dias antes; no dia, amanhã e vencido; feito, nada", () => {
    assert.equal(AVISO_PRAZO_DIAS, 5);
    assert.equal(avisoDoPrazo("2026-09", "2026-10-09", false), null);
    assert.deepEqual(avisoDoPrazo("2026-09", "2026-10-10", false)?.titulo, "eSocial de setembro de 2026 vence em 5 dias");
    assert.deepEqual(avisoDoPrazo("2026-09", "2026-10-14", false)?.titulo, "eSocial de setembro de 2026 vence amanhã");
    const hoje = avisoDoPrazo("2026-09", "2026-10-15", false);
    assert.deepEqual([hoje?.nivel, hoje?.titulo, hoje?.texto], ["vence", "eSocial de setembro de 2026 vence hoje", "Envie o pró-labore de setembro de 2026 ao eSocial até 15/10/2026."]);
    const atrasado = avisoDoPrazo("2026-09", "2026-10-16", false);
    assert.deepEqual([atrasado?.nivel, atrasado?.dias], ["vencida", -1]);
    assert.equal(avisoDoPrazo("2026-09", "2026-10-16", true), null);
  });
});
