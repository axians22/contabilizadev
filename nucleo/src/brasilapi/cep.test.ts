import assert from "node:assert/strict";
import { test } from "node:test";
import { consultarCep, ErroConsultaCep, lerRespostaCep, normalizarCep } from "./cep.ts";
import { buscarFalso } from "./exemplos.ts";

// Formato da resposta da BrasilAPI (cep/v1), com dados fictícios.
const RESPOSTA = { cep: "88010000", state: "SC", city: "Florianópolis", neighborhood: "Centro", street: "Rua Felipe Schmidt", service: "correios" };
const motivo = (m: string) => (e: unknown) => e instanceof ErroConsultaCep && e.motivo === m;

test("normalizarCep: 8 dígitos, com ou sem traço; zeros e tamanho errado não", () => {
  assert.equal(normalizarCep("88010-000"), "88010000");
  assert.equal(normalizarCep(" 88.010-000 "), "88010000");
  assert.equal(normalizarCep("8801000"), null);
  assert.equal(normalizarCep("880100000"), null);
  assert.equal(normalizarCep("00000-000"), null);
  assert.equal(normalizarCep("abcde-fgh"), null);
});

test("consultarCep: lê o endereço e chama a URL do CEP normalizado", async () => {
  const buscar = buscarFalso({ status: 200, corpo: RESPOSTA });
  assert.deepEqual(await consultarCep("88010-000", { buscar }), { cep: "88010000", logradouro: "Rua Felipe Schmidt", bairro: "Centro", cidade: "Florianópolis", uf: "SC" });
  assert.deepEqual(buscar.chamadas, ["https://brasilapi.com.br/api/cep/v1/88010000"]);
});

test("consultarCep: CEP só da cidade (sem rua nem bairro) volta com nulos", async () => {
  const r = await consultarCep("78890000", { buscar: buscarFalso({ status: 200, corpo: { cep: "78890000", state: "MT", city: "Sorriso" } }) });
  assert.deepEqual(r, { cep: "78890000", logradouro: null, bairro: null, cidade: "Sorriso", uf: "MT" });
});

test("consultarCep: inválido não chama; 404, 5xx, rede e resposta estranha viram erro com mensagem própria", async () => {
  const nada = buscarFalso();
  await assert.rejects(consultarCep("123", { buscar: nada }), motivo("cep-invalido"));
  assert.equal(nada.chamadas.length, 0);
  await assert.rejects(consultarCep("88010000", { buscar: buscarFalso({ status: 404, corpo: {} }) }), motivo("nao-encontrado"));
  await assert.rejects(consultarCep("88010000", { buscar: buscarFalso({ status: 500, corpo: {} }) }), motivo("indisponivel"));
  await assert.rejects(consultarCep("88010000", { buscar: buscarFalso(new Error("rede")) }), motivo("indisponivel"));
  await assert.rejects(consultarCep("88010000", { buscar: buscarFalso({ status: 200, corpo: { state: "XX", city: "Lugar" } }) }), motivo("indisponivel"));
  await assert.rejects(consultarCep("88010000", { buscar: buscarFalso("pendurar"), tempoLimiteMs: 20 }), motivo("indisponivel"));
});

test("as mensagens nunca citam o fornecedor", () => {
  try {
    lerRespostaCep(null, "88010000");
  } catch (e) {
    assert.doesNotMatch((e as Error).message, /brasil ?api/i);
  }
});
