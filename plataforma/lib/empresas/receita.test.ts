import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { consultaRecente, consultaVencida, hojeNoBrasil, INTERVALO_MINIMO_MINUTOS, VALIDADE_DOS_DADOS_DIAS } from "./receita";

const DIA = 24 * 60 * 60 * 1000;

describe("validade da consulta à Receita", () => {
  const consultada = new Date("2026-09-01T12:00:00Z");
  it(`vale ${VALIDADE_DOS_DADOS_DIAS} dias; depois disso está vencida`, () => {
    assert.equal(consultaVencida(consultada, new Date(consultada.getTime() + VALIDADE_DOS_DADOS_DIAS * DIA)), false);
    assert.equal(consultaVencida(consultada, new Date(consultada.getTime() + VALIDADE_DOS_DADOS_DIAS * DIA + 1)), true);
  });
  it(`recente = menos de ${INTERVALO_MINIMO_MINUTOS} minutos (o botão de atualizar não consulta de novo)`, () => {
    assert.equal(consultaRecente(consultada, new Date(consultada.getTime() + INTERVALO_MINIMO_MINUTOS * 60_000 - 1)), true);
    assert.equal(consultaRecente(consultada, new Date(consultada.getTime() + INTERVALO_MINIMO_MINUTOS * 60_000)), false);
  });
  it("hoje é o dia no horário de Brasília, não no UTC", () => {
    assert.equal(hojeNoBrasil(new Date("2026-10-17T02:00:00Z")), "2026-10-16");
    assert.equal(hojeNoBrasil(new Date("2026-10-17T03:00:00Z")), "2026-10-17");
  });
});
