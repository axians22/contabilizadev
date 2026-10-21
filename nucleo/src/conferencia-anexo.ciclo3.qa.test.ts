// QA, Parte 5 (ciclo 3): naturezas das atividades e textos da conferência.
import { test } from "node:test";
import assert from "node:assert/strict";
import { anexoDaAtividadePgdasd, conferirAtividades } from "./conferencia-anexo.ts";
import { ATIVIDADES_PGDASD } from "./serpro/atividades-pgdasd.ts";
import type { AtividadeDiagnosticada, Diagnostico } from "./diagnostico.ts";

const atividade = (cnae: string, tributacao: AtividadeDiagnosticada["tributacao"], principal = true): AtividadeDiagnosticada => ({
  cnae, descricao: "", principal, tributacao, anexo: tributacao === "fator-r" ? "III ou V" : "III", fundamento: "",
});
const SUPORTE: Pick<Diagnostico, "atividades" | "anexo"> = { atividades: [atividade("6209100", "anexo-fixo")], anexo: "III" };
const DESENV: Pick<Diagnostico, "atividades" | "anexo"> = { atividades: [atividade("6201501", "fator-r")], anexo: "III ou V" };
const texto = (pa: string, ids: (number | null)[], d: Pick<Diagnostico, "atividades" | "anexo">) => conferirAtividades(pa, ids, d)!.explicacao.join(" ");

test("QA: toda atividade do catálogo tem anexo", () => {
  for (const a of ATIVIDADES_PGDASD) assert.notEqual(anexoDaAtividadePgdasd(a.id), null, `atividade ${a.id}`);
});

test("QA: Fator R exatamente 28% = Anexo III; 27,99% = Anexo V", () => {
  assert.equal(anexoDaAtividadePgdasd(29, 0.28), "III");
  assert.equal(anexoDaAtividadePgdasd(29, 0.2799), "V");
  assert.equal(anexoDaAtividadePgdasd(29), "III ou V");
});

test("QA: 31 (Anexo IV, exterior) numa empresa de Fator R: sem 'mercado interno', diz Anexo IV e o certo III ou V", () => {
  const t = texto("2026-08", [31], DESENV);
  assert.doesNotMatch(t, /mercado interno/);
  assert.match(t, /Anexo IV/);
  assert.match(t, /o certo é o Anexo III ou o V/);
});

test("QA: 8 (locação para o exterior) numa empresa de Anexo III fixo: mesmo Anexo III, sem 'mercado interno'", () => {
  const t = texto("2026-08", [8], SUPORTE);
  assert.doesNotMatch(t, /mercado interno/);
  assert.match(t, /mesmo Anexo III/);
});

test("QA: 9 (contábil, mercado interno) numa empresa de Fator R: mercado interno + Anexo III sem Fator R", () => {
  const t = texto("2026-08", [9], DESENV);
  assert.match(t, /mercado interno/);
  assert.match(t, /sem o Fator R/);
  assert.doesNotMatch(t, /não é de prestação de serviço/);
});

test("QA: 43 (IPI e ISS para o exterior) é do Anexo II (regra própria), sem frase de mercado interno", () => {
  const t = texto("2026-08", [43], SUPORTE);
  assert.match(t, /Anexo II/);
  assert.doesNotMatch(t, /mercado interno/);
});

test("QA: atividade certa junto com uma errada no mesmo mês acusa a errada; inválidas e nulas são ignoradas", () => {
  assert.equal(conferirAtividades("2026-08", [30, 32], SUPORTE)!.declarada, 32);
  assert.equal(conferirAtividades("2026-08", [30, null, 99], SUPORTE), null);
  assert.equal(conferirAtividades("2026-08", [], SUPORTE), null);
});

test("QA: virada de ano no texto (12/2025)", () => {
  assert.match(conferirAtividades("2025-12", [14], SUPORTE)!.texto, /^Em 12\/2025 a declaração usou/);
});
