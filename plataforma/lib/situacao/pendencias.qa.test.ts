// QA (Parte 8, passo 22b): o texto do relatório de situação fiscal vem do PDF da Receita com uma célula por linha
// (textoDoPdf: cada Tj/TJ vira uma linha). Conferido no relatório real guardado no ../fiscal (data/documentos/SITFIS-*.pdf):
// as tabelas (sócios, por exemplo) saem com cada coluna numa linha ("CPF/CNPJ", "Nome", "Qualificação"... e depois cada
// valor numa linha). A tabela de débitos sai do mesmo jeito; o leitor de pendências precisa casar o débito com a guia
// vencida mesmo assim.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { debitosComGuia, explicarPendencias } from "./pendencias";

// Débito do INSS do pró-labore de 09/2026 como sai do PDF real: uma célula por linha.
const DEBITO_EM_CELULAS = [
  "Pendência - Débito (SIEF)",
  "Receita",
  "PA/Exerc.",
  "Dt. Vcto",
  "Vl.Original",
  "Sdo.Devedor",
  "Situação",
  "1082-01 - CP-SEGURADOS",
  "09/2026",
  "20/10/2026",
  "178,31",
  "178,31",
  "DEVEDOR",
].join("\n");

describe("QA: pendências com o texto do PDF real (uma célula por linha)", () => {
  it("o débito do INSS de 09/2026 casa com a guia vencida (tributo e mês juntos)", () => {
    assert.deepEqual(debitosComGuia(explicarPendencias(DEBITO_EM_CELULAS)), [{ tributo: "INSS", pa: "2026-09" }]);
  });

  it("um débito vira uma linha só na tela, com tributo, mês, vencimento e saldo", () => {
    const [p] = explicarPendencias(DEBITO_EM_CELULAS);
    assert.equal(p.debitos.length, 1);
    assert.deepEqual([p.debitos[0].tributo, p.debitos[0].pa, p.debitos[0].vencimento, p.debitos[0].saldo], ["INSS", "2026-09", "2026-10-20", 178.31]);
  });
});
