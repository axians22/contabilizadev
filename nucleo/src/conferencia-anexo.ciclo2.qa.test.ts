// QA, Parte 5 (ciclo 2): textos do tooltip da conferência CNAE x atividade para atividades fora das regras 29/30.
import { test } from "node:test";
import assert from "node:assert/strict";
import { conferirAtividades } from "./conferencia-anexo.ts";
import type { AtividadeDiagnosticada, Diagnostico } from "./diagnostico.ts";

const atividade = (cnae: string, tributacao: AtividadeDiagnosticada["tributacao"]): AtividadeDiagnosticada => ({
  cnae, descricao: "", principal: true, tributacao, anexo: tributacao === "fator-r" ? "III ou V" : "III", fundamento: "",
});
const SUPORTE: Pick<Diagnostico, "atividades" | "anexo"> = { atividades: [atividade("6209100", "anexo-fixo")], anexo: "III" };

test("QA: atividade 32 (construção civil Anexo III, exterior) não diz 'tributado pelo Anexo III, que não é o da empresa (o certo é o Anexo III)'", () => {
  const d = conferirAtividades("2026-08", [32], SUPORTE)!;
  const texto = d.explicacao.join(" ");
  assert.doesNotMatch(texto, /Anexo III, que não é o das atividades da empresa \(o certo é o Anexo III\)/, texto);
});

test("QA: atividade 28 (escritório contábil, serviço para o exterior) não é descrita como 'não é de prestação de serviço'", () => {
  const texto = conferirAtividades("2026-08", [28], SUPORTE)!.explicacao.join(" ");
  assert.doesNotMatch(texto, /não é de prestação de serviço/, texto);
});

test("QA: atividade 26 (transporte coletivo municipal, serviço) não é descrita como 'não é de prestação de serviço'", () => {
  const texto = conferirAtividades("2026-08", [26], SUPORTE)!.explicacao.join(" ");
  assert.doesNotMatch(texto, /não é de prestação de serviço/, texto);
});
