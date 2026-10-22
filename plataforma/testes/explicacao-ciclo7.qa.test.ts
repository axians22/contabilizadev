// QA ciclo 7 (Parte 3, tooltip único): verbete do anexo fixo em todas as telas e casos de borda.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { lerRespostaCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { respostaGravada, EXEMPLOS } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { diagnosticar } from "@contabilizadev/nucleo/diagnostico";
import { Assistente } from "@/app/(painel)/empresas/nova/assistente";
import { CartaoDiagnostico, FichaReceita } from "@/app/(painel)/empresa/ficha";
import { GLOSSARIO, verbeteAnexo } from "@/lib/empresas/glossario";
import { explicacoes, semExplicacoes, texto } from "./tela";

const HOJE = "2026-10-16";
const nada = async () => ({ erro: "não chamado" });
const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replace(/ /g, " ");

const diagnostico = (ex: (typeof EXEMPLOS)[number]) => {
  const dados = lerRespostaCnpj(respostaGravada(ex));
  return { dados, d: diagnosticar(dados, HOJE) };
};

const telaDiagnostico = (ex: (typeof EXEMPLOS)[number]) => {
  const { dados, d } = diagnostico(ex);
  return render(
    createElement(Assistente, {
      consultar: nada,
      cadastrar: nada, preparar: nada as never, enviar: nada,
      inicial: {
        etapa: "diagnostico",
        cnpj: "12.345.678/0001-95",
        previa: { dados, diagnostico: d, consultadaEm: `${HOJE}T12:00:00.000Z`, token: "t", qsa: "confere" as const },
        recebidaEm: Date.now(),
        empresaId: null,
        autorizacao: null,
        autorizadaAte: null,
      },
    }),
  );
};

describe("QA ciclo7: anexo fixo x Fator R em todas as empresas de exemplo", () => {
  for (const ex of EXEMPLOS) {
    const { dados, d } = diagnostico(ex);
    if (!d.anexo) continue;
    const telas: [string, string][] = [
      ["cartão", render(createElement(CartaoDiagnostico, { diagnostico: d }))],
      ["ficha", render(createElement(FichaReceita, { dados, diagnostico: d, consultadaEm: `${HOJE}T12:00:00.000Z` }))],
    ];
    if (d.atendido) telas.push(["assistente/diagnóstico", telaDiagnostico(ex)]);
    for (const [onde, h] of telas) {
      it(`${ex} (${onde}): o balão ao lado do anexo combina com a tela`, () => {
        const visivel = texto(semExplicacoes(h));
        const textos = explicacoes(h).map((e) => e.texto).join(" | ");
        if (d.dependeFatorR) {
          assert.match(visivel, /Fator R/);
          assert.match(textos, /Fator R/);
        } else {
          assert.match(visivel, /fixo/);
          const balao = explicacoes(h).find((e) => e.rotulo === GLOSSARIO.anexoFixo.titulo);
          assert.ok(balao, "tem o balão do anexo fixo");
          assert.doesNotMatch(balao.texto, /Fator R|Anexo V/);
          assert.match(balao.texto, /Anexo III/);
        }
      });
    }
  }

  it("assistente: rótulos repetidos na mesma etapa têm o mesmo texto (Fator R e anexo fixo)", () => {
    for (const ex of EXEMPLOS) {
      const { d } = diagnostico(ex);
      if (!d.atendido) continue;
      const porRotulo = new Map<string, string>();
      for (const e of explicacoes(telaDiagnostico(ex))) {
        const antes = porRotulo.get(e.rotulo);
        if (antes !== undefined) assert.equal(e.texto, antes, `${ex}: '${e.rotulo}'`);
        porRotulo.set(e.rotulo, e.texto);
      }
    }
  });
});

describe("QA ciclo7: verbeteAnexo(fixo) em bordas de data", () => {
  for (const pa of ["2026-01", "2026-12", "2027-01", "2028-12", "2029-01", "2026-13", "", "lixo"]) {
    it(`${JSON.stringify(pa)}: não quebra e não fala em Fator R`, () => {
      const v = verbeteAnexo(pa, true);
      const t = v.texto.join(" ");
      assert.equal(v.titulo, verbeteAnexo(pa).titulo);
      assert.doesNotMatch(t, /Fator R|Anexo V\b|undefined|null|,,|\s[,.]/);
      assert.match(t, /Anexo III/);
    });
  }
});
