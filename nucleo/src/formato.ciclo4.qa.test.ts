import { test } from "node:test";
import assert from "node:assert/strict";
import { formatarCnae, formatarNatureza } from "./formato.ts";
import { diagnosticar } from "./diagnostico.ts";

test("QA ciclo 4: formatarCnae com formatos variados da Receita", () => {
  assert.equal(formatarCnae("6201-5/01"), "6201-5/01");
  assert.equal(formatarCnae("6201-5-01"), "6201-5/01");
  assert.equal(formatarCnae("62.01-5-01"), "6201-5/01");
  assert.equal(formatarCnae(" 6311900 "), "6311-9/00");
  assert.equal(formatarCnae(""), "");
  assert.equal(formatarCnae("620150"), "620150");
  assert.equal(formatarCnae("62015011"), "62015011");
});

test("QA ciclo 4: formatarNatureza com borda", () => {
  assert.equal(formatarNatureza("2135"), "213-5");
  assert.equal(formatarNatureza("213-5"), "213-5");
  assert.equal(formatarNatureza(""), "");
  assert.equal(formatarNatureza("213"), "213");
});

import { lerRespostaCnpj } from "./brasilapi/cnpj.ts";
import { respostaGravada } from "./brasilapi/exemplos.ts";

test("QA ciclo 4: motivos do diagnóstico continuam formatando CNAE e natureza depois da troca para formato.ts", () => {
  const d0 = lerRespostaCnpj(respostaGravada("ti-fator-r"));
  d0.simples = { optante: true, dataOpcao: "2020-01-01", dataExclusao: null };
  d0.mei = { optante: false, dataOpcao: null, dataExclusao: null };
  const d = diagnosticar({ ...d0, cnaePrincipal: { codigo: "4751-2/01", descricao: "" }, cnaesSecundarios: [], naturezaJuridica: { codigo: "1015", descricao: "Órgão Público" } as typeof d0.naturezaJuridica }, "2026-10-16");
  assert.equal(d.atendido, false);
  assert.ok(d.impedimentos.map((n) => n.detalhe).some((m) => m.includes("4751-2/01")), d.impedimentos.map((n) => n.detalhe).join(" | "));
  assert.ok(d.impedimentos.map((n) => n.detalhe).some((m) => m.includes("101-5")), d.impedimentos.map((n) => n.detalhe).join(" | "));
});
