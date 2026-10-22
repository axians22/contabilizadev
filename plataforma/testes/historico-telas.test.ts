// Telas da Parte 5 (HTML do servidor, como o navegador recebe): situação fiscal em evidência (vermelho se irregular),
// rótulos de cada mês; explicações só no tooltip; fonte sempre "Receita Federal", sem o fornecedor; e as
// abas ligadas ao portão, ao modo guiado e à rota de documentos.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CartaoUltimaDefis } from "@/app/(painel)/defis/cartao-defis";
import { CartaoSituacaoFiscal } from "@/app/(painel)/situacao/cartao-situacao";
import type { DefisGuardada, SituacaoFiscal } from "@/lib/historico/leitura";
import { MENSAGENS_DO_HISTORICO, NOMES_DAS_ETAPAS, SITUACOES_DO_MES } from "@/lib/historico/mensagens";
import { explicacoes, paragrafosVisiveis, semExplicacoes, texto } from "./tela";

const APP = path.join(import.meta.dirname, "..", "app", "(painel)");
const FORNECEDOR = /serpro|integra\s*contador|brasil\s*api|PGDASD\b|SITFIS|PAGTOWEB|CONS[A-Z]+\d{2}/i;
const PRONTO = new Date("2026-10-18T13:05:00Z");
const situacao = (regular: boolean | null, pendencias: string | null = null): SituacaoFiscal => ({
  atual: { id: "00000000-0000-0000-0000-0000000000aa", regular, pendencias, prontoEm: PRONTO, temPdf: true },
  processando: false,
});
const visivel = (html: string) => texto(semExplicacoes(html));

