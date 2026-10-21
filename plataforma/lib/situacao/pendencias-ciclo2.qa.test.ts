// QA (Parte 8, passo 22b, ciclo 2): quebra de página com o cabeçalho completo do relatório real. No PDF real guardado no
// ../fiscal (data/documentos/SITFIS-*.pdf) o cabeçalho de página traz, depois de "INFORMAÇÕES DE APOIO PARA EMISSÃO DE
// CERTIDÃO", as linhas "CNPJ:" e "<raiz do CNPJ> - <NOME DA EMPRESA>". Elas também se repetem no meio da tabela de débitos.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { debitosComGuia, explicarPendencias } from "./pendencias";

const CABECALHO_DE_PAGINA = [
  "Página: 1 /",
  "2",
  "MINISTÉRIO DA ECONOMIA",
  "Por meio do fornecedor",
  "SECRETARIA ESPECIAL DA RECEITA FEDERAL DO BRASIL",
  "Autor pedido: 98.765.432/0001-98. Contratante: 98.765.432/0001-98",
  "PROCURADORIA-GERAL DA FAZENDA NACIONAL",
  "15/10/2026 20:29:23",
  "INFORMAÇÕES DE APOIO PARA EMISSÃO DE CERTIDÃO",
  "CNPJ:",
  "98.765.432 - ALFA CORRETORA SEGURADORA E PREVIDENCIA LTDA",
];

describe("QA ciclo 2: quebra de página com o cabeçalho real (CNPJ e nome da empresa)", () => {
  it("o DAS de 07/2026 cortado pela quebra de página continua DAS e o texto do débito não leva CNPJ e nome", () => {
    const texto = [
      "Pendência - Débito (SIMPLES NACIONAL)",
      "07/2026",
      "20/08/2026",
      ...CABECALHO_DE_PAGINA,
      "900,00",
      "900,00",
      "08/2026",
      "21/09/2026",
      "1.170,84",
      "1.170,84",
    ].join("\n");
    const [p] = explicarPendencias(texto);
    assert.deepEqual(debitosComGuia([p]), [
      { tributo: "DAS", pa: "2026-07" },
      { tributo: "DAS", pa: "2026-08" },
    ]);
    assert.deepEqual(p.debitos.map((d) => d.linha), ["07/2026 20/08/2026 900,00 900,00", "08/2026 21/09/2026 1.170,84 1.170,84"]);
  });
});
