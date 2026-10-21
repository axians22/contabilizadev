// QA, Parte 5 (ciclo 5): texto de mercadoria ("com ICMS" só no mercado interno) e anexo da industrialização vindo da tabela.
import { test } from "node:test";
import assert from "node:assert/strict";
import { conferirAtividades, naturezaDaAtividade } from "./conferencia-anexo.ts";
import type { AtividadeDiagnosticada, Diagnostico } from "./diagnostico.ts";

const atividade = (cnae: string, tributacao: AtividadeDiagnosticada["tributacao"], principal = true): AtividadeDiagnosticada => ({
  cnae, descricao: "", principal, tributacao, anexo: tributacao === "fator-r" ? "III ou V" : "III", fundamento: "",
});
const SUPORTE: Pick<Diagnostico, "atividades" | "anexo"> = { atividades: [atividade("6209100", "anexo-fixo")], anexo: "III" };
const DESENV: Pick<Diagnostico, "atividades" | "anexo"> = { atividades: [atividade("6201501", "fator-r")], anexo: "III ou V" };
const texto = (id: number, d: Pick<Diagnostico, "atividades" | "anexo">) => conferirAtividades("2026-12", [id], d)!.explicacao.join(" ");

test("QA ciclo 5: mercadoria no mercado interno (1, 2, 4, 5) diz 'com ICMS' com o anexo da tabela", () => {
  for (const d of [SUPORTE, DESENV])
    for (const [id, anexo] of [[1, "I"], [2, "I"], [4, "II"], [5, "II"]] as const) {
      const t = texto(id, d);
      assert.match(t, new RegExp(`\\(Anexo ${anexo}, com ICMS\\)`), `atividade ${id}`);
      assert.doesNotMatch(t, /null|undefined/, `atividade ${id}`);
    }
});

test("QA ciclo 5: mercadoria para o exterior (3, 6) não fala em ICMS", () => {
  for (const d of [SUPORTE, DESENV])
    for (const [id, anexo] of [[3, "I"], [6, "II"]] as const) {
      const t = texto(id, d);
      assert.match(t, new RegExp(`\\(Anexo ${anexo}\\)`), `atividade ${id}`);
      assert.doesNotMatch(t, /ICMS/, `atividade ${id}`);
    }
});

test("QA ciclo 5: mercadoria não tem regra própria; 40 a 43 têm e o anexo do texto é o da tabela", () => {
  for (const id of [1, 2, 3, 4, 5, 6]) assert.equal(naturezaDaAtividade(id)!.regraPropria, null, `atividade ${id}`);
  for (const id of [40, 41, 42, 43]) {
    const n = naturezaDaAtividade(id)!;
    assert.equal(n.anexo, "II");
    assert.ok(n.regraPropria);
    assert.match(texto(id, DESENV), new RegExp(`tributada pelo Anexo ${n.anexo}, ${n.regraPropria}`));
  }
});

test("QA ciclo 5: virada de ano no texto (12/2026) e mês 01", () => {
  assert.match(conferirAtividades("2026-12", [1], SUPORTE)!.texto, /^Em 12\/2026 /);
  assert.match(conferirAtividades("2027-01", [1], SUPORTE)!.texto, /^Em 01\/2027 /);
});
