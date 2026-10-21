import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assinarToken, destinoSeguro, hashDoToken, lerTokenAssinado, nomeDoCookie, novoToken, opcoesDoCookie } from "./cookie";

const SEGREDO = "um-segredo-de-teste-com-32-caracteres!";

describe("cookie de sessão assinado", () => {
  it("o token assinado volta igual com o mesmo segredo", () => {
    const token = novoToken();
    assert.equal(lerTokenAssinado(assinarToken(token, SEGREDO), SEGREDO), token);
  });
  it("tokens novos são aleatórios e longos (32 bytes)", () => {
    const a = novoToken();
    assert.notEqual(a, novoToken());
    assert.equal(Buffer.from(a, "base64url").length, 32);
  });
  it("assinado com outro segredo é recusado", () => {
    assert.equal(lerTokenAssinado(assinarToken(novoToken(), "outro-segredo-qualquer-com-32-caracteres"), SEGREDO), null);
  });
  it("token trocado com a assinatura antiga é recusado", () => {
    const [, assinatura] = assinarToken(novoToken(), SEGREDO).split(".");
    assert.equal(lerTokenAssinado(`${novoToken()}.${assinatura}`, SEGREDO), null);
  });
  it("valores malformados são recusados sem lançar", () => {
    for (const v of [undefined, null, "", "semponto", ".so-assinatura", "token.", "a.b.c"]) assert.equal(lerTokenAssinado(v, SEGREDO), null, String(v));
  });
  it("o banco guarda o hash, que não é o token", () => {
    const token = novoToken();
    assert.match(hashDoToken(token), /^[0-9a-f]{64}$/);
    assert.notEqual(hashDoToken(token), token);
  });
  it("opções: httpOnly e SameSite=Lax sempre; Secure e __Host- só em produção", () => {
    const expira = new Date("2026-11-15T00:00:00Z");
    assert.deepEqual(opcoesDoCookie(true, expira), { httpOnly: true, secure: true, sameSite: "lax", path: "/", expires: expira });
    assert.equal(opcoesDoCookie(false, expira).secure, false);
    assert.equal(nomeDoCookie(true), "__Host-sessao");
    assert.equal(nomeDoCookie(false), "sessao");
  });
});

describe("destinoSeguro: depois do login, só caminhos do próprio site", () => {
  it("aceita caminhos internos com busca", () => {
    assert.equal(destinoSeguro("/plano"), "/plano");
    assert.equal(destinoSeguro("/usuarios?q=ana&pagina=2"), "/usuarios?q=ana&pagina=2");
  });
  it("recusa outros sites e esquisitices", () => {
    for (const v of ["https://mal.example", "//mal.example", "/\\mal.example", "javascript:alert(1)", "plano", "", null, undefined, "/a\r\nSet-Cookie: x"]) {
      assert.equal(destinoSeguro(v), "/", String(v));
    }
  });
  it("recusa caracteres de controle em qualquer lugar (o navegador apaga TAB/CR/LF e '/\\t/x' viraria '//x')", () => {
    for (const v of ["/\t/mal.example", "/\t\\mal.example", "/plano\t", "/a\u0000b", "/a\u001fb", "/a\u007fb", "/\n/mal.example"]) {
      assert.equal(destinoSeguro(v), "/", JSON.stringify(v));
    }
  });
  it("o destino aceito sempre resolve na mesma origem", () => {
    const base = "http://localhost:3001/entrar";
    for (const v of ["/plano", "/a/b?c=1#d", "/\t/mal.example", "//mal.example", "/\\mal.example"]) {
      assert.equal(new URL(destinoSeguro(v), base).origin, "http://localhost:3001", JSON.stringify(v));
    }
  });
});
