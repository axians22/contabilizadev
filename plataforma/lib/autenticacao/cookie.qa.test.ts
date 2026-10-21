// QA: destino depois do login. O navegador (parser de URL do WHATWG) remove TAB, CR e LF de qualquer lugar da
// URL antes de interpretar o Location; então "/\t/evil.com" vira "//evil.com" e leva para outro site.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { destinoSeguro } from "./cookie";

const BASE = "http://localhost:3001/entrar";
const ATAQUES = [
  "/\t/evil.com",
  "/\t\\evil.com",
  "\t//evil.com",
  "/\u0009/evil.com/caminho",
  "//evil.com",
  "/\\evil.com",
  "/\n/evil.com",
  "/\r/evil.com",
  // Ciclo 2: outros caracteres de controle e variações.
  "/\x00/evil.com",
  "/\x7f/evil.com",
  " //evil.com",
  "/\u000b/evil.com",
  "/\u000c\\evil.com",
  "http://evil.com",
  "/\\\\evil.com",
  "\\/evil.com",
];

describe("destinoSeguro (QA): o destino resolvido nunca sai do próprio site", () => {
  for (const de of ATAQUES) {
    it(JSON.stringify(de), () => {
      const destino = destinoSeguro(de);
      assert.equal(new URL(destino, BASE).origin, new URL(BASE).origin, `destinoSeguro(${JSON.stringify(de)}) = ${JSON.stringify(destino)}`);
    });
  }
  it("caminhos legítimos continuam valendo", () => {
    assert.equal(destinoSeguro("/plano"), "/plano");
    assert.equal(destinoSeguro("/usuarios?q=a&pagina=2"), "/usuarios?q=a&pagina=2");
  });
});
