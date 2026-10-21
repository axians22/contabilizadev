// QA, Parte 8 (rodada de correções de 20/10/2026): casos de borda que os testes do engenheiro não cobrem.
// - Lançar com o mês em andamento: dezembro (virada de ano), o formulário bloqueado não tem botão de enviar nem ação, e o
//   mesmo componente sem `liberadoEm` envia normalmente.
// - Últimos 12 meses do eSocial no passo 6: virada de ano nos links, só o mês aberto marcado, tabela fora da aba eSocial.
// - Barra lateral: nenhum href repetido, grupos sem item vazio, nada de administração (a área /admin tem a própria barra).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { dataBr } from "@contabilizadev/nucleo/formato";
import { somarMeses } from "@contabilizadev/nucleo/meses";
import { LancarReceita } from "@/app/(painel)/roteiro/componentes";
import { MesesNoEsocial, situacaoDoMes } from "@/app/(painel)/roteiro/esocial";
import { gruposDaBarra } from "@/app/barra-lateral";
import type { SituacaoEsocial } from "@/lib/esocial/envio";
import { mesLancavel } from "@/lib/rotina/receitas";
import { texto } from "./tela";

const APP = path.join(import.meta.dirname, "..", "app", "(painel)");
const nada = async () => undefined;

describe("QA: lançar com o mês em andamento (igual ao ../fiscal)", () => {
  it("dezembro: liberado em 01/01/2027, campos à vista com a data de hoje, sem botão de enviar nem ação no form", () => {
    const pa = "2026-12";
    const liberadoEm = dataBr(`${somarMeses(pa, 1)}-01`);
    assert.equal(liberadoEm, "01/01/2027");
    const html = renderToStaticMarkup(createElement(LancarReceita, { acao: nada, empresaId: "e", pa, hoje: "2026-12-31", liberadoEm }));
    const t = texto(html);
    assert.match(t, /Valor que caiu no banco \(R\$\)/);
    assert.match(t, /Data em que caiu/);
    assert.match(html, /name="recebidaEm"[^>]*value="2026-12-31"|value="2026-12-31"[^>]*name="recebidaEm"/);
    assert.match(html, /Lançar a partir de (<!-- -->)?01\/01\/2027/);
    assert.doesNotMatch(html, /type="submit"/);
    assert.doesNotMatch(html, /<form[^>]*action=/);
    assert.match(html, /<form[^>]*data-bloqueado="true"/);
    // O valor vem antes da data, como no ../fiscal.
    assert.ok(html.indexOf('name="valor"') < html.indexOf('name="recebidaEm"'));
  });

  it("o mesmo componente sem liberadoEm: botão Lançar ativo e sem marca de bloqueio", () => {
    const html = renderToStaticMarkup(createElement(LancarReceita, { acao: nada, empresaId: "e", pa: "2026-09", hoje: "2026-10-20" }));
    assert.match(html, />Lançar<\/button>/);
    assert.doesNotMatch(html, /data-bloqueado|Lançar a partir de|disabled=""/);
  });

  it("o servidor recusa o mês em andamento até a meia-noite de Brasília (31/12 23:59 -03 ainda é dezembro)", () => {
    assert.equal(mesLancavel("2026-12", new Date("2026-12-31T23:59:00-03:00")), false);
    assert.equal(mesLancavel("2026-12", new Date("2027-01-01T00:00:00-03:00")), true);
    assert.equal(mesLancavel("2027-01", new Date("2027-01-01T00:00:00-03:00")), false);
  });
});

