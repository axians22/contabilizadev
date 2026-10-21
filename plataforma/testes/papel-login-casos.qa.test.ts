// QA: o papel gravado pelo upsert de entrarComGoogle segue papelPara em todos os casos de conflito.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { usuarios } from "@/banco/esquema";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps, perfil } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const ANA = { "tok-ana": perfil("Ana@Empresa.com", "sub-ana") };
const papelDe = async (id: string) => (await t.banco.select({ papel: usuarios.papel }).from(usuarios).where(eq(usuarios.id, id)))[0].papel;

describe("QA: papel no upsert do login", () => {
  it("ADMIN gravado na coluna sem estar na lista cai para COMMON_USER no login", async () => {
    const r = await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    await t.banco.update(usuarios).set({ papel: "ADMIN" }).where(eq(usuarios.id, r.usuario.id));
    const r2 = await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    assert.equal(r2.usuario.papel, "COMMON_USER");
    assert.equal(await papelDe(r.usuario.id), "COMMON_USER");
  });

  it("conta existente que entrou na lista vira ADMIN no login (e-mail com maiúsculas)", async () => {
    const r = await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    const r2 = await entrarComGoogle(deps(t.banco, ANA, { adminEmails: ["ana@empresa.com"] }), "tok-ana");
    assert.equal(r2.usuario.papel, "ADMIN");
    assert.equal(await papelDe(r.usuario.id), "ADMIN");
  });

  it("MANAGER na lista de admins vira ADMIN; ao sair da lista, cai para COMMON_USER", async () => {
    const r = await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    await t.banco.update(usuarios).set({ papel: "MANAGER" }).where(eq(usuarios.id, r.usuario.id));
    assert.equal((await entrarComGoogle(deps(t.banco, ANA, { adminEmails: ["ana@empresa.com"] }), "tok-ana")).usuario.papel, "ADMIN");
    assert.equal((await entrarComGoogle(deps(t.banco, ANA), "tok-ana")).usuario.papel, "COMMON_USER");
  });

  it("MANAGER continua MANAGER em logins seguidos e simultâneos", async () => {
    const r = await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    await t.banco.update(usuarios).set({ papel: "MANAGER" }).where(eq(usuarios.id, r.usuario.id));
    const rs = await Promise.all(Array.from({ length: 10 }, () => entrarComGoogle(deps(t.banco, ANA), "tok-ana")));
    for (const x of rs) assert.equal(x.usuario.papel, "MANAGER");
    assert.equal(await papelDe(r.usuario.id), "MANAGER");
    assert.equal((await t.banco.select().from(usuarios)).length, 1);
  });

  it("primeiro login simultâneo de conta nova cria uma linha só, COMMON_USER", async () => {
    const rs = await Promise.all(Array.from({ length: 10 }, () => entrarComGoogle(deps(t.banco, ANA), "tok-ana")));
    assert.equal(new Set(rs.map((x) => x.usuario.id)).size, 1);
    for (const x of rs) assert.equal(x.usuario.papel, "COMMON_USER");
  });
});
