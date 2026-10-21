import { test } from "node:test";
import assert from "node:assert/strict";
import { diaUtil, diaUtilAnterior, diaUtilSeguinte, feriadosNacionais, pascoa, somarDias } from "./feriados.ts";

test("Páscoa de anos conhecidos", () => {
  assert.equal(pascoa(2023), "2023-04-09");
  assert.equal(pascoa(2024), "2024-03-31");
  assert.equal(pascoa(2025), "2025-04-20");
  assert.equal(pascoa(2026), "2026-04-05");
  assert.equal(pascoa(2027), "2027-03-28");
  assert.equal(pascoa(2028), "2028-04-16");
});

test("feriados bancários nacionais de 2026 (fixos e móveis)", () => {
  assert.deepEqual(
    feriadosNacionais(2026).map((f) => f.data),
    [
      "2026-01-01",
      "2026-02-16", // Carnaval segunda
      "2026-02-17", // Carnaval terça
      "2026-04-03", // Sexta-feira da Paixão
      "2026-04-21",
      "2026-05-01",
      "2026-06-04", // Corpus Christi
      "2026-09-07",
      "2026-10-12",
      "2026-11-02",
      "2026-11-15",
      "2026-11-20",
      "2026-12-25",
    ],
  );
  assert.equal(feriadosNacionais(2025).find((f) => f.nome === "Sexta-feira da Paixão")?.data, "2025-04-18");
  assert.equal(feriadosNacionais(2025).find((f) => f.nome === "Corpus Christi")?.data, "2025-06-19");
  // Consciência Negra só a partir de 2024.
  assert.equal(feriadosNacionais(2023).some((f) => f.data === "2023-11-20"), false);
  assert.equal(feriadosNacionais(2024).some((f) => f.data === "2024-11-20"), true);
});

test("dia útil: fim de semana, feriado nacional e feriado extra", () => {
  assert.equal(diaUtil("2026-10-16"), true); // sexta
  assert.equal(diaUtil("2026-10-17"), false); // sábado
  assert.equal(diaUtil("2026-10-18"), false); // domingo
  assert.equal(diaUtil("2026-10-12"), false); // Aparecida, segunda
  assert.equal(diaUtil("2026-02-17"), false); // Carnaval
  assert.equal(diaUtil("2026-10-28"), true);
  assert.equal(diaUtil("2026-10-28", ["2026-10-28"]), false);
});

test("dia útil anterior e seguinte, atravessando mês e ano", () => {
  assert.equal(diaUtilAnterior("2026-10-16"), "2026-10-16");
  assert.equal(diaUtilAnterior("2026-10-18"), "2026-10-16");
  assert.equal(diaUtilAnterior("2027-01-01"), "2026-12-31");
  assert.equal(diaUtilSeguinte("2026-10-17"), "2026-10-19");
  assert.equal(diaUtilSeguinte("2026-12-31"), "2026-12-31");
  assert.equal(diaUtilSeguinte("2026-02-14"), "2026-02-18"); // sábado antes do Carnaval -> quarta de Cinzas
  assert.equal(somarDias("2028-02-28", 1), "2028-02-29");
  assert.equal(somarDias("2026-03-01", -1), "2026-02-28");
});
