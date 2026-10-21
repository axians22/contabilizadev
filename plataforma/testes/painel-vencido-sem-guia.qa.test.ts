// QA (Parte 8, painel no desenho do ../fiscal): mês que passou do vencimento sem a guia existir. No ../fiscal
// (lib/guias-vencidas.ts, vencidaNoMes) só conta como vencido o mês em que a guia existe (valor registrado ou, no DAS,
// receita lançada); e quando o painel diz "Gere as guias atualizadas abaixo", tem de haver o caminho abaixo.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { apurar } from "@contabilizadev/nucleo/apuracao";
import { regraDoCnae } from "@contabilizadev/nucleo/cnae";
import { PainelDoMes, type DadosDoPainel } from "@/app/(painel)/painel-do-mes";
import { resumoDoMes } from "@/lib/painel/resumo";
import type { BaseDoMes } from "@/lib/rotina/base";
import type { GuiaDoMes } from "@/lib/rotina/guias";
import { semExplicacoes, texto } from "./tela";

const RECEITAS = {
  "2025-09": 25_228.39, "2025-10": 19_224.3, "2025-11": 27_350.21, "2025-12": 24_655.48, "2026-01": 21_869.17, "2026-02": 25_798.12,
  "2026-03": 37_582, "2026-04": 24_985.4, "2026-05": 45_494.12, "2026-06": 47_400, "2026-07": 26_503.41, "2026-08": 26_908.25,
};
const REGRA = regraDoCnae("6209100");
const LANCAMENTO = {
  id: "00000000-0000-0000-0000-0000000000b1", empresaId: "00000000-0000-0000-0000-000000000001", pa: "2026-09", recebidaEm: "2026-10-05",
  moeda: "BRL", valorMoeda: 23_000, valorBrl: 23_000, origemValor: "reais", cotacao: null, cotacaoData: null, observacao: null,
  lancadaEm: new Date("2026-10-05T12:00:00Z"), lancadaPorId: null,
} as unknown as BaseDoMes["lancamentos"][number];

function base(extra: Partial<BaseDoMes>): BaseDoMes {
  return {
    pa: "2026-09", mesAtual: "2026-10", hoje: "2026-10-25", cnpj: "98765432000198", regra: REGRA, semRegra: null, inicioAtividade: undefined,
    lancamentos: [LANCAMENTO], receitaLancada: 23_000, vigente: null, receitaDeclarada: null, semReceita: false, receitaPendente: false,
    receita: 23_000, prolabore: null, prolaboreDoMesAtual: null, receitas: RECEITAS, fontesReceita: {}, folhas: {}, fontesFolha: {},
    apuracao: apurar({ pa: "2026-09", receita: 23_000, receitas: RECEITAS, folhas: {}, regra: REGRA }), erro: null, ...extra,
  };
}
// Sem declaração transmitida: não há referência, a guia ainda não existe (GuiaDoMes.vencida é false).
const semGuia = (tipo: "DAS" | "INSS"): GuiaDoMes => ({
  pa: "2026-09", tipo, referencia: null, vencimento: "2026-10-20", paga: false, pagaEm: null, vencida: false, original: null, atualizada: null, pagarEmSugerido: "2026-10-26",
});
const acao = async () => undefined;
function painel(b: BaseDoMes) {
  const d: DadosDoPainel = {
    empresaId: "00000000-0000-0000-0000-000000000001", base: b, resumo: resumoDoMes(b), ultimo: "2026-09", das: semGuia("DAS"), inss: semGuia("INSS"),
    situacaoFiscal: { atual: null, processando: false }, pendencias: [], mesesComGuia: [], autorizada: true, termo: { estado: "propria" },
  };
  return renderToStaticMarkup(createElement(PainelDoMes, { dados: d, acoes: { lancar: acao, remover: async () => {}, gerar: acao } }));
}

describe("QA: painel com o vencimento passado e a guia ainda inexistente", () => {
  it("receita lançada, sem declaração e depois do dia 20: o cartão do DAS não fica sem nenhuma ação (leva a declarar)", () => {
    const html = painel(base({}));
    const t = texto(semExplicacoes(html));
    // Com a guia sem referência, o próximo passo é declarar (o mesmo link do estado 'Em aberto').
    assert.match(html, /href="\/roteiro\?mes=2026-09#passo-4"/, `o DAS vencido sem declaração ficou sem caminho: ${t.match(/DAS Simples Nacional.{0,160}/)?.[0]}`);
  });

  it("sem receita lançada nem declarada (só a previsão): o destaque não diz 'Gere as guias atualizadas abaixo' sem guias abaixo", () => {
    const html = painel(base({ lancamentos: [], receitaLancada: null, receitaPendente: true, receita: 0 }));
    const t = texto(semExplicacoes(html));
    if (!html.includes('id="guias"')) assert.doesNotMatch(t, /Gere as guias atualizadas abaixo/);
  });
});
