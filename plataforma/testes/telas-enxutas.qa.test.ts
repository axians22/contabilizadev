// QA (Parte 3, tooltip): o que impede o cadastro fica visível, mas CURTO, com os detalhes no tooltip; explicação
// (aviso de regra, citação de lei, lista de códigos atendidos) não fica aberta na tela. Vale para o assistente
// (/empresas/nova) e para a ficha (/empresa). O teste dos parágrafos do engenheiro só olha <p>; aqui olhamos <li>
// e as linhas das atividades também.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { lerRespostaCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { respostaGravada, type Exemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { diagnosticar } from "@contabilizadev/nucleo/diagnostico";
import { Assistente } from "@/app/(painel)/empresas/nova/assistente";
import { CartaoDiagnostico } from "@/app/(painel)/empresa/ficha";
import type { IdEtapa } from "@/lib/empresas/assistente";
import { semExplicacoes, texto } from "./tela";

const LIMITE = 140;
const nada = async () => ({ erro: "não chamado" });

function etapa(exemplo: Exemplo, id: IdEtapa) {
  const dados = lerRespostaCnpj(respostaGravada(exemplo));
  const previa = { dados, diagnostico: diagnosticar(dados, "2026-10-16"), consultadaEm: new Date().toISOString(), token: "t" };
  return renderToStaticMarkup(
    createElement(Assistente, { consultar: nada, cadastrar: nada, preparar: nada as never, enviar: nada, inicial: { etapa: id, cnpj: "12.345.678/0001-95", previa, recebidaEm: Date.now(), empresaId: null, autorizacao: null, autorizadaAte: null } }),
  );
}

// Itens de lista e linhas visíveis (fora dos balões), com o texto de cada um.
const itensVisiveis = (html: string) => [...semExplicacoes(html).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => texto(m[1]).trim());

function enxuta(html: string, onde: string) {
  for (const item of itensVisiveis(html)) assert.ok(item.length <= LIMITE, `${onde}: item longo na tela (${item.length}): ${item}`);
  const t = texto(semExplicacoes(html));
  assert.doesNotMatch(t, /CGSN|art\. \d|§/, `${onde}: citação de lei aberta na tela`);
  assert.doesNotMatch(t, /6201, 6202, 6203/, `${onde}: lista de CNAEs atendidos aberta na tela (vai no tooltip)`);
}

describe("QA: impedimentos curtos, detalhes no tooltip", () => {
  for (const ex of ["banco-do-brasil", "fora-do-escopo", "mei", "baixada"] as const) {
    it(`assistente, diagnóstico (${ex}): motivos curtos`, () => enxuta(etapa(ex, "diagnostico"), `diagnóstico ${ex}`));
    it(`assistente, atividades (${ex}): motivo da atividade não atendida curto`, () => enxuta(etapa(ex, "atividades"), `atividades ${ex}`));
    it(`ficha /empresa (${ex}): motivos curtos`, () => {
      const d = diagnosticar(lerRespostaCnpj(respostaGravada(ex)), "2026-10-16");
      enxuta(renderToStaticMarkup(createElement(CartaoDiagnostico, { diagnostico: d })), `ficha ${ex}`);
    });
  }

  it("aviso de regra (atividades em anexos diferentes) é explicação: vai no tooltip, não fica aberto", () => {
    const aviso = /cada receita é declarada na atividade do serviço prestado/;
    assert.doesNotMatch(texto(semExplicacoes(etapa("ti-fator-r", "diagnostico"))), aviso, "assistente, diagnóstico");
    const d = diagnosticar(lerRespostaCnpj(respostaGravada("ti-fator-r")), "2026-10-16");
    assert.doesNotMatch(texto(semExplicacoes(renderToStaticMarkup(createElement(CartaoDiagnostico, { diagnostico: d })))), aviso, "ficha");
  });
});