describe("QA: os últimos 12 meses do eSocial no passo 6 do Roteiro", () => {
  const mes = (m: string, extra: Partial<SituacaoEsocial> = {}): SituacaoEsocial =>
    ({
      mes: m, config: null, proLabore: null, valores: null, envio: null, emAndamento: null, remuneracao: null, pagamentoAceito: false, fechado: false, portal: false,
      concluido: false, pagamento: null, semDemonstrativoAnterior: null, prazo: `${somarMeses(m, 1)}-15`, ...extra,
    }) as SituacaoEsocial;

  it("virada de ano: links para cada mês no passo 6, só o mês aberto marcado, situações com as frases da antiga aba", () => {
    const meses = Array.from({ length: 12 }, (_, i) => mes(somarMeses("2026-09", -i), i === 1 ? { proLabore: 1621 } : {}));
    const html = renderToStaticMarkup(createElement(MesesNoEsocial, { meses, atual: "2026-08" }));
    // A tabela pagina de 6 em 6: a primeira página vai de setembro a abril de 2026.
    assert.match(html, /href="\/roteiro\?mes=2026-04#passo-6"/);
    // Um link marcado na tabela do computador e um nos cartões do celular (o outro aria-current é o da paginação).
    assert.equal([...html.matchAll(/<a aria-current="page"/g)].length, 2);
    assert.match(html, /aria-current="page"[^>]*>agosto de 2026|href="\/roteiro\?mes=2026-08#passo-6" aria-current="page"/);
    const t = texto(html);
    assert.match(t, /A enviar/);
    assert.match(t, /Sem pró-labore informado/);
    assert.equal(situacaoDoMes(mes("2026-09", { portal: true })), "Lançado no portal");
  });

  it("o mês aberto fica à vista mesmo quando está na segunda página da tabela (ex.: Roteiro de janeiro de 2026)", () => {
    const meses = Array.from({ length: 12 }, (_, i) => mes(somarMeses("2026-09", -i)));
    const html = renderToStaticMarkup(createElement(MesesNoEsocial, { meses, atual: "2026-01" }));
    // Esperado: a tabela abre na página do mês aberto (o destaque prometido); obtido: abre na página 1, sem o mês.
    assert.match(html, /href="\/roteiro\?mes=2026-01#passo-6"/);
    assert.match(html, /aria-current="page"[^>]*href="\/roteiro\?mes=2026-01#passo-6"/);
  });

  it("a aba eSocial não mostra mais a situação dos meses nem consulta lotes ao abrir", () => {
    const fonte = readFileSync(path.join(APP, "esocial", "page.tsx"), "utf8");
    for (const fora of [/situacaoEsocial\(/, /acompanharAoAbrir/, /MesesNoEsocial/, /<Tabela/]) assert.doesNotMatch(fonte, fora, String(fora));
    const roteiro = readFileSync(path.join(APP, "roteiro", "page.tsx"), "utf8");
    assert.match(roteiro, /meses=\{mesesEs\}/);
  });
});

describe("QA: barra lateral", () => {
  it("nenhum href repetido, nenhum grupo vazio; nada de administração na barra da aplicação (fica na área /admin)", () => {
    const grupos = gruposDaBarra();
    const hrefs = grupos.flatMap((g) => g.itens.map((i) => i.href));
    assert.equal(new Set(hrefs).size, hrefs.length);
    for (const g of grupos) assert.ok(g.itens.length > 0, g.titulo);
    assert.ok(!grupos.some((g) => g.titulo === "Plataforma"));
    assert.ok(!hrefs.some((h) => ["/usuarios", "/config/plataforma", "/plano"].includes(h) || h.startsWith("/admin")));
  });
});

describe("QA: listas de declarações e pagamentos no máximo 1 vez por dia (regra pura)", () => {
  const em = (iso: string) => new Date(`${iso}-03:00`);
  const estado = (consultas: [string, string][], dasVencido = true) => ({
    consultas: new Map(consultas.map(([tipo, quando]) => [tipo, { em: em(quando), ok: true }])),
    ultimoProntoSituacao: em("2026-10-20T16:33:59"),
    situacaoProcessando: false,
    defisEntregues: new Set([2025]),
    dasSemPagamentoVencido: dasVencido,
    extratosFaltando: 0,
  });

  it("consulta às 23:50 e tela aberta às 00:10 do dia seguinte (outro dia no calendário, menos de 24 h): nada", async () => {
    const { planejar } = await import("@/lib/historico/prazos");
    const e = estado([["declaracoes:2025", "2026-10-20T23:50:00"], ["declaracoes:2026", "2026-10-20T23:50:00"], ["pagamentos", "2026-10-20T23:50:00"]]);
    for (const grupos of [["historico"], ["situacao"], ["defis"], ["historico", "defis", "situacao"]] as const) {
      assert.deepEqual(planejar(e, { grupos: [...grupos], manual: false }, em("2026-10-21T00:10:00")).etapas, [], grupos.join());
    }
  });

  it("o botão Atualizar da Situação fiscal ou da Declaração anual nunca refaz as listas do PGDAS-D nem os pagamentos", async () => {
    const { planejar } = await import("@/lib/historico/prazos");
    const e = estado([["declaracoes:2025", "2026-10-20T16:33:50"], ["declaracoes:2026", "2026-10-20T16:33:51"], ["pagamentos", "2026-10-20T16:33:55"]]);
    for (const grupo of ["situacao", "defis"] as const) {
      const ids = planejar(e, { grupos: [grupo], manual: true }, em("2026-10-20T18:42:08")).etapas.map((x) => x.id);
      assert.ok(!ids.includes("declaracoes") && !ids.includes("pagamentos"), `${grupo}: ${ids}`);
    }
  });
});
