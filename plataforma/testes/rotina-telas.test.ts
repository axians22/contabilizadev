// Telas da Parte 6 (HTML do servidor, como o navegador recebe): o cálculo do DAS com a conta no tooltip, a comparação da
// simulação, a confirmação com o resumo antes de enviar, as guias (inclusive vencida com juros), os valores do modo guiado
// e o aviso do Fator R (painel e sino). Explicações só no tooltip, rótulos de tooltip sem repetição, sem o fornecedor; e a
// ligação das abas Roteiro e Guias com o portão, a autorização e o modo guiado, conferida no código.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { apurar, sugestaoFatorR } from "@contabilizadev/nucleo/apuracao";
import { regraDoCnae } from "@contabilizadev/nucleo/cnae";
import { ListaDeAvisos } from "@/app/(painel)/avisos/lista";
import { SinoVisual as Sino } from "@/app/(painel)/sino-visual";
import { avisoDoFatorR } from "@/lib/avisos/fontes";
import { ConfirmarEnvio } from "@/app/(painel)/roteiro/componentes";
import { GuiaAqui, situacaoDaGuia } from "@/app/(painel)/roteiro/guia-aqui";
import { BaseDosDozeMeses, CalculoDoMes, CartaoFatorR, ResultadoSimulacao, ValoresDaDeclaracao, valoresDoInss } from "@/app/(painel)/roteiro/partes";
import type { BaseDoMes } from "@/lib/rotina/base";
import type { AvisoFatorR } from "@/lib/rotina/fator-r";
import type { GuiaDoMes } from "@/lib/rotina/guias";
import { MENSAGENS_DA_ROTINA, mensagemDaFalha, mensagemDoBloqueio } from "@/lib/rotina/mensagens";
import type { EnvioResumido } from "@/lib/rotina/pgdasd";
import { explicacoes, semExplicacoes, texto } from "./tela";

const APP = path.join(import.meta.dirname, "..", "app", "(painel)");
const FORNECEDOR = /serpro|integra\s*contador|brasil\s*api/i;
// Códigos de sistema e serviço da API, em maiúsculas (o nome oficial "DCTFWeb" da declaração pode aparecer).
const CODIGOS = /\b(PGDASD|DCTFWEB|SITFIS)\b|TRANSDECLARACAO|GERARDAS|GERARGUIA|CONSXML/;
const semFornecedor = (html: string) => {
  assert.doesNotMatch(html, FORNECEDOR);
  assert.doesNotMatch(html, CODIGOS);
};
const visivel = (html: string) => texto(semExplicacoes(html));
// A Tabela desenha cada linha duas vezes (tabela em tela larga e lista no celular, md:hidden); só uma aparece por vez,
// então a lista do celular não conta como repetição.
const semRepetir = (html: string) => {
  const rotulos = explicacoes(html.replace(/<ul class="[^"]*md:hidden[^"]*"[\s\S]*?<\/ul>/g, "")).map((e) => e.rotulo);
  assert.equal(new Set(rotulos).size, rotulos.length, `rótulos repetidos: ${rotulos.join(" | ")}`);
};

// A base do caso real de referência: 09/2026, receita 23.000, RBT12 352.998,85, Anexo III (atividade 30).
const RECEITAS = {
  "2025-09": 25_228.39, "2025-10": 19_224.3, "2025-11": 27_350.21, "2025-12": 24_655.48, "2026-01": 21_869.17, "2026-02": 25_798.12,
  "2026-03": 37_582, "2026-04": 24_985.4, "2026-05": 45_494.12, "2026-06": 47_400, "2026-07": 26_503.41, "2026-08": 26_908.25,
};
function base(extra: Partial<BaseDoMes> = {}, regra = regraDoCnae("6209100"), folhas: Record<string, number> = {}): BaseDoMes {
  return {
    pa: "2026-09",
    mesAtual: "2026-10",
    hoje: "2026-10-18",
    cnpj: "98765432000198",
    regra,
    semRegra: null,
    inicioAtividade: undefined,
    lancamentos: [],
    receitaLancada: 23_000,
    vigente: null,
    receitaDeclarada: null,
    semReceita: false,
    receitaPendente: false,
    receita: 23_000,
    prolabore: null,
    prolaboreDoMesAtual: null,
    receitas: RECEITAS,
    fontesReceita: Object.fromEntries(Object.keys(RECEITAS).map((m) => [m, m === "2026-08" ? "declarada" : "receita-federal"])),
    folhas,
    fontesFolha: Object.fromEntries(Object.keys(folhas).map((m) => [m, "informada"])),
    apuracao: apurar({ pa: "2026-09", receita: 23_000, receitas: RECEITAS, folhas, regra }),
    erro: null,
    ...extra,
  };
}

