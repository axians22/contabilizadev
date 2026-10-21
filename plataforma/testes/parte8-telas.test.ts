// Telas da Parte 8 (HTML do servidor, como o navegador recebe): mensagens da Caixa Postal em lista suspensa (cabeçalho
// visível, conteúdo só depois da confirmação da ciência), situação fiscal em evidência com as pendências explicadas e o
// botão da guia com juros, declaração anual (prazo, situação e o limite do lucro isento no tooltip), o sino ligado à
// central de avisos e a página Avisos (tabela única com paginação). Explicações só no tooltip, sem o fornecedor; e a
// ligação das abas novas com o portão, a autorização e o banco primeiro, conferida no código.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ListaDeAvisos } from "@/app/(painel)/avisos/lista";
import { CartaoDaDeclaracaoAnual, DefisNaoEncontrada, ValoresDoAno } from "@/app/(painel)/defis/declaracao-anual";
import { FuncoesDoPainel } from "@/app/(painel)/funcoes-do-painel";
import { MensagemDaCaixa } from "@/app/(painel)/mensagens/mensagem";
import { SinoVisual as Sino } from "@/app/(painel)/sino-visual";
import { PendenciasExplicadas } from "@/app/(painel)/situacao/pendencias";
import type { AvisoDoSino } from "@/lib/avisos/central";
import type { MensagemGuardada } from "@/lib/caixa-postal/caixa-postal";
import { situacaoDaDeclaracaoAnual } from "@/lib/defis/prazo";
import type { ResumoDoAno } from "@/lib/defis/resumo";
import type { Situacao } from "@/lib/termo/situacao";
import type { GuiaDoMes } from "@/lib/rotina/guias";
import { explicarPendencias } from "@/lib/situacao/pendencias";
import { explicacoes, semExplicacoes, texto } from "./tela";

const APP = path.join(import.meta.dirname, "..", "app", "(painel)");
const FORNECEDOR = /serpro|integra\s*contador|brasil\s*api|CAIXAPOSTAL|MSG[A-Z]+\d{2}|SITFIS/i;
const visivel = (html: string) => texto(semExplicacoes(html));
const semRepetir = (html: string) => {
  const rotulos = explicacoes(html).map((e) => e.rotulo);
  assert.equal(new Set(rotulos).size, rotulos.length, `rótulos repetidos: ${rotulos.join(" | ")}`);
};
const acao = async () => undefined;

const MENSAGEM: MensagemGuardada = {
  id: "00000000-0000-0000-0000-0000000000c1",
  empresaId: "00000000-0000-0000-0000-000000000001",
  isn: "0001626772",
  assunto: "Termo de Intima&ccedil;&atilde;o - Processo 10000.000001/2026-11",
  origem: "RECEITA FEDERAL DO BRASIL",
  enviadaEm: "2026-10-15T09:29:49",
  lidaNaReceita: false,
  cienciaEm: "2026-10-30",
  validaAte: null,
  relevante: true,
  conteudo: null,
  abertaEm: null,
  abertaPor: null,
  vistaEm: null,
  buscadaEm: new Date("2026-10-20T13:00:00Z"),
};
const mensagem = (extra: Partial<MensagemGuardada> = {}, opcoes: { nova?: boolean; autorizada?: boolean } = {}) =>
  renderToStaticMarkup(createElement(MensagemDaCaixa, { m: { ...MENSAGEM, ...extra }, nova: opcoes.nova ?? true, empresaId: MENSAGEM.empresaId, autorizada: opcoes.autorizada ?? true, abrir: acao }));

