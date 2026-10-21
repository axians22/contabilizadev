// QA (Parte 3, tooltip, ciclo 4): bordas das correções do ciclo 3.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lerRespostaCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { respostaGravada } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { completarDiagnostico, diagnosticar, type Diagnostico } from "@contabilizadev/nucleo/diagnostico";
import { orientacoes } from "@/lib/empresas/assistente";
import { janelaVisivel, posicionarBalao, MARGEM } from "@/lib/explicacao";

const HOJE = "2026-10-16";

describe("QA ciclo4: orientações por situação", () => {
  for (const s of ["SUSPENSA", "INAPTA"]) {
    it(`${s} mantém as outras orientações (regularizável)`, () => {
      const dados = { ...lerRespostaCnpj(respostaGravada("mei")), situacaoCadastral: s };
      const o = orientacoes(dados, diagnosticar(dados, HOJE), HOJE);
      assert.ok(o.length >= 2, JSON.stringify(o.map((x) => x.titulo)));
    });
  }
  for (const s of ["BAIXADA", "NULA"]) {
    it(`${s} com MEI só tem a orientação da situação`, () => {
      const dados = { ...lerRespostaCnpj(respostaGravada("mei")), situacaoCadastral: s };
      const o = orientacoes(dados, diagnosticar(dados, HOJE), HOJE);
      assert.equal(o.length, 1);
    });
  }
});

describe("QA ciclo4: diagnóstico antigo", () => {
  it("completarDiagnostico não mexe no que já está completo", () => {
    const dados = lerRespostaCnpj(respostaGravada("mei"));
    const d = diagnosticar(dados, HOJE);
    assert.deepEqual(completarDiagnostico(d, dados, HOJE), d);
  });
  it("só observacoes faltando também refaz", () => {
    const dados = lerRespostaCnpj(respostaGravada("mei"));
    const d: Partial<Diagnostico> = { ...diagnosticar(dados, HOJE) };
    delete d.observacoes;
    const c = completarDiagnostico(d as Diagnostico, dados, HOJE);
    assert.ok(Array.isArray(c.observacoes) && Array.isArray(c.impedimentos));
  });
});

describe("QA ciclo4: janela visível", () => {
  it("visualViewport com zero cai para o layout", () => {
    assert.deepEqual(janelaVisivel({ largura: 360, altura: 640 }, { width: 0, height: 0, offsetLeft: 0, offsetTop: 0 }), { largura: 360, altura: 640, esquerda: 0, topo: 0 });
  });
  it("balão com zoom 2x e tela arrastada fica dentro da área visível", () => {
    const j = janelaVisivel({ largura: 360, altura: 640 }, { width: 180, height: 320, offsetLeft: 100, offsetTop: 200 });
    const p = posicionarBalao({ esquerda: 250, topo: 480, largura: 24, altura: 24 }, 120, j);
    assert.ok(p.esquerda >= 100 + MARGEM - 0.01 && p.esquerda + p.largura <= 280 - MARGEM + 0.01, JSON.stringify(p));
    assert.ok(p.topo >= 200 + MARGEM - 0.01 && p.topo + 120 <= 520 - MARGEM + 0.01, JSON.stringify(p));
  });
});