describe("cálculo do DAS (rotina do mês)", () => {
  it("caso real: receita, RBT12, anexo, alíquota efetiva e DAS de R$ 1.000,76; a conta só no tooltip", () => {
    const html = renderToStaticMarkup(createElement(CalculoDoMes, { base: base() }));
    const t = visivel(html);
    assert.match(t, /Receita do mês R\$\s23\.000,00/);
    assert.match(t, /Receita dos 12 meses \(RBT12\) R\$\s352\.998,85/);
    assert.match(t, /Anexo III/);
    assert.match(t, /Alíquota paga \(exportação\) 4,35%/);
    assert.match(t, /DAS do mês R\$\s1\.000,76/);
    assert.match(t, /IRPJ 0,34% R\$\s78,65/);
    assert.match(t, /INSS patronal \(CPP\) 3,71% R\$\s853,30/);
    assert.doesNotMatch(t, /Fator R/); // Anexo III fixo: sem Fator R
    const conta = explicacoes(html).find((e) => e.rotulo === "Como o DAS de setembro de 2026 foi calculado?");
    assert.ok(conta);
    assert.match(conta.texto, /RBT12: a receita bruta dos 12 meses anteriores \(setembro de 2025 a agosto de 2026\) = R\$\s352\.998,85/);
    assert.match(conta.texto, /Na exportação de serviços não há ISS, PIS e COFINS/);
    assert.match(conta.texto, /Atividade declarada: Prestação de serviços para o exterior - Não sujeitos ao fator .r. e tributados pelo Anexo III/);
    assert.doesNotMatch(t, /Na exportação de serviços/);
    semFornecedor(html);
    semRepetir(html);
  });

  it("alíquota paga x efetiva com nomes diferentes; tributos pelo percentual mesmo com receita zero; pendente sem DAS", () => {
    const html = renderToStaticMarkup(createElement(CalculoDoMes, { base: base() }));
    const conta = explicacoes(html).find((e) => e.rotulo === "Como o DAS de setembro de 2026 foi calculado?")!;
    assert.match(conta.texto, /Alíquota efetiva = .* = 8,55%/);
    assert.match(conta.texto, /sobram IRPJ, CSLL, INSS patronal \(CPP\), 4,35% da receita \(a alíquota paga\)/);
    assert.doesNotMatch(visivel(html), /Alíquota efetiva/); // o bloco é a alíquota paga, não a efetiva

    const zero = apurar({ pa: "2026-09", receita: 0, receitas: {}, folhas: {}, regra: regraDoCnae("6209100") });
    const semReceita = renderToStaticMarkup(createElement(CalculoDoMes, { base: base({ receitaLancada: null, semReceita: true, receita: 0, receitas: {}, apuracao: zero }) }));
    const contaZero = explicacoes(semReceita).find((e) => e.rotulo === "Como o DAS de setembro de 2026 foi calculado?")!;
    assert.match(contaZero.texto, /sobram IRPJ, CSLL, INSS patronal \(CPP\), 3,05% da receita/);
    assert.match(visivel(semReceita), /DAS do mês R\$\s0,00/);

    const pendente = visivel(renderToStaticMarkup(createElement(CalculoDoMes, { base: base({ receitaLancada: null, receitaPendente: true, receita: 0, receitas: {}, apuracao: zero }) })));
    assert.match(pendente, /Receita do mês a lançar/);
    assert.match(pendente, /DAS do mês —/);
    assert.doesNotMatch(pendente, /R\$\s0,00 R\$\s0,00/);
  });

  it("valores do INSS no modo guiado: 11% até o teto do ano", () => {
    assert.deepEqual(valoresDoInss("2026-09", 1_621).slice(2), [["INSS do sócio (11%, código 1099)", "R$\u00a0178,31"], ["DARF esperado", "R$\u00a0178,31"]]);
    const noTeto = valoresDoInss("2026-09", 20_000);
    assert.match(noTeto[2][0], /11% do teto de R\$\s8\.475,55/);
    assert.equal(noTeto[3][1], "R$\u00a0932,31");
  });

  it("Fator R aparece para a atividade que depende dele; meses sem receita viram aviso com o porquê no tooltip", () => {
    const folhas = Object.fromEntries(Object.entries(RECEITAS).map(([m, v]) => [m, Math.ceil(v * 28) / 100]));
    const comFator = visivel(renderToStaticMarkup(createElement(CalculoDoMes, { base: base({}, regraDoCnae("6201501"), folhas) })));
    assert.match(comFator, /Fator R 28,\d\d%/);
    const { "2025-09": _, ...semSetembro } = RECEITAS;
    void _;
    const incompleta = base({ receitas: semSetembro, apuracao: apurar({ pa: "2026-09", receita: 23_000, receitas: semSetembro, folhas: {}, regra: regraDoCnae("6209100") }) });
    const html = renderToStaticMarkup(createElement(CalculoDoMes, { base: incompleta }));
    assert.match(visivel(html), /Faltam receitas de 1 mês anteriores: a alíquota pode estar subestimada\./);
    assert.ok(explicacoes(html).some((e) => /setembro de 2025/.test(e.texto)));
  });

  it("empresa não atendida: a mensagem própria, sem cálculo", () => {
    const html = renderToStaticMarkup(createElement(CalculoDoMes, { base: base({ apuracao: null, regra: null, semRegra: MENSAGENS_DA_ROTINA.semRegra }) }));
    assert.match(visivel(html), /ainda não é atendida pela rotina do mês/);
  });

  it("base dos 12 meses na tabela única, com a fonte de cada valor", () => {
    const html = renderToStaticMarkup(createElement(BaseDosDozeMeses, { base: base() }));
    const t = visivel(html);
    assert.match(t, /Agosto de 2026 R\$\s26\.908,25 Declarada/i);
    assert.match(t, /Receita Federal/);
    assert.match(html, /aria-label="Paginação"/); // 12 meses em páginas de 6
  });
});

