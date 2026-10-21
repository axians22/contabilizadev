// QA (Parte 3, ciclo 2): anexo e Fator R só para quem está no Simples agora e não é MEI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lerRespostaCnpj, type DadosCnpj } from "./brasilapi/cnpj.ts";
import { respostaGravada, type Exemplo } from "./brasilapi/exemplos.ts";
import { diagnosticar } from "./diagnostico.ts";

const HOJE = "2026-10-16";
const dados = (nome: Exemplo, mudar: (d: DadosCnpj) => void = () => {}) => {
  const d = lerRespostaCnpj(respostaGravada(nome));
  mudar(d);
  return d;
};

test("QA ciclo2: MEI que também é optante do Simples (como a Receita marca) fica sem anexo", () => {
  const d = diagnosticar(dados("ti-fator-r", (x) => { x.mei = { optante: true, dataOpcao: "2020-01-01", dataExclusao: null }; x.simples = { optante: true, dataOpcao: "2020-01-01", dataExclusao: null }; }), HOJE);
  assert.equal(d.anexo, null);
  assert.equal(d.dependeFatorR, false);
  assert.equal(d.dependeFatorR, false);
  assert.equal(d.atendido, false);
  assert.ok(d.impedimentos.map((n) => n.detalhe).some((m) => /MEI/.test(m)));
  assert.ok(d.atividades.length > 0);
});

test("QA ciclo2: exclusão do Simples exatamente hoje já tira o anexo; amanhã ainda não", () => {
  const hoje = diagnosticar(dados("ti-fator-r", (x) => { x.simples = { optante: true, dataOpcao: "2020-01-01", dataExclusao: HOJE }; x.mei = { optante: false, dataOpcao: null, dataExclusao: null }; }), HOJE);
  assert.equal(hoje.anexo, null);
  assert.equal(hoje.dependeFatorR, false);
  const amanha = diagnosticar(dados("ti-fator-r", (x) => { x.simples = { optante: true, dataOpcao: "2020-01-01", dataExclusao: "2026-10-17" }; x.mei = { optante: false, dataOpcao: null, dataExclusao: null }; }), HOJE);
  assert.equal(amanha.anexo, "III ou V");
  assert.equal(amanha.dependeFatorR, true);
  assert.equal(amanha.dependeFatorR, true);
});

test("QA ciclo2: MEI sem informação (null) e Simples sim continua com anexo", () => {
  const d = diagnosticar(dados("ti-fator-r", (x) => { x.mei = { optante: null, dataOpcao: null, dataExclusao: null }; x.simples = { optante: true, dataOpcao: "2020-01-01", dataExclusao: null }; }), HOJE);
  assert.equal(d.anexo, "III ou V");
  assert.equal(d.dependeFatorR, true);
});

test("QA ciclo2: fora do Simples com CNAEs mistos não recebe o aviso de atividades mistas", () => {
  const base = dados("ti-fator-r");
  const d = diagnosticar({ ...base, cnaePrincipal: { codigo: "6201501", descricao: "" }, cnaesSecundarios: [{ codigo: "6311900", descricao: "" }], simples: { optante: false, dataOpcao: null, dataExclusao: null }, mei: { optante: false, dataOpcao: null, dataExclusao: null } }, HOJE);
  assert.equal(d.anexo, null);
  assert.ok(!d.observacoes.map((n) => n.detalhe).some((a) => /mistas|Anexo III fixo/.test(a)));
});
