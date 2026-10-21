// QA, Parte 5 (passo 17): prazos do banco primeiro em viradas de mês e de ano.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { anoDaDefis, anosDoHistorico, declaracoesVencidas, defisVencida, mesesDoHistorico, proximaSituacao } from "./prazos";

const em = (iso: string) => new Date(`${iso}-03:00`);

describe("QA: viradas", () => {
  it("histórico em janeiro: os 12 meses do ano anterior; 1º de janeiro às 00:30 de Brasília (ainda 31/12 em UTC-0 não)", () => {
    const meses = mesesDoHistorico(em("2027-01-01T00:30:00"));
    assert.deepEqual([meses[0], meses[11]], ["2026-01", "2026-12"]);
    assert.deepEqual(anosDoHistorico(em("2027-01-01T00:30:00")), [2026]);
    // 31/12 às 22:00 em Brasília já é 01/01 em UTC: continua dezembro.
    assert.deepEqual(mesesDoHistorico(em("2026-12-31T22:00:00")).at(-1), "2026-11");
  });
  it("ano anterior: diário até a consulta depois de 1º/02; depois, nunca sozinho", () => {
    assert.equal(declaracoesVencidas(2026, em("2027-01-20T10:00:00"), em("2027-01-25T10:00:00")), true);
    assert.equal(declaracoesVencidas(2026, em("2027-02-01T00:00:00"), em("2027-03-10T10:00:00")), false);
    assert.equal(declaracoesVencidas(2026, em("2027-01-31T23:59:00"), em("2027-03-10T10:00:00")), true);
  });
  it("situação fiscal: 31/12 -> 28/02 (ou 29/02 no bissexto)", () => {
    assert.equal(proximaSituacao(em("2026-12-31T12:00:00")), "2027-02-28");
    assert.equal(proximaSituacao(em("2027-12-31T12:00:00")), "2028-02-29");
    assert.equal(proximaSituacao(em("2026-10-18T12:00:00")), "2026-12-18");
  });
  it("DEFIS: 31/03 ainda é prazo; 01/04 já busca o ano anterior", () => {
    assert.equal(anoDaDefis(em("2027-03-31T23:00:00")), 2025);
    assert.equal(anoDaDefis(em("2027-04-01T00:10:00")), 2026);
    // Consultada (sem achar) em 15/03 de 2027, antes do prazo: depois do prazo consulta de novo uma vez.
    assert.equal(defisVencida(2026, em("2027-03-15T10:00:00"), false, em("2027-04-02T10:00:00")), true);
    assert.equal(defisVencida(2026, em("2027-04-02T10:00:00"), false, em("2027-06-02T10:00:00")), false);
    assert.equal(defisVencida(2026, undefined, true, em("2027-06-02T10:00:00")), false);
  });
});