describe("mensagens da Caixa Postal: lista suspensa, conteúdo só com a confirmação da ciência", () => {
  it("fechada: o cabeçalho visível (assunto, remetente, data, nova, importante, não lida); nenhum conteúdo", () => {
    const html = mensagem();
    assert.match(html, /<details[^>]*open=""/);
    const resumo = texto(/<summary[\s\S]*?<\/summary>/.exec(html)![0]);
    assert.match(resumo, /Termo de Intimação - Processo 10000\.000001\/2026-11/);
    assert.match(resumo, /RECEITA FEDERAL DO BRASIL · enviada em 15\/10\/2026 às 09:29/);
    assert.match(resumo, /Nova Importante Não lida/);
    assert.match(visivel(html), /Mesmo sem abrir, a Receita considera a ciência em 30\/10\/2026\./);
    assert.doesNotMatch(html, FORNECEDOR);
    semRepetir(html);
  });

  it("não lida: abrir pede a confirmação clara de que a Receita registra a ciência; o porquê no tooltip", () => {
    const html = mensagem();
    assert.match(html, /<dialog/);
    assert.match(texto(html), /Ao abrir, a Receita registra que você tomou ciência desta mensagem\. Entendi e quero abrir\./);
    assert.match(html, /<input type="checkbox" required=""[^>]*name="confirmo" value="sim"/);
    assert.match(html, /name="mensagemId" value="00000000-0000-0000-0000-0000000000c1"/);
    assert.match(texto(html), /Abrir a mensagem/);
    assert.ok(explicacoes(html).some((e) => /Decreto 70\.235\/1972, art\. 23/.test(e.texto) && /prazo para responder/.test(e.texto)));
  });

  it("já lida na Receita: abre sem a caixa de confirmação; sem autorização, o caminho do e-CAC no tooltip", () => {
    const lida = mensagem({ lidaNaReceita: true }, { nova: false });
    assert.doesNotMatch(lida, /<dialog/);
    assert.doesNotMatch(lida, /<details[^>]*open/);
    assert.match(visivel(lida), /Lida/);
    assert.match(visivel(lida), /Abrir a mensagem/);
    const guiado = mensagem({}, { autorizada: false });
    assert.doesNotMatch(guiado, /<dialog|<form/);
    assert.match(visivel(guiado), /Para ler, abra a Caixa Postal no e-CAC\./);
  });

  it("aberta: o texto da Receita vira parágrafos e links, sem HTML de fora", () => {
    const html = mensagem({
      lidaNaReceita: true,
      abertaEm: new Date("2026-10-20T13:00:00Z"),
      conteudo: '<p>Prezado(a) Contribuinte,</p><p>Fica intimado.</p><script>alert(1)</script><p><a href="/ecac/processos">Abrir</a> <a href="javascript:alert(1)">x</a></p>',
    });
    assert.doesNotMatch(html, /<script|javascript:/);
    assert.match(html, /<a class="[^"]*" href="https:\/\/cav\.receita\.fazenda\.gov\.br\/ecac\/processos" target="_blank"/);
    assert.match(visivel(html), /Fica intimado\./);
    assert.match(visivel(html), /Aberta aqui em 20\/10\/2026\./);
    assert.doesNotMatch(html, /<dialog/);
  });

});

// Uma célula por linha, como o texto sai do PDF real.
const RELATORIO = ["Pendência - Débito (SIMPLES NACIONAL)", "PA", "Dt. Vcto", "Vl.Original", "Sdo.Devedor", "08/2026", "21/09/2026", "1.170,84", "1.170,84", "Pendência - Omissão de DCTF (SIEF)", "Período 07/2026"].join("\n");
const GUIA: GuiaDoMes = {
  pa: "2026-08",
  tipo: "DAS",
  referencia: "98765432202608001",
  vencimento: "2026-09-21",
  paga: false,
  pagaEm: null,
  vencida: true,
  original: null,
  atualizada: null,
  pagarEmSugerido: "2026-10-21",
};

describe("situação fiscal em evidência", () => {
  it("pendências em linguagem simples; a guia vencida com o botão de gerar com juros e a data de pagamento", () => {
    const html = renderToStaticMarkup(createElement(PendenciasExplicadas, { pendencias: explicarPendencias(RELATORIO), vencidas: [GUIA], empresaId: "e", autorizada: true, gerar: acao }));
    const t = visivel(html);
    assert.match(t, /Imposto vencido sem pagamento DAS do Simples de agosto de 2026 · venceu em 21\/09\/2026 · R\$\s1\.170,84/);
    assert.match(t, /Declaração em falta/);
    assert.match(t, /Gerar com multa e juros/);
    assert.match(html, /<input type="date"[^>]*name="pagarEm"[^>]*value="2026-10-21"/);
    assert.doesNotMatch(t, /SIEF|SIMPLES NACIONAL/); // o texto cru do relatório fica no tooltip
    assert.ok(explicacoes(html).some((e) => /No relatório da Receita Federal: Pendência - Débito \(SIMPLES NACIONAL\)/.test(e.texto)));
    semRepetir(html);
    // Sem autorização: nada de gerar aqui.
    assert.doesNotMatch(renderToStaticMarkup(createElement(PendenciasExplicadas, { pendencias: explicarPendencias(RELATORIO), vencidas: [GUIA], empresaId: "e", autorizada: false, gerar: acao })), /Gerar com multa/);
    assert.equal(renderToStaticMarkup(createElement(PendenciasExplicadas, { pendencias: [], vencidas: [], empresaId: "e", autorizada: true, gerar: acao })), "");
  });
});

