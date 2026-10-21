// QA (ciclo 5): conta desativada recusada sem gravar nada, nos dois caminhos de entrada.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { sessoes, usuarios } from "@/banco/esquema";
import { entrarComGoogle, entrarSemLogin } from "@/lib/autenticacao/servico";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps, perfil } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const linha = async (email: string) =>
  (await t.banco.select({ ultimoLoginEm: usuarios.ultimoLoginEm, nome: usuarios.nome, avatarUrl: usuarios.avatarUrl, papel: usuarios.papel }).from(usuarios).where(eq(usuarios.email, email)))[0];

describe("QA: conta desativada", () => {
  it("Google: e-mail em caixa diferente, desativada, não grava nada nem abre sessão", async () => {
    const r = await entrarComGoogle(deps(t.banco, { a: perfil("ana@empresa.com", "sub-ana") }), "a");
    await t.banco.delete(sessoes);
    await t.banco.update(usuarios).set({ ativo: false }).where(eq(usuarios.id, r.usuario.id));
    const antes = await linha("ana@empresa.com");
    const depois1h = () => new Date(Date.now() + 3_600_000);
    await assert.rejects(
      entrarComGoogle(deps(t.banco, { b: perfil(" ANA@Empresa.com ", "sub-ana", { nome: "X", foto: "https://f/x" }) }, { adminEmails: ["ana@empresa.com"] }, depois1h), "b"),
      /desativada/,
    );
    assert.deepEqual(await linha("ana@empresa.com"), antes);
    assert.equal((await t.banco.select().from(sessoes)).length, 0);
  });

  it("login desligado: conta de desenvolvimento desativada não grava 'último login'", async () => {
    const d = deps(t.banco, {}, { loginDesligado: true });
    await entrarSemLogin(d);
    const email = d.config.emailDesenvolvimento;
    await t.banco.delete(sessoes);
    await t.banco.update(usuarios).set({ ativo: false }).where(eq(usuarios.email, email));
    const antes = await linha(email);
    await assert.rejects(entrarSemLogin({ ...d, agora: () => new Date(Date.now() + 3_600_000) }), /desativada/);
    assert.deepEqual(await linha(email), antes);
    assert.equal((await t.banco.select().from(sessoes)).length, 0);
  });
});
