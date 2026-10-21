// QA, Parte 5 (ciclo 4): atividades com IPI e ISS ao mesmo tempo (40 a 43) com regra própria (LC 123, art. 18, § 4º, VI).
import { test } from "node:test";
import assert from "node:assert/strict";
import { anexoDaAtividadePgdasd, conferirAtividades, ehExportacao } from "./conferencia-anexo.ts";
import type { AtividadeDiagnosticada, Diagnostico } from "./diagnostico.ts";

const atividade = (cnae: string, tributacao: AtividadeDiagnosticada["tributacao"], principal = true): AtividadeDiagnosticada => ({
  cnae, descricao: "", principal, tributacao, anexo: tributacao === "fator-r" ? "III ou V" : "III", fundamento: "",
});
const SUPORTE: Pick<Diagnostico, "atividades" | "anexo"> = { atividades: [atividade("6209100", "anexo-fixo")], anexo: "III" };
const DESENV: Pick<Diagnostico, "atividades" | "anexo"> = { atividades: [atividade("6201501", "fator-r")], anexo: "III ou V" };
const MISTA: Pick<Diagnostico, "atividades" | "anexo"> = {
  atividades: [atividade("6201501", "fator-r", true), atividade("6209100", "anexo-fixo", false)], anexo: "III ou V",
};
const texto = (pa: string, ids: (number | null)[], d: Pick<Diagnostico, "atividades" | "anexo">) => conferirAtividades(pa, ids, d)!.explicacao.join(" ");

test("QA ciclo 4: 40 a 43 são Anexo II; só 43 é exportação", () => {
  for (const id of [40, 41, 42, 43]) assert.equal(anexoDaAtividadePgdasd(id), "II", `atividade ${id}`);
  assert.deepEqual([40, 41, 42, 43].map(ehExportacao), [false, false, false, true]);
});

test("QA ciclo 4: 40 a 43 nunca falam em mercadoria, ICMS a pagar ou 'não de prestação de serviço'", () => {
  for (const d of [SUPORTE, DESENV, MISTA])
    for (const id of [40, 41, 42, 43]) {
      const t = texto("2026-08", [id], d);
      assert.doesNotMatch(t, /mercadoria/i, `atividade ${id}`);
      assert.doesNotMatch(t, /não de prestação de serviço/, `atividade ${id}`);
      assert.match(t, /tributada pelo Anexo II, com o ISS no lugar do ICMS/, `atividade ${id}`);
      assert.match(t, /retifique a declaração/, `atividade ${id}`);
      assert.equal((t.match(/Anexo II,/g) ?? []).length, 1, `atividade ${id}: frase única`);
    }
});

test("QA ciclo 4: 'o certo é' segue a empresa; na mista vale o CNAE principal (Fator R)", () => {
  assert.match(texto("2026-08", [42], SUPORTE), /o certo é o Anexo III\)/);
  assert.match(texto("2026-08", [42], DESENV), /o certo é o Anexo III ou o V, conforme o Fator R\)/);
  const m = conferirAtividades("2026-08", [42], MISTA)!;
  assert.equal(m.esperada, 29);
  assert.match(m.explicacao.join(" "), /o certo é o Anexo III ou o V, conforme o Fator R\)/);
});

test("QA ciclo 4: mercado interno só para 40 a 42; 43 sem essa frase", () => {
  for (const id of [40, 41, 42]) assert.match(texto("2026-08", [id], DESENV), /mercado interno, como industrialização com IPI e ISS ao mesmo tempo no Brasil/);
  assert.doesNotMatch(texto("2026-08", [43], DESENV), /mercado interno/);
  assert.doesNotMatch(texto("2026-08", [43], SUPORTE), /mercado interno/);
});

test("QA ciclo 4: título e texto curto do mês (virada de ano)", () => {
  const d = conferirAtividades("2025-12", [41], SUPORTE)!;
  assert.equal(d.declarada, 41);
  assert.equal(d.esperada, 30);
  assert.match(d.texto, /^Em 12\/2025 a declaração usou .+; pelo seu CNAE seria serviço para o exterior, Anexo III fixo\.$/);
});

test("QA ciclo 4: mercadoria (1, 2, 4, 5) continua com o texto de mercadoria e ICMS", () => {
  for (const id of [1, 2, 4, 5]) {
    const t = texto("2026-08", [id], SUPORTE);
    assert.match(t, /venda de mercadoria/);
    assert.match(t, /com ICMS/);
  }
  assert.doesNotMatch(texto("2026-08", [3], SUPORTE), /com ICMS/);
});
