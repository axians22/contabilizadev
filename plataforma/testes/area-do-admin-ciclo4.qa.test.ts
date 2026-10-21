// QA (Parte 2, área do administrador, ciclo 4): avisosDoAdminPara de verdade (não só o texto do arquivo): quem não é
// ADMIN recebe lista vazia sem tocar no banco nem na plataforma.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

// "server-only" recusa ser carregado fora do Next: um módulo vazio no lugar, só neste teste.
const exigir = createRequire(import.meta.url);
const so = exigir.resolve("server-only");
exigir.cache[so] = { id: so, filename: so, loaded: true, exports: {} } as never;

describe("QA ciclo 4: avisosDoAdminPara por papel", async () => {
  process.env.DATABASE_URL = "postgres://ninguem:nada@127.0.0.1:1/nao_existe_teste";
  const { avisosDoAdminPara } = await import("@/lib/plataforma/servidor");
  for (const papel of ["COMMON_USER", "MANAGER"] as const)
    it(`${papel}: lista vazia, sem consultar nada`, async () => {
      assert.deepEqual(await avisosDoAdminPara(papel, new Date("2026-10-21T12:00:00-03:00")), []);
    });
  it("um papel desconhecido também fica de fora (fechado por padrão)", async () => {
    assert.deepEqual(await avisosDoAdminPara("QUALQUER" as never, new Date()), []);
  });
});
