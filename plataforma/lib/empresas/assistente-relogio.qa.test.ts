// QA (ciclo 2): relógio do navegador ADIANTADO em relação ao servidor. A prévia traz consultadaEm com o horário do
// servidor e a tela compara com Date.now() do navegador. Com o navegador adiantado 29 min ou mais (ex.: PC com dual
// boot e relógio em hora local, 3 h de diferença), toda prévia nasce "vencida" na tela: o clique em "Confirmar e
// cadastrar" pesquisa de novo, a prévia nova também nasce vencida, e o cliente nunca consegue cadastrar, embora o
// servidor aceitaria a prévia normalmente.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lerRespostaCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { respostaGravada, type Exemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { diagnosticar } from "@contabilizadev/nucleo/diagnostico";
import { acaoPrincipal, ESTADO_INICIAL, precisaRepesquisar, reduzir, type EstadoAssistente, type EventoAssistente, type PreviaDoAssistente } from "./assistente";

function previa(exemplo: Exemplo, consultadaEm: string): PreviaDoAssistente {
  const dados = lerRespostaCnpj(respostaGravada(exemplo));
  return { dados, diagnostico: diagnosticar(dados, consultadaEm.slice(0, 10)), consultadaEm, token: "t" };
}
const aplicar = (estado: EstadoAssistente, ...eventos: EventoAssistente[]) => eventos.reduce(reduzir, estado);

describe("QA: relógio do navegador adiantado", () => {
  it("prévia recém-consultada pelo servidor não pode ser tratada como vencida só porque o navegador está adiantado", () => {
    const servidorAgora = Date.parse("2026-10-17T12:00:00.000Z");
    const navegadorAgora = servidorAgora + 3 * 60 * 60 * 1000; // navegador 3 h adiantado
    const cnpj = "12.345.678/0001-95";
    // O cliente pesquisa: o servidor devolve a prévia com o horário dele (fresca).
    const fresca = previa("ti-fator-r", new Date(servidorAgora).toISOString());
    let e = aplicar(ESTADO_INICIAL, { tipo: "digitar", cnpj }, { tipo: "consultou", previa: fresca, agora: navegadorAgora });
    for (let i = 0; i < 3; i++) e = reduzir(e, { tipo: "continuar", agora: navegadorAgora });
    assert.equal(e.etapa, "diagnostico");
    assert.equal(acaoPrincipal(e, navegadorAgora), "cadastrar");
    // Clique em cadastrar: a tela acha a prévia vencida e pesquisa de novo; a resposta nova é igualmente fresca no
    // servidor. Depois disso o clique precisa cadastrar, senão o cliente fica num laço sem fim.
    if (precisaRepesquisar(e, navegadorAgora)) {
      e = reduzir(e, {
        tipo: "consultou",
        previa: previa("ti-fator-r", new Date(servidorAgora + 5_000).toISOString()),
        agora: navegadorAgora + 5_000, // a tela marca a chegada com o relógio dela (o evento real sempre leva o agora)
      });
    }
    assert.equal(
      precisaRepesquisar(e, navegadorAgora + 5_000),
      false,
      "com a prévia recém-pesquisada, o clique deve cadastrar (o servidor aceita), não pesquisar de novo para sempre",
    );
  });
});
