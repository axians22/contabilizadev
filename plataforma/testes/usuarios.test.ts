// Gestão de usuários contra o Postgres de teste (casos do horizons usuarios.service.spec e papeis.e2e.spec).
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { sessoes, usuarios, type Papel } from "@/banco/esquema";
import { entrarComGoogle, resolverSessao } from "@/lib/autenticacao/servico";
import { listarUsuarios, mudarAtivo, mudarPapel, POR_PAGINA } from "@/lib/usuarios/servico";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps, perfil } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
// ADMIN_EMAILS dos testes: conta(..., "ADMIN") põe o e-mail aqui, e as funções de gestão recebem esta lista.
let ADMINS: string[] = [];
beforeEach(async () => {
  ADMINS = [];
  await t.limpar();
});
after(() => t.fechar());

async function conta(email: string, papel: Papel = "COMMON_USER") {
  if (papel === "ADMIN") ADMINS.push(email);
  const r = await entrarComGoogle(deps(t.banco, { x: perfil(email, `sub-${email}`) }, { adminEmails: papel === "ADMIN" ? [email] : [] }), "x");
  if (papel === "MANAGER") await t.banco.update(usuarios).set({ papel }).where(eq(usuarios.id, r.usuario.id));
  return { ...r, ator: { id: r.usuario.id, papel } };
}

describe("mudarPapel: ninguém vira admin pela tela", () => {
  it("recusa promover a ADMIN, mesmo vindo de um ADMIN", async () => {
    const adm = await conta("adm@x.dev", "ADMIN");
    const c = await conta("c@x.dev");
    await assert.rejects(mudarPapel(t.banco, adm.ator, c.usuario.id, "ADMIN", ADMINS), (e: { status: number }) => e.status === 400);
  });
  it("recusa rebaixar outro ADMIN (quem decide é ADMIN_EMAILS)", async () => {
    const adm = await conta("adm@x.dev", "ADMIN");
    const adm2 = await conta("adm2@x.dev", "ADMIN");
    await assert.rejects(mudarPapel(t.banco, adm.ator, adm2.usuario.id, "COMMON_USER", ADMINS), /ADMIN_EMAILS/);
  });
  it("o admin não muda o próprio papel", async () => {
    const adm = await conta("adm@x.dev", "ADMIN");
    await assert.rejects(mudarPapel(t.banco, adm.ator, adm.usuario.id, "MANAGER", ADMINS), (e: { status: number }) => e.status === 403);
  });
  it("MANAGER e COMMON_USER não mudam papel de ninguém", async () => {
    const g = await conta("g@x.dev", "MANAGER");
    const c = await conta("c@x.dev");
    const c2 = await conta("c2@x.dev");
    await assert.rejects(mudarPapel(t.banco, g.ator, c.usuario.id, "MANAGER", ADMINS), (e: { status: number }) => e.status === 403);
    await assert.rejects(mudarPapel(t.banco, c.ator, c2.usuario.id, "MANAGER", ADMINS), (e: { status: number }) => e.status === 403);
  });
  it("o admin promove a MANAGER e rebaixa, e isso grava", async () => {
    const adm = await conta("adm@x.dev", "ADMIN");
    const c = await conta("c@x.dev");
    assert.equal((await mudarPapel(t.banco, adm.ator, c.usuario.id, "MANAGER", ADMINS)).papel, "MANAGER");
    assert.equal((await resolverSessao(deps(t.banco), c.cookie))?.usuario.papel, "MANAGER");
    assert.equal((await mudarPapel(t.banco, adm.ator, c.usuario.id, "COMMON_USER", ADMINS)).papel, "COMMON_USER");
  });
  it("alvo inexistente ou id malformado dá 404", async () => {
    const adm = await conta("adm@x.dev", "ADMIN");
    await assert.rejects(mudarPapel(t.banco, adm.ator, "00000000-0000-4000-8000-000000000000", "MANAGER", ADMINS), (e: { status: number }) => e.status === 404);
    await assert.rejects(mudarPapel(t.banco, adm.ator, "abc", "MANAGER", ADMINS), (e: { status: number }) => e.status === 404);
  });
});

describe("mudarAtivo", () => {
  it("ninguém se desativa", async () => {
    const adm = await conta("adm@x.dev", "ADMIN");
    await assert.rejects(mudarAtivo(t.banco, adm.ator, adm.usuario.id, false, ADMINS), /própria conta/);
  });
  it("manager não desativa admin nem outro manager", async () => {
    const g = await conta("g@x.dev", "MANAGER");
    const g2 = await conta("g2@x.dev", "MANAGER");
    const adm = await conta("adm@x.dev", "ADMIN");
    await assert.rejects(mudarAtivo(t.banco, g.ator, adm.usuario.id, false, ADMINS), (e: { status: number }) => e.status === 403);
    await assert.rejects(mudarAtivo(t.banco, g.ator, g2.usuario.id, false, ADMINS), (e: { status: number }) => e.status === 403);
  });
  it("manager desativa um comum: registra quem foi e derruba as sessões na hora", async () => {
    const g = await conta("g@x.dev", "MANAGER");
    const c = await conta("c@x.dev");
    const linha = await mudarAtivo(t.banco, g.ator, c.usuario.id, false, ADMINS);
    assert.equal(linha.ativo, false);
    assert.equal(linha.desativadoPor, "g");
    assert.ok(linha.desativadoEm);
    assert.equal(await resolverSessao(deps(t.banco), c.cookie), null);
    assert.equal((await t.banco.select().from(sessoes).where(eq(sessoes.usuarioId, c.usuario.id))).length, 0);
  });
  it("reativar limpa o registro de desativação", async () => {
    const adm = await conta("adm@x.dev", "ADMIN");
    const c = await conta("c@x.dev");
    await mudarAtivo(t.banco, adm.ator, c.usuario.id, false, ADMINS);
    const linha = await mudarAtivo(t.banco, adm.ator, c.usuario.id, true, ADMINS);
    assert.equal(linha.ativo, true);
    assert.equal(linha.desativadoEm, null);
    assert.equal(linha.desativadoPor, null);
  });
  it("COMMON_USER não desativa ninguém", async () => {
    const c = await conta("c@x.dev");
    const c2 = await conta("c2@x.dev");
    await assert.rejects(mudarAtivo(t.banco, c.ator, c2.usuario.id, false, ADMINS), (e: { status: number }) => e.status === 403);
  });
});