describe("declaração anual", () => {
  it("o cartão do ano: a entregar com o prazo, atrasada em vermelho, entregue; prazo e virada do ano no tooltip", () => {
    const naEpoca = renderToStaticMarkup(createElement(CartaoDaDeclaracaoAnual, { s: situacaoDaDeclaracaoAnual("2027-02-01", null), comLink: true }));
    assert.match(visivel(naEpoca), /Declaração anual de 2026 A entregar Prazo: 31\/03\/2027 \(vence em 58 dias\)\. Ver a declaração anual/);
    assert.ok(explicacoes(naEpoca).some((e) => /virada do ano/.test(e.texto) && /mesmo sem movimento/.test(e.texto)));
    const atrasada = renderToStaticMarkup(createElement(CartaoDaDeclaracaoAnual, { s: situacaoDaDeclaracaoAnual("2027-04-10", false) }));
    assert.match(atrasada, /border-bad/);
    assert.match(visivel(atrasada), /Atrasada Prazo: 31\/03\/2027 \(venceu em 31\/03\/2027\)\./);
    assert.match(visivel(renderToStaticMarkup(createElement(CartaoDaDeclaracaoAnual, { s: situacaoDaDeclaracaoAnual("2027-04-10", true) }))), /Entregue Prazo era 31\/03\/2027\./);
    // Empresa que entrou no Simples depois do ano: não devida, sem vermelho e sem prazo.
    const naoDevida = renderToStaticMarkup(createElement(CartaoDaDeclaracaoAnual, { s: situacaoDaDeclaracaoAnual("2027-04-10", false, "2027-01-15") }));
    assert.doesNotMatch(naoDevida, /border-bad|bg-bad/);
    assert.match(visivel(naoDevida), /Declaração anual de 2026 Não devida A empresa está no Simples desde 15\/01\/2027\./);
  });

  it("valores do ano; o limite do lucro isento com a conta só no tooltip", () => {
    const r: ResumoDoAno = { receita: 300_000, proLabore: 19_452, inss: 2_139.72, das: 13_500, irpj: 1_000, limiteLucroIsento: 95_000, semReceita: [], semProLabore: [] };
    const html = renderToStaticMarkup(createElement(ValoresDoAno, { ano: 2026, r }));
    assert.match(visivel(html), /Receita bruta do ano R\$\s300\.000,00/);
    assert.match(visivel(html), /Limite de lucro isento sem contabilidade R\$\s95\.000,00/);
    assert.doesNotMatch(visivel(html), /32%/);
    const dica = explicacoes(html).find((e) => e.rotulo === "O que é o limite de lucro isento sem contabilidade?")!;
    assert.match(dica.texto, /32% de R\$\s300\.000,00 = R\$\s96\.000,00, menos R\$\s1\.000,00 de IRPJ = R\$\s95\.000,00/);
    assert.match(dica.texto, /contabilidade completa/);
  });

  it("o limite do lucro isento por ano: até 2025 sem Imposto de Renda; de 2026 em diante, a retenção da Lei 15.270/2025", () => {
    const r: ResumoDoAno = { receita: 300_000, proLabore: 19_452, inss: 2_139.72, das: 13_500, irpj: 1_000, limiteLucroIsento: 95_000, semReceita: [], semProLabore: [] };
    const dica = (ano: number) => explicacoes(renderToStaticMarkup(createElement(ValoresDoAno, { ano, r }))).find((e) => e.rotulo === "O que é o limite de lucro isento sem contabilidade?")!.texto;
    assert.match(dica(2025), /em 2025 sem pagar Imposto de Renda/);
    assert.doesNotMatch(dica(2025), /15\.270/);
    assert.doesNotMatch(dica(2026), /sem pagar Imposto de Renda/);
    assert.match(dica(2026), /não afasta a retenção: .*mais de R\$ 50\.000,00 de lucros no mesmo mês, retém 10%/);
    assert.match(dica(2026), /Lei 15\.270\/2025/);
    assert.match(dica(2026), /Simples Nacional/);
  });

  it("DEFIS não encontrada: vermelho só quando consultada depois do prazo; antes do prazo, nada", () => {
    const quadro = (consultadaEm: string, inicio: string | null = null) =>
      renderToStaticMarkup(createElement(DefisNaoEncontrada, { ano: 2026, registro: { situacao: "nao-encontrada", consultadaEm: new Date(consultadaEm) }, inicio }));
    // Atualizar em fevereiro, antes de entregar: o prazo (31/03/2027) ainda não venceu.
    assert.equal(quadro("2027-02-10T15:00:00Z"), "");
    assert.equal(quadro("2027-03-31T15:00:00Z"), ""); // no dia do prazo ainda vale
    const depois = quadro("2027-04-02T15:00:00Z");
    assert.match(depois, /border-bad/);
    assert.match(visivel(depois), /DEFIS de 2026 não encontrada\. O prazo era 31\/03\/2027\./);
    // Entregue, ou a empresa entrou no Simples depois do ano: nada.
    assert.equal(renderToStaticMarkup(createElement(DefisNaoEncontrada, { ano: 2026, registro: { situacao: "entregue", consultadaEm: new Date("2027-04-02T15:00:00Z") }, inicio: null })), "");
    assert.equal(quadro("2027-04-02T15:00:00Z", "2027-01-15"), "");
  });
});

