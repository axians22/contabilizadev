// Os botões da guia do mês (lib/rotina/botoes-guia.ts e app/(painel)/botoes-da-guia.tsx), como no ../fiscal: "Ver guia"
// (paga), "Abrir guia" (em aberto) ou "Guia original" (vencida), que abre o PDF em nova aba, e "Baixar". Com o PDF no banco,
// a rota protegida de documentos; sem ele (mês feito fora da plataforma), a rota que busca na Receita uma vez; sem serviço,
// o portal com os passos no tooltip. O DARF pago sem guia conhecida mostra o valor pago.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BotoesDaGuia } from "@/app/(painel)/botoes-da-guia";
import { GuiasDoMes } from "@/app/(painel)/guias-do-mes";
import { botoesDaGuia, entradaDaGuia, valorDaGuia, type EntradaDosBotoes } from "@/lib/rotina/botoes-guia";
import type { Guia, GuiaDoMes } from "@/lib/rotina/guias";
import { ECAC, PORTAL_SIMPLES } from "@/lib/termo/guiado";
import { explicacoes, semExplicacoes, texto } from "./tela";

const visivel = (html: string) => texto(semExplicacoes(html)).replace(/\s+/g, " ").trim();
const ID = "00000000-0000-0000-0000-0000000000a1";
const entrada = (extra: Partial<EntradaDosBotoes> = {}): EntradaDosBotoes => ({
  pa: "2026-09", tipo: "DAS", situacao: "aberto", guardada: null, referencia: "98765432202609001", pagamento: null, autorizada: true, ...extra,
});
const salva = (extra: Partial<Guia> = {}) => ({ id: ID, total: 1000.76, referencia: "98765432202609001", ...extra }) as Guia;
const guia = (tipo: "DAS" | "INSS", extra: Partial<GuiaDoMes> = {}): GuiaDoMes => ({
  pa: "2026-09", tipo, referencia: tipo === "DAS" ? "98765432202609001" : null, vencimento: "2026-10-20", paga: false, pagaEm: null, vencida: false,
  original: null, atualizada: null, pagarEmSugerido: "2026-10-19", ...extra,
});

