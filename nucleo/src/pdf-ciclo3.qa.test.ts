import { test } from "node:test";
import assert from "node:assert/strict";
import { pdfDoBase64 } from "./pdf.ts";

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");

test("QA ciclo 3: pdfDoBase64 nas bordas", () => {
  // cabeçalho terminando exatamente no byte 1024 (começa em 1019): aceito
  assert.ok(pdfDoBase64(b64(Buffer.concat([Buffer.alloc(1019, 0x20), Buffer.from("%PDF-1.4\n")]))));
  // só espaços / base64 inválido
  assert.equal(pdfDoBase64("   "), null);
  assert.equal(pdfDoBase64("!!!!"), null);
  // base64 com quebras de linha (MIME) continua valendo
  const quebrado = b64("%PDF-1.7\n" + "x".repeat(200)).replace(/(.{76})/g, "$1\n");
  assert.ok(pdfDoBase64(quebrado));
  // %PDF sem o hífen não é PDF
  assert.equal(pdfDoBase64(b64("%PDF1.4")), null);
  // o Buffer devolvido é o conteúdo inteiro
  const conteudo = "%PDF-1.4\nabc\n%%EOF";
  assert.equal(pdfDoBase64(b64(conteudo))!.toString(), conteudo);
});
