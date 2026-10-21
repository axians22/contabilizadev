// QA (Parte 3, ciclo 5): natureza jurídica sem código, impedida por lei, CNAE 7490-1/04 sozinho e situação em minúsculas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lerRespostaCnpj, type DadosCnpj } from "./brasilapi/cnpj.ts";
import { respostaGravada } from "./brasilapi/exemplos.ts";
import { diagnosticar } from "./diagnostico.ts";

const HOJE = "2026-10-16";
const base = (): DadosCnpj => {
  const d = lerRespostaCnpj(respostaGravada("ti-fator-r"));
  d.simples = { optante: true, dataOpcao: "2020-01-01", dataExclusao: null };
  d.mei = { optante: false, dataOpcao: null, dataExclusao: null };
  return d;
};

test("QA ciclo5: natureza jurídica sem código nem descrição diz 'não informada' sem parênteses vazios", () => {
  const d = diagnosticar({ ...base(), naturezaJuridica: { codigo: "", descricao: "" } }, HOJE);
  assert.equal(d.atendido, false);
  const m = d.impedimentos.map((n) => n.detalhe).find((x) => /Natureza jurídica/.test(x));
  assert.ok(m);
  assert.match(m!, /não informada/);
  assert.ok(!/\(\s*\)/.test(m!), m);
});

test("QA ciclo5: S/A (2054) cita a vedação legal do Simples", () => {
  const d = diagnosticar({ ...base(), naturezaJuridica: { codigo: "2054", descricao: "Sociedade Anônima Fechada" } }, HOJE);
  assert.ok(d.impedimentos.map((n) => n.detalhe).some((m) => /art\. 3º, § 4º, X/.test(m)));
});

test("QA ciclo5: só 7490-1/04 no cadastro (principal) não é atendido, sem anexo e sem Fator R", () => {
  const d = diagnosticar({ ...base(), cnaePrincipal: { codigo: "7490104", descricao: "" }, cnaesSecundarios: [] }, HOJE);
  assert.equal(d.atendido, false);
  assert.equal(d.anexo, null);
  assert.equal(d.dependeFatorR, false);
  assert.equal(d.dependeFatorR, false);
  assert.ok(d.impedimentos.map((n) => n.detalhe).some((m) => /7490-1\/04.*o principal/.test(m)));
});

test("QA ciclo5: situação 'ativa' em minúsculas na resposta é lida como ATIVA e atende", () => {
  const json = { ...respostaGravada("ti-anexo-iii"), descricao_situacao_cadastral: "ativa" };
  const dados = lerRespostaCnpj(json);
  const d = diagnosticar({ ...dados, simples: { optante: true, dataOpcao: "2020-01-01", dataExclusao: null }, mei: { optante: false, dataOpcao: null, dataExclusao: null } }, HOJE);
  assert.ok(!d.impedimentos.map((n) => n.detalhe).some((m) => /situação/.test(m)), d.impedimentos.map((n) => n.detalhe).join(" | "));
});
