// Tooltips das guias e dos impostos (DAS, DARF e cada tributo): todo tributo que aparece na tela tem verbete, a
// regra da exportação está certa em cada um e o nome acessível contém o nome que aparece sublinhado.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TRIBUTOS } from "@contabilizadev/nucleo/simples";
import { ExplicacaoDoTermo, rotuloDoTermo } from "@/app/explicacao";
import { GLOSSARIO, TERMO_DO_TRIBUTO } from "@/lib/empresas/glossario";
import { explicacoes, semExplicacoes, texto } from "./tela";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replace(/ /g, " ");

describe("glossário: guias e impostos", () => {
  it("todo tributo do DAS e o INSS do pró-labore têm verbete com título em pergunta e texto", () => {
    for (const t of [...TRIBUTOS, "inss" as const]) {
      const v = GLOSSARIO[TERMO_DO_TRIBUTO[t]];
      assert.ok(v, t);
      assert.match(v.titulo, /^O que é .+\?$/, t);
      assert.ok(v.texto.length > 0 && v.texto.every((p) => p.length > 0), t);
    }
    for (const termo of ["das", "darf"] as const) assert.match(GLOSSARIO[termo].titulo, /^O que é o (DAS|DARF do INSS)\?$/);
  });

  it("os que não incidem na exportação dizem isso; IRPJ, CSLL e CPP não", () => {
    for (const t of ["pis", "cofins", "iss", "cbs", "ibs"] as const) {
      assert.match(GLOSSARIO[TERMO_DO_TRIBUTO[t]].texto.join(" "), /Não incide na exportação de serviços/, t);
    }
    for (const t of ["irpj", "csll", "cpp"] as const) {
      assert.doesNotMatch(GLOSSARIO[TERMO_DO_TRIBUTO[t]].texto.join(" "), /Não incide/, t);
    }
    assert.match(GLOSSARIO.irpj.texto.join(" "), /Continua devido na exportação/);
    assert.match(GLOSSARIO.csll.texto.join(" "), /Continua devida na exportação/);
  });

  it("CPP e INSS do pró-labore se explicam um pelo outro (DAS x DARF)", () => {
    assert.match(GLOSSARIO.cpp.texto.join(" "), /DARF/);
    assert.match(GLOSSARIO.inssProLabore.texto.join(" "), /fora do DAS/);
    assert.match(GLOSSARIO.inssProLabore.texto.join(" "), /11%/);
  });

  it("os títulos são únicos (o painel mostra os tributos, o DAS e o DARF juntos) e não repetem os outros verbetes", () => {
    const novos = new Set<string>(["das", "darf", ...Object.values(TERMO_DO_TRIBUTO)]);
    const titulos = [...novos].map((t) => GLOSSARIO[t as keyof typeof GLOSSARIO].titulo);
    assert.equal(new Set(titulos).size, titulos.length);
    const outros = Object.entries(GLOSSARIO).filter(([t]) => !novos.has(t)).map(([, v]) => v.titulo);
    for (const t of titulos) assert.ok(!outros.includes(t), t);
  });
});

describe("ExplicacaoDoTermo: rótulo acessível", () => {
  it("gatilho que está na pergunta: o rótulo é a pergunta", () => {
    assert.equal(rotuloDoTermo("O que é o IRPJ?", "IRPJ"), "O que é o IRPJ?");
    assert.equal(rotuloDoTermo("O que é o DARF do INSS?", "DARF"), "O que é o DARF do INSS?");
    assert.equal(rotuloDoTermo("O que é o INSS patronal (CPP)?", "INSS patronal"), "O que é o INSS patronal (CPP)?");
  });

  it("gatilho fora da pergunta: o rótulo começa pelo texto visível (WCAG 2.5.3)", () => {
    assert.equal(rotuloDoTermo("O que é o INSS do pró-labore?", "DARF do INSS"), "DARF do INSS: o que é o INSS do pró-labore?");
  });

  it("sem gatilho de texto (ícone ⓘ), o rótulo é a pergunta", () => {
    assert.equal(rotuloDoTermo("O que é o DAS?"), "O que é o DAS?");
  });

  it("na tela: o nome fica visível e sublinhado; a explicação, só no balão", () => {
    const h = render(createElement(ExplicacaoDoTermo, { termo: TERMO_DO_TRIBUTO.inss, gatilho: "DARF do INSS" }));
    const [balao] = explicacoes(h);
    assert.equal(balao.rotulo, "DARF do INSS: o que é o INSS do pró-labore?");
    assert.match(balao.texto, /11% do pró-labore/);
    assert.match(texto(semExplicacoes(h)), /DARF do INSS/);
    assert.doesNotMatch(texto(semExplicacoes(h)), /11%/);
  });
});