describe("listarUsuarios", () => {
  it("COMMON_USER não vê a lista", async () => {
    const c = await conta("c@x.dev");
    await assert.rejects(listarUsuarios(t.banco, c.ator, "", 1, ADMINS), (e: { status: number }) => e.status === 403);
  });
  it("a lista concorda com o que as ações permitem", async () => {
    const g = await conta("g@x.dev", "MANAGER");
    await conta("adm@x.dev", "ADMIN");
    await conta("c@x.dev");
    const lista = await listarUsuarios(t.banco, g.ator, "", 1, ADMINS);
    const por = Object.fromEntries(lista.itens.map((u) => [u.email, u]));
    assert.equal(por["g@x.dev"].euMesmo, true);
    assert.equal(por["g@x.dev"].podeMudarAtivo, false);
    assert.equal(por["adm@x.dev"].podeMudarAtivo, false);
    assert.equal(por["c@x.dev"].podeMudarAtivo, true);
    assert.ok(lista.itens.every((u) => !u.podeMudarPapel));
  });
  it("não devolve mais que o necessário (nada de sessão, provedor ou empresa)", async () => {
    const adm = await conta("adm@x.dev", "ADMIN");
    const [u] = (await listarUsuarios(t.banco, adm.ator, "", 1, ADMINS)).itens;
    assert.deepEqual(Object.keys(u).sort(), ["ativo", "criadoEm", "desativadoEm", "desativadoPor", "email", "euMesmo", "id", "nome", "papel", "podeMudarAtivo", "podeMudarPapel", "ultimoLoginEm"]);
    assert.equal(typeof u.criadoEm, "string");
  });
  it("busca por e-mail ou nome, sem diferenciar maiúscula; espaço vale como sem busca", async () => {
    const adm = await conta("adm@x.dev", "ADMIN");
    await conta("maria@x.dev");
    assert.deepEqual((await listarUsuarios(t.banco, adm.ator, "MARIA", 1, ADMINS)).itens.map((u) => u.email), ["maria@x.dev"]);
    assert.equal((await listarUsuarios(t.banco, adm.ator, "   ", 1, ADMINS)).total, 2);
    assert.equal((await listarUsuarios(t.banco, adm.ator, "ninguem", 1, ADMINS)).total, 0);
  });
  it("% e _ na busca são texto, não curinga", async () => {
    const adm = await conta("adm@x.dev", "ADMIN");
    assert.equal((await listarUsuarios(t.banco, adm.ator, "%", 1, ADMINS)).total, 0);
    assert.equal((await listarUsuarios(t.banco, adm.ator, "_", 1, ADMINS)).total, 0);
  });
  it("paginação: página além do fim vai para a última; 0 ou negativa vira 1; sem repetir", async () => {
    const adm = await conta("adm@x.dev", "ADMIN");
    for (let i = 0; i < POR_PAGINA + 2; i++) await conta(`u${i}@x.dev`);
    const p1 = await listarUsuarios(t.banco, adm.ator, "", 0, ADMINS);
    const p2 = await listarUsuarios(t.banco, adm.ator, "", 99, ADMINS);
    assert.equal(p1.pagina, 1);
    assert.equal(p2.pagina, 2);
    assert.equal(p1.itens.length + p2.itens.length, POR_PAGINA + 3);
    const ids = new Set([...p1.itens, ...p2.itens].map((u) => u.id));
    assert.equal(ids.size, POR_PAGINA + 3);
  });
  it("o papel mostrado e as regras usam ADMIN_EMAILS, não a coluna: quem saiu da lista vira comum na hora", async () => {
    const g = await conta("g@x.dev", "MANAGER");
    const ex = await conta("ex@x.dev", "ADMIN"); // coluna ADMIN
    ADMINS = []; // saiu da lista e ainda não fez nenhuma requisição
    const [linha] = (await listarUsuarios(t.banco, g.ator, "ex@", 1, ADMINS)).itens;
    assert.equal(linha.papel, "COMMON_USER");
    assert.equal(linha.podeMudarAtivo, true);
    assert.equal((await mudarAtivo(t.banco, g.ator, ex.usuario.id, false, ADMINS)).ativo, false);
  });
  it("quem entrou na lista já é ADMIN para a gestão, mesmo com a coluna atrasada", async () => {
    const adm = await conta("adm@x.dev", "ADMIN");
    const novo = await conta("novo@x.dev"); // coluna COMMON_USER
    ADMINS.push("novo@x.dev");
    const [linha] = (await listarUsuarios(t.banco, adm.ator, "novo@", 1, ADMINS)).itens;
    assert.equal(linha.papel, "ADMIN");
    assert.equal(linha.podeMudarPapel, false);
    await assert.rejects(mudarPapel(t.banco, adm.ator, novo.usuario.id, "MANAGER", ADMINS), /ADMIN_EMAILS/);
  });
});
