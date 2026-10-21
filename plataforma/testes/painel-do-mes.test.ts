// Painel do mês (página inicial) no desenho do ../fiscal (app/page.tsx): o resumo do mês (lib/painel/resumo.ts) e a tela
// renderizada (HTML do servidor, como o navegador recebe) nos estados principais: regular, irregular com guia vencida, sem
// autorização (modo guiado), receita pendente (previsão), mês em andamento, e sem empresa ou sem plano (portão). Confere a
// ordem dos blocos do ../fiscal, as cores (verde regular, vermelho vencido), as explicações só no tooltip e nada do
// fornecedor na tela.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { apurar } from "@contabilizadev/nucleo/apuracao";
import { regraDoCnae } from "@contabilizadev/nucleo/cnae";
import { PainelDoMes, type DadosDoPainel } from "@/app/(painel)/painel-do-mes";
import { PortaoFechado } from "@/app/(painel)/portao";
import { abaDaEmpresa } from "@/lib/abas";
import { avisoDoTermo } from "@/lib/avisos/fontes";
import { avisoDaDeclaracaoAnual } from "@/lib/defis/prazo";
import { avisoDaSituacao } from "@/lib/termo/situacao";
import { receitaPrevista, resumoDoMes } from "@/lib/painel/resumo";
import type { BaseDoMes } from "@/lib/rotina/base";
import type { Guia, GuiaDoMes } from "@/lib/rotina/guias";
import { explicacoes, paragrafosVisiveis, semExplicacoes, texto } from "./tela";

const APP = path.join(import.meta.dirname, "..", "app", "(painel)");
const FORNECEDOR = /serpro|integra\s*contador|brasil\s*api|\b(PGDASD|SITFIS|CAIXAPOSTAL)\b/i;
const visivel = (html: string) => texto(semExplicacoes(html));

// O caso real de referência: 09/2026, receita 23.000, RBT12 352.998,85, Anexo III, DAS 1.000,76; pró-labore 1.621.
const RECEITAS = {
  "2025-09": 25_228.39, "2025-10": 19_224.3, "2025-11": 27_350.21, "2025-12": 24_655.48, "2026-01": 21_869.17, "2026-02": 25_798.12,
  "2026-03": 37_582, "2026-04": 24_985.4, "2026-05": 45_494.12, "2026-06": 47_400, "2026-07": 26_503.41, "2026-08": 26_908.25,
};
const REGRA = regraDoCnae("6209100");
function base(extra: Partial<BaseDoMes> = {}): BaseDoMes {
  const pa = extra.pa ?? "2026-09";
  const receita = extra.receita ?? 23_000;
  return {
    pa,
    mesAtual: "2026-10",
    hoje: "2026-10-18",
    cnpj: "98765432000198",
    regra: REGRA,
    semRegra: null,
    inicioAtividade: undefined,
    lancamentos: [],
    receitaLancada: 23_000,
    vigente: null,
    receitaDeclarada: null,
    semReceita: false,
    receitaPendente: false,
    receita,
    prolabore: 1_621,
    prolaboreDoMesAtual: null,
    receitas: RECEITAS,
    fontesReceita: {},
    folhas: {},
    fontesFolha: {},
    apuracao: apurar({ pa, receita, receitas: RECEITAS, folhas: {}, regra: REGRA }),
    erro: null,
    ...extra,
  };
}

const ORIGINAL: Guia = {
  id: "00000000-0000-0000-0000-0000000000a1",
  empresaId: "00000000-0000-0000-0000-000000000001",
  pa: "2026-09",
  tipo: "DAS",
  referencia: "98765432202609001",
  pagarEm: null,
  numero: "07202609000000001",
  vencimento: "2026-10-20",
  principal: null,
  multa: null,
  juros: null,
  total: 1000.76,
  geradaEm: new Date("2026-10-10T12:00:00Z"),
  usuarioId: null,
};
const guia = (tipo: "DAS" | "INSS", extra: Partial<GuiaDoMes> = {}): GuiaDoMes => ({
  pa: "2026-09",
  tipo,
  referencia: tipo === "DAS" ? "98765432202609001" : null,
  vencimento: "2026-10-20",
  paga: false,
  pagaEm: null,
  vencida: false,
  original: null,
  atualizada: null,
  pagarEmSugerido: "2026-10-19",
  ...extra,
});

const LANCAMENTO = {
  id: "00000000-0000-0000-0000-0000000000b1",
  empresaId: "00000000-0000-0000-0000-000000000001",
  pa: "2026-09",
  recebidaEm: "2026-10-05",
  moeda: "USD",
  valorMoeda: 4_200,
  valorBrl: 23_000,
  origemValor: "reais",
  cotacao: 5.4762,
  cotacaoData: null,
  observacao: null,
  lancadaEm: new Date("2026-10-05T12:00:00Z"),
  lancadaPorId: null,
} as BaseDoMes["lancamentos"][number];

