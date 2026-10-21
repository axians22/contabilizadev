// QA ciclo 4 (Parte 8, painel no desenho do ../fiscal): casos de borda da guia vencida que os testes do engenheiro não
// cobrem. O DARF do INSS existe (DCTFWeb transmitida, há referência) e venceu, mas o mês não tem receita lançada nem
// declarada: o destaque e a faixa da situação fiscal mandam para "as guias abaixo" (#guias), que precisam existir.
// Também: as funções puras mesesComGuiaVencida com DAS e INSS no mesmo mês e com tipos que não batem.
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
import { explicarPendencias, mesesComGuiaVencida } from "@/lib/situacao/pendencias";
import { semExplicacoes, texto } from "./tela";

const RECEITAS = {
  "2025-09": 25_228.39, "2025-10": 19_224.3, "2025-11": 27_350.21, "2025-12": 24_655.48, "2026-01": 21_869.17, "2026-02": 25_798.12,
  "2026-03": 37_582, "2026-04": 24_985.4, "2026-05": 45_494.12, "2026-06": 47_400, "2026-07": 26_503.41, "2026-08": 26_908.25,
};
const REGRA = regraDoCnae("6209100");

// Mês sem receita lançada nem declarada (previsão), com o pró-labore informado (DARF devido).
function base(extra: Partial<BaseDoMes> = {}): BaseDoMes {
  return {
    pa: "2026-09", mesAtual: "2026-10", hoje: "2026-10-25", cnpj: "98765432000198", regra: REGRA, semRegra: null, inicioAtividade: undefined,
    lancamentos: [], receitaLancada: null, vigente: null, receitaDeclarada: null, semReceita: false, receitaPendente: true,
    receita: 0, prolabore: 1_621, prolaboreDoMesAtual: null, receitas: RECEITAS, fontesReceita: {}, folhas: {}, fontesFolha: {},
    apuracao: apurar({ pa: "2026-09", receita: 0, receitas: RECEITAS, folhas: {}, regra: REGRA }), erro: null, ...extra,
  };
}
const guia = (tipo: "DAS" | "INSS", extra: Partial<GuiaDoMes> = {}): GuiaDoMes => ({
  pa: "2026-09", tipo, referencia: null, vencimento: "2026-10-20", paga: false, pagaEm: null, vencida: false, original: null, atualizada: null,
  pagarEmSugerido: "2026-10-26", ...extra,
});
// DCTFWeb do mês transmitida: o DARF existe (referência) e passou do vencimento sem pagamento.
const DARF_VENCIDO = guia("INSS", { referencia: "98765432202609999", vencida: true });
const acao = async () => undefined;
function painel(extra: Partial<DadosDoPainel> = {}) {
  const b = base();
  const d: DadosDoPainel = {
    empresaId: "00000000-0000-0000-0000-000000000001", base: b, resumo: resumoDoMes(b), ultimo: "2026-09", das: guia("DAS"), inss: DARF_VENCIDO,
    situacaoFiscal: { atual: null, processando: false }, pendencias: [], mesesComGuia: [], autorizada: true, termo: { estado: "propria" }, ...extra,
  };
  return renderToStaticMarkup(createElement(PainelDoMes, { dados: d, acoes: { lancar: acao, remover: async () => {}, gerar: acao } }));
}

describe("QA ciclo 4: DARF do INSS vencido num mês sem receita lançada nem declarada", () => {
  it("o destaque diz 'Gere as guias atualizadas abaixo': então as guias (#guias) têm de estar abaixo, com a do DARF", () => {
    const html = painel();
    const t = texto(semExplicacoes(html));
    if (/Gere as guias atualizadas abaixo/.test(t)) {
      assert.ok(html.includes('id="guias"'), "o destaque manda gerar as guias abaixo, mas o painel não mostra as guias do mês (nem a do DARF vencido)");
    }
  });

  it("mês marcado sem receita (ainda não declarado) com o DARF vencido: as guias aparecem para gerar a do DARF com juros", () => {
    const b = base({ semReceita: true, receitaPendente: false, receita: 0 });
    const d: DadosDoPainel = {
      empresaId: "00000000-0000-0000-0000-000000000001", base: b, resumo: resumoDoMes(b), ultimo: "2026-09", das: guia("DAS"), inss: DARF_VENCIDO,
      situacaoFiscal: { atual: null, processando: false }, pendencias: [], mesesComGuia: [], autorizada: true, termo: { estado: "propria" },
    };
    const html = renderToStaticMarkup(createElement(PainelDoMes, { dados: d, acoes: { lancar: acao, remover: async () => {}, gerar: acao } }));
    assert.match(texto(semExplicacoes(html)), /Venceu em 20\/10\/2026/);
    assert.ok(html.includes('id="guias"'), "o destaque está vermelho pelo DARF vencido, mas não há a seção das guias para gerar a nova");
  });

  it("empresa com pendência e esse DARF vencido: o botão 'Gerar novas guias' leva a /?mes=2026-09#guias, que precisa existir na página", () => {
    const irregular = {
      atual: { id: "00000000-0000-0000-0000-0000000000c2", regular: false, pendencias: "Pendência - Débito (SIEF)", prontoEm: new Date("2026-10-22T13:00:00Z"), temPdf: false },
      processando: false,
    };
    const html = painel({ situacaoFiscal: irregular, pendencias: ["Débito em aberto"], mesesComGuia: ["2026-09"] });
    assert.match(html, /href="\/\?mes=2026-09#guias"/);
    assert.ok(html.includes('id="guias"'), "o botão da situação fiscal aponta para #guias, mas a seção das guias não aparece neste mês");
  });
});

describe("QA ciclo 4: mesesComGuiaVencida", () => {
  const TEXTO = [
    "Pendência - Débito (SIEF)",
    "DARF 1099 - CP SEGURADOS - PA 12/2025 - vencimento 20/01/2026 - saldo devedor R$ 178,31",
  ].join("\n");

  it("débito do INSS com mês: só o mês do DARF vencido daquele mês entra (o DAS vencido de outro mês não)", () => {
    const pend = explicarPendencias(TEXTO);
    const meses = mesesComGuiaVencida(pend, [
      { tipo: "INSS", pa: "2025-12" },
      { tipo: "DAS", pa: "2026-03" },
    ]);
    assert.deepEqual(meses, ["2025-12"]);
  });

  it("o tipo tem de bater: o DAS vencido de 12/2025 não resolve o débito do INSS de 12/2025", () => {
    const pend = explicarPendencias(TEXTO);
    assert.deepEqual(mesesComGuiaVencida(pend, [{ tipo: "DAS", pa: "2025-12" }]), []);
  });
});
