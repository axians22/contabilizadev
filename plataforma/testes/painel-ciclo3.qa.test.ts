// QA (Parte 8, ciclo 3 do painel no desenho do ../fiscal): limites do vencimento e combinações de guias que os testes do
// engenheiro não cobrem: o próprio dia do vencimento, DAS pago com o DARF vencido, guia vencida no modo guiado e a faixa
// da situação fiscal com pendência no modo guiado (page.tsx só procura guias vencidas com a autorização em dia).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { apurar } from "@contabilizadev/nucleo/apuracao";
import { regraDoCnae } from "@contabilizadev/nucleo/cnae";
import { PainelDoMes, type DadosDoPainel } from "@/app/(painel)/painel-do-mes";
import { resumoDoMes } from "@/lib/painel/resumo";
import type { BaseDoMes } from "@/lib/rotina/base";
import type { Guia, GuiaDoMes } from "@/lib/rotina/guias";
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

function base(extra: Partial<BaseDoMes> = {}): BaseDoMes {
  return {
    pa: "2026-09", mesAtual: "2026-10", hoje: "2026-10-25", cnpj: "98765432000198", regra: REGRA, semRegra: null, inicioAtividade: undefined,
    lancamentos: [LANCAMENTO], receitaLancada: 23_000, vigente: null, receitaDeclarada: null, semReceita: false, receitaPendente: false,
    receita: 23_000, prolabore: 1_621, prolaboreDoMesAtual: null, receitas: RECEITAS, fontesReceita: {}, folhas: {}, fontesFolha: {},
    apuracao: apurar({ pa: "2026-09", receita: 23_000, receitas: RECEITAS, folhas: {}, regra: REGRA }), erro: null, ...extra,
  };
}
const ORIGINAL: Guia = {
  id: "00000000-0000-0000-0000-0000000000a1", empresaId: "00000000-0000-0000-0000-000000000001", pa: "2026-09", tipo: "DAS",
  referencia: "98765432202609001", pagarEm: null, numero: "07202609000000001", vencimento: "2026-10-20", principal: null, multa: null,
  juros: null, total: 1000.76, geradaEm: new Date("2026-10-10T12:00:00Z"), usuarioId: null,
};
const guia = (tipo: "DAS" | "INSS", extra: Partial<GuiaDoMes> = {}): GuiaDoMes => ({
  pa: "2026-09", tipo, referencia: `ref-${tipo}`, vencimento: "2026-10-20", paga: false, pagaEm: null, vencida: false, original: null,
  atualizada: null, pagarEmSugerido: "2026-10-26", ...extra,
});
const acao = async () => undefined;
function painel(extra: Partial<DadosDoPainel>, b: BaseDoMes = base()) {
  const d: DadosDoPainel = {
    empresaId: "00000000-0000-0000-0000-000000000001", base: b, resumo: resumoDoMes(b), ultimo: "2026-09",
    das: guia("DAS", { original: ORIGINAL }), inss: guia("INSS"), situacaoFiscal: { atual: null, processando: false }, pendencias: [],
    mesesComGuia: [], autorizada: true, termo: { estado: "propria" }, ...extra,
  };
  return renderToStaticMarkup(createElement(PainelDoMes, { dados: d, acoes: { lancar: acao, remover: async () => {}, gerar: acao } }));
}
const visivel = (html: string) => texto(semExplicacoes(html));

describe("QA ciclo 3: vencimento e combinações de guias no painel", () => {
  it("no próprio dia do vencimento (20/10) nada está vencido: 'Vence em' e o destaque verde", () => {
    const html = painel({}, base({ hoje: "2026-10-20" }));
    const t = visivel(html);
    assert.doesNotMatch(html, /from-hero-vencido/);
    assert.match(t, /Total a pagar até 20\/10\/2026/);
    assert.match(t, /DAS Simples Nacional Em aberto R\$\s1\.000,76 Vence em 20\/10\/2026/);
    assert.doesNotMatch(t, /Venceu em|Vencido/);
  });

  it("DAS pago depois do vencimento e DARF vencido: só o DARF pede a guia com multa e juros e o destaque usa o prazo do DARF", () => {
    const html = painel({
      das: guia("DAS", { original: ORIGINAL, paga: true, pagaEm: "2026-10-22" }),
      inss: guia("INSS", { vencida: true }),
    });
    const t = visivel(html);
    assert.match(html, /from-hero-vencido/);
    assert.match(t, /Venceu em 20\/10\/2026 e não foi pago/);
    assert.match(t, /DAS Simples Nacional Pago R\$\s1\.000,76 Pago em 22\/10\/2026/);
    assert.match(t, /DARF INSS do pró-labore Vencido R\$\s178,31 Venceu em 20\/10\/2026/);
    assert.equal([...t.matchAll(/Gerar guia com multa e juros/g)].length, 1);
    assert.match(html, /name="tipo" value="INSS"/);
  });

  it("modo guiado com o DAS vencido e declarado: o caminho da guia nova no portal, nenhum botão que gera aqui", () => {
    const html = painel({ autorizada: false, termo: { estado: "ausente" }, das: guia("DAS", { vencida: true }) });
    const t = visivel(html);
    assert.match(t, /DAS Simples Nacional Vencido/);
    assert.match(t, /Passou do vencimento\. Gerar a nova no portal/);
    assert.doesNotMatch(t, /Gerar guia com multa e juros|Gerar guia\b/);
  });

  it("modo guiado, empresa com pendência e o DAS do mês vencido na tela: a situação fiscal não pode dizer que não há guia vencida", () => {
    // page.tsx: `const vencidas = ligado && pendencias.length ? await guiasVencidas(...) : []` -> sem a autorização,
    // mesesComGuia chega sempre vazio, mesmo com a guia vencida (só leitura do banco) que resolve a pendência.
    const html = painel({
      autorizada: false,
      termo: { estado: "ausente" },
      das: guia("DAS", { vencida: true }),
      situacaoFiscal: {
        atual: { id: "00000000-0000-0000-0000-0000000000c1", regular: false, pendencias: "Pendência - Débito (SIMPLES NACIONAL)", prontoEm: new Date("2026-09-01T12:00:00Z"), temPdf: false },
        processando: false,
      },
      pendencias: ["Imposto vencido sem pagamento"],
      mesesComGuia: [], // o que page.tsx entrega sem a autorização
    });
    const t = visivel(html);
    assert.match(t, /DAS Simples Nacional Vencido/);
    assert.doesNotMatch(t, /Nenhuma guia vencida aqui/, "a faixa diz que não há guia vencida enquanto o cartão do DAS do mesmo mês mostra Vencido");
  });
});
