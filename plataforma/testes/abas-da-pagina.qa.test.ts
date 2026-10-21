// QA (21/10/2026, ciclo 2): bordas do componente único de abas — limites da contagem (100, negativa), rótulo da
// contagem, aba atual inexistente e as abas reais do Plano.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AbasDaPagina } from "@/app/abas-da-pagina";
import { ABAS_DO_PLANO } from "@/lib/plano";

const desenhar = (atual: string, abas: Parameters<typeof AbasDaPagina>[0]["abas"]) =>
  renderToStaticMarkup(createElement(AbasDaPagina, { rotulo: "R", abas, atual }));

describe("QA: AbasDaPagina", () => {
  it("100 vira 99+, contagem negativa não mostra selo, o rótulo da contagem vai no aria-label", () => {
    const html = desenhar("a", [
      { id: "a", nome: "A", href: "/a", contagem: 100, rotuloDaContagem: "100 avisos" },
      { id: "b", nome: "B", href: "/b", contagem: -3 },
      { id: "c", nome: "C", href: "/c", contagem: 1, rotuloDaContagem: "1 aviso" },
    ]);
    assert.match(html, /aria-label="100 avisos">99\+</);
    assert.ok(!/-3/.test(html));
    assert.match(html, /aria-label="1 aviso">1</);
  });

  it("aba atual que não existe: nenhuma marcada", () => {
    const html = desenhar("zzz", [{ id: "a", nome: "A", href: "/a" }]);
    assert.ok(!/aria-current/.test(html));
  });

  it("as abas reais do Plano: links para /admin/plano e ?aba=seguranca", () => {
    const html = desenhar("seguranca", ABAS_DO_PLANO);
    assert.match(html, /href="\/admin\/plano">Plano</);
    assert.match(html, /aria-current="page"[^>]*href="\/admin\/plano\?aba=seguranca">Segurança</);
  });
});