describe("o que cada botão faz", () => {
  it("PDF guardado: a rota protegida, com o rótulo de cada situação", () => {
    for (const [situacao, rotulo] of [["pago", "Ver guia"], ["aberto", "Abrir guia"], ["vencido", "Guia original"]] as const) {
      assert.deepEqual(botoesDaGuia(entrada({ situacao, guardada: ID })), { modo: "guardada", rotulo, abrir: `/documentos/guia/${ID}`, baixar: `/documentos/guia/${ID}`, explicacao: null });
    }
    // Mesmo sem autorização, o que já está aqui abre.
    assert.equal(botoesDaGuia(entrada({ guardada: ID, autorizada: false }))?.modo, "guardada");
  });

  it("sem o PDF e com a autorização: o mesmo botão busca na Receita (paga: o comprovante; em aberto: a guia do mês)", () => {
    const paga = botoesDaGuia(entrada({ situacao: "pago", pa: "2026-08", pagamento: "7202608000000001" }));
    assert.deepEqual(paga && paga.modo === "buscar" && [paga.rotulo, paga.abrir, paga.baixar], ["Ver guia", "/documentos/guia-do-mes/DAS/2026-08", "/documentos/guia-do-mes/DAS/2026-08?baixar=1"]);
    assert.match(paga!.explicacao!.texto[0], /comprovante de arrecadação.*uma vez só/);
    const aberta = botoesDaGuia(entrada({ tipo: "INSS", referencia: "50000534643844" }));
    assert.deepEqual(aberta && aberta.modo === "buscar" && [aberta.rotulo, aberta.abrir], ["Abrir guia", "/documentos/guia-do-mes/INSS/2026-09"]);
    assert.match(aberta!.explicacao!.texto[0], /busca a guia do mês na Receita Federal, uma vez só/);
  });

  it("sem serviço para o caso: o caminho no portal, com os passos no tooltip", () => {
    const semDocumento = botoesDaGuia(entrada({ situacao: "pago" }));
    assert.ok(semDocumento?.modo === "portal");
    assert.deepEqual([semDocumento.rotulo, semDocumento.portal], ["Comprovante no portal", ECAC]);
    assert.ok(semDocumento.explicacao.passos?.some((p) => /Comprovante de Pagamento/.test(p)));
    const pagaSemAutorizacao = botoesDaGuia(entrada({ situacao: "pago", pagamento: "1", autorizada: false }));
    assert.equal(pagaSemAutorizacao?.modo, "portal");
    const das = botoesDaGuia(entrada({ autorizada: false }));
    assert.ok(das?.modo === "portal" && das.portal === PORTAL_SIMPLES && das.rotulo === "Gerar no portal");
    const darf = botoesDaGuia(entrada({ tipo: "INSS", referencia: "1", autorizada: false }));
    assert.ok(darf?.modo === "portal" && darf.portal === ECAC);
  });

  it("sem guia: nada (sem declaração ou DCTFWeb, DAS sem valor)", () => {
    assert.equal(botoesDaGuia(entrada({ referencia: null })), null);
    assert.equal(botoesDaGuia(entrada({ situacao: "vencido", referencia: null })), null);
    assert.equal(botoesDaGuia(entrada({ situacao: "pago", semValor: true })), null);
    assert.equal(botoesDaGuia(entrada({ situacao: "vencido", semValor: true })), null);
  });

  it("vencida sem a original guardada: 'Guia original' leva ao portal (PGDAS-D no DAS, DCTFWeb no e-CAC), com o motivo no tooltip", () => {
    const das = botoesDaGuia(entrada({ situacao: "vencido" }));
    assert.ok(das?.modo === "portal" && das.rotulo === "Guia original" && das.portal === PORTAL_SIMPLES);
    assert.match(das.explicacao.texto.join(" "), /venceu.*multa e juros.*PGDAS-D/);
    assert.ok(das.explicacao.passos?.length);
    const darf = botoesDaGuia(entrada({ tipo: "INSS", situacao: "vencido", autorizada: false }));
    assert.ok(darf?.modo === "portal" && darf.rotulo === "Guia original" && darf.portal === ECAC);
    assert.match(darf.explicacao.texto.join(" "), /DCTFWeb do e-CAC/);
    // Com a original guardada, abre a guardada (não o portal).
    assert.equal(botoesDaGuia(entrada({ situacao: "vencido", guardada: "00000000-0000-0000-0000-0000000000a1" }))?.modo, "guardada");
  });

  it("a entrada da guia do mês: paga usa a guia ou o comprovante guardado; o valor pago entra quando a guia é desconhecida", () => {
    const comprovante = salva({ id: "00000000-0000-0000-0000-0000000000c1", referencia: "comprovante:1" });
    const paga = guia("INSS", { paga: true, pagaEm: "2026-10-13", pagamento: { numero: "1", valor: 178.31 }, comprovante });
    assert.deepEqual(entradaDaGuia(paga, "pago", true), { pa: "2026-09", tipo: "INSS", situacao: "pago", guardada: comprovante.id, referencia: null, pagamento: "1", semValor: false, autorizada: true });
    // Em aberto, o comprovante não conta (é só da paga).
    assert.equal(entradaDaGuia({ ...paga, paga: false }, "aberto", true).guardada, null);
    assert.equal(entradaDaGuia(guia("DAS", { paga: true, declarado: 0 }), "pago", true).semValor, true);
    assert.deepEqual(valorDaGuia(paga, null), { valor: 178.31, origem: "pago" });
    assert.deepEqual(valorDaGuia(paga, 150), { valor: 178.31, origem: "pago" });
    assert.deepEqual(valorDaGuia(guia("DAS", { original: salva() }), 1), { valor: 1000.76, origem: "" });
    assert.deepEqual(valorDaGuia(guia("DAS", { declarado: 999 }), 1), { valor: 999, origem: "declarado" });
    assert.deepEqual(valorDaGuia(guia("INSS"), 178.31), { valor: 178.31, origem: "calculado" });
    assert.deepEqual(valorDaGuia(guia("INSS"), null), { valor: null, origem: "" });
  });
});

