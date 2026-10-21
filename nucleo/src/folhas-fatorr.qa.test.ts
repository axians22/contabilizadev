// Testes do QA (Parte 1, ciclo 2): folhasSalario da declaração x meses do Fator R em todas as combinações.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dadosDeclaracao, folhasDaDeclaracao } from "./serpro/pgdasd.ts";
import { fatorR, mesesDoFatorR } from "./simples.ts";
import { somarMeses } from "./meses.ts";

const CNPJ = "12345678000195";

test("QA: para todo PA de 2025 a 2028 e início de 0 a 15 meses antes, declaração e fatorR usam os mesmos meses", () => {
  for (let i = 0; i < 48; i++) {
    const pa = somarMeses("2025-01", i);
    for (let k = 0; k <= 15; k++) {
      const inicio = somarMeses(pa, -k);
      const folhas: Record<string, number> = {};
      const receitas: Record<string, number> = {};
      for (let j = -20; j <= 0; j++) { folhas[somarMeses(pa, j)] = 3000; receitas[somarMeses(pa, j)] = 10000; }
      const f = fatorR(pa, folhas, receitas, inicio);
      const decl = folhasDaDeclaracao(pa, folhas, inicio).map((x) => String(x.pa));
      assert.deepEqual(decl, f.meses.map((m) => m.replace("-", "")), `${pa} início ${inicio}`);
      // nenhum mês antes do início nem depois do PA
      for (const m of f.meses) assert.ok(m >= inicio && m <= pa, `${pa} ${inicio} ${m}`);
      // ordem crescente e sem repetição
      assert.deepEqual([...f.meses].sort(), f.meses);
      assert.equal(new Set(f.meses).size, f.meses.length);
    }
  }
});

test("QA: virada de ano 2026 -> 2027 com abertura em dezembro/2026", () => {
  assert.deepEqual(mesesDoFatorR("2026-12", "2026-12").meses, ["2026-12"]);
  // jan/2027 é o 2º mês de atividade: regra nova, fator r fixo, sem folha.
  assert.deepEqual(mesesDoFatorR("2027-01", "2026-12"), { regra: "inicio-dois-primeiros-meses", meses: [] });
  const d = dadosDeclaracao({ cnpj: CNPJ, pa: "2027-01", receitaExterna: 5000, idAtividade: 29, inicioAtividade: "2026-12", transmitir: false, retificadora: false });
  assert.equal("folhasSalario" in d.declaracao, false);
  // fev/2027 (3º mês): janela da CGSN 190 = 12 antecedentes ao mês anterior, filtrada pelo início -> só 2026-12.
  assert.deepEqual(mesesDoFatorR("2027-02", "2026-12").meses, ["2026-12"]);
});

test("QA: atividade 29 sem folha e com meses a enviar continua exigindo a folha", () => {
  assert.throws(
    () => dadosDeclaracao({ cnpj: CNPJ, pa: "2026-09", receitaExterna: 5000, idAtividade: 29, inicioAtividade: "2026-09", transmitir: false, retificadora: false }),
    /fator r/,
  );
  assert.throws(
    () => dadosDeclaracao({ cnpj: CNPJ, pa: "2026-09", receitaExterna: 5000, idAtividade: 29, transmitir: false, retificadora: false }),
    /fator r/,
  );
});

test("QA: início depois do PA ou inválido é recusado na declaração", () => {
  assert.throws(() => dadosDeclaracao({ cnpj: CNPJ, pa: "2026-09", receitaExterna: 5000, idAtividade: 29, folhasSalario: {}, inicioAtividade: "2026-10", transmitir: false, retificadora: false }));
  assert.throws(() => dadosDeclaracao({ cnpj: CNPJ, pa: "2026-09", receitaExterna: 5000, idAtividade: 29, folhasSalario: {}, inicioAtividade: "2026-13", transmitir: false, retificadora: false }));
});

test("QA: atividade 30 (não sujeita) e receita zero não mandam folhasSalario", () => {
  const d30 = dadosDeclaracao({ cnpj: CNPJ, pa: "2026-09", receitaExterna: 5000, idAtividade: 30, inicioAtividade: "2026-09", transmitir: false, retificadora: false });
  assert.equal("folhasSalario" in d30.declaracao, false);
  const d0 = dadosDeclaracao({ cnpj: CNPJ, pa: "2026-09", receitaExterna: 0, idAtividade: 29, inicioAtividade: "2026-09", transmitir: false, retificadora: false });
  assert.equal("folhasSalario" in d0.declaracao, false);
});
