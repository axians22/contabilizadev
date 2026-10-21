// QA, Parte 5 (passo 17): conferência do CNAE com a atividade declarada no PGDAS-D — casos de borda.
import { test } from "node:test";
import assert from "node:assert/strict";
import { conferirAtividades } from "./conferencia-anexo.ts";
import type { AtividadeDiagnosticada, Diagnostico } from "./diagnostico.ts";

const atividade = (cnae: string, tributacao: AtividadeDiagnosticada["tributacao"], principal = true): AtividadeDiagnosticada => ({
  cnae,
  descricao: "",
  principal,
  tributacao,
  anexo: tributacao === "fator-r" ? "III ou V" : tributacao === "anexo-fixo" ? "III" : null,
  fundamento: "",
});
const DEV: Pick<Diagnostico, "atividades" | "anexo"> = { atividades: [atividade("6201501", "fator-r")], anexo: "III ou V" };
const SUPORTE: Pick<Diagnostico, "atividades" | "anexo"> = { atividades: [atividade("6209100", "anexo-fixo")], anexo: "III" };

test("QA: atividade certa (29 / 30) não acusa; várias atividades no mês, uma errada, acusa a errada", () => {
  assert.equal(conferirAtividades("2026-09", [29], DEV), null);
  assert.equal(conferirAtividades("2026-09", [30], SUPORTE), null);
  const d = conferirAtividades("2026-09", [29, 30], DEV);
  assert.equal(d?.declarada, 30);
  assert.equal(d?.esperada, 29);
  assert.match(d!.texto, /^Em 09\/2026 a declaração usou .+; pelo seu CNAE seria .+\.$/);
});

test("QA: virada de ano no texto (12/2025) e mês não identificado no extrato não acusa", () => {
  assert.match(conferirAtividades("2025-12", [30], DEV)!.texto, /^Em 12\/2025 /);
  assert.equal(conferirAtividades("2025-12", [null], DEV), null);
  assert.equal(conferirAtividades("2025-12", [], DEV), null);
  assert.equal(conferirAtividades("2025-12", [999], DEV), null);
});

// O MVP atende só receita de exportação: pelo CNAE (e pelo diagnóstico) a atividade certa é a 29 (Fator R) ou a 30
// (Anexo III fixo). Declarar a receita no mercado interno (11, 14...) muda o imposto (ISS, PIS e COFINS entram) e é
// exatamente o tipo de erro que a conferência deveria apontar ("Em MM/AAAA a declaração usou X; pelo seu CNAE seria Y").
test("QA: receita declarada no mercado interno (14) por empresa que só exporta (6209 -> 30) é acusada", () => {
  const d = conferirAtividades("2026-08", [14], SUPORTE);
  assert.ok(d, "declarou atividade 14 (serviço no Brasil, Anexo III) mas pelo CNAE/exportação seria a 30: sem aviso");
  assert.equal(d?.esperada, 30);
});

test("QA: receita declarada no mercado interno com Fator R (11) por empresa de desenvolvimento que só exporta (6201 -> 29) é acusada", () => {
  const d = conferirAtividades("2026-08", [11], DEV);
  assert.ok(d, "declarou atividade 11 (serviço no Brasil) mas pelo CNAE/exportação seria a 29: sem aviso");
  assert.equal(d?.esperada, 29);
});

// Atividade declarada no Anexo IV (31) quando o certo é a 29: a explicação não pode dizer que "o mês fica sempre no
// Anexo III" (é o texto do caso 30 -> 29). Com 31 o mês foi tributado pelo Anexo IV.
test("QA: explicação do tooltip coerente quando a atividade declarada é do Anexo IV (31 -> 29)", () => {
  const d = conferirAtividades("2026-08", [31], DEV);
  assert.equal(d?.esperada, 29);
  const texto = d!.explicacao.join(" ");
  assert.doesNotMatch(texto, /fica sempre no Anexo III/, `explicação errada para atividade do Anexo IV: ${texto}`);
});
