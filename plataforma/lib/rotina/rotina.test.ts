// Regras puras da rotina do mês (sem banco): pró-labore vigente, recibo da DCTFWeb, mês lançável e o mês padrão.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { proLaboreVigente, ultimoMesApuravel } from "./base";
import { lerRecibo } from "./dctfweb";
import { dataHoraNoBrasil } from "./dependencias";
import { mesLancavel } from "./receitas";

describe("rotina do mês: regras puras", () => {
  it("pró-labore vigente: o do mês, senão o último informado antes; nenhum antes = null", () => {
    const informados = new Map([
      ["2026-07", 1_518],
      ["2026-09", 1_621],
    ]);
    assert.equal(proLaboreVigente(informados, "2026-09"), 1_621);
    assert.equal(proLaboreVigente(informados, "2026-08"), 1_518);
    assert.equal(proLaboreVigente(informados, "2026-12"), 1_621);
    assert.equal(proLaboreVigente(informados, "2026-06"), null);
    assert.equal(proLaboreVigente(new Map([["2026-09", 0]]), "2026-10"), 0);
  });

  it("recibo da DCTFWeb: o número, qualquer que seja o formato do objeto da resposta", () => {
    assert.equal(lerRecibo(JSON.stringify({ numeroRecibo: "50000534643844" })), "50000534643844");
    assert.equal(lerRecibo(JSON.stringify({ recibo: 123456789012 })), "123456789012");
    assert.equal(lerRecibo("Recibo 50000534643844 gerado"), "50000534643844");
    assert.equal(lerRecibo("ok"), "ok");
  });

  it("mês lançável: só o que já terminou (Brasília); o mês padrão da rotina é o anterior ao atual", () => {
    const agora = new Date("2026-11-01T02:30:00Z"); // 31/10 23:30 em Brasília
    assert.equal(ultimoMesApuravel(agora), "2026-09");
    assert.equal(mesLancavel("2026-09", agora), true);
    assert.equal(mesLancavel("2026-10", agora), false);
    assert.equal(mesLancavel("2026-13", agora), false);
    assert.equal(mesLancavel("2026-9", agora), false);
    assert.equal(dataHoraNoBrasil(agora), "2026-10-31T23:30:00");
  });
});
