// QA (Parte 3, tooltip, ciclo 3): o que o ciclo 2 deixou de fora.
// - Etapa 6 de CNPJ baixado/nulo não pode mandar "entrar no Simples" (contradiz "abra uma nova empresa").
// - Diagnóstico já gravado (jsonb sem as versões curtas), refeito por completarDiagnostico: rótulos naturais e únicos.
// - Posição do balão em casos de borda (janela minúscula, gatilho fora da tela).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { lerRespostaCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { respostaGravada, EXEMPLOS, type Exemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { completarDiagnostico, diagnosticar, type Diagnostico } from "@contabilizadev/nucleo/diagnostico";
import { CartaoDiagnostico } from "@/app/(painel)/empresa/ficha";
import { orientacoes } from "@/lib/empresas/assistente";
import { MARGEM, posicionarBalao, reduzirExplicacao, FECHADA, aberta } from "@/lib/explicacao";
import { explicacoes, semExplicacoes, texto } from "./tela";

const HOJE = "2026-10-16";

function comSituacao(exemplo: Exemplo, situacao: string) {
  const dados = lerRespostaCnpj(respostaGravada(exemplo));
  const d2 = { ...dados, situacaoCadastral: situacao };
  return { dados: d2, diagnostico: diagnosticar(d2, HOJE) };
}

// Diagnóstico como estava no banco antes das versões curtas, lido como a tela lê (completarDiagnostico com os dados).
function guardadoAntigo(exemplo: Exemplo): Diagnostico {
  const dados = lerRespostaCnpj(respostaGravada(exemplo));
  const velho: Partial<Diagnostico> = { ...diagnosticar(dados, HOJE) };
  delete velho.impedimentos;
  delete velho.observacoes;
  return completarDiagnostico(velho as Diagnostico, dados, HOJE);
}

describe("QA ciclo 3: próximos passos de CNPJ que não volta a ficar ativo", () => {
  for (const situacao of ["BAIXADA", "NULA"]) {
    it(`${situacao}: não sugere entrar no Simples nem regularizar outras coisas do mesmo CNPJ`, () => {
      const { dados, diagnostico } = comSituacao("baixada", situacao);
      const titulos = orientacoes(dados, diagnostico, HOJE).map((o) => o.titulo);
      assert.ok(!titulos.includes("Entrar no Simples Nacional"), `CNPJ ${situacao} com orientação contraditória: ${titulos.join(" | ")}`);
    });
  }
});

describe("QA ciclo 3: diagnóstico guardado antes das versões curtas (empresas já cadastradas)", () => {
  for (const ex of EXEMPLOS) {
    it(`${ex}: rótulos em pergunta natural, únicos, e versão curta sem palavra cortada`, () => {
      const d = guardadoAntigo(ex);
      const notas = [...d.impedimentos, ...d.observacoes];
      for (const n of notas) {
        assert.doesNotMatch(n.pergunta, /(motivo|aviso)( \d+)? completo\?/, `rótulo artificial: ${n.pergunta}`);
        assert.doesNotMatch(n.curto, /\p{L}…$/u, `versão curta cortada no meio da palavra: ${n.curto}`);
      }
      const html = renderToStaticMarkup(createElement(CartaoDiagnostico, { diagnostico: d }));
      const rotulos = explicacoes(html).map((e) => e.rotulo);
      assert.equal(new Set(rotulos).size, rotulos.length, `rótulos repetidos: ${rotulos.join(" | ")}`);
      assert.doesNotMatch(texto(semExplicacoes(html)), /CGSN|art\. \d/, "lei aberta na tela");
    });
  }
});

describe("QA ciclo 3: posição do balão em casos de borda", () => {
  it("janela mais estreita que as margens: largura não negativa e dentro da tela", () => {
    const p = posicionarBalao({ esquerda: 5, topo: 5, largura: 10, altura: 10 }, 50, { largura: 20, altura: 300 });
    assert.ok(p.largura >= 0);
    assert.ok(p.esquerda >= 0);
  });

  it("gatilho rolado para fora da tela (acima): o balão continua dentro da janela", () => {
    const janela = { largura: 1280, altura: 800 };
    const p = posicionarBalao({ esquerda: 600, topo: -200, largura: 24, altura: 24 }, 120, janela);
    assert.ok(p.topo >= MARGEM && p.topo + 120 <= janela.altura - MARGEM, JSON.stringify(p));
  });

  it("gatilho rolado para fora da tela (abaixo): o balão continua dentro da janela", () => {
    const janela = { largura: 390, altura: 700 };
    const p = posicionarBalao({ esquerda: 300, topo: 900, largura: 24, altura: 24 }, 200, janela);
    assert.ok(p.topo >= MARGEM && p.topo + 200 <= janela.altura - MARGEM, JSON.stringify(p));
    assert.equal(p.lado, "cima");
  });

  it("mouse e foco juntos: tirar o mouse não fecha o que o teclado abriu", () => {
    let e = reduzirExplicacao(FECHADA, { tipo: "entrou" });
    e = reduzirExplicacao(e, { tipo: "focou" });
    e = reduzirExplicacao(e, { tipo: "saiu" });
    assert.ok(aberta(e));
    e = reduzirExplicacao(e, { tipo: "desfocou" });
    assert.ok(!aberta(e));
  });
});
