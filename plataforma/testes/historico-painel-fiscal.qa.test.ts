// QA da Parte 8 (painel e histórico no desenho do ../fiscal): casos de borda que os testes do engenheiro não cobrem.
// Virada de ano na RBT12, arredondamento de centavos na diferença, mês com receita zero, as outras situações do mês,
// os cartões do celular, a linha da divergência do CNAE e a regra de não repetir no painel um aviso que já está no sino.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { apurar } from "@contabilizadev/nucleo/apuracao";
import { regraDoCnae } from "@contabilizadev/nucleo/cnae";
import { PainelDoMes, type DadosDoPainel } from "@/app/(painel)/painel-do-mes";
import { TelaDoHistorico } from "@/app/(painel)/historico/tela-historico";
import { avisoDaDeclaracaoAnual } from "@/lib/defis/prazo";
import { conferenciaDoHistorico } from "@/lib/historico/conferencia";
import type { MesDoHistorico } from "@/lib/historico/leitura";
import { resumoDoMes } from "@/lib/painel/resumo";
import type { BaseDoMes } from "@/lib/rotina/base";
import type { GuiaDoMes } from "@/lib/rotina/guias";
import { explicacoes, semExplicacoes, texto } from "./tela";

const REGRA = regraDoCnae("6209100");
const EMPRESA = { regra: REGRA, inicioAtividade: undefined };
const visivel = (html: string) => texto(semExplicacoes(html));

const mes = (pa: string, extra: Partial<MesDoHistorico> = {}): MesDoHistorico => ({
  pa,
  situacao: "pago",
  declaracao: { numero: `0000000${pa.replace("-", "")}001`, tipo: "original", transmitidaEm: null, malha: null },
  receita: null,
  valorDas: null,
  das: null,
  vencimento: `${pa}-20`,
  pagoEm: null,
  extrato: null,
  divergencia: null,
  ...extra,
});
const vazio = { fontesReceita: {}, folhas: {}, fontesFolha: {} };
const tela = (meses: MesDoHistorico[], receitas: Record<string, number>, extra: { mostrarProLabore?: boolean } = {}) =>
  renderToStaticMarkup(
    createElement(TelaDoHistorico, {
      dados: { linhas: conferenciaDoHistorico(meses, { ...vazio, receitas }, EMPRESA), mostrarProLabore: false, importado: true, autorizada: true, ...extra },
    }),
  );

describe("QA: conferência do histórico, casos de borda", () => {
  it("virada de ano: a RBT12 de janeiro soma exatamente os 12 meses do ano anterior (nem o próprio mês, nem o 13º)", () => {
    const receitas: Record<string, number> = { "2024-12": 99_999 };
    for (let m = 1; m <= 12; m++) receitas[`2025-${String(m).padStart(2, "0")}`] = 10_000;
    receitas["2026-01"] = 7_000;
    const [jan] = conferenciaDoHistorico([mes("2026-01", { receita: 7_000 })], { ...vazio, receitas }, EMPRESA);
    assert.equal(jan.rbt12, 120_000);
    assert.equal(jan.rbt12Incompleta, false);
    assert.equal(jan.receitaTotal, 7_000);
  });

  it("diferença de meio centavo arredonda para R$ 0,00 e fica verde (não vermelha)", () => {
    const receitas: Record<string, number> = {};
    for (let m = 1; m <= 12; m++) receitas[`2025-${String(m).padStart(2, "0")}`] = 10_000;
    receitas["2026-01"] = 7_000;
    const [base] = conferenciaDoHistorico([mes("2026-01")], { ...vazio, receitas }, EMPRESA);
    const das = base.dasCalculado!;
    const [l] = conferenciaDoHistorico([mes("2026-01", { receita: 7_000, valorDas: das + 0.004 })], { ...vazio, receitas }, EMPRESA);
    assert.ok(Math.abs(l.diferenca!) < 0.005);
    // centavos(-0,004) é -0, e brl(-0) mostra "-R$ 0,00": a tela não pode mostrar zero negativo.
    const html = tela([mes("2026-01", { receita: 7_000, valorDas: das + 0.004 })], receitas);
    assert.match(html, /<span class="text-accent-ink">R\$\s0,00<\/span>/);
  });

  it("mês declarado com receita zero: DAS calculado R$ 0,00 (não '—') e diferença zero com o DAS zerado", () => {
    const receitas: Record<string, number> = { "2026-03": 0 };
    for (let m = 3; m <= 12; m++) receitas[`2025-${String(m).padStart(2, "0")}`] = 10_000;
    receitas["2026-01"] = 10_000;
    receitas["2026-02"] = 10_000;
    const [l] = conferenciaDoHistorico([mes("2026-03", { receita: 0, valorDas: 0, situacao: "sem-valor" })], { ...vazio, receitas }, EMPRESA);
    assert.equal(l.receitaTotal, 0);
    assert.equal(l.dasCalculado, 0);
    assert.equal(l.diferenca, 0);
  });

  it("pró-labore zero: INSS R$ 0,00 (não '—'); sem pró-labore: '—'", () => {
    const [z] = conferenciaDoHistorico([mes("2026-09")], { ...vazio, receitas: {}, folhas: { "2026-09": 0 } }, EMPRESA);
    assert.equal(z.prolabore, 0);
    assert.equal(z.inss, 0);
    const [n] = conferenciaDoHistorico([mes("2026-09")], { ...vazio, receitas: {} }, EMPRESA);
    assert.equal(n.inss, null);
  });
});

