// QA: o papel que vale (ADMIN_EMAILS) tem que ser o mesmo na sessão e nas regras de gestão (lista e ações),
// inclusive para quem ainda não fez nenhuma requisição depois da mudança em ADMIN_EMAILS.
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

describe("QA: papel efetivo nas regras de gestão", () => {
  it("e-mail que entrou em ADMIN_EMAILS (sem requisição ainda) não pode ser desativado por um MANAGER", async () => {
    const lista = ["chefe@x.dev"];
    const chefe = await entrar("chefe@x.dev"); // entrou antes de estar na lista: coluna COMMON_USER
    const g = await entrar("g@x.dev");
    await t.banco.update(usuarios).set({ papel: "MANAGER" }).where(eq(usuarios.id, g.usuario.id));
    // A lista muda (deploy com ADMIN_EMAILS novo). O manager faz a requisição dele; o chefe ainda não fez nenhuma.
    const sessaoG = await resolverSessao(deps(t.banco, {}, { adminEmails: lista }), g.cookie);
    assert.equal(sessaoG?.usuario.papel, "MANAGER");
    const ator = { id: sessaoG!.usuario.id, papel: sessaoG!.usuario.papel };
    const { itens } = await listarUsuarios(t.banco, ator, "chefe", 1, lista);
    // O chefe é ADMIN (está na lista): o manager não deveria poder desativá-lo.
    assert.equal(itens[0].podeMudarAtivo, false, "a lista oferece ao MANAGER desativar quem é ADMIN por ADMIN_EMAILS");
    await assert.rejects(mudarAtivo(t.banco, ator, chefe.usuario.id, false, lista), (e: { status: number }) => e.status === 403);
  });

  it("quem saiu de ADMIN_EMAILS (sem requisição ainda) pode ser rebaixado/gerido pelo ADMIN atual", async () => {
    const antigo = await entrar("antigo@x.dev", ["antigo@x.dev"]); // coluna ADMIN
    const adm = await entrar("adm@x.dev", ["adm@x.dev"]);
    const listaNova = ["adm@x.dev"];
    const sessaoAdm = await resolverSessao(deps(t.banco, {}, { adminEmails: listaNova }), adm.cookie);
    const ator = { id: sessaoAdm!.usuario.id, papel: sessaoAdm!.usuario.papel };
    const { itens } = await listarUsuarios(t.banco, ator, "antigo", 1, listaNova);
    assert.equal(itens[0].papel, "COMMON_USER", "a lista mostra ADMIN para quem já saiu de ADMIN_EMAILS");
    const linha = await mudarPapel(t.banco, ator, antigo.usuario.id, "MANAGER", listaNova);
    assert.equal(linha.papel, "MANAGER");
  });
});
