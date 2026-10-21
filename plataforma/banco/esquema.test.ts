// Toda tabela de dado de cliente tem empresa_id (not null, referência a empresas). Tabela nova fora da lista da
// plataforma sem isso faz este teste falhar.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as esquema from "./esquema";

const tabelas: PgTable[] = (Object.values(esquema) as unknown[]).filter((v): v is PgTable => v instanceof PgTable);

describe("esquema: cada dado preso à sua empresa", () => {
  it("acha as tabelas (senão o teste mede o vazio)", () => {
    assert.ok(tabelas.length >= 5);
  });
  it("as tabelas da plataforma existem no esquema", () => {
    const nomes = tabelas.map((t) => getTableConfig(t).name);
    for (const n of esquema.TABELAS_DA_PLATAFORMA) assert.ok(nomes.includes(n), n);
  });
  it("toda tabela fora da lista da plataforma tem empresa_id not null com referência a empresas", () => {
    for (const tabela of tabelas) {
      const config = getTableConfig(tabela);
      if (esquema.TABELAS_DA_PLATAFORMA.includes(config.name)) continue;
      const coluna = config.columns.find((c) => c.name === "empresa_id");
      assert.ok(coluna, `${config.name} sem empresa_id`);
      assert.ok(coluna.notNull, `${config.name}.empresa_id aceita nulo`);
      const referencia = config.foreignKeys.some((fk) => {
        const r = fk.reference();
        return r.columns.some((c) => c.name === "empresa_id") && getTableConfig(r.foreignTable).name === "empresas";
      });
      assert.ok(referencia, `${config.name}.empresa_id sem referência a empresas`);
    }
  });
});
