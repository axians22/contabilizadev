// QA ciclo 6 (Parte 8, painel no desenho do ../fiscal): o DARF existente com o pró-labore não informado aqui, nos casos
// que o teste do engenheiro não cobre: DARF pago, DARF ainda no prazo (hoje antes do dia 20), DAS e DARF vencidos juntos
// (o total soma os dois), a barra do destaque nunca passa de 100% e o mês em andamento com o DARF já gerado.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { apurar } from "@contabilizadev/nucleo/apuracao";
import { brl } from "@contabilizadev/nucleo/formato";
import { regraDoCnae } from "@contabilizadev/nucleo/cnae";
import { PainelDoMes, type DadosDoPainel } from "@/app/(painel)/painel-do-mes";
import { resumoDoMes } from "@/lib/painel/resumo";
import type { BaseDoMes } from "@/lib/rotina/base";
import type { Guia, GuiaDoMes } from "@/lib/rotina/guias";
import { semExplicacoes, texto } from "./tela";

const REGRA = regraDoCnae("6209100");
const RECEITAS = {
  "2025-09": 25_228.39, "2025-10": 19_224.3, "2025-11": 27_350.21, "2025-12": 24_655.48, "2026-01": 21_869.17, "2026-02": 25_798.12,
  "2026-03": 37_582, "2026-04": 24_985.4, "2026-05": 45_494.12, "2026-06": 47_400, "2026-07": 26_503.41, "2026-08": 26_908.25,
};
const visivel = (html: string) => texto(semExplicacoes(html));

function base(extra: Partial<BaseDoMes> = {}): BaseDoMes {
  const pa = extra.pa ?? "2026-09";
  const receita = extra.receita ?? 0;
  return {
    pa, mesAtual: "2026-10", hoje: "2026-10-25", cnpj: "98765432000198", regra: REGRA, semRegra: null, inicioAtividade: undefined,
    lancamentos: [], receitaLancada: null, vigente: null, receitaDeclarada: null, semReceita: false, receitaPendente: true,
    receita, prolabore: null, prolaboreDoMesAtual: null, receitas: RECEITAS, fontesReceita: {}, folhas: {}, fontesFolha: {},
    apuracao: apurar({ pa, receita, receitas: RECEITAS, folhas: {}, regra: REGRA }), erro: null, ...extra,
  };
}
const gerada = (tipo: "DAS" | "INSS", total: number): Guia => ({
  id: "00000000-0000-0000-0000-0000000000b1", empresaId: "00000000-0000-0000-0000-000000000001", pa: "2026-09", tipo,
  referencia: "98765432202609999", pagarEm: null, numero: "07202609000000009", vencimento: "2026-10-20", principal: null, multa: null,
  juros: null, total, geradaEm: new Date("2026-10-10T12:00:00Z"), usuarioId: null,
});
const guia = (tipo: "DAS" | "INSS", extra: Partial<GuiaDoMes> = {}): GuiaDoMes => ({
  pa: "2026-09", tipo, referencia: null, vencimento: "2026-10-20", paga: false, pagaEm: null, vencida: false, original: null, atualizada: null,
  pagarEmSugerido: "2026-10-26", ...extra,
});
const acao = async () => undefined;
function painel(b: BaseDoMes, extra: Partial<DadosDoPainel> = {}) {
  const d: DadosDoPainel = {
    empresaId: "00000000-0000-0000-0000-000000000001", base: b, resumo: resumoDoMes(b), ultimo: "2026-09", das: guia("DAS"), inss: guia("INSS"),
    situacaoFiscal: { atual: null, processando: false }, pendencias: [], mesesComGuia: [], autorizada: true, termo: { estado: "propria" }, ...extra,
  };
  return renderToStaticMarkup(createElement(PainelDoMes, { dados: d, acoes: { lancar: acao, remover: async () => {}, gerar: acao } }));
}
const DARF = { referencia: "98765432202609999" };
const n = (s: string) => s.replace(/\s/g, " ");

describe("QA ciclo 6: DARF existente com o pró-labore não informado aqui", () => {
  it("DARF pago: nada vencido, o destaque verde e o valor pago no Total", () => {
    const b = base();
    const t = n(visivel(painel(b, { inss: guia("INSS", { ...DARF, paga: true, pagaEm: "2026-10-18", original: gerada("INSS", 178.31) }) })));
    assert.doesNotMatch(t, /e não foi pago/);
    assert.match(t, /Total a pagar até 20\/10\/2026/);
    assert.doesNotMatch(t, /DARF do INSS · vencido/);
    assert.doesNotMatch(t, /pró-labore não informado/);
    const total = brl(Math.round((resumoDoMes(b).total + 178.31) * 100) / 100);
    assert.ok(t.includes(`Total ${n(total)}`), `Total com o DARF pago (${total}): ${t.slice(t.indexOf("Guias do mês"), t.indexOf("Guias do mês") + 200)}`);
  });

  it("DARF no prazo (hoje 15/10): 'guia da DCTFWeb', 'Total a pagar até 20/10/2026' e o DARF somado", () => {
    const b = base({ hoje: "2026-10-15" });
    const t = n(visivel(painel(b, { inss: guia("INSS", { ...DARF, original: gerada("INSS", 178.31) }) })));
    assert.match(t, /Total a pagar até 20\/10\/2026/);
    assert.match(t, /DARF do INSS · guia da DCTFWeb R\$ 178,31/);
    assert.doesNotMatch(t, /Venceu em/);
  });

  it("DAS e DARF vencidos juntos: o total soma os dois e a barra do destaque (IRPJ, CSLL, INSS patronal e DARF) soma 100%", () => {
    const receita = 26_908.25;
    const b = base({ receita, receitaLancada: receita, lancamentos: [{ id: "l1", valorBrl: receita, moeda: "BRL", valorMoeda: receita, recebidaEm: "2026-09-30" }] as BaseDoMes["lancamentos"] });
    const r = resumoDoMes(b);
    const html = painel(b, {
      das: guia("DAS", { referencia: "98765432202609001", vencida: true }),
      inss: guia("INSS", { ...DARF, vencida: true, original: gerada("INSS", 178.31) }),
    });
    const t = n(visivel(html));
    assert.match(html, /from-hero-vencido/);
    assert.match(t, /Venceu em 20\/10\/2026 e não foi pago/);
    const total = Math.round(((r.das ?? 0) + 178.31) * 100) / 100;
    assert.ok(t.includes(`Total ${n(brl(total))}`), `Total = DAS + DARF (${brl(total)})`);
    const larguras = [...html.matchAll(/style="width:([\d.]+)%"/g)].map((m) => Number(m[1]));
    const soma = larguras.slice(0, 4).reduce((s, x) => s + x, 0);
    assert.ok(Math.abs(soma - 100) < 0.5, `barra soma ${soma}% (${larguras.join(", ")})`);
  });

  it("mês em andamento (10/2026) com o DARF já gerado: nada vencido, nem as guias", () => {
    const b = base({ pa: "2026-10", hoje: "2026-10-25" });
    const html = painel(b, { das: guia("DAS", { pa: "2026-10", vencimento: "2026-11-20" }), inss: guia("INSS", { ...DARF, pa: "2026-10", vencimento: "2026-11-20", original: gerada("INSS", 178.31) }) });
    const t = n(visivel(html));
    assert.doesNotMatch(html, /from-hero-vencido/);
    assert.doesNotMatch(html, /id="guias"/);
    assert.match(t, /Total a pagar até 20\/11\/2026/);
  });
});