describe("simulação, confirmação e modo guiado", () => {
  const simulacao = (valoresReceita: Record<string, number>): EnvioResumido =>
    ({ id: "x", etapa: "simulacao", estado: "ok", valoresReceita, valores: {}, temDeclaracao: false, temRecibo: false }) as unknown as EnvioResumido;
  const valores = { 1001: 78.65, 1002: 68.81, 1006: 853.3 };

  it("simulação lado a lado: igual em verde, diferente em vermelho; nomes dos tributos, nunca o código da API", () => {
    const igual = renderToStaticMarkup(createElement(ResultadoSimulacao, { simulacao: simulacao(valores), valores }));
    assert.match(visivel(igual), /IRPJ R\$\s78,65 R\$\s78,65/);
    assert.match(visivel(igual), /INSS\/CPP R\$\s853,30 R\$\s853,30/);
    assert.doesNotMatch(igual, /text-bad/);
    const diferente = renderToStaticMarkup(createElement(ResultadoSimulacao, { simulacao: simulacao({ ...valores, 1001: 78.66 }), valores }));
    assert.match(diferente, /font-semibold text-bad">R\$\s78,66/);
    semFornecedor(diferente);
  });

  it("confirmação: caixa de diálogo com o resumo do que vai ser enviado e a caixa Confirmo obrigatória", () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmarEnvio, {
        acao: async () => undefined,
        campos: { empresaId: "e", pa: "2026-09", receita: "23000", total: "1000.76" },
        rotulo: "Transmitir a declaração",
        titulo: "Declarar setembro de 2026",
        resumo: [["Receita de exportação", "R$ 23.000,00"], ["DAS", "R$ 1.000,76"]],
        confirmo: "Confirmo a receita de R$ 23.000,00.",
        explicacao: ["A declaração é transmitida à Receita Federal em nome da empresa."],
      }),
    );
    const titulo = /<dialog[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];
    assert.ok(titulo && !/\s/.test(titulo) && html.includes(`<h2 id="${titulo}"`));
    assert.match(html, /<input type="checkbox" required=""[^>]*name="confirmo" value="sim"/);
    assert.match(texto(html), /Receita de exportação R\$ 23\.000,00 DAS R\$ 1\.000,76/);
    for (const [nome, valor] of [["receita", "23000"], ["total", "1000.76"], ["pa", "2026-09"]]) assert.match(html, new RegExp(`name="${nome}" value="${valor.replace(".", "\\.")}"`));
    assert.ok(explicacoes(html).some((e) => e.rotulo === "O que acontece ao confirmar: Declarar setembro de 2026?"));
  });

  it("modo guiado: os valores prontos para o portal (receita de exportação, tributos e DAS) e os do INSS", () => {
    const t = visivel(renderToStaticMarkup(createElement(ValoresDaDeclaracao, { base: base() })));
    assert.match(t, /Receita no mercado externo \(exportação\) R\$\s23\.000,00/);
    assert.match(t, /CSLL R\$\s68,81/);
    assert.match(t, /DAS esperado R\$\s1\.000,76/);
    assert.deepEqual(valoresDoInss("2026-09", 1_621).slice(2), [["INSS do sócio (11%, código 1099)", "R$ 178,31"], ["DARF esperado", "R$ 178,31"]]);
    assert.deepEqual(valoresDoInss("2026-09", null), [["Pró-labore do mês", "informe no passo 2"]]);
  });

  it("mensagens próprias: bloqueios e falhas da Receita viram texto da plataforma, sem o texto da API", () => {
    assert.equal(mensagemDoBloqueio("O mês ainda não terminou. A declaração só pode ser feita a partir do mês seguinte."), MENSAGENS_DA_ROTINA.mesAberto);
    assert.equal(mensagemDoBloqueio("Este mês já foi declarado. Para corrigir, faça uma retificação."), MENSAGENS_DA_ROTINA.jaDeclarado);
    assert.equal(mensagemDaFalha("Limite de 40 chamadas no período de cobrança atingido. Nada foi enviado."), MENSAGENS_DA_ROTINA.limite);
    assert.equal(mensagemDaFalha("[Erro-PGDASD-1234]: Declaração já transmitida"), MENSAGENS_DA_ROTINA.recusou);
    assert.equal(mensagemDaFalha("HTTP 500"), MENSAGENS_DA_ROTINA.recusou);
    assert.equal(mensagemDaFalha("socket hang up"), MENSAGENS_DA_ROTINA.falhou);
    for (const m of Object.values(MENSAGENS_DA_ROTINA)) semFornecedor(m);
  });
});

