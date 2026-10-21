// QA ciclo 5 (Parte 8, painel e histórico no desenho do ../fiscal): casos de borda que os testes do engenheiro não cobrem.
// Painel: DARF do INSS existente e vencido com o pró-labore não informado aqui (a seção das guias aparece pelo
// mostrarGuias novo: o destaque não pode dizer "Total a pagar" verde com uma guia vencida embaixo); mês em andamento com
// DARF já existente (nada vencido, sem guias); virada de ano (12/2026 vence em 20/01/2027).
// Histórico: modo guiado, nada importado, só receita lançada aqui (a tabela aparece, com "lançada aqui"); diferença
// negativa em vermelho; nenhum mês com valores e sem autorização: o estado vazio curto.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { apurar } from "@contabilizadev/nucleo/apuracao";
import { regraDoCnae } from "@contabilizadev/nucleo/cnae";
import { PainelDoMes, type DadosDoPainel } from "@/app/(painel)/painel-do-mes";
import { TelaDoHistorico } from "@/app/(painel)/historico/tela-historico";
import { conferenciaDoHistorico } from "@/lib/historico/conferencia";
import type { MesDoHistorico } from "@/lib/historico/leitura";
import { resumoDoMes } from "@/lib/painel/resumo";
import type { BaseDoMes } from "@/lib/rotina/base";
import type { GuiaDoMes } from "@/lib/rotina/guias";
import { semExplicacoes, texto } from "./tela";

const REGRA = regraDoCnae("6209100");
const RECEITAS = {
  "2025-09": 25_228.39, "2025-10": 19_224.3, "2025-11": 27_350.21, "2025-12": 24_655.48, "2026-01": 21_869.17, "2026-02": 25_798.12,
  "2026-03": 37_582, "2026-04": 24_985.4, "2026-05": 45_494.12, "2026-06": 47_400, "2026-07": 26_503.41, "2026-08": 26_908.25,
};
const visivel = (html: string) => texto(semExplicacoes(html));

function base(extra: Partial<BaseDoMes> = {}): BaseDoMes {
  const pa = extra.pa ?? "2026-09";
  return {
    pa, mesAtual: "2026-10", hoje: "2026-10-25", cnpj: "98765432000198", regra: REGRA, semRegra: null, inicioAtividade: undefined,
    lancamentos: [], receitaLancada: null, vigente: null, receitaDeclarada: null, semReceita: false, receitaPendente: true,
    receita: 0, prolabore: 1_621, prolaboreDoMesAtual: null, receitas: RECEITAS, fontesReceita: {}, folhas: {}, fontesFolha: {},
    apuracao: apurar({ pa, receita: 0, receitas: RECEITAS, folhas: {}, regra: REGRA }), erro: null, ...extra,
  };
}
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

