// O banco dos testes nunca é o de desenvolvimento.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { nomeDoBanco, prepararBancoDeTeste, urlDoBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";

describe("banco de teste", () => {
  it("deriva <nome>_teste da DATABASE_URL", () => {
    const url = urlDoBancoDeTeste({ DATABASE_URL: "postgres://u:s@localhost:5433/contabilizadev" });
    assert.equal(nomeDoBanco(url), "contabilizadev_teste");
  });
  it("DATABASE_URL_TESTE tem precedência", () => {
    assert.equal(urlDoBancoDeTeste({ DATABASE_URL: "postgres://a/b", DATABASE_URL_TESTE: "postgres://a/c_teste" }), "postgres://a/c_teste");
  });
  it("recusa banco que não termina em _teste", async () => {
    const antes = process.env.DATABASE_URL_TESTE;
    process.env.DATABASE_URL_TESTE = "postgres://contabilizadev:x@localhost:5433/contabilizadev";
    try {
      await assert.rejects(prepararBancoDeTeste(), /recusado/);
    } finally {
      if (antes === undefined) delete process.env.DATABASE_URL_TESTE;
      else process.env.DATABASE_URL_TESTE = antes;
    }
  });

  describe("conectado", () => {
    let t: BancoDeTeste;
    before(async () => (t = await prepararBancoDeTeste()));
    after(() => t.fechar());
    it("está conectado a um banco _teste, com as migrações aplicadas", async () => {
      const [{ banco }] = (await t.banco.execute(sql`select current_database() as banco`)) as unknown as { banco: string }[];
      assert.match(banco, /_teste$/);
      const tabelas = (await t.banco.execute(sql`select table_name from information_schema.tables where table_schema = 'public'`)) as unknown as { table_name: string }[];
      for (const n of ["usuarios", "empresas", "empresa_usuarios", "sessoes"]) assert.ok(tabelas.some((x) => x.table_name === n), n);
    });
  });
});