describe("guias na tela", () => {
  const guia = (extra: Partial<GuiaDoMes>): GuiaDoMes => ({
    pa: "2026-09", tipo: "DAS", referencia: "98765432202609001", vencimento: "2026-10-20", paga: false, pagaEm: null, vencida: false, original: null, atualizada: null, pagarEmSugerido: "2026-10-26", ...extra,
  });
  const gerar = async () => undefined;
  const campos = { empresaId: "e", pa: "2026-09" };

  it("sem declaração, a guia espera; no prazo, o botão de gerar; gerada, o PDF pela rota protegida", () => {
    assert.match(visivel(renderToStaticMarkup(createElement(GuiaAqui, { guia: guia({ referencia: null }), campos, rotulo: "Gerar o DAS", gerar }))), /Liberado depois da declaração/);
    assert.match(visivel(renderToStaticMarkup(createElement(GuiaAqui, { guia: guia({}), campos, rotulo: "Gerar o DAS", gerar }))), /Gerar o DAS/);
    const original = { id: "00000000-0000-0000-0000-0000000000a1", total: 1000.76 } as GuiaDoMes["original"];
    const html = renderToStaticMarkup(createElement(GuiaAqui, { guia: guia({ original }), campos, rotulo: "Gerar o DAS", gerar }));
    assert.match(html, /href="\/documentos\/guia\/00000000-0000-0000-0000-0000000000a1"/);
    assert.match(visivel(html), /R\$\s1\.000,76 Abrir guia Baixar vence em 20\/10\/2026/);
    assert.match(html, /href="\/documentos\/guia\/00000000-0000-0000-0000-0000000000a1" download=""/);
    assert.equal(situacaoDaGuia(guia({ original })), "Gerada · vence em 20/10/2026");
    assert.equal(situacaoDaGuia(guia({ paga: true, pagaEm: "2026-10-13" })), "Paga em 13/10/2026");
  });

  it("vencida: aviso em vermelho, a data de pagamento (dia útil sugerido) e, gerada, o valor com multa e juros", () => {
    const html = renderToStaticMarkup(createElement(GuiaAqui, { guia: guia({ vencida: true }), campos, rotulo: "Gerar o DAS", gerar }));
    assert.match(visivel(html), /Passou do vencimento\. Gere a guia com multa e juros para o dia em que vai pagar\. Vou pagar em Gerar com multa e juros/);
    assert.match(html, /<input type="date" required=""[^>]*name="pagarEm" value="2026-10-26"/);
    assert.ok(explicacoes(html).some((e) => /só aceita dia útil/.test(e.texto)));
    const atualizada = { id: "00000000-0000-0000-0000-0000000000a2", pagarEm: "2026-10-27", principal: 1000.76, multa: 20.02, juros: 10, total: 1030.78 } as GuiaDoMes["atualizada"];
    const t = visivel(renderToStaticMarkup(createElement(GuiaAqui, { guia: guia({ vencida: true, atualizada }), campos, rotulo: "Gerar o DAS", gerar })));
    assert.match(t, /Guia atualizada para pagar até 27\/10\/2026 R\$\s1\.030,78 R\$\s1\.000,76 \+ multa R\$\s20,02 \+ juros R\$\s10,00/);
    assert.match(t, /Gerar para outra data/);
  });
});