describe("painel: o que fazemos com a Receita Federal", () => {
  const VIGENTE = { estado: "vigente" } as Situacao;
  const itens = (html: string) => [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => visivel(m[1]).trim());

  it("com o termo em dia, a DEFIS não é \"Feito aqui\": valores prontos aqui, entrega no portal", () => {
    const html = renderToStaticMarkup(createElement(FuncoesDoPainel, { ligado: true, situacao: VIGENTE }));
    const defis = itens(html).find((t) => /DEFIS/.test(t))!;
    assert.ok(defis, "a DEFIS aparece na lista");
    assert.doesNotMatch(defis, /Feito aqui/);
    assert.match(defis, /Valores prontos aqui Declaração anual do Simples \(DEFIS\) · entrega no portal\. Ver os valores/);
    assert.match(html, /href="\/defis"/);
    // As outras continuam "Feito aqui".
    assert.ok(itens(html).filter((t) => !/DEFIS/.test(t)).every((t) => t.startsWith("Feito aqui")));
    assert.match(explicacoes(html)[0].texto, /Valores prontos aqui: .*declaração anual/);
  });

  it("sem o termo, todas no modo guiado; a DEFIS leva aos valores prontos, sem o atalho da autorização", () => {
    const html = renderToStaticMarkup(createElement(FuncoesDoPainel, { ligado: false, situacao: { estado: "ausente" } }));
    const blocos = [...html.matchAll(/<details[\s\S]*?<\/details>/g)].map((m) => m[0]);
    assert.equal(blocos.length, 7);
    const defis = blocos.find((b) => /DEFIS/.test(b))!;
    assert.match(visivel(defis), /Ver os valores prontos/);
    assert.doesNotMatch(visivel(defis), /Disponível aqui depois da autorização/);
    assert.ok(blocos.filter((b) => b !== defis).every((b) => /Disponível aqui depois da autorização/.test(visivel(b))));
    assert.doesNotMatch(texto(html), FORNECEDOR);
  });
});

const aviso = (chave: string, nivel: AvisoDoSino["nivel"]): AvisoDoSino => ({ chave, nivel, titulo: `Título ${chave}`, texto: `Texto ${chave}.`, link: { href: `/${chave}`, texto: `Resolver ${chave}` } });

