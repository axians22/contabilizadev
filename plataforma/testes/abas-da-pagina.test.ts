// O componente único de abas de página (Avisos e mensagens, Plano do projeto): aria-current só na aba atual, o selo de
// contagem (sem selo quando zero ou ausente, "99+" acima de 99) e as duas páginas usando o mesmo componente.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AbasDaPagina } from "@/app/abas-da-pagina";

const desenhar = (atual: string, abas: Parameters<typeof AbasDaPagina>[0]["abas"]) =>
  renderToStaticMarkup(createElement(AbasDaPagina, { rotulo: "Exemplo", abas, atual }));

describe("AbasDaPagina", () => {
  it("marca aria-current só na aba atual", () => {
    const html = desenhar("b", [
      { id: "a", nome: "Primeira", href: "/x" },
      { id: "b", nome: "Segunda", href: "/x?aba=b" },
    ]);
    assert.match(html, /<nav aria-label="Exemplo"/);
    assert.equal(html.match(/aria-current="page"/g)?.length, 1);
    assert.match(html, /<a aria-current="page" class="[^"]*border-accent-ink[^"]*" href="\/x\?aba=b">Segunda/);
    assert.match(html, /<a class="[^"]*border-transparent[^"]*" href="\/x">Primeira/);
  });

  it("mostra contagem acima de 99 como 99+ e esconde a contagem zero ou ausente", () => {
    const html = desenhar("a", [
      { id: "a", nome: "Avisos", href: "/a", contagem: 150, rotuloDaContagem: "150 avisos" },
      { id: "b", nome: "Mensagens", href: "/b", contagem: 0, rotuloDaContagem: "0 mensagens" },
      { id: "c", nome: "Outra", href: "/c" },
      { id: "d", nome: "Poucas", href: "/d", contagem: 99, rotuloDaContagem: "99 itens" },
    ]);
    assert.match(html, /aria-label="150 avisos">99\+</);
    assert.doesNotMatch(html, /0 mensagens/);
    assert.match(html, /aria-label="99 itens">99</);
    assert.equal(html.match(/rounded-full/g)?.length, 2);
  });

  it("é o mesmo componente nas páginas de Avisos e do Plano (sem nav copiado)", () => {
    for (const arquivo of ["app/(painel)/avisos/page.tsx", "app/admin/plano/conteudo.tsx"]) {
      const fonte = readFileSync(new URL(`../${arquivo}`, import.meta.url), "utf8");
      assert.match(fonte, /<AbasDaPagina /, arquivo);
      assert.doesNotMatch(fonte, /<nav /, arquivo);
    }
  });
});