describe("aviso do Fator R (painel e sino)", () => {
  const MESES = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  const aviso = (proLabore: number): AvisoFatorR => ({
    ...sugestaoFatorR({
      mesAtual: "2026-10",
      receitas: Object.fromEntries(MESES.map((m) => [m, 25_000])),
      folhas: Object.fromEntries(MESES.map((m) => [m, 6_750])),
      regra: regraDoCnae("6201501"),
      proLaboreAtual: proLabore,
    })!,
    proLaboreInformado: true,
  });

  it("abaixo de 28%: Anexo V em vermelho, o pró-labore sugerido e a economia; a conta inteira no tooltip", () => {
    const html = renderToStaticMarkup(createElement(CartaoFatorR, { aviso: aviso(6_750), comLink: true }));
    const t = visivel(html);
    assert.match(t, /Fator R em 27,00%: abaixo de 28%/);
    // O mês do pró-labore a ajustar é o corrente (outubro), dito com o nome: não o mês apurado (setembro).
    assert.match(t, /Com o pró-labore de R\$\s6\.750,00 em outubro de 2026, novembro de 2026 fica no Anexo V\. Com R\$\s9\.750,00 em outubro de 2026, fica no Anexo III\./);
    assert.match(t, /Economia estimada: R\$\s[\d.,]+ em novembro de 2026\./);
    assert.match(html, /href="\/roteiro#prolabore-do-mes-atual"/);
    const conta = explicacoes(html)[0];
    assert.match(conta.texto, /Avisamos entre 25% e 30%/);
    // INSS no teto de 2026: 932,31 (sobre 9.750 limitado a 8.475,55) - 742,50 = 189,81 (sem teto seriam 330,00).
    assert.match(conta.texto, /custa R\$\s189,81 de INSS \(11%, até o teto do INSS\)/);
    assert.doesNotMatch(t, /Avisamos entre/);
  });

  it("no Anexo III com pouca margem: aviso amarelo, sem economia; o sino só avisa na faixa de atenção", () => {
    const t = visivel(renderToStaticMarkup(createElement(CartaoFatorR, { aviso: aviso(9_750) })));
    assert.match(t, /Fator R em 28,00%: perto de 28%/);
    assert.match(t, /fica no Anexo III, com pouca margem/);
    assert.doesNotMatch(t, /Economia/);
    const [noSino] = avisoDoFatorR(aviso(6_750));
    assert.equal(noSino.titulo, "Fator R em 27,00%: abaixo de 28%");
    assert.deepEqual(noSino.link, { href: "/roteiro#prolabore-do-mes-atual", texto: "Ajustar o pró-labore" });
    assert.deepEqual(avisoDoFatorR(aviso(20_000)), []); // 30% ou mais: fora da faixa
    assert.deepEqual(avisoDoFatorR(null), []);
    const sino = renderToStaticMarkup(createElement(Sino, { avisos: avisoDoFatorR(aviso(6_750)) }));
    assert.match(sino, /aria-label="Avisos e mensagens: 1 aviso pendente"/);
    const lista = renderToStaticMarkup(createElement(ListaDeAvisos, { avisos: avisoDoFatorR(aviso(6_750)), cnpj: null, rotulo: "Avisos da empresa" }));
    assert.match(lista, /Fator R em 27,00%: abaixo de 28%/);
    semFornecedor(sino);
    semFornecedor(lista);
  });

});