describe("QA ciclo 5: painel, guias que aparecem pelo mostrarGuias novo", () => {
  it("DARF da DCTFWeb vencido e o pró-labore não informado aqui: se o cartão do DARF diz Vencido, o destaque não fica verde", () => {
    const html = painel(base({ prolabore: null }), { inss: guia("INSS", { referencia: "98765432202609999", vencida: true }) });
    const t = visivel(html);
    if (html.includes('id="guias"') && /DARF[^|]*Vencido/.test(t)) {
      assert.doesNotMatch(t, /Total a pagar até/, "a guia do DARF aparece Vencida, mas o destaque do topo diz 'Total a pagar' em verde");
    }
  });

  it("mês em andamento com o DARF já existente: nada vencido e sem as guias (só depois do mês acabar)", () => {
    const b = base({ pa: "2026-10", hoje: "2026-10-25" });
    const html = painel(b, { inss: guia("INSS", { pa: "2026-10", referencia: "98765432202610999", vencimento: "2026-11-20" }), das: guia("DAS", { pa: "2026-10", vencimento: "2026-11-20" }) });
    assert.ok(!html.includes('id="guias"'));
    assert.doesNotMatch(visivel(html), /Vencido|Venceu em/);
  });

  it("virada de ano: 12/2026 vence em 20/01/2027 e, passado o prazo com a receita lançada, fica vermelho", () => {
    const LANC = {
      id: "00000000-0000-0000-0000-0000000000b9", empresaId: "00000000-0000-0000-0000-000000000001", pa: "2026-12", recebidaEm: "2027-01-05",
      moeda: "BRL", valorMoeda: 20_000, valorBrl: 20_000, origemValor: "reais", cotacao: null, cotacaoData: null, observacao: null,
      lancadaEm: new Date("2027-01-05T12:00:00Z"), lancadaPorId: null,
    } as BaseDoMes["lancamentos"][number];
    const receitas = { ...RECEITAS, "2026-09": 23_000, "2026-10": 20_000, "2026-11": 20_000 };
    const b = base({
      pa: "2026-12", mesAtual: "2027-02", hoje: "2027-02-03", lancamentos: [LANC], receitaLancada: 20_000, receita: 20_000, receitaPendente: false, receitas,
      apuracao: apurar({ pa: "2026-12", receita: 20_000, receitas, folhas: {}, regra: REGRA }),
    });
    const html = painel(b, { ultimo: "2027-01", das: guia("DAS", { pa: "2026-12", vencimento: "2027-01-20" }), inss: guia("INSS", { pa: "2026-12", vencimento: "2027-01-20" }) });
    const t = visivel(html);
    assert.match(t, /Venceu em 20\/01\/2027/);
    assert.ok(html.includes('id="guias"'));
  });
});

const EMPRESA = { regra: REGRA, inicioAtividade: undefined };
const vazio = { fontesReceita: {}, folhas: {}, fontesFolha: {} };
const mes = (pa: string, extra: Partial<MesDoHistorico> = {}): MesDoHistorico => ({
  pa, situacao: "nao-importado", declaracao: null, receita: null, valorDas: null, das: null, vencimento: `${pa}-20`, pagoEm: null, extrato: null,
  divergencia: null, ...extra,
});

describe("QA ciclo 5: histórico", () => {
  it("modo guiado, nada importado, só a receita lançada aqui: a tabela aparece com 'lançada aqui' e o DAS calculado", () => {
    const meses = ["2026-07", "2026-08", "2026-09"].map((pa) => mes(pa));
    const linhas = conferenciaDoHistorico(meses, { ...vazio, receitas: { ...RECEITAS, "2026-09": 23_000 }, fontesReceita: { "2026-09": "lancada" } }, EMPRESA);
    const html = renderToStaticMarkup(createElement(TelaDoHistorico, { dados: { linhas, mostrarProLabore: false, importado: false, autorizada: false } }));
    const t = visivel(html);
    assert.doesNotMatch(t, /Nada importado ainda/);
    assert.match(t, /lançada aqui/);
    assert.match(t, /R\$\s*1\.000,76/);
  });

  it("diferença negativa (DAS emitido maior que o calculado) fica vermelha e com o sinal", () => {
    const linhas = conferenciaDoHistorico([mes("2026-09", { situacao: "pago", receita: 23_000, valorDas: 1_100 })], { ...vazio, receitas: { ...RECEITAS, "2026-09": 23_000 } }, EMPRESA);
    assert.equal(linhas[0].diferenca, -99.24);
    const html = renderToStaticMarkup(createElement(TelaDoHistorico, { dados: { linhas, mostrarProLabore: false, importado: true, autorizada: true } }));
    assert.match(html, /<span class="text-bad">-R\$\s*99,24<\/span>/);
  });

  it("sem autorização, nada importado e nada lançado: só o estado vazio, sem a tabela e sem o botão do pró-labore", () => {
    const linhas = conferenciaDoHistorico([mes("2026-09")], { ...vazio, receitas: {} }, EMPRESA);
    const html = renderToStaticMarkup(createElement(TelaDoHistorico, { dados: { linhas, mostrarProLabore: false, importado: false, autorizada: false } }));
    const t = visivel(html);
    assert.match(t, /Nada importado ainda/);
    assert.doesNotMatch(t, /Mostrar pró-labore/);
    assert.ok(!html.includes("<table"));
  });
});