describe("situação fiscal em evidência", () => {
  it("regular: selo verde, data da consulta, link do PDF; explicação no tooltip", () => {
    const html = renderToStaticMarkup(createElement(CartaoSituacaoFiscal, { situacao: situacao(true) }));
    assert.match(html, /bg-accent[^"]*">Regular</);
    assert.match(visivel(html), /Consultada em 18\/10\/2026 às 10:05\./);
    assert.match(html, /href="\/documentos\/situacao\/00000000-0000-0000-0000-0000000000aa"/);
    assert.ok(explicacoes(html).some((e) => e.rotulo === "O que é a situação fiscal?" && /certidão negativa/.test(e.texto)));
    assert.doesNotMatch(visivel(html), /certidão negativa/);
  });

  it("irregular: selo e borda vermelhos (as pendências, explicadas, ficam em PendenciasExplicadas: testes/situacao-telas)", () => {
    const html = renderToStaticMarkup(createElement(CartaoSituacaoFiscal, { situacao: situacao(false, "Pendência - Débito (SIEF)\nOmissão de DCTF") }));
    assert.match(html, /bg-bad[^"]*">Irregular</);
    assert.match(html, /border-bad\/50/);
    assert.doesNotMatch(visivel(html), /SIEF/); // o texto cru do relatório não vai para a tela
  });

  it("indefinida, sem consulta e consultando", () => {
    assert.match(visivel(renderToStaticMarkup(createElement(CartaoSituacaoFiscal, { situacao: situacao(null) }))), /Não deu para ler/);
    assert.match(visivel(renderToStaticMarkup(createElement(CartaoSituacaoFiscal, { situacao: { atual: null, processando: false } }))), /Ainda não consultada\./);
    assert.match(visivel(renderToStaticMarkup(createElement(CartaoSituacaoFiscal, { situacao: { atual: null, processando: true } }))), /Consultando a Receita Federal…/);
  });
});

describe("declaração anual (DEFIS)", () => {
  const defis = (situacao: DefisGuardada["situacao"]): DefisGuardada => ({
    id: "00000000-0000-0000-0000-0000000000dd",
    ano: 2025,
    situacao,
    idDefis: situacao === "entregue" ? "00000000202500001" : null,
    declaracao: situacao === "entregue",
    recibo: situacao === "entregue",
    consultadaEm: PRONTO,
  });
  const cartao = (lista: DefisGuardada[], autorizada: boolean, consultando = false) =>
    visivel(renderToStaticMarkup(createElement(CartaoUltimaDefis, { lista, autorizada, consultando }))).trim();

  it("sem consulta feita não afirma que não há DEFIS: ainda não consultada, ou consultando durante a importação", () => {
    assert.equal(cartao([], true), "Ainda não consultada.");
    assert.equal(cartao([], true, true), "Consultando a Receita Federal…");
    assert.equal(cartao([], false), "");
  });

  it("não encontrada só com uma consulta que não achou; entregue mostra o ano, o número e os PDFs", () => {
    assert.equal(cartao([defis("nao-encontrada")], true), "Nenhuma DEFIS entregue encontrada na Receita Federal.");
    assert.equal(cartao([defis("nao-encontrada")], false), "Nenhuma DEFIS entregue encontrada na Receita Federal.");
    const entregue = renderToStaticMarkup(createElement(CartaoUltimaDefis, { lista: [defis("entregue")], autorizada: true, consultando: false }));
    assert.match(visivel(entregue), /Última DEFIS entregue Ano 2025 Entregue Número 00000000202500001 Declaração Recibo/);
    assert.match(entregue, /href="\/documentos\/defis\/00000000-0000-0000-0000-0000000000dd"/);
  });
});

describe("textos próprios, curtos e sem o fornecedor", () => {
  it("rótulos e mensagens do histórico", () => {
    const textos = [
      ...Object.values(SITUACOES_DO_MES).flatMap((s) => [s.rotulo, s.explicacao]),
      ...Object.values(NOMES_DAS_ETAPAS),
      ...Object.values(MENSAGENS_DO_HISTORICO).map((m) => (typeof m === "function" ? m(3) : m)),
    ];
    for (const t of textos) assert.doesNotMatch(t, FORNECEDOR, t);
    for (const s of Object.values(SITUACOES_DO_MES)) assert.ok(s.rotulo.length <= 20, s.rotulo);
    assert.equal(MENSAGENS_DO_HISTORICO.espere(1), "Consultado há pouco. Tente de novo em 1 minuto.");
  });

  it("nas telas renderizadas, nenhum parágrafo aberto longo (explicação vai no tooltip) e nada do fornecedor", () => {
    const htmls = [
      renderToStaticMarkup(createElement(CartaoSituacaoFiscal, { situacao: situacao(false, "Débito") })),
    ];
    for (const html of htmls) {
      assert.doesNotMatch(texto(html), FORNECEDOR);
      for (const p of paragrafosVisiveis(html)) assert.ok(p.length <= 140, p);
    }
  });
});

describe("abas ligadas ao portão, ao modo guiado e ao banco primeiro", () => {
  for (const [aba, funcao, grupo] of [
    ["historico", "declaracaoMensal", "historico"],
    ["situacao", "situacaoFiscal", "situacao"],
    ["defis", "declaracaoAnual", "defis"],
  ] as const) {
    it(`/${aba}: portão, modo guiado sem autorização, atualização automática só autorizada, botão Atualizar`, () => {
      const codigo = readFileSync(path.join(APP, aba, "page.tsx"), "utf8");
      assert.match(codigo, /await exigirConteudo\(\)/);
      assert.match(codigo, /<PortaoFechado /);
      assert.match(codigo, new RegExp(`<FacaNoPortal\\s+funcao="${funcao}"`));
      assert.match(codigo, new RegExp(`if \\(autorizada\\) await atualizarAoAbrir\\(acesso, \\["${grupo}"\\]\\)`));
      assert.match(codigo, /<BotaoAtualizarHistorico /);
    });
  }

  it("histórico: tabela única com paginação, gráfico sob demanda e o extrato pela rota de documentos", () => {
    const codigo = readFileSync(path.join(APP, "historico", "page.tsx"), "utf8");
    const tela = readFileSync(path.join(APP, "historico", "tela-historico.tsx"), "utf8"); // a tela, no desenho do ../fiscal
    assert.match(tela, /from "@\/app\/tabela"/);
    assert.match(codigo, /from "@\/app\/graficos"/); // GraficoBarras com import dinâmico (Chart.js só quando aparece)
    assert.match(tela, /enderecoDoDocumento\("extrato"/);
    assert.match(readFileSync(path.join(APP, "..", "graficos.tsx"), "utf8"), /dynamic\(\(\) => import\("@\/app\/grafico-barras"\)/);
  });

  it("a importação inicial começa quando a empresa fica autorizada (passo 7 e página Autorização)", () => {
    const acoes = readFileSync(path.join(APP, "autorizacao", "acoes.ts"), "utf8");
    // Com o acesso de dono que o envio devolve (o provisório que comprovou vira dono no envio).
    assert.match(acoes, /await importarSeNuncaImportou\(r\.acesso\);\s*return \{ ok: true/);
    assert.match(acoes, /if \(liberada\(preparo\.situacao\) && !ehProvisorio\(acesso\)\) await importarSeNuncaImportou\(acesso\)/);
    assert.match(readFileSync(path.join(APP, "autorizacao", "page.tsx"), "utf8"), /if \(liberada\(situacao\)\) await importarSeNuncaImportou\(acesso\)/);
  });
});
