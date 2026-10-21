import { test } from "node:test";
import assert from "node:assert/strict";
import type { Transporte } from "../http.ts";
import { ENVIO_ACEITO } from "./respostas-exemplo.ts";
import { criarClienteEsocial, envelopeSoap, type ChamadaEsocial } from "./ws.ts";

function montar(dia: number, usadasHoje: number, transporte?: Transporte) {
  const registradas: ChamadaEsocial[] = [];
  const enviados: { url: string; headers: Record<string, string>; corpo: string }[] = [];
  const cliente = criarClienteEsocial({
    certificado: { pfx: Buffer.from("pfx"), senha: "x" },
    registro: { registrar: (c) => void registradas.push(c), consultasNoDia: () => usadasHoje },
    transporte:
      transporte ??
      (async (url, headers, corpo) => {
        enviados.push({ url, headers, corpo });
        return { status: 200, texto: ENVIO_ACEITO };
      }),
    agora: () => new Date(2026, 9, dia, 10),
  });
  return { cliente, registradas, enviados };
}

test("envelope SOAP com o método e o wrapper do serviço", () => {
  assert.match(envelopeSoap("enviarLote", "<eSocial/>"), /<v1:EnviarLoteEventos><v1:loteEventos><eSocial\/><\/v1:loteEventos>/);
});

test("envia com SOAPAction, lê cdResposta e registra a chamada", async () => {
  const { cliente, registradas, enviados } = montar(16, 0);
  const r = await cliente.chamar("enviarLote", "restrita", "<eSocial/>", "Enviar lote de teste");
  assert.equal(r.cdResposta, "201");
  assert.match(enviados[0].url, /producaorestrita/);
  assert.match(enviados[0].headers.SOAPAction, /EnviarLoteEventos"$/);
  assert.deepEqual([registradas[0].servico, registradas[0].status, registradas[0].resumo], ["enviarLote", 200, "201 Lote Recebido com Sucesso."]);
});

test("consultas e downloads: nada nos dias 1 a 7 e no máximo 10 por dia", async () => {
  await assert.rejects(montar(7, 0).cliente.chamar("downloadPorId", "producao", "<x/>", "x"), /dias 1 a 7/);
  await assert.rejects(montar(16, 10).cliente.chamar("identificadoresTrabalhador", "producao", "<x/>", "x"), /Limite de 10/);
  assert.equal(await montar(16, 12).cliente.consultasRestantes("producao"), 0);
  // Envio de lote não tem esse limite.
  assert.equal((await montar(3, 10).cliente.chamar("enviarLote", "producao", "<x/>", "x")).cdResposta, "201");
  await assert.rejects(montar(16, 0).cliente.chamar("enviarLote", "producao", "<x/>", " "), /finalidade/);
});

test("falha de rede é registrada sem status", async () => {
  const { cliente, registradas } = montar(16, 0, async () => {
    throw new Error("sem rede");
  });
  await assert.rejects(cliente.chamar("consultarLote", "producao", "<x/>", "x"), /sem rede/);
  assert.equal(registradas[0].status, null);
});
