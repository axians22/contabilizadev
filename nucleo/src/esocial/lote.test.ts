import { test } from "node:test";
import assert from "node:assert/strict";
import { ErroLoteRecusado, GRUPO, aceito, consultarLote, enviarLote, idEvento, lerRetornoConsulta, montarLote } from "./lote.ts";
import { CONSULTA_AGUARDANDO, CONSULTA_PROCESSADA, ENVIO_ACEITO, ENVIO_RECUSADO, OCORRENCIA_GRAVADA, consultaProcessada, esocialFalso, resposta, soap } from "./respostas-exemplo.ts";

test("Id do evento: ID + 1 + CNPJ raiz com zeros + data e hora + sequencial", () => {
  const id = idEvento("11.222.333/0001-81", 7, new Date(2026, 9, 16, 12, 30, 5));
  assert.equal(id, "ID1112223330000002026101612300500007");
  assert.equal(id.length, 36);
  assert.throws(() => idEvento("1", 1), /CNPJ/);
});

// O transmissor (a plataforma, dona do certificado da conexão) não é o empregador (MOD v1.16 §7.5.7 e §7.5.9).
const PARTES = { empregador: "11222333000181", transmissor: "11.444.777/0001-61" };

test("lote: empregador pelo CNPJ raiz (o dos eventos), transmissor pelo CNPJ completo da plataforma, de 1 a 50 eventos", () => {
  const lote = montarLote(PARTES, GRUPO.periodico, [{ id: "ID1", tipo: "evtRemun", xml: '<?xml version="1.0"?><eSocial/>' }]);
  assert.match(lote, /<envioLoteEventos grupo="3"><ideEmpregador><tpInsc>1<\/tpInsc><nrInsc>11222333<\/nrInsc>/);
  assert.match(lote, /<ideTransmissor><tpInsc>1<\/tpInsc><nrInsc>11444777000161<\/nrInsc>/);
  assert.match(lote, /<evento Id="ID1"><eSocial\/><\/evento>/);
  assert.throws(() => montarLote(PARTES, 3, []), /1 a 50/);
  assert.throws(() => montarLote(PARTES, 3, Array.from({ length: 51 }, (_, i) => ({ id: String(i), tipo: "x", xml: "" }))), /1 a 50/);
  assert.throws(() => montarLote({ ...PARTES, transmissor: "123" }, 3, [{ id: "ID1", tipo: "x", xml: "" }]), /transmissor inválido/);
});

test("envio: devolve o protocolo; recusa vira erro com as ocorrências", async () => {
  const ws = esocialFalso(resposta(ENVIO_ACEITO), resposta(ENVIO_RECUSADO));
  const eventos = [{ id: "ID1", tipo: "evtRemun", xml: "<eSocial/>" }];
  assert.equal(await enviarLote(ws, "restrita", PARTES, GRUPO.periodico, eventos, "2026-10"), "1.2.202610.0000000000000001");
  assert.equal(ws.chamadas[0].servico, "enviarLote");
  assert.match(ws.chamadas[0].finalidade, /evtRemun de 2026-10/);
  await assert.rejects(enviarLote(ws, "restrita", PARTES, GRUPO.periodico, eventos), (e: unknown) => {
    assert.ok(e instanceof ErroLoteRecusado);
    assert.match(e.message, /Lote recusado \(401 Lote Incorreto\): 402: Schema inválido/);
    assert.deepEqual(e.ocorrencias, [{ codigo: "402", descricao: "Schema inválido" }]);
    return true;
  });
});

test("consulta: resultado de cada evento, com recibo e ocorrências", async () => {
  const r = await consultarLote(esocialFalso(resposta(CONSULTA_PROCESSADA)), "restrita", "P1");
  assert.equal(r.situacao, "processado");
  assert.equal(r.eventos[0].recibo, "1.1.0000000000000000001");
  assert.equal(aceito(r.eventos[0].cdResposta), true);
  assert.deepEqual(r.eventos[1].ocorrencias, [{ codigo: "537", descricao: "Duplicado", tipo: "1", localizacao: "/eSocial/evtRemun" }]);
  assert.equal(aceito(r.eventos[1].cdResposta), false);
  const aguardando = lerRetornoConsulta(resposta(soap("<status><cdResposta>101</cdResposta><tempoEstimadoConclusao>30</tempoEstimadoConclusao></status>")));
  assert.deepEqual([aguardando.situacao, aguardando.espera], ["aguardando", 30]);
});

test("consulta gerada para o teste: aceito com recibo, recusado com a ocorrência gravada, aguardando", async () => {
  const r = lerRetornoConsulta(resposta(consultaProcessada([{ id: "IDA", recibo: "1.1.9" }, { id: "IDB", cd: "401", ocorrencias: [OCORRENCIA_GRAVADA] }])));
  assert.deepEqual(r.eventos.map((e) => [e.id, e.cdResposta, e.recibo]), [["IDA", "201", "1.1.9"], ["IDB", "401", ""]]);
  assert.equal(r.eventos[1].ocorrencias[0].descricao, OCORRENCIA_GRAVADA.descricao);
  assert.equal(lerRetornoConsulta(resposta(CONSULTA_AGUARDANDO)).situacao, "aguardando");
});
