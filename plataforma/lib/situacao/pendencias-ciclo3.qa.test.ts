// QA (Parte 8, passo 22b, ciclo 3): o fim do cabeçalho de página sai sem levar débitos de verdade.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { debitosComGuia, explicarPendencias } from "./pendencias";

describe("QA ciclo 3: quebra de página", () => {
  it("CNPJ completo e nome na mesma linha que 'CNPJ:' também sai; débito de INSS de outra página continua INSS", () => {
    const texto = [
      "Pendência - Débito (SIEF)",
      "1082-01 - CP-SEGURADOS",
      "07/2026",
      "20/08/2026",
      "Página: 2 /",
      "3",
      "CNPJ: 98.765.432/0001-98 - ALFA SIMPLES DAS LTDA",
      "300,00",
      "300,00",
      "DEVEDOR",
    ].join("\n");
    const [p] = explicarPendencias(texto);
    assert.equal(p.debitos.length, 1);
    assert.equal(p.debitos[0].tributo, "INSS");
    assert.equal(p.debitos[0].saldo, 300);
    assert.doesNotMatch(p.debitos[0].linha, /ALFA|98\.765/);
    assert.deepEqual(debitosComGuia([p]), [{ tributo: "INSS", pa: "2026-07" }]);
  });

  it("sem quebra de página, nenhuma linha de débito é descartada", () => {
    const texto = ["Pendência - Débito (SIMPLES NACIONAL)", "07/2026", "20/08/2026", "900,00", "900,00", "08/2026", "21/09/2026", "1.170,84", "1.170,84"].join("\n");
    const [p] = explicarPendencias(texto);
    assert.deepEqual(
      p.debitos.map((d) => [d.pa, d.vencimento, d.saldo]),
      [
        ["2026-07", "2026-08-20", 900],
        ["2026-08", "2026-09-21", 1170.84],
      ],
    );
  });
});
