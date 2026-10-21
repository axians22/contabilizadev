import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { avisoDaDeclaracaoAnual, declaracaoDevida, entregaDaDeclaracaoAnual, explicacaoDoPrazo, inicioNoSimples, situacaoDaDeclaracaoAnual } from "./prazo";
import { valorDoCampo, faltando, anosDaDeclaracao } from "./resumo";

describe("prazo da declaração anual (Resolução CGSN 140/2018, art. 72: até 31 de março do ano seguinte)", () => {
  it("o ano declarado é o que acabou; o prazo, 31 de março", () => {
    const s = situacaoDaDeclaracaoAnual("2027-01-02", null);
    assert.deepEqual([s.ano, s.prazo, s.estado], [2026, "2027-03-31", "na-epoca"]);
    assert.equal(s.dias, 88);
    assert.equal(situacaoDaDeclaracaoAnual("2027-03-31", null).dias, 0);
  });

  it("entregue; atrasada só quando a Receita foi consultada e não tem; sem consulta depois do prazo, a conferir", () => {
    assert.equal(situacaoDaDeclaracaoAnual("2027-02-01", true).estado, "entregue");
    assert.equal(situacaoDaDeclaracaoAnual("2027-04-01", true).estado, "entregue");
    assert.equal(situacaoDaDeclaracaoAnual("2027-04-01", false).estado, "atrasada");
    assert.equal(situacaoDaDeclaracaoAnual("2027-04-01", null).estado, "a-conferir");
    assert.equal(situacaoDaDeclaracaoAnual("2027-03-31", false).estado, "na-epoca"); // ainda no prazo
  });
});

describe("o que a consulta guardada diz da entrega", () => {
  const em = (iso: string) => new Date(`${iso}-03:00`);
  it("entregue vale sempre; 'não encontrada' só conta como não entregue se consultada depois do prazo (Brasília)", () => {
    assert.equal(entregaDaDeclaracaoAnual(2026, null), null);
    assert.equal(entregaDaDeclaracaoAnual(2026, undefined), null);
    assert.equal(entregaDaDeclaracaoAnual(2026, { situacao: "entregue", consultadaEm: em("2027-02-10T10:00:00") }), true);
    assert.equal(entregaDaDeclaracaoAnual(2026, { situacao: "nao-encontrada", consultadaEm: em("2027-02-10T10:00:00") }), null);
    // No último dia do prazo ainda dá para entregar.
    assert.equal(entregaDaDeclaracaoAnual(2026, { situacao: "nao-encontrada", consultadaEm: em("2027-03-31T23:30:00") }), null);
    assert.equal(entregaDaDeclaracaoAnual(2026, { situacao: "nao-encontrada", consultadaEm: em("2027-04-01T00:10:00") }), false);
  });

  it("consulta de fevereiro sem a declaração, olhada em abril: a conferir, sem aviso vermelho", () => {
    const entregue = entregaDaDeclaracaoAnual(2026, { situacao: "nao-encontrada", consultadaEm: em("2027-02-10T10:00:00") });
    assert.equal(situacaoDaDeclaracaoAnual("2027-04-01", entregue).estado, "a-conferir");
    assert.equal(avisoDaDeclaracaoAnual("2027-04-01", entregue), null);
    const depois = entregaDaDeclaracaoAnual(2026, { situacao: "nao-encontrada", consultadaEm: em("2027-04-02T10:00:00") });
    assert.equal(situacaoDaDeclaracaoAnual("2027-04-02", depois).estado, "atrasada");
  });
});

describe("aviso da declaração anual (painel e sino)", () => {
  it("janeiro: informativo (o ano fechou, já dá para entregar)", () => {
    const a = avisoDaDeclaracaoAnual("2027-01-15", null)!;
    assert.deepEqual([a.ano, a.nivel], [2026, "info"]);
    assert.equal(a.titulo, "Declaração anual de 2026: entregue até 31/03/2027");
  });

  it("fevereiro e março: amarelo com os dias que faltam", () => {
    assert.equal(avisoDaDeclaracaoAnual("2027-02-01", null)!.nivel, "vence");
    assert.equal(avisoDaDeclaracaoAnual("2027-03-30", false)!.titulo, "Declaração anual de 2026 vence amanhã");
    assert.equal(avisoDaDeclaracaoAnual("2027-03-31", null)!.titulo, "Declaração anual de 2026 vence hoje");
    assert.equal(avisoDaDeclaracaoAnual("2027-03-01", null)!.titulo, "Declaração anual de 2026 vence em 30 dias");
  });

  it("depois do prazo sem entrega na Receita: vermelho; entregue ou sem saber: nada", () => {
    const a = avisoDaDeclaracaoAnual("2027-04-01", false)!;
    assert.deepEqual([a.nivel, a.titulo], ["vencida", "Declaração anual de 2026 atrasada"]);
    assert.match(a.texto, /vencia em 31\/03\/2027/);
    assert.equal(avisoDaDeclaracaoAnual("2027-12-31", false)!.nivel, "vencida");
    assert.equal(avisoDaDeclaracaoAnual("2027-04-01", null), null);
    assert.equal(avisoDaDeclaracaoAnual("2027-02-01", true), null);
  });

  it("o tooltip explica o prazo, a multa e o que muda na virada do ano", () => {
    const t = explicacaoDoPrazo(2026).join(" ");
    assert.match(t, /31\/03\/2027/);
    assert.match(t, /mesmo sem movimento/);
    assert.match(t, /2% ao mês/);
    assert.match(t, /1º de janeiro de 2027 o ano de 2026 fecha/);
  });
});

