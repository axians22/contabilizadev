// QA (Parte 8, passo 22c, ciclo 3): bordas do "desde quando a empresa está no Simples" na declaração anual.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { avisoDaDeclaracaoAnual, inicioNoSimples, situacaoDaDeclaracaoAnual } from "./prazo";

const dados = (atividade: string | null, opcao: string | null, exclusao: string | null = null, optante: boolean | null = true) => ({
  dataInicioAtividade: atividade,
  simples: { optante, dataOpcao: opcao, dataExclusao: exclusao },
});

describe("QA ciclo 3: início no Simples nas viradas de ano", () => {
  it("abriu em 31/12 do ano declarado: a declaração do ano é devida", () => {
    const inicio = inicioNoSimples(dados("2026-12-31", "2026-12-31"));
    assert.equal(situacaoDaDeclaracaoAnual("2027-02-10", null, inicio).estado, "na-epoca");
    assert.ok(avisoDaDeclaracaoAnual("2027-02-10", null, inicio));
  });

  it("entrou no Simples em 1º/01 do ano seguinte: não devida, sem aviso nem depois do prazo", () => {
    const inicio = inicioNoSimples(dados("2020-05-04", "2027-01-01"));
    assert.equal(inicio, "2027-01-01");
    assert.equal(situacaoDaDeclaracaoAnual("2027-01-01", null, inicio).estado, "nao-devida");
    assert.equal(situacaoDaDeclaracaoAnual("2027-04-10", false, inicio).estado, "nao-devida");
    assert.equal(avisoDaDeclaracaoAnual("2027-04-10", false, inicio), null);
  });

  it("sem dado nenhum do cadastro: continua devida (não esconde aviso por falta de dado)", () => {
    assert.equal(inicioNoSimples(null), null);
    assert.equal(inicioNoSimples(dados(null, null)), null);
    assert.equal(situacaoDaDeclaracaoAnual("2027-04-10", false, null).estado, "atrasada");
  });

  it("entregue vale mesmo com o início depois do ano (a Receita tem a declaração)", () => {
    assert.equal(situacaoDaDeclaracaoAnual("2027-02-10", true, "2027-01-01").estado, "entregue");
  });
});