describe("as abas no código: portão, autorização, modo guiado e nada chamado ao abrir", () => {
  const roteiro = readFileSync(path.join(APP, "roteiro", "page.tsx"), "utf8");
  const guias = readFileSync(path.join(APP, "guias", "page.tsx"), "utf8");

  it("Roteiro e Guias passam pelo portão", () => {
    for (const pagina of [roteiro, guias]) {
      assert.match(pagina, /await exigirConteudo\(\)/);
      assert.match(pagina, /portao\.estado !== "liberado"\) return <PortaoFechado/);
    }
  });

  it("sem autorização, cada passo que depende da Receita vira o modo guiado com os valores", () => {
    for (const funcao of ["declaracaoMensal", "guiaDoMes", "dctfweb"]) assert.match(roteiro, new RegExp(`<FacaNoPortal funcao="${funcao}"`));
    assert.match(roteiro, /<ValoresDaDeclaracao base=\{base\} \/>/);
    assert.match(guias, /<FacaNoPortal funcao="guiaDoMes"/);
  });

  it("abrir as abas só lê o banco: nada de simular, transmitir, gerar ou importar sem clique", () => {
    for (const pagina of [roteiro, guias]) {
      assert.doesNotMatch(pagina, /\b(simularMes|transmitirMes|gerarGuia|conferirDctfMes|transmitirDctfMes|atualizarAoAbrir|importar)\(/);
    }
  });

  it("toda transmissão passa pela confirmação com o resumo (PGDAS-D e DCTFWeb)", () => {
    assert.match(roteiro, /<ConfirmarEnvio\s+acao=\{transmitirAcao\}/);
    assert.match(roteiro, /<ConfirmarEnvio\s+acao=\{transmitirDctfAcao\}/);
    assert.match(roteiro, /<AssinarDctf/);
    const componentes = readFileSync(path.join(APP, "roteiro", "componentes.tsx"), "utf8");
    assert.match(componentes, /Confirmo a DCTFWeb/);
    assert.match(componentes, /disabled=\{!confirmado \|\| enviando\}/);
  });
});
