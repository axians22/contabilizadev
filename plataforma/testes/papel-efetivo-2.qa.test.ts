// QA (ciclo 4): bordas do papel efetivo na gestão.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { usuarios } from "@/banco/esquema";
import { entrarComGoogle, resolverSessao } from "@/lib/autenticacao/servico";
import { listarUsuarios, mudarAtivo, mudarPapel } from "@/lib/usuarios/servico";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps, perfil } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const entrar = (email: string, adminEmails: string[] = []) =>
  entrarComGoogle(deps(t.banco, { x: perfil(email, `sub-${email}`) }, { adminEmails }), "x");

describe("QA ciclo 4: papel efetivo", () => {
  it("ADMIN não rebaixa quem entrou na lista com coluna MANAGER atrasada", async () => {
    const lista = ["adm@x.dev", "novo@x.dev"];
    const novo = await entrar("novo@x.dev");
    await t.banco.update(usuarios).set({ papel: "MANAGER" }).where(eq(usuarios.id, novo.usuario.id));
    const adm = await entrar("adm@x.dev", lista);
    const s = await resolverSessao(deps(t.banco, {}, { adminEmails: lista }), adm.cookie);
    const ator = { id: s!.usuario.id, papel: s!.usuario.papel };
    const { itens } = await listarUsuarios(t.banco, ator, "novo", 1, lista);
    assert.equal(itens[0].papel, "ADMIN");
    assert.equal(itens[0].podeMudarPapel, false);
    assert.equal(itens[0].podeMudarAtivo, true);
    await assert.rejects(mudarPapel(t.banco, ator, novo.usuario.id, "COMMON_USER", lista), (e: { status: number }) => e.status === 400);
    const [col] = await t.banco.select({ papel: usuarios.papel }).from(usuarios).where(eq(usuarios.id, novo.usuario.id));
    assert.equal(col.papel, "MANAGER", "a coluna não pode ter sido alterada");
  });

  it("ex-ADMIN (coluna ADMIN) fora da lista pode ser desativado por MANAGER e some a sessão", async () => {
    const antigo = await entrar("antigo@x.dev", ["antigo@x.dev"]);
    const g = await entrar("g@x.dev");
    await t.banco.update(usuarios).set({ papel: "MANAGER" }).where(eq(usuarios.id, g.usuario.id));
    const ator = { id: g.usuario.id, papel: "MANAGER" as const };
    const linha = await mudarAtivo(t.banco, ator, antigo.usuario.id, false, []);
    assert.equal(linha.ativo, false);
    assert.equal(linha.papel, "COMMON_USER");
    assert.equal(await resolverSessao(deps(t.banco, {}, { adminEmails: [] }), antigo.cookie), null);
  });
});
