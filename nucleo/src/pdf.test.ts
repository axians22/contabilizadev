import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import fs from "node:fs";
import { documentoReal } from "./casos-reais.ts";
import { pdfDoBase64, textoDoPdf } from "./pdf.ts";
import { valorDoDarf } from "./serpro/dctfweb.ts";

test("extrai o texto dos operadores Tj e TJ", () => {
  const conteudo = zlib.deflateSync(Buffer.from("BT (N\\343o foram detectadas pend\\352ncias)Tj [(Final )-20(do Relat\\363rio)]TJ ET", "latin1"));
  const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n1 0 obj<<>>stream\n", "latin1"), conteudo, Buffer.from("\nendstream\nendobj", "latin1")]);
  assert.equal(textoDoPdf(pdf), "Não foram detectadas pendências\nFinal do Relatório");
});

test("caso real: total do DARF do INSS de 09/2026", { skip: !documentoReal("DARF-INSS-202609.pdf") && "PDF do ../fiscal não encontrado" }, () => {
  assert.equal(valorDoDarf(textoDoPdf(fs.readFileSync(documentoReal("DARF-INSS-202609.pdf")!))), 178.31);
});

test("PDF sem stream ou com stream que não descompacta devolve texto vazio", () => {
  assert.equal(textoDoPdf(Buffer.from("%PDF-1.4\n%%EOF")), "");
  assert.equal(textoDoPdf(Buffer.from("%PDF-1.4\nstream\nlixo\nendstream")), "");
});

test("pdfDoBase64: só aceita o que é PDF (assinatura %PDF- no começo)", () => {
  const b64 = (t: string) => Buffer.from(t, "latin1").toString("base64");
  assert.equal(pdfDoBase64(b64("%PDF-1.4\n%%EOF"))?.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdfDoBase64(b64("\r\n%PDF-1.7\n")), "lixo curto antes do cabeçalho é aceito, como nos leitores");
  assert.equal(pdfDoBase64(b64("<html>erro interno</html>")), null);
  assert.equal(pdfDoBase64(b64(`${" ".repeat(1100)}%PDF-1.4`)), null);
  assert.equal(pdfDoBase64(""), null);
  assert.equal(pdfDoBase64(null), null);
  assert.equal(pdfDoBase64("!!!não é base64!!!"), null);
});