describe("sino e página Avisos", () => {
  it("a cor do mais grave; informativo em verde; o sino leva direto à página Avisos e mensagens, sem balão", () => {
    assert.match(renderToStaticMarkup(createElement(Sino, { avisos: [aviso("a", "info")] })), /bg-accent text-on-accent[^"]*" aria-hidden="true">1</);
    assert.match(renderToStaticMarkup(createElement(Sino, { avisos: [aviso("a", "vence"), aviso("b", "vencida")] })), /bg-bad text-white/);
    const muitos = Array.from({ length: 7 }, (_, i) => aviso(`a${i}`, "vence"));
    const sino = renderToStaticMarkup(createElement(Sino, { avisos: muitos }));
    assert.match(sino, /<a [^>]*href="\/avisos"/);
    assert.match(sino, /aria-label="Avisos e mensagens: 7 avisos pendentes"/);
    assert.equal(explicacoes(sino).length, 0);
    const nada = renderToStaticMarkup(createElement(Sino, { avisos: [] }));
    assert.match(nada, /<a [^>]*href="\/avisos"/);
    assert.match(nada, /aria-label="Avisos e mensagens: nada pendente"/);
    assert.equal(explicacoes(nada).length, 0);
  });

  it("a lista completa: tabela com prioridade e o link de onde resolver, paginada", () => {
    const avisos = [aviso("x", "vencida"), aviso("y", "vence"), aviso("z", "info"), ...Array.from({ length: 9 }, (_, i) => aviso(`k${i}`, "info"))];
    const html = renderToStaticMarkup(createElement(ListaDeAvisos, { avisos, cnpj: "12345678000195", rotulo: "Avisos da empresa" }));
    const t = texto(html);
    assert.match(t, /Título x Texto x\. Urgente Resolver x/);
    assert.match(t, /Atenção/);
    assert.match(t, /Para saber/);
    assert.match(html, /href="\/x"/);
    assert.doesNotMatch(t, /Título k8/); // 12 avisos, 10 por página
    assert.match(texto(renderToStaticMarkup(createElement(ListaDeAvisos, { avisos: [], cnpj: "12345678000195", rotulo: "Avisos da empresa" }))), /Nenhum aviso agora\./);
  });
});

describe("as abas novas no código: portão, autorização, banco primeiro e nada aberto sozinho", () => {
  const ler = (...p: string[]) => readFileSync(path.join(APP, ...p), "utf8");

  it("Mensagens (aba da página Avisos e mensagens): portão, modo guiado, lista uma vez por dia só autorizada, tabela única, sem o serviço do conteúdo", () => {
    // O portão fica na página única; a Caixa Postal só é desenhada depois dele, na aba Mensagens.
    const pagina = ler("avisos", "page.tsx");
    assert.match(pagina, /await exigirConteudo\(\)/);
    assert.match(pagina, /<PortaoFechado /);
    assert.match(pagina, /\.aba === "mensagens"/);
    assert.ok(pagina.indexOf("<CaixaPostal ") > pagina.indexOf("<PortaoFechado "));
    const caixa = ler("mensagens", "caixa-postal.tsx");
    assert.match(caixa, /<FacaNoPortal funcao="caixaPostal"/);
    assert.match(caixa, /if \(autorizada\) await atualizarCaixaAoAbrir\(acesso\)/);
    assert.match(caixa, /from "@\/app\/tabela"/);
    assert.match(caixa, /marcarComoVistas/);
    // O endereço antigo leva para a aba.
    assert.match(ler("mensagens", "page.tsx"), /redirect\(ENDERECO_DAS_MENSAGENS\)/);
    // A página e os componentes nunca chamam o serviço que registra a ciência: só a ação, com o pedido do cliente.
    for (const arquivo of [pagina, caixa, ler("mensagens", "mensagem.tsx"), ler("page.tsx"), ler("layout.tsx")]) assert.doesNotMatch(arquivo, /abrirMensagem\b|abrirMensagemDaCaixa/);
    assert.match(ler("mensagens", "acoes.ts"), /confirmado: texto\(dados, "confirmo"\) === "sim"/);
  });

  it("Avisos: portão e a tabela única; o painel busca a lista de mensagens só autorizado", () => {
    const pagina = ler("avisos", "page.tsx");
    assert.match(pagina, /await exigirConteudo\(\)/);
    assert.match(pagina, /<PortaoFechado /);
    assert.match(ler("avisos", "lista.tsx"), /from "@\/app\/tabela"/);
    assert.match(ler("page.tsx"), /if \(ligado\) \{[\s\S]*?await atualizarCaixaAoAbrir\(acesso\)/);
  });

  it("Declaração anual: o nome na tela, o modo guiado com os valores e o botão Atualizar", () => {
    const pagina = ler("defis", "page.tsx");
    assert.match(pagina, /<FacaNoPortal\s+funcao="declaracaoAnual"/);
    assert.doesNotMatch(pagina, /rodape=\{<><\/>\}/);
    assert.match(pagina, /<ValoresDoAno /);
    assert.match(pagina, /salvarDefisAcao/);
  });
});
