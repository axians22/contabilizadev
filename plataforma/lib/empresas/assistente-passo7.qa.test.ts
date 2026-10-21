// QA (Parte 3, passo 7 "Autorização"): casos de borda da lógica das 7 etapas que os testes do engenheiro não cobrem.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lerRespostaCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { respostaGravada, type Exemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { diagnosticar } from "@contabilizadev/nucleo/diagnostico";
import {
  acaoPrincipal,
  ESTADO_INICIAL,
  podeAvancar,
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
  return { dados, diagnostico: diagnosticar(dados, HOJE), consultadaEm: CONSULTADA_EM, token: `token-${exemplo}` };
}
const aplicar = (estado: EstadoAssistente, ...eventos: EventoAssistente[]) => eventos.reduce(reduzir, estado);
const continuar: EventoAssistente = { tipo: "continuar", agora: RECEBIDA_EM };
const voltar: EventoAssistente = { tipo: "voltar" };
const ateDiagnostico = (exemplo: Exemplo, cnpj: string) =>
  aplicar(ESTADO_INICIAL, { tipo: "digitar", cnpj }, { tipo: "consultou", previa: previa(exemplo), agora: RECEBIDA_EM }, continuar, continuar, continuar);

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
  aplicar(ateDiagnostico("ti-fator-r", "12.345.678/0001-95"), { tipo: "cadastrou", empresaId: "emp-1" }, { tipo: "preparou", autorizacao: a }, continuar);

describe("QA passo 7: assinatura e navegação", () => {
  it("assinatura que termina depois de o cliente clicar Voltar (botão Voltar fica ativo durante 'Assinando e enviando…') não se perde: o passo 7 não volta a pedir a assinatura", () => {
    // O envio já registrou o termo no servidor; o retorno chega com o assistente no passo 6.
    const e = aplicar(noPasso7(ASSINAR), voltar, { tipo: "autorizou", validaAte: "2027-10-18" }, continuar);
    assert.equal(e.etapa, "autorizacao");
    assert.equal(vistaDaAutorizacao(e), "concluida", "o passo 7 pediria para assinar de novo um termo que já foi enviado");
  });

  it("voltar do 7 até o 1 e seguir de novo até o 7 não recadastra, não repesquisa e mantém a autorização preparada", () => {
    let e = noPasso7(ASSINAR);
    for (let i = 0; i < 6; i++) e = reduzir(e, voltar);
    assert.equal(e.etapa, "cnpj");
    assert.equal(acaoPrincipal(e, RECEBIDA_EM + 60 * 60 * 1000), "continuar", "mesmo com a prévia vencida, nada é pesquisado de novo");
    e = aplicar(e, { tipo: "digitar", cnpj: "98.765.432/0001-98" }, { tipo: "consultou", previa: previa("ti-anexo-iii"), agora: RECEBIDA_EM });
    assert.equal(e.previa?.dados.cnpj, "12345678000195");
    for (let i = 0; i < 4; i++) e = reduzir(e, { tipo: "continuar", agora: RECEBIDA_EM + 60 * 60 * 1000 });
    assert.equal(e.etapa, "diagnostico");
    assert.equal(acaoPrincipal(e, RECEBIDA_EM + 60 * 60 * 1000), "continuar");
    assert.equal(reduzir(e, { tipo: "cadastrou", empresaId: "emp-2" }).empresaId, "emp-1");
    e = aplicar(e, continuar, continuar);
    assert.equal(e.etapa, "autorizacao");
    assert.equal(e.autorizacao, ASSINAR);
    assert.equal(progresso(e), "Passo 7 de 7");
  });

  it("depois de concluída, voltar e avançar mostra de novo 'Tudo pronto'; um novo 'preparou' não reabre a assinatura", () => {
    const e = aplicar(noPasso7(ASSINAR), { tipo: "autorizou", validaAte: "2027-10-18" }, voltar, { tipo: "preparou", autorizacao: ASSINAR }, continuar);
    assert.equal(vistaDaAutorizacao(e), "concluida");
    assert.equal(tituloDaEtapa(e), "Tudo pronto");
  });

  it("empresa da plataforma: passo 7 sem ação do formulário, 'autorizou' é ignorado e o título diz que já está autorizada", () => {
    const e = noPasso7({ tipo: "propria" });
    assert.equal(acaoPrincipal(e), null);
    assert.equal(podeAvancar(e), false);
    assert.equal(reduzir(e, { tipo: "autorizou", validaAte: "2027-10-18" }).autorizadaAte, null);
    assert.equal(tituloDaEtapa(e), "A empresa já está autorizada");
  });

  it("não atendida: termina no 'Passo 6 de 6', sem caminho para o 7, mesmo com eventos fora de ordem", () => {
    let e = ateDiagnostico("mei", "24.681.357/0001-40");
    assert.equal(progresso(e), "Passo 5 de 6");
    e = aplicar(e, continuar);
    assert.equal(e.etapa, "proximos");
    assert.equal(progresso(e), "Passo 6 de 6");
    e = aplicar(e, { tipo: "cadastrou", empresaId: "x" }, { tipo: "preparou", autorizacao: ASSINAR }, continuar);
    assert.equal(e.etapa, "proximos");
    assert.equal(e.empresaId, null);
    assert.equal(e.autorizacao, null);
  });
});
