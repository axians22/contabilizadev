// SESSAO_HTTP_TESTE (TEMPORÁRIO, teste no Coolify em HTTP): só liga com "true" exato, só muda o cookie, e avisa.
// Remover junto com a variável quando o domínio com HTTPS estiver pronto (seção SEGURANÇA do plano.txt).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { avisosDaConfig, cookieSeguro, lerConfigAutenticacao, sessaoHttpTeste } from "./config";
import { nomeDoCookie, opcoesDoCookie } from "./cookie";

const SEGREDO = "s".repeat(32);
const PRODUCAO = { NODE_ENV: "production", SESSAO_SEGREDO: SEGREDO };

describe("SESSAO_HTTP_TESTE: cookie sem Secure só para o teste em HTTP", () => {
  it("sem a variável, produção usa o cookie seguro (__Host-, Secure)", () => {
    const config = lerConfigAutenticacao(PRODUCAO);
    assert.equal(config.cookieSeguro, true);
    assert.equal(config.sessaoHttpTeste, false);
    assert.equal(nomeDoCookie(config.cookieSeguro), "__Host-sessao");
    assert.equal(opcoesDoCookie(config.cookieSeguro, new Date()).secure, true);
  });
  it("com SESSAO_HTTP_TESTE=true em produção, o cookie sai sem Secure e sem o prefixo __Host-", () => {
    const config = lerConfigAutenticacao({ ...PRODUCAO, SESSAO_HTTP_TESTE: "true" });
    assert.equal(config.cookieSeguro, false);
    assert.equal(config.producao, true, "continua produção: o login com Google segue obrigatório");
    assert.equal(config.loginDesligado, false);
    assert.equal(nomeDoCookie(config.cookieSeguro), "sessao");
    assert.equal(opcoesDoCookie(config.cookieSeguro, new Date()).secure, false);
  });
  it("só a string exata 'true' liga", () => {
    for (const valor of ["TRUE", "1", "sim", " true", ""]) {
      assert.equal(sessaoHttpTeste({ SESSAO_HTTP_TESTE: valor }), false, valor);
      assert.equal(cookieSeguro({ NODE_ENV: "production", SESSAO_HTTP_TESTE: valor }), true, valor);
    }
  });
  it("fora de produção o cookie já é sem Secure, com ou sem a variável", () => {
    assert.equal(cookieSeguro({ NODE_ENV: "development" }), false);
    assert.equal(cookieSeguro({ NODE_ENV: "development", SESSAO_HTTP_TESTE: "true" }), false);
  });
  it("ligada, a subida avisa que é só teste", () => {
    const avisos = avisosDaConfig(lerConfigAutenticacao({ ...PRODUCAO, SESSAO_HTTP_TESTE: "true" }), { ...PRODUCAO, SESSAO_HTTP_TESTE: "true" });
    assert.ok(avisos.some((a) => a.startsWith("SESSAO_HTTP_TESTE=true")));
  });
});