const REGULAR = { atual: { id: "00000000-0000-0000-0000-0000000000c1", regular: true, pendencias: null, prontoEm: new Date("2026-10-18T13:05:00Z"), temPdf: true }, processando: false };

function dados(extra: Partial<DadosDoPainel> = {}, b: BaseDoMes = base({ lancamentos: [LANCAMENTO] })): DadosDoPainel {
  return {
    empresaId: "00000000-0000-0000-0000-000000000001",
    base: b,
    resumo: resumoDoMes(b),
    ultimo: "2026-09",
    das: guia("DAS", { original: ORIGINAL }),
    inss: guia("INSS"),
    situacaoFiscal: REGULAR,
    pendencias: [],
    mesesComGuia: [],
    autorizada: true,
    termo: { estado: "propria" },
    ...extra,
  };
}
const acao = async () => undefined;
const ACOES = { lancar: acao, remover: async () => {}, gerar: acao };
const painel = (d: DadosDoPainel) => renderToStaticMarkup(createElement(PainelDoMes, { dados: d, acoes: ACOES }));

// Regras de tela comuns a todos os estados.
function conferir(html: string) {
  assert.doesNotMatch(texto(html), FORNECEDOR);
  const rotulos = explicacoes(html).map((e) => e.rotulo);
  assert.equal(new Set(rotulos).size, rotulos.length, `rótulos repetidos: ${rotulos.join(" | ")}`);
  for (const p of paragrafosVisiveis(html)) assert.ok(p.length <= 140, `parágrafo longo aberto na tela: ${p}`);
}

describe("resumo do mês (lib/painel/resumo.ts)", () => {
  it("caso real: DAS de R$ 1.000,76 + DARF do INSS de R$ 178,31; as partes e a faixa 2 do Anexo III", () => {
    const r = resumoDoMes(base());
    assert.equal(r.receita, 23_000);
    assert.equal(r.previsao, null);
    assert.equal(r.das, 1000.76);
    assert.equal(r.inss, 178.31);
    assert.equal(r.total, 1179.07);
    assert.deepEqual(r.partes.map((p) => p.nome), ["IRPJ", "CSLL", "INSS patronal", "DARF do INSS"]);
    assert.equal(Math.round(r.partes.slice(0, 3).reduce((s, p) => s + p.valor, 0) * 100) / 100, 1000.76);
    assert.equal(r.faixa?.numero, 2);
    assert.equal(r.faixa?.anexo, "III");
    assert.equal(r.faixa?.teto, 360_000);
    assert.equal(r.faixa?.limites.length, 6);
    assert.ok(Math.abs(r.faixa!.naFaixa - (352_998.85 - 180_000) / 180_000) < 1e-9);
    assert.deepEqual(r.mesesSemReceita, []);
    assert.equal(r.erro, null);
  });

  it("receita pendente: a previsão (média das 3 últimas receitas positivas) entra no cálculo, nunca como receita", () => {
    assert.equal(receitaPrevista(RECEITAS, "2026-09"), 33_603.89); // (26.908,25 + 26.503,41 + 47.400) / 3
    assert.equal(receitaPrevista({ "2026-08": 0, "2026-07": 10_000, "2026-05": 20_000 }, "2026-09"), 15_000); // pula mês zerado ou ausente
    assert.equal(receitaPrevista({}, "2026-09"), 0);
    assert.equal(receitaPrevista({ "2025-08": 9_000 }, "2026-09"), 0); // só os 12 meses anteriores
    const r = resumoDoMes(base({ receitaLancada: null, receitaPendente: true, receita: 0 }));
    assert.equal(r.receita, null);
    assert.equal(r.previsao, 33_603.89);
    assert.equal(r.apuracao?.receita, 33_603.89);
    assert.ok(r.das! > 1000.76);
  });

  it("sem pró-labore: sem DARF do INSS (nem parte no total); mês sem receita marcado: DAS zero", () => {
    const r = resumoDoMes(base({ prolabore: null }));
    assert.equal(r.inss, null);
    assert.equal(r.total, 1000.76);
    assert.ok(!r.partes.some((p) => p.tributo === "inss"));
    const zero = resumoDoMes(base({ receitaLancada: null, semReceita: true, receita: 0 }));
    assert.equal(zero.receita, 0);
    assert.equal(zero.das, 0);
  });

  it("empresa fora do escopo: sem cálculo, com o motivo; histórico incompleto: os meses sem receita", () => {
    const fora = resumoDoMes(base({ regra: null, semRegra: "Esta empresa ainda não é atendida.", apuracao: null }));
    assert.equal(fora.apuracao, null);
    assert.equal(fora.faixa, null);
    assert.equal(fora.total, 178.31);
    assert.equal(fora.erro, "Esta empresa ainda não é atendida.");
    const receitas = { ...RECEITAS } as Record<string, number>;
    delete receitas["2025-10"];
    delete receitas["2025-11"];
    const incompleta = resumoDoMes(base({ receitas, apuracao: apurar({ pa: "2026-09", receita: 23_000, receitas, folhas: {}, regra: REGRA }) }));
    assert.deepEqual(incompleta.mesesSemReceita, ["2025-10", "2025-11"]);
  });

  it("Fator R: a atividade que depende dele traz o valor e o anexo na faixa", () => {
    const regra = regraDoCnae("6201501");
    const folhas = Object.fromEntries(Object.keys(RECEITAS).map((m) => [m, 10_000]));
    const b = base({ regra, folhas, apuracao: apurar({ pa: "2026-09", receita: 23_000, receitas: RECEITAS, folhas, regra }) });
    const r = resumoDoMes(b);
    assert.ok(r.apuracao?.fatorR);
    assert.equal(r.faixa?.anexo, r.apuracao!.anexo);
  });
});

