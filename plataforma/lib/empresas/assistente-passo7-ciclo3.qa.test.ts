// QA (Parte 3, ciclo 3): "autorizou" aceito fora do passo 7. Bordas: chegada em qualquer passo anterior, depois de
// recomeçar, com preparo que não é de assinar, preparo atrasado e confirmação repetida.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lerRespostaCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { respostaGravada, type Exemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { diagnosticar } from "@contabilizadev/nucleo/diagnostico";
import {
  acaoPrincipal,
  ESTADO_INICIAL,
  progresso,
  reduzir,
  tituloDaEtapa,
  vistaDaAutorizacao,
  type Autorizacao,
  type EstadoAssistente,
  type EventoAssistente,
  type PreviaDoAssistente,
} from "./assistente";

const CONSULTADA_EM = new Date().toISOString();
const RECEBIDA_EM = Date.parse(CONSULTADA_EM);
const HOJE = "2026-10-16";
function previa(exemplo: Exemplo): PreviaDoAssistente {
  const dados = lerRespostaCnpj(respostaGravada(exemplo));
  return { dados, diagnostico: diagnosticar(dados, HOJE), consultadaEm: CONSULTADA_EM, token: `token-${exemplo}`, qsa: "confere" };
}
const aplicar = (estado: EstadoAssistente, ...eventos: EventoAssistente[]) => eventos.reduce(reduzir, estado);
const continuar: EventoAssistente = { tipo: "continuar", agora: RECEBIDA_EM };
const voltar: EventoAssistente = { tipo: "voltar" };
const ASSINAR: Autorizacao = {
  tipo: "assinar",
  parametros: {
    contratante: { numero: "11444777000161", nome: "PLATAFORMA DE TESTE LTDA" },
    empresa: { cnpj: "12345678000195", razaoSocial: "EXEMPLO SOFTWARE LTDA" },
    dataAssinatura: "20261018",
    vigenciaMaxima: "20271018",
  },
};
const noPasso7 = (a: Autorizacao) =>
  aplicar(
    ESTADO_INICIAL,
    { tipo: "digitar", cnpj: "12.345.678/0001-95" },
    { tipo: "consultou", previa: previa("ti-fator-r"), agora: RECEBIDA_EM },
    continuar,
    continuar,
    continuar,
    { tipo: "cadastrou", empresaId: "emp-1" },
    { tipo: "preparou", autorizacao: a },
    continuar,
  );

describe("QA ciclo 3: confirmação da assinatura fora do passo 7", () => {
  it("confirmação que chega com o cliente já no passo 1 vale; ao seguir até o 7, mostra concluída e o título 'Tudo pronto'", () => {
    let e = noPasso7(ASSINAR);
    assert.equal(progresso(e), "Passo 7 de 7");
    for (let i = 0; i < 6; i++) e = reduzir(e, voltar);
    assert.equal(e.etapa, "cnpj");
    e = reduzir(e, { tipo: "autorizou", validaAte: "2027-10-17" });
    assert.equal(e.autorizadaAte, "2027-10-17");
    assert.equal(acaoPrincipal(e), "continuar");
    for (let i = 0; i < 6; i++) e = reduzir(e, continuar);
    assert.equal(e.etapa, "autorizacao");
    assert.equal(vistaDaAutorizacao(e), "concluida");
    assert.equal(tituloDaEtapa(e), "Tudo pronto");
    assert.equal(e.empresaId, "emp-1");
  });

  it("preparo atrasado depois da confirmação não volta a pedir a assinatura", () => {
    const e = aplicar(noPasso7(ASSINAR), { tipo: "autorizou", validaAte: "2027-10-17" }, { tipo: "preparou", autorizacao: ASSINAR });
    assert.equal(vistaDaAutorizacao(e), "concluida");
  });

  it("segunda confirmação não troca a data da primeira", () => {
    const e = aplicar(noPasso7(ASSINAR), { tipo: "autorizou", validaAte: "2027-10-17" }, { tipo: "autorizou", validaAte: "2030-01-01" });
    assert.equal(e.autorizadaAte, "2027-10-17");
  });

  it("confirmação depois de 'Cadastrar outra' (recomeçar) é ignorada: o assistente novo não nasce autorizado", () => {
    const e = aplicar(noPasso7(ASSINAR), voltar, { tipo: "recomecar" }, { tipo: "autorizou", validaAte: "2027-10-17" });
    assert.deepEqual(e, ESTADO_INICIAL);
  });

  it("confirmação com preparo 'indisponivel' ou 'propria' é ignorada", () => {
    for (const a of [{ tipo: "indisponivel", mensagem: "x" }, { tipo: "propria" }] as Autorizacao[]) {
      const e = aplicar(noPasso7(a), voltar, { tipo: "autorizou", validaAte: "2027-10-17" });
      assert.equal(e.autorizadaAte, null);
      assert.equal(vistaDaAutorizacao(reduzir(e, continuar)), a.tipo);
    }
  });

  it("confirmação antes de o preparo chegar (vista 'carregando') é ignorada", () => {
    const e = aplicar(noPasso7(ASSINAR), { tipo: "recomecar" });
    const semPreparo = aplicar(
      e,
      { tipo: "digitar", cnpj: "12.345.678/0001-95" },
      { tipo: "consultou", previa: previa("ti-fator-r"), agora: RECEBIDA_EM },
      continuar,
      continuar,
      continuar,
      { tipo: "cadastrou", empresaId: "emp-2" },
      { tipo: "autorizou", validaAte: "2027-10-17" },
    );
    assert.equal(semPreparo.autorizadaAte, null);
  });
});
