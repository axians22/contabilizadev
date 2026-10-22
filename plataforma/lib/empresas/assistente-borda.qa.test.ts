// QA (ciclo 3): bordas da idade da prévia medida pelo relógio do navegador (recebidaEm).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lerRespostaCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { respostaGravada } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { diagnosticar } from "@contabilizadev/nucleo/diagnostico";
import {
  FOLGA_DA_PREVIA_MS,
  VALIDADE_DA_PREVIA_MS,
  acaoPrincipal,
  ESTADO_INICIAL,
  precisaRepesquisar,
  previaVencida,
  reduzir,
  type EventoAssistente,
  type EstadoAssistente,
} from "./assistente";

const LIMITE = VALIDADE_DA_PREVIA_MS - FOLGA_DA_PREVIA_MS;
const dados = lerRespostaCnpj(respostaGravada("ti-fator-r"));
const p = { dados, diagnostico: diagnosticar(dados, "2026-10-17"), consultadaEm: "2026-10-17T12:00:00.000Z", token: "t", qsa: "confere" as const };
const aplicar = (e: EstadoAssistente, ...ev: EventoAssistente[]) => ev.reduce(reduzir, e);

describe("QA: bordas de previaVencida", () => {
  const t0 = 1_000_000_000_000;
  it("exatamente no limite (29 min) ainda vale; 1 ms depois vence", () => {
    assert.equal(previaVencida(t0, t0 + LIMITE), false);
    assert.equal(previaVencida(t0, t0 + LIMITE + 1), true);
  });
  it("hora de chegada inválida (NaN) conta como vencida", () => {
    assert.equal(previaVencida(Number.NaN, t0), true);
  });
  it("recebidaEm = 0 (epoch) não é tratado como vazio por engano", () => {
    assert.equal(previaVencida(0, 1000), false);
  });
  it("prévia que chegou e foi para o diagnóstico: 31 min depois pede nova pesquisa; antes não", () => {
    const e = aplicar(ESTADO_INICIAL, { tipo: "digitar", cnpj: dados.cnpj }, { tipo: "consultou", previa: p, agora: t0 });
    const d = aplicar(e, { tipo: "continuar", agora: t0 }, { tipo: "continuar", agora: t0 }, { tipo: "continuar", agora: t0 });
    assert.equal(d.etapa, "diagnostico");
    assert.equal(acaoPrincipal(d, t0 + LIMITE), "cadastrar");
    assert.equal(precisaRepesquisar(d, t0 + LIMITE), false);
    assert.equal(precisaRepesquisar(d, t0 + 31 * 60 * 1000), true);
  });
  it("no passo 1, prévia vencida faz o botão voltar a pesquisar e Continuar não avança", () => {
    const e = aplicar(ESTADO_INICIAL, { tipo: "digitar", cnpj: dados.cnpj }, { tipo: "consultou", previa: p, agora: t0 }, { tipo: "voltar" });
    assert.equal(e.etapa, "cnpj");
    assert.equal(acaoPrincipal(e, t0 + 1000), "continuar");
    assert.equal(acaoPrincipal(e, t0 + LIMITE + 1), "consultar");
    assert.equal(reduzir(e, { tipo: "continuar", agora: t0 + LIMITE + 1 }).etapa, "cnpj");
  });
  it("resposta de outro CNPJ chegando no diagnóstico não renova a hora de chegada", () => {
    const e = aplicar(ESTADO_INICIAL, { tipo: "digitar", cnpj: dados.cnpj }, { tipo: "consultou", previa: p, agora: t0 },
      { tipo: "continuar", agora: t0 }, { tipo: "continuar", agora: t0 }, { tipo: "continuar", agora: t0 });
    const outro = { ...p, dados: { ...dados, cnpj: "11222333000181" } };
    const depois = reduzir(e, { tipo: "consultou", previa: outro, agora: t0 + 40 * 60 * 1000 });
    assert.equal(depois.recebidaEm, t0);
    assert.equal(precisaRepesquisar(depois, t0 + 40 * 60 * 1000), true);
  });
});