describe("na tela", () => {
  it("o componente: abre em nova aba e Baixar; o tooltip explica a busca; no portal, link externo", () => {
    const html = renderToStaticMarkup(createElement(BotoesDaGuia, { botoes: botoesDaGuia(entrada({ situacao: "pago", pagamento: "1" })), nome: "DAS" }));
    assert.equal(visivel(html), "Ver guia Baixar");
    assert.match(html, /<a[^>]*href="\/documentos\/guia-do-mes\/DAS\/2026-09"[^>]*target="_blank"/);
    // Buscar: o Baixar abre em nova aba SEM `download`, para a mensagem de falha da busca ser lida (e não baixada como
    // arquivo); dando certo, a rota responde com Content-Disposition: attachment.
    const baixar = html.match(/<a[^>]*href="\/documentos\/guia-do-mes\/DAS\/2026-09\?baixar=1"[^>]*>/)?.[0] ?? "";
    assert.match(baixar, /target="_blank"/);
    assert.doesNotMatch(baixar, /download/);
    // Guardada: o PDF já está aqui, download direto.
    const guardada = renderToStaticMarkup(createElement(BotoesDaGuia, { botoes: botoesDaGuia(entrada({ guardada: ID })), nome: "DAS" }));
    assert.match(guardada, new RegExp(`href="/documentos/guia/${ID}" download=""`));
    assert.equal(explicacoes(html)[0].rotulo, "De onde vem a guia do DAS?");
    const portal = renderToStaticMarkup(createElement(BotoesDaGuia, { botoes: botoesDaGuia(entrada({ autorizada: false })), nome: "DAS" }));
    assert.match(portal, /href="https:\/\/www8\.receita\.fazenda\.gov\.br\/SimplesNacional\/[^"]*"[^>]*target="_blank"[^>]*>Gerar no portal</);
    assert.match(explicacoes(portal)[0].texto, /Emitir Guia de Pagamento \(DAS\)/);
    assert.equal(renderToStaticMarkup(createElement(BotoesDaGuia, { botoes: null, nome: "DAS" })), "");
  });

  it("painel: o mês importado da Receita (pago fora) mostra Ver guia e Baixar nos dois cartões e o valor pago do DARF", () => {
    const html = renderToStaticMarkup(
      createElement(GuiasDoMes, {
        das: guia("DAS", { paga: true, pagaEm: "2026-10-13", declarado: 1000.76, pagamento: { numero: "7202627851592322", valor: 1000.76 } }),
        inss: guia("INSS", { paga: true, pagaEm: "2026-10-13", pagamento: { numero: "7162627851517448", valor: 178.31 } }),
        dasCalculado: null,
        inssCalculado: null,
        hoje: "2026-10-20",
        receitaLancada: false,
        autorizada: true,
        empresaId: "e",
        gerar: async () => undefined,
      }),
    );
    const t = visivel(html);
    assert.match(t, /DAS Simples Nacional Pago R\$\s1\.000,76 Pago em 13\/10\/2026 · valor declarado Ver guia Baixar/);
    assert.match(t, /DARF INSS do pró-labore Pago R\$\s178,31 Pago em 13\/10\/2026 · valor pago Ver guia Baixar/);
    assert.doesNotMatch(t, /—/);
    assert.match(html, /href="\/documentos\/guia-do-mes\/DAS\/2026-09"/);
    assert.match(html, /href="\/documentos\/guia-do-mes\/INSS\/2026-09\?baixar=1"/);
  });

  it("painel e rotina: vencida sem a original guardada mostra 'Guia original' (portal, motivo no tooltip) e a guia com multa e juros", async () => {
    const vencida = guia("DAS", { pa: "2026-08", referencia: "98765432202608001", vencimento: "2026-09-21", vencida: true, declarado: 1213.55, pagarEmSugerido: "2026-10-21" });
    const html = renderToStaticMarkup(
      createElement(GuiasDoMes, { das: vencida, inss: guia("INSS", { pa: "2026-08", vencida: true, vencimento: "2026-09-21" }), dasCalculado: null, inssCalculado: 178.31, hoje: "2026-10-20", receitaLancada: true, autorizada: true, empresaId: "e", gerar: async () => undefined }),
    );
    const t = visivel(html);
    assert.match(t, /Vencido R\$\s1\.213,55 Venceu em 21\/09\/2026 · valor declarado Guia original/);
    assert.match(t, /Gerar guia com multa e juros|multa e juros/);
    assert.match(html, /href="https:\/\/www8\.receita\.fazenda\.gov\.br\/SimplesNacional\/[^"]*"[^>]*target="_blank"[^>]*>Guia original</);
    assert.ok(explicacoes(html).some((e) => /não devolve a original depois do vencimento/.test(e.texto)));
    const { GuiaAqui } = await import("@/app/(painel)/roteiro/guia-aqui");
    const rotina = renderToStaticMarkup(createElement(GuiaAqui, { guia: vencida, campos: {}, rotulo: "Gerar guia", gerar: async () => ({ ok: true }) as never }));
    assert.match(visivel(rotina), /Guia original/);
    assert.match(visivel(rotina), /Gerar com multa e juros/);
  });

  it("painel: em aberto com a declaração feita fora, Abrir guia (busca ao clicar) no lugar de Gerar guia; gerada, a rota protegida", () => {
    const comuns = { dasCalculado: 1000.76, inssCalculado: null, hoje: "2026-10-18", receitaLancada: true, autorizada: true, empresaId: "e", gerar: async () => undefined };
    const aberta = renderToStaticMarkup(createElement(GuiasDoMes, { ...comuns, das: guia("DAS"), inss: guia("INSS") }));
    assert.match(visivel(aberta), /DAS Simples Nacional Em aberto R\$\s1\.000,76 Vence em 20\/10\/2026 · valor calculado aqui Abrir guia Baixar/);
    assert.doesNotMatch(visivel(aberta), /Gerar guia\b/);
    const gerada = renderToStaticMarkup(createElement(GuiasDoMes, { ...comuns, das: guia("DAS", { original: salva() }), inss: guia("INSS") }));
    assert.match(gerada, new RegExp(`href="/documentos/guia/${ID}"[^>]*target="_blank"[^>]*>Abrir guia<`));
    assert.match(gerada, new RegExp(`href="/documentos/guia/${ID}" download=""`));
  });
});