describe("QA: tela do histórico, estados que faltavam", () => {
  it("as outras situações do mês (sem declaração, sem guia, sem valor, a declarar) aparecem com a pílula e o tooltip", () => {
    const meses = [
      mes("2026-05", { situacao: "nao-declarado", declaracao: null }),
      mes("2026-06", { situacao: "sem-guia" }),
      mes("2026-07", { situacao: "sem-valor" }),
      mes("2026-09", { situacao: "no-prazo", declaracao: null }),
    ];
    const html = tela(meses, {});
    const t = visivel(html);
    for (const r of ["Sem declaração", "Sem guia", "Sem valor a pagar", "A declarar"]) assert.match(t, new RegExp(r));
    const rotulos = explicacoes(html).map((e) => e.rotulo);
    assert.ok(rotulos.some((r) => r === 'O que quer dizer "Sem declaração" em maio de 2026?'));
  });

  it("retificadora: a marca 'Retificada' no mês, também no cartão do celular", () => {
    const html = tela([mes("2026-09", { declaracao: { numero: "1", tipo: "retificadora", transmitidaEm: null, malha: null } })], {});
    const celular = /<ul[^>]*aria-label="Histórico mensal"[\s\S]*?<\/ul>/.exec(html)?.[0] ?? "";
    assert.match(texto(celular), /Retificada/);
  });

  it("divergência do CNAE: a marca também no cartão do celular e o link do portal abre fora com rel noopener", () => {
    const divergencia = { pa: "2026-08", declarada: 17, esperada: 16, titulo: "Atividade declarada diferente do CNAE", texto: "Em 08/2026 a declaração usou outra atividade.", explicacao: ["Retifique."] };
    const html = tela([mes("2026-08", { divergencia })], {});
    const celular = /<ul[^>]*aria-label="Histórico mensal"[\s\S]*?<\/ul>/.exec(html)?.[0] ?? "";
    assert.match(texto(celular), /Atividade não bate com o CNAE/);
    assert.match(html, /target="_blank" rel="noopener noreferrer"[^>]*>Retificar no /);
  });

  it("divergência do CNAE: a linha em destaque não usa o verde de 'tudo certo' (bg-accent), e sim um tom de alerta", () => {
    const divergencia = { pa: "2026-08", declarada: 17, esperada: 16, titulo: "Atividade declarada diferente do CNAE", texto: "Em 08/2026 a declaração usou outra atividade.", explicacao: ["Retifique."] };
    const html = tela([mes("2026-08", { divergencia })], {});
    const linha = /<tr class="([^"]*)"/.exec(/<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "")?.[1] ?? "";
    assert.doesNotMatch(linha, /bg-accent\//, `a linha com erro de CNAE está pintada de verde: "${linha}"`);
  });
});

// O painel não deve repetir aviso que a central do sino já mostra (lib/avisos/fontes.ts tem `defis:<ano>`).
describe("QA: painel sem repetir avisos do sino", () => {
  const RECEITAS = {
    "2025-09": 25_228.39, "2025-10": 19_224.3, "2025-11": 27_350.21, "2025-12": 24_655.48, "2026-01": 21_869.17, "2026-02": 25_798.12,
    "2026-03": 37_582, "2026-04": 24_985.4, "2026-05": 45_494.12, "2026-06": 47_400, "2026-07": 26_503.41, "2026-08": 26_908.25,
  };
  const b: BaseDoMes = {
    pa: "2026-09", mesAtual: "2026-10", hoje: "2026-10-18", cnpj: "98765432000198", regra: REGRA, semRegra: null, inicioAtividade: undefined,
    lancamentos: [], receitaLancada: 23_000, vigente: null, receitaDeclarada: null, semReceita: false, receitaPendente: false, receita: 23_000,
    prolabore: 1_621, prolaboreDoMesAtual: null, receitas: RECEITAS, fontesReceita: {}, folhas: {}, fontesFolha: {},
    apuracao: apurar({ pa: "2026-09", receita: 23_000, receitas: RECEITAS, folhas: {}, regra: REGRA }), erro: null,
  };
  const guia = (tipo: "DAS" | "INSS"): GuiaDoMes => ({
    pa: "2026-09", tipo, referencia: null, vencimento: "2026-10-20", paga: false, pagaEm: null, vencida: false, original: null, atualizada: null, pagarEmSugerido: "2026-10-19",
  });

  it("a declaração anual já está no sino: o painel não repete a faixa dela", () => {
    const defis = avisoDaDeclaracaoAnual("2027-02-10", null)!;
    const dados: DadosDoPainel = {
      empresaId: "00000000-0000-0000-0000-000000000001", base: b, resumo: resumoDoMes(b), ultimo: "2026-09", das: guia("DAS"), inss: guia("INSS"),
      situacaoFiscal: { atual: null, processando: false }, pendencias: [], mesesComGuia: [], autorizada: true, termo: { estado: "propria" },
    };
    const html = renderToStaticMarkup(createElement(PainelDoMes, { dados, acoes: { lancar: async () => undefined, remover: async () => {}, gerar: async () => undefined } }));
    assert.doesNotMatch(visivel(html), new RegExp(defis.titulo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "a faixa da declaração anual repete o aviso defis:<ano> do sino");
  });
});
