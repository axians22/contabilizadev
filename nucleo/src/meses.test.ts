import { test } from "node:test";
import assert from "node:assert/strict";
import { dataValida, fimDoMes, mesValido, somarMeses, vencimento, vencimentoDarf, vencimentoDas } from "./meses.ts";

test("soma meses atravessando o ano", () => {
  assert.equal(somarMeses("2026-11", 2), "2027-01");
  assert.equal(somarMeses("2026-01", -1), "2025-12");
});

test("valida o formato AAAA-MM", () => {
  assert.equal(mesValido("2026-09"), true);
  assert.equal(mesValido("2026-13"), false);
  assert.equal(mesValido("26-09"), false);
});

test("datas: validade e fim do mês", () => {
  assert.equal(dataValida("2026-02-29"), false);
  assert.equal(dataValida("2028-02-29"), true);
  assert.equal(dataValida("2026-1-05"), false);
  assert.equal(fimDoMes("2026-02-10"), "2026-02-28");
  assert.equal(fimDoMes("2026-12-31"), "2026-12-31");
});

test("vencimento no dia 20 do mês seguinte quando é dia útil (caso real: DAS de 09/2026 vence em 20/10/2026)", () => {
  assert.equal(vencimento("2026-09"), "2026-10-20"); // terça
  assert.equal(vencimento("2026-12"), "2027-01-20"); // virada de ano, quarta
});

test("vencimento antecipado para o dia útil anterior: sábado, domingo e feriados", () => {
  assert.equal(vencimento("2026-05"), "2026-06-19"); // 20/06/2026 é sábado -> sexta 19
  assert.equal(vencimento("2026-08"), "2026-09-18"); // 20/09/2026 é domingo -> sexta 18
  // 20/04/2025 é domingo de Páscoa; 19 é sábado e 18 é Sexta-feira da Paixão -> quinta 17.
  assert.equal(vencimento("2025-03"), "2025-04-17");
  // 20/11 é feriado nacional desde 2024 (Lei 14.759/2023): DAS de 10/2026 vence na quinta 19/11/2026.
  assert.equal(vencimento("2026-10"), "2026-11-19");
  assert.equal(vencimento("2024-10"), "2024-11-19"); // 20/11/2024, quarta
  assert.equal(vencimento("2023-10"), "2023-11-20"); // antes da lei, segunda normal
  // 20/02/2023 foi segunda de Carnaval: 19 domingo, 18 sábado -> sexta 17.
  assert.equal(vencimento("2023-01"), "2023-02-17");
});

test("vencimento com feriado local informado por parâmetro", () => {
  assert.equal(vencimento("2026-09", ["2026-10-20"]), "2026-10-19");
  assert.equal(vencimento("2026-09", ["2026-10-20", "2026-10-19"]), "2026-10-16"); // e pula o fim de semana
  assert.equal(vencimento("2026-09", ["2026-10-21"]), "2026-10-20"); // feriado depois do dia 20 não muda nada
});

test("DAS prorrogado para o dia útil seguinte (Resolução CGSN 140/2018, art. 40, § 3º); DARF do INSS antecipado", () => {
  assert.equal(vencimentoDas("2026-09"), "2026-10-20"); // dia útil: igual nos dois
  assert.equal(vencimentoDarf("2026-09"), "2026-10-20");
  assert.equal(vencimentoDas("2026-08"), "2026-09-21"); // 20/09/2026 é domingo -> segunda 21
  assert.equal(vencimentoDarf("2026-08"), "2026-09-18"); // -> sexta 18
  assert.equal(vencimentoDas("2026-05"), "2026-06-22"); // 20/06/2026 é sábado -> segunda 22
  assert.equal(vencimentoDas("2025-03"), "2025-04-22"); // Páscoa 20/04 e Tiradentes 21/04 -> terça 22
  assert.equal(vencimentoDas("2025-10"), "2025-11-21"); // Consciência Negra 20/11/2025 -> sexta 21
  assert.equal(vencimentoDas("2026-09", ["2026-10-20"]), "2026-10-21"); // feriado local no dia 20
  assert.equal(vencimento("2026-08", [], "DAS"), "2026-09-21");
  assert.equal(vencimento("2026-08", [], "INSS"), "2026-09-18");
  assert.equal(vencimento("2026-08"), "2026-09-18"); // sem tipo: o do DARF
});
