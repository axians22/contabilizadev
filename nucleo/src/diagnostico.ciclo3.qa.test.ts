// QA (Parte 3, ciclo 3): com algum CNAE fora do escopo, a empresa fica sem anexo, sem Fator R e sem aviso de mistas.
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
const com = (principal: string, secundarios: string[]) =>
  diagnosticar({ ...base(), cnaePrincipal: { codigo: principal, descricao: "" }, cnaesSecundarios: secundarios.map((codigo) => ({ codigo, descricao: "" })) }, HOJE);

test("QA ciclo3: mistas (Fator R + III fixo) + um CNAE fora do escopo: sem anexo, sem Fator R, sem aviso de mistas", () => {
  const d = com("6201501", ["6311900", "4751201"]);
  assert.equal(d.atendido, false);
  assert.equal(d.anexo, null);
  assert.equal(d.dependeFatorR, false);
  assert.equal(d.dependeFatorR, false);
  assert.deepEqual(d.observacoes.map((n) => n.detalhe), []);
  assert.equal(d.impedimentos.map((n) => n.detalhe).length, 1);
  assert.match(d.impedimentos.map((n) => n.detalhe)[0], /4751-2\/01/);
  // referência por atividade continua
  assert.deepEqual(d.atividades.map((a) => a.anexo), ["III ou V", "III", null]);
});

test("QA ciclo3: dois CNAEs fora do escopo geram dois motivos e só o principal diz 'o principal'", () => {
  const d = com("4751201", ["6201501", "8599604"]);
  assert.equal(d.anexo, null);
  const foras = d.impedimentos.map((n) => n.detalhe).filter((m) => /não é atendido/.test(m));
  assert.equal(foras.length, 2);
  assert.equal(foras.filter((m) => /o principal/.test(m)).length, 1);
  assert.match(foras.find((m) => /o principal/.test(m))!, /4751-2\/01/);
});

test("QA ciclo3: tirar o CNAE fora do escopo volta a dar anexo (o filtro não ficou preso)", () => {
  const d = com("6201501", ["6311900"]);
  assert.equal(d.atendido, true);
  assert.equal(d.anexo, "III ou V");
  assert.equal(d.dependeFatorR, true);
  assert.equal(d.dependeFatorR, true);
  assert.equal(d.observacoes.map((n) => n.detalhe).length, 1);
});

test("QA ciclo3: só CNAEs de Anexo III fixo continua 'III' sem Fator R", () => {
  const d = com("6311900", ["6319400"]);
  assert.equal(d.atendido, true);
  assert.equal(d.anexo, "III");
  assert.equal(d.dependeFatorR, false);
  assert.equal(d.dependeFatorR, false);
});

test("QA ciclo3: CNAE secundário com código vazio/inválido não dá anexo à empresa", () => {
  const d = com("6201501", [""]);
  assert.equal(d.anexo, null);
  assert.equal(d.atendido, false);
});

test("QA ciclo3: CNAE fora do escopo + fora do Simples: motivos dos dois, sem anexo", () => {
  const d = diagnosticar({ ...base(), cnaesSecundarios: [{ codigo: "4751201", descricao: "" }], simples: { optante: false, dataOpcao: null, dataExclusao: null } }, HOJE);
  assert.equal(d.anexo, null);
  assert.ok(d.impedimentos.map((n) => n.detalhe).some((m) => /Simples/.test(m)));
  assert.ok(d.impedimentos.map((n) => n.detalhe).some((m) => /4751-2\/01/.test(m)));
});