describe("painel do mês: os blocos do ../fiscal na mesma ordem", () => {
  it("regular: cabeçalho do mês, situação verde, destaque verde com o total, receita, lançar com as guias, guias do mês e alíquota", () => {
    const html = painel(dados());
    conferir(html);
    const t = visivel(html);
    // Cabeçalho do mês com as setas e o "Último mês".
    assert.match(t, /Apuração setembro de 2026/);
    assert.match(html, /<a(?=[^>]*href="\/\?mes=2026-08")(?=[^>]*aria-label="Mês anterior")[^>]*>/);
    assert.match(html, /<a(?=[^>]*href="\/\?mes=2026-10")(?=[^>]*aria-label="Próximo mês")[^>]*>/);
    assert.match(t, /Último mês/);
    // Ordem dos blocos, como no ../fiscal.
    const ordem = ["Situação fiscal", "Total a pagar", "Receita", "Guias e alíquota"].map((r) => html.indexOf(`aria-label="${r}"`));
    assert.ok(ordem.every((i, n) => i > 0 && (n === 0 || i > ordem[n - 1])), `ordem: ${ordem}`);
    assert.ok(html.indexOf("Lançar setembro de 2026") > ordem[2] && html.indexOf("Lançar setembro de 2026") < ordem[3]);
    // Situação fiscal regular em verde.
    assert.match(t, /Situação fiscal · Receita e PGFN Empresa regular Verificada em 18\/10\/2026 · próxima em 18\/12\/2026/);
    assert.match(html, /border-accent-ink\/30 bg-accent\/15/);
    assert.match(html, /href="\/documentos\/situacao\/00000000-0000-0000-0000-0000000000c1"[^>]*>Ver relatório</);
    assert.match(html, /href="\/situacao"[^>]*>Detalhes</);
    // Destaque verde com o total (DAS + DARF) e as partes.
    assert.match(html, /from-hero to-hero-deep/);
    assert.doesNotMatch(html, /from-hero-vencido/);
    assert.match(t, /Total a pagar até 20\/10\/2026 R\$\s1\.179,07 Calculado/);
    assert.match(t, /IRPJ R\$\s[\d.,]+ CSLL R\$\s[\d.,]+ INSS patronal R\$\s[\d.,]+ DARF do INSS R\$\s178,31/);
    // Receita do mês e dos 12 meses.
    assert.match(t, /Recebido no banco R\$\s23\.000,00 Receita em 12 meses R\$\s352\.998,85/);
    // Lançar: o formulário, o lançamento com Remover e as guias deste mês.
    assert.match(html, /name="recebidaEm"/);
    assert.match(t, /R\$\s23\.000,00 · USD 4\.200,00 · caiu em 05\/10\/2026 Remover/);
    assert.match(html, /id="guias"/);
    assert.match(t, /Guias deste mês DAS Simples Nacional Em aberto R\$\s1\.000,76 Vence em 20\/10\/2026 Abrir guia Baixar/);
    assert.match(html, /href="\/documentos\/guia\/00000000-0000-0000-0000-0000000000a1" download=""/);
    assert.match(t, /DARF INSS do pró-labore Em aberto R\$\s178,31 Vence em 20\/10\/2026 · valor calculado aqui Enviar o pró-labore na rotina do mês/);
    assert.match(html, /href="\/roteiro\?mes=2026-09#passo-6"/);
    // Guias do mês e alíquota.
    assert.match(t, /Guias do mês DAS calculado R\$\s1\.000,76 DARF do INSS · 11% de R\$\s1\.621,00 R\$\s178,31 Total R\$\s1\.179,07/);
    assert.match(t, /DAS emitido: R\$\s1\.000,76\. Diferença para o cálculo: R\$\s0,00\./);
    assert.match(t, /Alíquota 4,35% paga na exportação Faixa 2 de 6 do Anexo III, até R\$\s360\.000,00 em 12 meses\. Alíquota efetiva da tabela/);
    // Com a autorização, sem o modo guiado.
    assert.doesNotMatch(t, /Modo guiado|Faça no portal/);
    // Explicações que o ../fiscal deixa abertas (Nota) ficam no tooltip.
    assert.doesNotMatch(t, /Estimativa pela média|Depois de trabalhar e receber/);
    assert.ok(explicacoes(html).some((e) => /Depois de trabalhar e receber/.test(e.texto)));
  });

  it("irregular com guia vencida: faixa vermelha com as pendências e o botão das novas guias; destaque vermelho e a guia com juros", () => {
    const vencida = guia("DAS", { original: ORIGINAL, vencida: true });
    const b = base({ lancamentos: [LANCAMENTO], hoje: "2026-10-25" });
    const html = painel(
      dados(
        {
          das: vencida,
          inss: guia("INSS", { paga: true, pagaEm: "2026-10-19" }),
          situacaoFiscal: { atual: { ...REGULAR.atual, regular: false, pendencias: "Pendência - Débito (SIMPLES NACIONAL)" }, processando: false },
          pendencias: ["Imposto vencido sem pagamento"],
          mesesComGuia: ["2026-09"],
        },
        b,
      ),
    );
    conferir(html);
    const t = visivel(html);
    assert.match(html, /border-bad\/40 bg-bad\/10/);
    assert.match(t, /Empresa com pendências Imposto vencido sem pagamento Verificada em 18\/10\/2026/);
    assert.match(html, /href="\/\?mes=2026-09#guias"[^>]*>Gerar novas guias</);
    assert.doesNotMatch(t, /SIMPLES NACIONAL/); // o texto cru do relatório não vai para a tela
    assert.match(html, /from-hero-vencido to-hero-vencido-deep/);
    assert.match(t, /Venceu em 20\/10\/2026 e não foi pago R\$\s1\.179,07 Sem multa e juros\. Gere as guias atualizadas abaixo\. Vencido/);
    assert.match(t, /DAS Simples Nacional Vencido R\$\s1\.000,76 Venceu em 20\/10\/2026 Guia original Baixar Passou do vencimento\. Gere uma nova com multa e juros\./);
    assert.match(html, /<input(?=[^>]*type="date")(?=[^>]*name="pagarEm")(?=[^>]*value="2026-10-19")[^>]*>/);
    assert.match(t, /Gerar guia com multa e juros/);
    assert.match(t, /DARF INSS do pró-labore Pago R\$\s178,31 Pago em 19\/10\/2026/);
  });

  it("vencida com a guia atualizada já gerada: o valor com multa e juros e o link para abrir", () => {
    const atualizada: Guia = { ...ORIGINAL, id: "00000000-0000-0000-0000-0000000000a2", pagarEm: "2026-10-27", principal: 1000.76, multa: 20.02, juros: 10, total: 1030.78 };
    const html = painel(dados({ das: guia("DAS", { original: ORIGINAL, vencida: true, atualizada }) }, base({ lancamentos: [LANCAMENTO], hoje: "2026-10-25" })));
    const t = visivel(html);
    assert.match(t, /Guia atualizada para pagar até 27\/10\/2026 R\$\s1\.030,78 R\$\s1\.000,76 \+ multa R\$\s20,02 \+ juros R\$\s10,00 Abrir guia atualizada Baixar/);
    assert.match(t, /Gerar para outra data/);
    assert.ok(explicacoes(html).some((e) => /multa e juros mudam a cada dia/.test(e.texto)));
  });

  it("sem autorização: a faixa do modo guiado, nada gerado aqui (o caminho no portal) e as funções no modo guiado", () => {
    const html = painel(dados({ autorizada: false, termo: { estado: "ausente" }, das: guia("DAS"), situacaoFiscal: { atual: null, processando: false } }));
    conferir(html);
    const t = visivel(html);
    assert.match(t, /Modo guiado\. Sem a autorização em dia, você faz no portal com os valores daqui\. Autorizar/);
    assert.match(html, /href="\/autorizacao"[^>]*>Autorizar</);
    assert.match(t, /Situação fiscal ainda não verificada Sem a autorização, consulte no e-CAC/);
    assert.doesNotMatch(t, /próxima em/);
    assert.match(t, /DAS Simples Nacional Em aberto R\$\s1\.000,76 Vence em 20\/10\/2026 · valor calculado aqui Gerar no portal/);
    // O botão leva ao portal oficial; os passos ficam no tooltip.
    assert.match(html, /href="https:\/\/www8\.receita\.fazenda\.gov\.br\/SimplesNacional\/[^"]*"[^>]*>Gerar no portal</);
    assert.ok(explicacoes(html).some((e) => /Emitir Guia de Pagamento \(DAS\)/.test(e.texto)));
    assert.doesNotMatch(t, /Gerar guia\b/);
    assert.equal([...html.matchAll(/<details/g)].length, 7); // as funções da Receita, cada uma com o caminho no portal
    assert.match(t, /Faça no portal/);
    // Vencida sem autorização: só o caminho no portal.
    const vencida = visivel(painel(dados({ autorizada: false, termo: { estado: "ausente" }, das: guia("DAS", { vencida: true }) }, base({ lancamentos: [LANCAMENTO], hoje: "2026-10-25" }))));
    assert.match(vencida, /Passou do vencimento\. Gerar a nova no portal/);
    assert.doesNotMatch(vencida, /Gerar guia com multa e juros/);
  });

  it("receita pendente: a previsão em destaque (tracejado), o DAS previsto e o formulário de lançar; sem guias ainda", () => {
    const b = base({ receitaLancada: null, receitaPendente: true, receita: 0 });
    const html = painel(dados({ das: guia("DAS", { referencia: null }) }, b));
    conferir(html);
    const t = visivel(html);
    assert.match(t, /Previsão/);
    assert.match(t, /Recebido no banco Previsão ~ R\$\s33\.603,89/);
    assert.match(html, /border-dashed/);
    assert.match(t, /DAS previsto/);
    assert.match(html, /name="recebidaEm"/);
    // O mesmo formulário do mês em andamento (mesmos campos), agora com o botão de lançar ligado.
    assert.match(t, /Valor que caiu no banco \(R\$\)/);
    assert.match(t, /Data em que caiu/);
    assert.match(html, /<button[^>]*>Lançar<\/button>/);
    assert.doesNotMatch(html, /Lançar a partir de|data-bloqueado/);
    assert.doesNotMatch(html, /id="guias"/);
    assert.ok(explicacoes(html).some((e) => /média das últimas três receitas/.test(e.texto)));
  });

  it("mês declarado: nada a lançar e as guias; mês em andamento: o botão de lançar desligado até o mês acabar", () => {
    const declarado = visivel(painel(dados({}, base({ receitaLancada: null, receitaDeclarada: 23_000 }))));
    assert.match(declarado, /setembro de 2026 Já declarado na Receita Federal com R\$\s23\.000,00\. Não há nada a lançar\./);
    assert.match(declarado, /Guias deste mês/);
    const b = base({ pa: "2026-10", receitaLancada: null, receitaPendente: true, receita: 0 });
    const html = painel(dados({ das: guia("DAS", { pa: "2026-10", referencia: null, vencimento: "2026-11-20" }), inss: guia("INSS", { pa: "2026-10", vencimento: "2026-11-20" }) }, b));
    const t = visivel(html);
    // Como no ../fiscal: a frase com a data, os campos já à vista (data com o dia de hoje) e o botão desligado ao lado.
    assert.match(t, /Lançar outubro de 2026 Outubro de 2026 ainda está em andamento\. O botão de lançar é liberado em 01\/11\/2026\./);
    assert.match(t, /Valor que caiu no banco \(R\$\)/);
    assert.match(t, /Data em que caiu/);
    assert.match(html, /<input [^>]*name="valor"/);
    assert.match(html, /<input [^>]*type="date"[^>]*name="recebidaEm"[^>]*value="2026-10-18"|<input [^>]*name="recebidaEm"[^>]*value="2026-10-18"/);
    assert.match(html, /<button type="button" disabled=""[^>]*>Lançar a partir de <!-- -->01\/11\/2026<\/button>|<button type="button" disabled=""[^>]*>Lançar a partir de 01\/11\/2026<\/button>/);
    // O envio fica bloqueado: nenhum botão de enviar no formulário (o servidor também recusa o mês em andamento).
    const form = html.slice(html.indexOf('name="recebidaEm"') - 2000, html.indexOf("Lançar a partir de"));
    assert.doesNotMatch(form, /<button type="submit"|<button class="[^"]*"[^>]*>Lançar<\/button>/);
    assert.doesNotMatch(t, /\bLançar\b(?! (a partir|outubro))/);
    assert.match(html, /<form[^>]*data-bloqueado="true"/);
    assert.doesNotMatch(html, /id="guias"/);
    assert.doesNotMatch(html, /from-hero-vencido/);
  });

  it("faixas do ../fiscal: histórico incompleto curto e com a ação; a declaração anual não aparece (fica só no sino)", () => {
    const receitas = { ...RECEITAS } as Record<string, number>;
    delete receitas["2025-10"];
    const b = base({ receitas, apuracao: apurar({ pa: "2026-09", receita: 23_000, receitas, folhas: {}, regra: REGRA }) });
    const html = painel(dados({}, b));
    conferir(html);
    const t = visivel(html);
    assert.match(t, /Histórico incompleto\. Faltam receitas em 1 dos 12 meses anteriores\. Completar o histórico/);
    assert.ok(explicacoes(html).some((e) => /outubro de 2025/.test(e.texto)));
    // O aviso defis:<ano> já está na central do sino (lib/avisos/fontes.ts): o painel não repete.
    const defis = avisoDaDeclaracaoAnual("2027-02-10", null);
    assert.ok(defis);
    assert.doesNotMatch(t, new RegExp(defis.titulo));
    assert.doesNotMatch(t, /Preparar a declaração/);
    assert.doesNotMatch(html, /href="\/defis"/);
  });

  it("DAS emitido com meio centavo a mais: a diferença sai R$ 0,00 em verde, nunca -R$ 0,00", () => {
    const b = base({ lancamentos: [LANCAMENTO] });
    const das = resumoDoMes(b).das!;
    const html = painel(dados({ das: guia("DAS", { original: { ...ORIGINAL, total: das + 0.004 } }) }, b));
    const t = visivel(html);
    assert.match(t, /Diferença para o cálculo: R\$\s0,00\./);
    assert.doesNotMatch(t, /-R\$\s0,00/);
    assert.match(html, /text-accent-ink">DAS emitido/);
  });

  it("sem pró-labore informado: o DARF fica 'A informar' (nunca vencido) e leva ao passo do pró-labore; o DAS declarado vale", () => {
    const b = base({ lancamentos: [], receitaLancada: null, receitaDeclarada: 23_000, prolabore: null, hoje: "2026-10-25" });
    const html = painel(dados({ das: guia("DAS", { declarado: 1000.76, paga: true, pagaEm: "2026-10-15" }), inss: guia("INSS") }, b));
    conferir(html);
    const t = visivel(html);
    assert.match(t, /DAS Simples Nacional Pago R\$\s1\.000,76 Pago em 15\/10\/2026 · valor declarado/);
    assert.match(t, /DARF INSS do pró-labore A informar — Pró-labore do mês não informado Informar o pró-labore/);
    assert.match(html, /href="\/roteiro\?mes=2026-09#passo-2"[^>]*>Informar o pró-labore</);
    assert.doesNotMatch(html, /from-hero-vencido/); // sem pró-labore, o DARF não deixa o mês vencido
    assert.match(t, /DAS declarado: R\$\s1\.000,76\. Diferença para o cálculo: R\$\s0,00\./);
  });

  it("empresa fora do escopo: o destaque sem total, com o motivo e o link para os dados da empresa", () => {
    const b = base({ regra: null, semRegra: "Esta empresa ainda não é atendida pela rotina do mês.", apuracao: null });
    const html = painel(dados({}, b));
    const t = visivel(html);
    assert.match(t, /Total a pagar até 20\/10\/2026 — Esta empresa ainda não é atendida pela rotina do mês\. Dados da empresa/);
    assert.match(html, /href="\/empresa"/);
  });

  it("DARF da DCTFWeb vencido num mês sem receita lançada nem declarada: o destaque vermelho e a faixa levam às guias, que aparecem", () => {
    const darf = guia("INSS", { referencia: "98765432202609999", vencida: true });
    const semDas = guia("DAS", { referencia: null });
    for (const b of [
      base({ receitaLancada: null, receitaPendente: true, receita: 0, hoje: "2026-10-25" }),
      base({ receitaLancada: null, receitaPendente: false, semReceita: true, receita: 0, hoje: "2026-10-25" }),
    ]) {
      const html = painel(dados({ das: semDas, inss: darf }, b));
      const t = visivel(html);
      assert.match(html, /from-hero-vencido/);
      assert.match(html, /id="guias"/);
      assert.match(t, /DARF INSS do pró-labore Vencido/);
      assert.match(t, /Gerar guia com multa e juros/);
    }
    // Empresa irregular: o botão da situação fiscal aponta para #guias deste mês, que existe na página.
    const irregular = { atual: { id: "00000000-0000-0000-0000-0000000000c2", regular: false, pendencias: "Pendência - Débito (SIEF)", prontoEm: new Date("2026-10-22T13:00:00Z"), temPdf: false }, processando: false };
    const html = painel(dados({ das: semDas, inss: darf, situacaoFiscal: irregular, pendencias: ["Débito em aberto"], mesesComGuia: ["2026-09"] }, base({ receitaLancada: null, receitaPendente: true, receita: 0, hoje: "2026-10-25" })));
    assert.match(html, /href="\/\?mes=2026-09#guias"/);
    assert.match(html, /id="guias"/);
  });

  it("DARF da DCTFWeb vencido e o pró-labore não informado aqui: o destaque vermelho, o DARF no 'Guias do mês' e a faixa no mês", () => {
    const semProLabore = { receitaLancada: null, receitaPendente: true, receita: 0, hoje: "2026-10-25", prolabore: null } as const;
    // Só a referência (a DCTFWeb transmitida): o destaque fica vermelho, sem "Total a pagar" nem "Previsão".
    const darf = guia("INSS", { referencia: "98765432202609999", vencida: true });
    const html = painel(dados({ das: guia("DAS", { referencia: null }), inss: darf }, base(semProLabore)));
    const t = visivel(html);
    assert.match(html, /from-hero-vencido/);
    assert.match(t, /Venceu em 20\/10\/2026 e não foi pago/);
    assert.doesNotMatch(t, /Total a pagar até/);
    assert.match(t, /DARF INSS do pró-labore Vencido/);
    assert.match(t, /DARF do INSS · vencido/);
    assert.doesNotMatch(t, /pró-labore não informado/);
    // Com a guia gerada aqui, o valor dela entra no "Guias do mês", no total e na barra do destaque.
    const gerada = { ...ORIGINAL, tipo: "INSS" as const, referencia: "98765432202609999", total: 178.31 };
    const comValor = visivel(painel(dados({ das: guia("DAS", { referencia: null }), inss: { ...darf, original: gerada } }, base(semProLabore))));
    assert.match(comValor, /DARF do INSS · vencido R\$\s*178,31/);
    const r = resumoDoMes(base(semProLabore));
    const total = (Math.round((r.total + 178.31) * 100) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
    assert.ok(comValor.includes(`Total R$ ${total}`) || comValor.includes(`Total R$ ${total}`), `total com o DARF (${total})`);
    // Empresa irregular: o mês com o DARF vencido entra nos meses da faixa (o botão leva às guias deste mês).
    const irregular = { atual: { id: "00000000-0000-0000-0000-0000000000c3", regular: false, pendencias: "Pendência - Débito (SIEF)", prontoEm: new Date("2026-10-22T13:00:00Z"), temPdf: false }, processando: false };
    const comFaixa = painel(dados({ das: guia("DAS", { referencia: null }), inss: darf, situacaoFiscal: irregular, pendencias: ["Débito em aberto"] }, base(semProLabore)));
    assert.match(comFaixa, /href="\/\?mes=2026-09#guias"/);
    // Sem a guia existir e sem pró-labore: continua "pró-labore não informado" e nada vencido.
    const nada = visivel(painel(dados({ das: guia("DAS", { referencia: null }), inss: guia("INSS") }, base(semProLabore))));
    assert.match(nada, /pró-labore não informado/);
    assert.doesNotMatch(nada, /Venceu em/);
  });

  it("vencimento passado sem a guia existir: sem receita lançada nem declaração não fica vencido; com a receita, o caminho é declarar", () => {
    const semGuia = (tipo: "DAS" | "INSS") => guia(tipo, { referencia: null });
    // Só a previsão (nada lançado, nada declarado): como no ../fiscal (vencidaNoMes), o mês não está vencido.
    const previsao = painel(dados({ das: semGuia("DAS"), inss: semGuia("INSS") }, base({ receitaLancada: null, receitaPendente: true, receita: 0, hoje: "2026-10-25" })));
    assert.doesNotMatch(previsao, /from-hero-vencido/);
    assert.doesNotMatch(visivel(previsao), /Vencido|Gere as guias atualizadas/);
    assert.match(visivel(previsao), /Total a pagar até 20\/10\/2026/);
    // Receita lançada, sem declaração: DAS vencido, com o botão de declarar (a guia com juros só sai depois).
    const lancada = painel(dados({ das: semGuia("DAS"), inss: semGuia("INSS") }, base({ lancamentos: [LANCAMENTO], hoje: "2026-10-25" })));
    const t = visivel(lancada);
    assert.match(lancada, /from-hero-vencido/);
    assert.match(t, /Sem multa e juros\. Declare o mês e gere as guias atualizadas abaixo\./);
    assert.match(t, /DAS Simples Nacional Vencido R\$\s1\.000,76 Venceu em 20\/10\/2026 · valor calculado aqui Declarar na rotina do mês/);
    assert.match(lancada, /href="\/roteiro\?mes=2026-09#passo-4"/);
    assert.doesNotMatch(t, /Gerar guia com multa e juros/);
    // O DARF sem a DCTFWeb não existe ainda: não fica vencido, leva a enviar o pró-labore.
    assert.match(t, /DARF INSS do pró-labore Em aberto R\$\s178,31 Venceu em 20\/10\/2026 · valor calculado aqui Enviar o pró-labore na rotina do mês/);
  });

  it("termo vencido ou recusado: sem a faixa do modo guiado (o aviso já está no sino); nunca assinado: com a faixa", () => {
    const guardado = { validaAte: "2026-10-01", motivo: "vigencia" as const, diasRestantes: -17, signatario: { cnpj: "98765432000198", nome: "Empresa" }, enviadoEm: new Date("2025-10-01T12:00:00Z") };
    for (const termo of [
      { estado: "vencida" as const, ...guardado },
      { estado: "recusada" as const, recusadoEm: new Date("2026-10-02T12:00:00Z"), recusa: null, ...guardado },
    ]) {
      const html = painel(dados({ autorizada: false, termo }));
      assert.ok(avisoDoTermo(avisoDaSituacao(termo), termo).some((a) => a.link?.href === "/autorizacao"), termo.estado);
      assert.doesNotMatch(visivel(html), /Modo guiado\./, termo.estado);
      assert.match(visivel(html), /Faça no portal/); // continua no modo guiado (as funções com o caminho no portal)
    }
    assert.equal(avisoDoTermo(avisoDaSituacao({ estado: "ausente" }), { estado: "ausente" }).length, 0);
    assert.match(visivel(painel(dados({ autorizada: false, termo: { estado: "ausente" } }))), /Modo guiado\./);
  });
});

describe("painel do mês: portão e página", () => {
  const EMPRESA = { id: "00000000-0000-0000-0000-000000000001", cnpj: "12345678000195", razaoSocial: "Alfa Software Ltda", papel: "DONO" as const };

  it("sem empresa e sem plano: o estado vazio do portão, nunca o painel", () => {
    const aba = abaDaEmpresa("/");
    const sem = visivel(renderToStaticMarkup(createElement(PortaoFechado, { aba, portao: { estado: "sem-empresa" }, sobre: "Olá, Ana" })));
    assert.match(sem, /Olá, Ana Painel do mês Cadastre sua empresa para ver esta aba/);
    assert.match(renderToStaticMarkup(createElement(PortaoFechado, { aba, portao: { estado: "sem-empresa" } })), /href="\/empresas\/nova"/);
    const semPlano = visivel(renderToStaticMarkup(createElement(PortaoFechado, { aba, portao: { estado: "sem-plano", empresa: EMPRESA } })));
    assert.match(semPlano, /Escolha um plano para ver esta aba/);
  });

  it("modo guiado, empresa irregular e o DAS do mês vencido: a faixa leva à guia (nunca 'nenhuma guia vencida')", () => {
    const irregular = { atual: { ...REGULAR.atual, regular: false, pendencias: "Pendência - Débito (SIMPLES NACIONAL)" }, processando: false };
    const b = base({ lancamentos: [LANCAMENTO], hoje: "2026-10-25" });
    const html = painel(
      dados({ autorizada: false, termo: { estado: "ausente" }, das: guia("DAS", { vencida: true }), situacaoFiscal: irregular, pendencias: ["Imposto vencido sem pagamento"], mesesComGuia: [] }, b),
    );
    conferir(html);
    const t = visivel(html);
    assert.match(t, /DAS Simples Nacional Vencido/);
    assert.match(html, /href="\/\?mes=2026-09#guias"[^>]*>Gerar novas guias</);
    assert.doesNotMatch(t, /Nenhuma guia vencida aqui/);
    assert.match(t, /Passou do vencimento\. Gerar a nova no portal/);
    // Outro mês vencido vindo da página e o deste mês: um botão por mês, sem repetir.
    const dois = painel(dados({ das: guia("DAS", { vencida: true }), situacaoFiscal: irregular, pendencias: ["Imposto vencido sem pagamento"], mesesComGuia: ["2026-07", "2026-09"] }, b));
    assert.equal([...dois.matchAll(/>Gerar novas guias/g)].length, 2);
    // Irregular sem guia vencida nenhuma: aí sim o texto de que não há guia vencida.
    const sem = visivel(painel(dados({ situacaoFiscal: irregular, pendencias: ["Imposto vencido sem pagamento"], mesesComGuia: [] })));
    assert.match(sem, /Nenhuma guia vencida aqui: veja os detalhes\./);
  });

  it("a página: portão antes de ler dados, último mês por padrão, só banco ao abrir e a tela do painel", () => {
    const pagina = readFileSync(path.join(APP, "page.tsx"), "utf8");
    assert.match(pagina, /if \(portao\.estado !== "liberado"\) \{[\s\S]*?<PortaoFechado aba=\{abaDaEmpresa\("\/"\)\}/);
    assert.ok(pagina.indexOf("<PortaoFechado") < pagina.indexOf("baseDoMes("));
    assert.match(pagina, /const pa = mesValido\(pedido\) \? pedido : ultimo;/);
    assert.match(pagina, /<PainelDoMes/);
    assert.match(pagina, /resumo: resumoDoMes\(base\)/);
    // Nada é gerado, transmitido ou simulado ao abrir: só as ações dos botões.
    assert.doesNotMatch(pagina, /\b(simularMes|transmitirMes|gerarGuia|conferirDctfMes)\(/);
    // Nada do ../fiscal fixo: tudo pela empresa ativa (o acesso do portão).
    assert.doesNotMatch(pagina, /\d{14}|43079489/);
    // As guias vencidas (só banco) valem também sem a autorização: nada de `ligado &&` antes delas.
    assert.match(pagina, /const vencidas = pendencias\.length \? await guiasVencidas\(/);
    assert.match(pagina, /mesesComGuia = mesesComGuiaVencida\(pendencias, vencidas\)/);
  });
});
