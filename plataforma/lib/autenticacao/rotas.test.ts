import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decidirAcesso, destinoAoSair, enderecoSemSessao, ROTA_DA_SESSAO_LOCAL, rotaPublica, ROTAS_PUBLICAS } from "./rotas";

describe("fechado por padrão", () => {
  it("a lista de rotas públicas é exatamente esta", () => {
    assert.deepEqual([...ROTAS_PUBLICAS], ["/entrar"]);
  });
  it("só /entrar (e o que está embaixo dela) é público", () => {
    assert.equal(rotaPublica("/entrar"), true);
    assert.equal(rotaPublica("/entrar/x"), true);
    assert.equal(rotaPublica("/entrarx"), false);
    assert.equal(rotaPublica("/"), false);
    assert.equal(rotaPublica("/plano"), false);
    assert.equal(rotaPublica("/usuarios"), false);
    assert.equal(rotaPublica("/api/sessao"), false);
    assert.equal(rotaPublica(ROTA_DA_SESSAO_LOCAL), false);
  });
  it("rota nova sem cookie: página vai para /entrar, API recebe 401", () => {
    assert.equal(decidirAcesso("/qualquer-rota-nova", false), "entrar");
    assert.equal(decidirAcesso("/api/qualquer", false), "401");
    assert.equal(decidirAcesso("/api", false), "401");
  });
  it("com cookie assinado válido, segue (o servidor confere o resto no banco)", () => {
    assert.equal(decidirAcesso("/plano", true), "seguir");
    assert.equal(decidirAcesso("/api/sessao", true), "seguir");
  });
  it("a tela de entrada abre sem cookie", () => {
    assert.equal(decidirAcesso("/entrar", false), "seguir");
  });
});

describe("login desligado (desenvolvimento): sem tela de login", () => {
  it("página sem cookie vai para a sessão local, nunca para /entrar", () => {
    assert.equal(decidirAcesso("/", false, true), "sessao-local");
    assert.equal(decidirAcesso("/plano", false, true), "sessao-local");
    assert.equal(decidirAcesso("/usuarios", false, true), "sessao-local");
  });
  it("a sessão local é pública só com o login desligado", () => {
    assert.equal(rotaPublica(ROTA_DA_SESSAO_LOCAL, true), true);
    assert.equal(rotaPublica(`${ROTA_DA_SESSAO_LOCAL}x`, true), false);
    assert.equal(decidirAcesso(ROTA_DA_SESSAO_LOCAL, false, true), "seguir");
    assert.equal(decidirAcesso(ROTA_DA_SESSAO_LOCAL, false, false), "entrar");
  });
  it("API sem cookie continua com 401, e com cookie segue", () => {
    assert.equal(decidirAcesso("/api/sessao", false, true), "401");
    assert.equal(decidirAcesso("/plano", true, true), "seguir");
  });
  it("endereço sem sessão: /entrar ou a sessão local, guardando o destino (menos a raiz)", () => {
    assert.equal(enderecoSemSessao(false), "/entrar");
    assert.equal(enderecoSemSessao(true), "/sessao-local");
    assert.equal(enderecoSemSessao(true, "/"), "/sessao-local");
    assert.equal(enderecoSemSessao(true, "/usuarios?q=a b"), "/sessao-local?de=%2Fusuarios%3Fq%3Da%20b");
    assert.equal(enderecoSemSessao(false, "/plano"), "/entrar?de=%2Fplano");
  });
  it("sair: com login desligado volta ao painel; com login ligado, vai para /entrar", () => {
    assert.equal(destinoAoSair(true), "/");
    assert.equal(destinoAoSair(false), "/entrar");
  });
});
