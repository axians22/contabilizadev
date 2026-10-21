// QA ciclo 6 (Parte 3, tooltip único): correções do ciclo 5 (Fator R com fonte única, verbete do anexo com a tabela
// vigente, título do balão nos casos que impedem, WCAG 2.5.3 nos gatilhos de texto).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { lerRespostaCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { respostaGravada, EXEMPLOS } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { diagnosticar } from "@contabilizadev/nucleo/diagnostico";
import { Assistente } from "@/app/(painel)/empresas/nova/assistente";
import { CartaoDiagnostico, FichaReceita } from "@/app/(painel)/empresa/ficha";
import { explicarNatureza, explicarSituacao, resumoSimples } from "@/lib/empresas/assistente";
import { aliquotaInicial, GLOSSARIO, verbeteAnexo } from "@/lib/empresas/glossario";
import { explicacoes, semExplicacoes, texto } from "./tela";

const HOJE = "2026-10-16";
const nada = async () => ({ erro: "não chamado" });
const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replace(/ /g, " ");

describe("QA ciclo6: verbete do anexo com a tabela vigente", () => {
  it("2026-10: 6% (Anexo III) e 15,5% (Anexo V)", () => {
    assert.equal(aliquotaInicial("III", "2026-10"), "6%");
    assert.equal(aliquotaInicial("V", "2026-10"), "15,5%");
    const t = verbeteAnexo("2026-10").texto.join(" ");
    assert.match(t, /Anexo III, com alíquota inicial de 6%, ou no Anexo V, que começa em 15,5%/);
  });

  it("mês sem tabela (depois de 2028): o texto sai sem número e continua gramatical", () => {
    assert.equal(aliquotaInicial("III", "2029-01"), null);
    const t = verbeteAnexo("2029-01").texto.join(" ");
    assert.doesNotMatch(t, /\d+(,\d+)?%/);
    assert.doesNotMatch(t, /,,|\s,|undefined|null/);
    assert.match(t, /Anexo III ou no Anexo V, mais caro\./);
  });

  it("PA inválido não derruba o verbete", () => {
    assert.doesNotThrow(() => verbeteAnexo("2026-13"));
    assert.doesNotThrow(() => verbeteAnexo(""));
  });
});

describe("QA ciclo6: empresa de anexo fixo (sem Fator R)", () => {
  const d = diagnosticar(lerRespostaCnpj(respostaGravada("ti-anexo-iii")), HOJE);

  it("o fixture é de anexo fixo", () => {
    assert.equal(d.atendido, true);
    assert.equal(d.dependeFatorR, false);
  });

  // Ao lado de "fixo, sem Fator R" o balão não pode dizer que quem decide o anexo é o Fator R.
  for (const [onde, html] of [
    ["painel/ficha (CartaoDiagnostico)", () => render(createElement(CartaoDiagnostico, { diagnostico: d }))],
    [
      "assistente (etapa Diagnóstico)",
      () =>
        render(
          createElement(Assistente, {
            consultar: nada,
            cadastrar: nada, preparar: nada as never, enviar: nada,
            inicial: {
              etapa: "diagnostico",
              cnpj: "12.345.678/0001-95",
              previa: { dados: lerRespostaCnpj(respostaGravada("ti-anexo-iii")), diagnostico: d, consultadaEm: `${HOJE}T12:00:00.000Z`, token: "t" },
              recebidaEm: Date.now(),
              empresaId: null,
              autorizacao: null,
              autorizadaAte: null,
            },
          }),
        ),
    ],
  ] as const) {
    it(`${onde}: o balão ao lado de 'fixo/sem Fator R' não contradiz a tela`, () => {
      const h = html();
      assert.match(texto(semExplicacoes(h)), /fixo/);
      const balao = explicacoes(h).find((e) => e.rotulo === GLOSSARIO.anexo.titulo);
      assert.ok(balao, "tem o balão do anexo");
      assert.doesNotMatch(balao.texto, /Quem decide entre os dois é o Fator R/, `balão contradiz 'sem Fator R': ${balao.texto}`);
    });
  }
});

describe("QA ciclo6: casos que impedem o cadastro", () => {
  const casos = [
    ...["INAPTA", "SUSPENSA", "BAIXADA", "NULA", "EM ANÁLISE"].map((s) => explicarSituacao(s)),
    explicarNatureza("2046"),
    explicarNatureza(""),
    resumoSimples({ simples: { optante: null, dataOpcao: null, dataExclusao: null }, mei: { optante: false, dataOpcao: null, dataExclusao: null } }, HOJE).simples,
    resumoSimples({ simples: { optante: false, dataOpcao: null, dataExclusao: "2025-01-01" }, mei: { optante: false, dataOpcao: null, dataExclusao: null } }, HOJE).simples,
    resumoSimples({ simples: { optante: true, dataOpcao: "2020-01-01", dataExclusao: null }, mei: { optante: true, dataOpcao: "2020-01-01", dataExclusao: null } }, HOJE).mei,
  ];

  it("todo caso { ok: false } tem título-pergunta, texto com 'O que fazer:' seguido de ação, e o texto não repete o curto", () => {
    for (const c of casos) {
      assert.equal(c.ok, false, JSON.stringify(c));
      if (c.ok) continue;
      assert.match(c.titulo, /^Por que .+\?$/);
      assert.match(c.texto, /O que fazer: \S.{10,}/);
      assert.ok(!c.texto.includes(c.curto), `repete o curto: ${c.curto}`);
    }
  });
});

describe("QA ciclo6: Fator R e nomes acessíveis em todas as telas com a ficha", () => {
  it("ficha e cartão: todo gatilho de texto tem o texto visível no nome acessível (WCAG 2.5.3) e rótulos não se repetem por tela", () => {
    for (const ex of EXEMPLOS) {
      const dados = lerRespostaCnpj(respostaGravada(ex));
      const diagnostico = diagnosticar(dados, HOJE);
      const html = render(createElement(FichaReceita, { dados, diagnostico, consultadaEm: `${HOJE}T12:00:00.000Z` }));
      const lista = explicacoes(html);
      for (const e of lista) {
        const fim = html.indexOf("</button>", html.indexOf(e.botao));
        const visivel = texto(html.slice(html.indexOf(e.botao) + e.botao.length, fim)).trim();
        if (visivel) assert.ok(e.rotulo.toLowerCase().includes(visivel.toLowerCase()), `${ex}: '${visivel}' fora de '${e.rotulo}'`);
      }
      // Rótulos iguais com textos diferentes confundem quem usa leitor de tela.
      const porRotulo = new Map<string, string>();
      for (const e of lista) {
        const antes = porRotulo.get(e.rotulo);
        if (antes !== undefined) assert.equal(e.texto, antes, `${ex}: rótulo '${e.rotulo}' com textos diferentes`);
        porRotulo.set(e.rotulo, e.texto);
      }
    }
  });

  it("nenhum diagnóstico mostra explicacaoFatorR, motivos ou avisos", () => {
    for (const ex of EXEMPLOS) {
      const d = diagnosticar(lerRespostaCnpj(respostaGravada(ex)), HOJE) as unknown as Record<string, unknown>;
      for (const k of ["explicacaoFatorR", "motivos", "avisos"]) assert.ok(!(k in d), `${ex}: ${k}`);
    }
  });
});
