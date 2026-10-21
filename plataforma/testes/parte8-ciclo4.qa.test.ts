// QA da Parte 8, ciclo 4: casos de borda das correções (prazo da DEFIS no fuso de Brasília, texto do limite isento por
// ano, funções do painel sem "Feito aqui" para a DEFIS).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DefisNaoEncontrada, ValoresDoAno } from "@/app/(painel)/defis/declaracao-anual";
import { FuncoesDoPainel } from "@/app/(painel)/funcoes-do-painel";
import { ANO_DA_REFORMA_DO_IR, explicacaoDoLimiteIsento, explicacaoDoLucroAcima } from "@/lib/defis/limite";
import { entregaDaDeclaracaoAnual } from "@/lib/defis/prazo";
import type { ResumoDoAno } from "@/lib/defis/resumo";
import type { Situacao } from "@/lib/termo/situacao";
import { explicacoes, semExplicacoes, texto } from "./tela";

const R = { receita: 100000, irpj: 400, limiteLucroIsento: 31600 };

describe("QA ciclo 4: prazo da DEFIS no fuso de Brasília", () => {
  it("consulta às 23h de 31/03 em Brasília (02h UTC de 01/04) ainda está no prazo", () => {
    assert.equal(entregaDaDeclaracaoAnual(2026, { situacao: "nao-encontrada", consultadaEm: new Date("2027-04-01T02:59:59Z") }), null);
    assert.equal(entregaDaDeclaracaoAnual(2026, { situacao: "nao-encontrada", consultadaEm: new Date("2027-04-01T03:00:00Z") }), false);
    const quadro = (iso: string) => renderToStaticMarkup(createElement(DefisNaoEncontrada, { ano: 2026, registro: { situacao: "nao-encontrada", consultadaEm: new Date(iso) }, inicio: null }));
    assert.equal(quadro("2027-04-01T02:59:59Z"), "");
    assert.match(texto(semExplicacoes(quadro("2027-04-01T03:00:00Z"))), /DEFIS de 2026 não encontrada/);
  });

  it("empresa que entrou no Simples no próprio ano declarado ainda deve a DEFIS (quadro aparece)", () => {
    const html = renderToStaticMarkup(createElement(DefisNaoEncontrada, { ano: 2026, registro: { situacao: "nao-encontrada", consultadaEm: new Date("2027-05-01T15:00:00Z") }, inicio: "2026-12-31" }));
    assert.match(html, /DEFIS de 2026 não encontrada/);
  });
});

describe("QA ciclo 4: limite isento por ano", () => {
  it("a virada é exatamente em 2026: 2025 sem retenção, 2026 com retenção e altas rendas", () => {
    assert.equal(ANO_DA_REFORMA_DO_IR, 2026);
    const a2025 = explicacaoDoLimiteIsento(2025, R).join(" ");
    const a2026 = explicacaoDoLimiteIsento(2026, R).join(" ");
    assert.match(a2025, /sem pagar Imposto de Renda/);
    assert.doesNotMatch(a2025, /15\.270|retém|retenção/);
    assert.doesNotMatch(a2026, /sem pagar Imposto de Renda/);
    assert.match(a2026, /R\$ 50\.000,00/);
    assert.match(a2026, /10%/);
    assert.match(a2026, /R\$ 600\.000,00/);
    assert.match(a2026, /Lei 15\.270\/2025/);
    assert.match(a2026, /31\/12\/2025/);
  });

  it("a conta do limite fecha com os números mostrados (32% da receita menos IRPJ)", () => {
    const conta = explicacaoDoLimiteIsento(2026, R)[1];
    assert.match(conta, /32% de R\$\s100\.000,00 = R\$\s32\.000,00, menos R\$\s400,00 de IRPJ = R\$\s31\.600,00/);
  });

  it("receita zero: o texto não quebra e mostra R$ 0,00", () => {
    const conta = explicacaoDoLimiteIsento(2026, { receita: 0, irpj: 0, limiteLucroIsento: 0 })[1];
    assert.match(conta, /= R\$\s0,00\.$/);
  });

  it("o aviso de lucro acima do limite muda em 2026 e não diz 'sem Imposto de Renda'", () => {
    assert.match(explicacaoDoLucroAcima(2025)[0], /sem Imposto de Renda/);
    assert.doesNotMatch(explicacaoDoLucroAcima(2026)[0], /sem Imposto de Renda/);
    assert.match(explicacaoDoLucroAcima(2026)[0], /10%/);
  });

  it("na tela, o tooltip do limite em 2026 tem a retenção e nenhum texto explicativo aberto", () => {
    const r = { ...R, proLabore: 0, inss: 0, das: 0, semReceita: [], semProLabore: [] } as unknown as ResumoDoAno;
    const html = renderToStaticMarkup(createElement(ValoresDoAno, { ano: 2026, r }));
    const tip = explicacoes(html).find((e) => /limite de lucro isento/i.test(e.rotulo));
    assert.ok(tip);
    assert.match(tip.texto, /retém 10%/);
    assert.doesNotMatch(texto(semExplicacoes(html)), /15\.270|retém/);
  });
});

describe("QA ciclo 4: funções do painel", () => {
  it("com o termo em dia: exatamente uma 'Valores prontos aqui' (DEFIS) e seis 'Feito aqui'", () => {
    const html = texto(renderToStaticMarkup(createElement(FuncoesDoPainel, { ligado: true, situacao: { estado: "vigente" } as Situacao })));
    assert.equal((html.match(/Valores prontos aqui(?!:)/g) ?? []).length, 1);
    assert.equal((html.match(/Feito aqui(?!:)/g) ?? []).length, 6);
  });
});
