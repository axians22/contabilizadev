import { test } from "node:test";
import assert from "node:assert/strict";
import { dataIso, lerXlsx, numero } from "./xlsx.ts";

test("converte números e datas dos extratos", () => {
  assert.equal(numero("1.234,56"), 1234.56);
  assert.equal(numero("1323.43829511"), 1323.43829511);
  assert.equal(numero("-"), null);
  assert.equal(numero(""), null);
  assert.equal(numero("abc"), null);
  assert.equal(numero("R$ 10,00"), 10);
  assert.equal(dataIso("17/09/2026"), "2026-09-17");
  assert.equal(dataIso("2026-09-17"), "2026-09-17");
  assert.equal(dataIso("abc"), null);
});

// Planilha mínima (aba "Extrato", 2 linhas) com dados fictícios, montada só para o teste.
const PLANILHA = "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";

test("lê as abas de um .xlsx como linhas de texto", async () => {
  assert.deepEqual(await lerXlsx(Buffer.from(PLANILHA, "base64")), [
    { nome: "Extrato", linhas: [["Data", "Valor"], ["17/09/2026", "1234.56"]] },
  ]);
  await assert.rejects(lerXlsx(Buffer.from("não é planilha")));
});
