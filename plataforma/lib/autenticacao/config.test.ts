import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { avisosDaConfig, ErroDeConfiguracao, lerConfigAutenticacao, listaDeAdmins, loginDesligado } from "./config";

const SEGREDO = "s".repeat(32);

describe("lerConfigAutenticacao: o segredo é validado na subida", () => {
  it("sem SESSAO_SEGREDO, recusa", () => {
    assert.throws(() => lerConfigAutenticacao({}), ErroDeConfiguracao);
  });
  it("segredo curto demais (31 caracteres), recusa", () => {
    assert.throws(() => lerConfigAutenticacao({ SESSAO_SEGREDO: "s".repeat(31) }), /mínimo 32/);
  });
  it("segredo de 32 caracteres, aceita", () => {
    assert.equal(lerConfigAutenticacao({ SESSAO_SEGREDO: SEGREDO }).segredo, SEGREDO);
  });
  it("GOOGLE_CLIENT_ID vazio ou só espaço vale como ausente", () => {
    assert.equal(lerConfigAutenticacao({ SESSAO_SEGREDO: SEGREDO, GOOGLE_CLIENT_ID: "  " }).googleClientId, null);
    assert.equal(lerConfigAutenticacao({ SESSAO_SEGREDO: SEGREDO, GOOGLE_CLIENT_ID: " abc.apps.googleusercontent.com " }).googleClientId, "abc.apps.googleusercontent.com");
  });
  it("e-mail do login desligado tem padrão e vira minúsculo", () => {
    assert.equal(lerConfigAutenticacao({ SESSAO_SEGREDO: SEGREDO }).emailDesenvolvimento, "dev@contabilizadev.local");
    assert.equal(lerConfigAutenticacao({ SESSAO_SEGREDO: SEGREDO, DEV_USER_EMAIL: "Eu@Teste.dev" }).emailDesenvolvimento, "eu@teste.dev");
  });
});

describe("loginDesligado: só fora de produção, nunca por padrão", () => {
  it("variável ausente mantém o login ligado", () => {
    assert.equal(loginDesligado({ NODE_ENV: "development" }), false);
  });
  it('só a string exata "true" desliga', () => {
    for (const valor of ["1", "TRUE", "True", "yes", " true", ""]) assert.equal(loginDesligado({ AUTH_DISABLED: valor, NODE_ENV: "development" }), false, valor);
    assert.equal(loginDesligado({ AUTH_DISABLED: "true", NODE_ENV: "development" }), true);
  });
  it("em produção nunca desliga, mesmo com AUTH_DISABLED=true", () => {
    assert.equal(loginDesligado({ AUTH_DISABLED: "true", NODE_ENV: "production" }), false);
    assert.equal(lerConfigAutenticacao({ SESSAO_SEGREDO: SEGREDO, AUTH_DISABLED: "true", NODE_ENV: "production" }).loginDesligado, false);
  });
  it("o aviso de subida diz quando foi ignorado em produção", () => {
    const env = { SESSAO_SEGREDO: SEGREDO, AUTH_DISABLED: "true", NODE_ENV: "production" };
    assert.ok(avisosDaConfig(lerConfigAutenticacao(env), env).some((a) => a.includes("ignorado")));
    const dev = { SESSAO_SEGREDO: SEGREDO, AUTH_DISABLED: "true", NODE_ENV: "development" };
    assert.ok(avisosDaConfig(lerConfigAutenticacao(dev), dev).some((a) => a.includes("login desligado")));
  });
});

describe("listaDeAdmins", () => {
  it("separa por vírgula, tira espaços e normaliza a caixa", () => {
    assert.deepEqual(listaDeAdmins(" Dono@Empresa.com , outro@x.dev"), ["dono@empresa.com", "outro@x.dev"]);
  });
  it("ausente, vazia ou só vírgulas: ninguém", () => {
    assert.deepEqual(listaDeAdmins(undefined), []);
    assert.deepEqual(listaDeAdmins(""), []);
    assert.deepEqual(listaDeAdmins(" , ,"), []);
  });
});
