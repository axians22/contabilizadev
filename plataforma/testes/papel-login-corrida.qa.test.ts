// QA: o papel mudado na tela entre a leitura prévia e o upsert de entrarComGoogle não pode ser desfeito pelo login.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { usuarios } from "@/banco/esquema";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { antesDoInsert, deps, perfil } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const ANA = { "tok-ana": perfil("ana@empresa.com", "sub-ana") };

describe("QA: papel mudado durante o login", () => {
  it("rebaixamento MANAGER -> COMMON_USER feito entre a leitura e o upsert não é desfeito", async () => {
    const r = await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    await t.banco.update(usuarios).set({ papel: "MANAGER" }).where(eq(usuarios.id, r.usuario.id));
    const banco = antesDoInsert(t.banco, usuarios, () => t.banco.update(usuarios).set({ papel: "COMMON_USER" }).where(eq(usuarios.id, r.usuario.id)));
    const r2 = await entrarComGoogle(deps(banco, ANA), "tok-ana");
    const [linha] = await t.banco.select({ papel: usuarios.papel }).from(usuarios).where(eq(usuarios.id, r.usuario.id));
    assert.equal(linha.papel, "COMMON_USER", "o login regravou o papel antigo por cima do rebaixamento");
    assert.equal(r2.usuario.papel, "COMMON_USER");
  });

  it("promoção COMMON_USER -> MANAGER feita entre a leitura e o upsert não é desfeita", async () => {
    const r = await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    const banco = antesDoInsert(t.banco, usuarios, () => t.banco.update(usuarios).set({ papel: "MANAGER" }).where(eq(usuarios.id, r.usuario.id)));
    await entrarComGoogle(deps(banco, ANA), "tok-ana");
    const [linha] = await t.banco.select({ papel: usuarios.papel }).from(usuarios).where(eq(usuarios.id, r.usuario.id));
    assert.equal(linha.papel, "MANAGER", "o login regravou o papel antigo por cima da promoção");
  });
});