describe("valores que só o cliente sabe", () => {
  it("campo vazio = não informado; valor do input numérico; o resto é recusado", () => {
    assert.equal(valorDoCampo(""), null);
    assert.equal(valorDoCampo("  "), null);
    assert.equal(valorDoCampo("1234.5"), 1234.5);
    assert.equal(valorDoCampo("0"), 0);
    for (const ruim of ["-1", "1e5", "1,5", "abc", "1.234", "Infinity"]) assert.ok(Number.isNaN(valorDoCampo(ruim)), ruim);
  });

  it("o que falta informar e os anos da aba (os três últimos que fecharam)", () => {
    assert.deepEqual(faltando({ lucros: 1, saldoInicial: null, saldoFinal: 0, despesas: null }), ["saldoInicial", "despesas"]);
    assert.deepEqual(anosDaDeclaracao(new Date("2027-01-01T02:00:00Z")), [2025, 2024, 2023]); // ainda 31/12/2026 em Brasília
    assert.deepEqual(anosDaDeclaracao(new Date("2027-01-01T03:00:00Z")), [2026, 2025, 2024]);
  });
});

describe("ano em que a empresa ainda não estava no Simples (Resolução CGSN 140/2018, art. 72)", () => {
  const opcao = (dataOpcao: string | null, dataExclusao: string | null = null) => ({ optante: true, dataOpcao, dataExclusao });

  it("início no Simples: o mais tarde entre o início de atividade e a opção (a opção só sem exclusão informada)", () => {
    assert.equal(inicioNoSimples(null), null);
    assert.equal(inicioNoSimples({ dataInicioAtividade: null, simples: opcao(null) }), null);
    assert.equal(inicioNoSimples({ dataInicioAtividade: "2027-01-15", simples: opcao("2027-01-15") }), "2027-01-15");
    assert.equal(inicioNoSimples({ dataInicioAtividade: "2020-05-01", simples: opcao("2027-01-01") }), "2027-01-01");
    assert.equal(inicioNoSimples({ dataInicioAtividade: "2020-05-01", simples: opcao("2027-01-01", "2025-06-30") }), "2020-05-01");
    assert.equal(inicioNoSimples({ dataInicioAtividade: "2020-05-01", simples: { optante: false, dataOpcao: "2027-01-01", dataExclusao: null } }), "2020-05-01");
  });

  it("devida no ano do início e depois; não devida nos anos anteriores; sem início conhecido, devida", () => {
    assert.equal(declaracaoDevida(2026, "2027-01-15"), false);
    assert.equal(declaracaoDevida(2026, "2026-12-31"), true);
    assert.equal(declaracaoDevida(2027, "2027-01-15"), true);
    assert.equal(declaracaoDevida(2026, null), true);
  });

  it("empresa aberta em 2027: a de 2026 é não devida (nem na época, nem atrasada) e não gera aviso", () => {
    assert.equal(situacaoDaDeclaracaoAnual("2027-03-10", null, "2027-01-15").estado, "nao-devida");
    assert.equal(situacaoDaDeclaracaoAnual("2027-04-03", false, "2027-01-15").estado, "nao-devida");
    assert.equal(situacaoDaDeclaracaoAnual("2027-04-03", false, "2027-01-15").inicio, "2027-01-15");
    for (const hoje of ["2027-01-10", "2027-03-10", "2027-04-03"]) assert.equal(avisoDaDeclaracaoAnual(hoje, false, "2027-01-15"), null, hoje);
    // Aberta durante 2026: deve a de 2026.
    assert.equal(situacaoDaDeclaracaoAnual("2027-04-03", false, "2026-11-02").estado, "atrasada");
    assert.equal(avisoDaDeclaracaoAnual("2027-03-10", null, "2026-11-02")!.nivel, "vence");
    // Em 2028, a de 2027 já é devida.
    assert.equal(situacaoDaDeclaracaoAnual("2028-03-10", null, "2027-01-15").estado, "na-epoca");
  });
});
