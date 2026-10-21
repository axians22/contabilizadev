import { test } from "node:test";
import assert from "node:assert/strict";
import { CNAES_FORA_DO_ESCOPO, REGRAS_CNAE, anexoDaAtividade, idAtividadeExportacao, idAtividadeInterno, normalizarCnae, regraDoCnae, type IssDevido } from "./cnae.ts";
import { atividadePgdasd, sujeitaAoFatorR } from "./serpro/atividades-pgdasd.ts";
import { fatorR } from "./simples.ts";

test("todos os CNAEs de TI do MVP têm regra", () => {
  for (const classe of ["6201", "6202", "6203", "6204", "6209", "6311", "6319"]) {
    assert.ok(REGRAS_CNAE.some((r) => r.cnae.startsWith(classe)), classe);
  }
});

test("caso real: 6209-1/00 é Anexo III fixo, código 30 no PGDAS-D", () => {
  const regra = regraDoCnae("6209-1/00");
  assert.equal(regra.tributacao, "anexo-fixo");
  assert.equal(anexoDaAtividade(regra), "III");
  assert.equal(idAtividadeExportacao(regra), 30);
});

test("desenvolvimento e consultoria dependem do Fator R", () => {
  const regra = regraDoCnae(6201501);
  assert.equal(regra.tributacao, "fator-r");
  assert.throws(() => anexoDaAtividade(regra), /Fator R/);
  assert.equal(anexoDaAtividade(regra, fatorR("2026-09", { "2026-01": 2_800 }, { "2026-01": 10_000 })), "III");
  assert.equal(anexoDaAtividade(regra, fatorR("2026-09", {}, { "2026-01": 10_000 })), "V");
  assert.equal(regraDoCnae("6204000").tributacao, "fator-r");
});

test("exportação sujeita ao Fator R (6201 a 6204) usa o código 29 do catálogo do Serpro", () => {
  for (const cnae of ["6201501", "6201502", "6202300", "6203100", "6204000"]) {
    const id = idAtividadeExportacao(regraDoCnae(cnae));
    assert.equal(id, 29, cnae);
    assert.equal(atividadePgdasd(id).grupo, "Prestação de serviços para o exterior");
    assert.equal(atividadePgdasd(id).descricao, 'Sujeitos ao fator "r"');
    assert.equal(sujeitaAoFatorR(id), true);
  }
  for (const cnae of ["6209100", "6311900", "6319400"]) {
    const id = idAtividadeExportacao(regraDoCnae(cnae));
    assert.equal(id, 30, cnae);
    assert.match(atividadePgdasd(id).descricao, /Não sujeitos ao fator "r" e tributados pelo Anexo III/);
    assert.equal(sujeitaAoFatorR(id), false);
  }
});

test("mercado interno: 10/11/12 com Fator R e 13/14/15 no Anexo III, conforme onde o ISS é devido", () => {
  const dev = regraDoCnae("6201501");
  const suporte = regraDoCnae("6209100");
  const iss: IssDevido[] = ["outro-municipio", "proprio-municipio", "retencao"];
  assert.deepEqual(iss.map((i) => idAtividadeInterno(dev, i)), [10, 11, 12]);
  assert.deepEqual(iss.map((i) => idAtividadeInterno(suporte, i)), [13, 14, 15]);
  assert.match(atividadePgdasd(11).descricao, /^Sujeitos ao fator "r", sem retenção.*próprio Município/);
  assert.match(atividadePgdasd(15).descricao, /Anexo III, com retenção/);
  assert.equal(atividadePgdasd(14).grupo, "Prestação de serviços, exceto para o exterior");
  assert.throws(() => idAtividadeInterno(dev, "ali" as IssDevido), /ISS inválida/);
  assert.throws(() => idAtividadeInterno(regraDoCnae("4751201"), "retencao"), /não atendido/);
});

test("catálogo de atividades do PGDAS-D: 1 a 43, sem repetição; só 10, 11, 12 e 29 sujeitas ao fator r", () => {
  const ids = Array.from({ length: 43 }, (_, i) => i + 1);
  for (const id of ids) assert.equal(atividadePgdasd(id).id, id);
  assert.deepEqual(ids.filter(sujeitaAoFatorR), [10, 11, 12, 29]);
  assert.match(atividadePgdasd(31).descricao, /Anexo IV/);
  assert.match(atividadePgdasd(28).descricao, /contábeis/);
  assert.throws(() => atividadePgdasd(44), /não existe/);
  assert.throws(() => atividadePgdasd(0), /não existe/);
});

test("CNAE fora da lista não é atendido", () => {
  const regra = regraDoCnae("4751-2/01");
  assert.equal(regra.tributacao, "nao-atendido");
  assert.throws(() => anexoDaAtividade(regra), /não atendido/);
  assert.throws(() => idAtividadeExportacao(regra), /não atendido/);
  assert.throws(() => regraDoCnae("12345678"), /inválido/);
  assert.equal(normalizarCnae("6311-9/00"), "6311900");
});

test("7490-1/04 (intermediação): conferido na CGSN 140 (art. 25, § 1º, V, s), mas não é TI e fica fora do MVP", () => {
  const regra = regraDoCnae("7490-1/04");
  assert.equal(regra.tributacao, "nao-atendido");
  assert.match(regra.descricao, /intermediação e agenciamento/);
  assert.match(regra.fundamento, /art\. 25, § 1º, V, s/);
  assert.throws(() => anexoDaAtividade(regra), /não atendido/);
});

test("a tabela tem todas as subclasses das classes de TI do MVP, sem repetição", () => {
  assert.deepEqual(REGRAS_CNAE.map((r) => r.cnae), ["6201501", "6201502", "6202300", "6203100", "6204000", "6209100", "6311900", "6319400"]);
  assert.ok(REGRAS_CNAE.every((r) => r.tributacao !== "nao-atendido"));
  assert.ok(CNAES_FORA_DO_ESCOPO.every((r) => r.tributacao === "nao-atendido" && !REGRAS_CNAE.some((t) => t.cnae === r.cnae)));
});
