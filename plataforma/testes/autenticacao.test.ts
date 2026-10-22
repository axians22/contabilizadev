// Login e sessão contra o Postgres de teste (casos do horizons auth.service.banco.spec e fail-closed.e2e.spec).
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { sessoes, usuarios } from "@/banco/esquema";
import { assinarToken, hashDoToken, lerTokenAssinado, novoToken, VALIDADE_DA_SESSAO_MS } from "@/lib/autenticacao/cookie";
import { encerrarSessao, entrarComGoogle, entrarSemLogin, ErroDeLogin, resolverSessao } from "@/lib/autenticacao/servico";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { antesDoInsert, deps, perfil } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const ANA = { "tok-ana": perfil("ana@empresa.com", "sub-ana", { nome: "Ana Souza", foto: "https://foto/ana" }) };

describe("entrarComGoogle", () => {
  it("cria a conta como COMMON_USER e abre uma sessão", async () => {
    const r = await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    assert.equal(r.usuario.email, "ana@empresa.com");
    assert.equal(r.usuario.nome, "Ana Souza");
    assert.equal(r.usuario.papel, "COMMON_USER");
    const [linha] = await t.banco.select().from(usuarios).where(eq(usuarios.id, r.usuario.id));
    assert.equal(linha.provedor, "GOOGLE");
    assert.equal(linha.provedorId, "sub-ana");
    assert.ok(linha.ultimoLoginEm);
    assert.ok(await resolverSessao(deps(t.banco), r.cookie));
  });

  it("o banco guarda só o hash do token, e o cookie é assinado", async () => {
    const r = await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    const token = lerTokenAssinado(r.cookie, deps(t.banco).config.segredo)!;
    const linhas = await t.banco.select().from(sessoes);
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].tokenHash, hashDoToken(token));
    assert.ok(!JSON.stringify(linhas).includes(token));
  });

  it("a sessão vale 30 dias", async () => {
    const agora = new Date("2026-10-16T12:00:00Z");
    const r = await entrarComGoogle(deps(t.banco, ANA, {}, () => agora), "tok-ana");
    assert.equal(r.expiraEm.getTime(), agora.getTime() + VALIDADE_DA_SESSAO_MS);
  });

  it("entrar de novo não cria outra conta (upsert por e-mail, normalizado)", async () => {
    await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    await entrarComGoogle(deps(t.banco, { x: perfil("ANA@Empresa.com", "sub-ana") }), "x");
    assert.equal((await t.banco.select().from(usuarios)).length, 1);
  });

  it("e-mail não verificado é recusado (inclusive sem a informação)", async () => {
    const perfis = { falso: perfil("a@x.dev", "1", { emailVerificado: false }), sem: perfil("b@x.dev", "2", { emailVerificado: undefined }) };
    await assert.rejects(entrarComGoogle(deps(t.banco, perfis), "falso"), /Confirme o e-mail/);
    await assert.rejects(entrarComGoogle(deps(t.banco, perfis), "sem"), /Confirme o e-mail/);
    assert.equal((await t.banco.select().from(usuarios)).length, 0);
  });

  it("token recusado pelo Google (assinatura, audience de outro app) não entra", async () => {
    await assert.rejects(entrarComGoogle(deps(t.banco, ANA), "token-de-outro-app"), (e: Error) => e instanceof ErroDeLogin && /validar sua conta/.test(e.message));
  });

  it("token vazio e Google não configurado são recusados", async () => {
    await assert.rejects(entrarComGoogle(deps(t.banco, ANA), "  "), /ausente/);
    await assert.rejects(entrarComGoogle({ ...deps(t.banco), verificarGoogle: null }, "tok-ana"), /não está configurado/);
  });

  it("perfil sem e-mail ou sem sub é recusado", async () => {
    const perfis = { a: { sub: "1", emailVerificado: true }, b: { email: "b@x.dev", emailVerificado: true } };
    await assert.rejects(entrarComGoogle(deps(t.banco, perfis), "a"), /e-mail válido/);
    await assert.rejects(entrarComGoogle(deps(t.banco, perfis), "b"), /e-mail válido/);
  });

  it("outra conta Google com o mesmo e-mail não herda a conta", async () => {
    await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    await assert.rejects(entrarComGoogle(deps(t.banco, { x: perfil("ana@empresa.com", "sub-outro") }), "x"), /não é a mesma/);
  });

  it("conta desativada não entra", async () => {
    const r = await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    await t.banco.update(usuarios).set({ ativo: false }).where(eq(usuarios.id, r.usuario.id));
    const linha = async () =>
      (await t.banco.select({ ultimoLoginEm: usuarios.ultimoLoginEm, nome: usuarios.nome, avatarUrl: usuarios.avatarUrl }).from(usuarios).where(eq(usuarios.id, r.usuario.id)))[0];
    const antes = await linha();
    const outroPerfil = { "tok-ana": perfil("ana@empresa.com", "sub-ana", { nome: "Outro Nome", foto: "https://foto/outra" }) };
    const umaHoraDepois = () => new Date(Date.now() + 3_600_000);
    await assert.rejects(entrarComGoogle(deps(t.banco, outroPerfil, {}, umaHoraDepois), "tok-ana"), /desativada/);
    // A tentativa recusada não grava nada: nem "último login", nem nome ou foto.
    assert.deepEqual(await linha(), antes);
  });

  it("conta desativada entre a leitura e o upsert: recusa sem gravar o login nem abrir sessão", async () => {
    const r = await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    const linha = async () =>
      (await t.banco.select({ ultimoLoginEm: usuarios.ultimoLoginEm, nome: usuarios.nome, ativo: usuarios.ativo }).from(usuarios).where(eq(usuarios.id, r.usuario.id)))[0];
    const antes = await linha();
    const sessoesAntes = (await t.banco.select().from(sessoes)).length;
    // O banco desativa a conta logo antes do upsert rodar: é a janela entre o select e o insert.
    const banco = antesDoInsert(t.banco, usuarios, () => t.banco.update(usuarios).set({ ativo: false }).where(eq(usuarios.id, r.usuario.id)));
    const outroPerfil = { "tok-ana": perfil("ana@empresa.com", "sub-ana", { nome: "Outro Nome" }) };
    const umaHoraDepois = () => new Date(Date.now() + 3_600_000);
    await assert.rejects(entrarComGoogle(deps(banco, outroPerfil, {}, umaHoraDepois), "tok-ana"), (e: Error) => e instanceof ErroDeLogin && /desativada/.test(e.message));
    assert.deepEqual(await linha(), { ...antes, ativo: false });
    assert.equal((await t.banco.select().from(sessoes)).length, sessoesAntes);
  });

  it("outra conta Google grava o e-mail entre a leitura e o upsert: recusa sem tomar a conta nem abrir sessão", async () => {
    // Conta que existe mas ainda não está presa a um sub (ex.: criada antes de entrar pelo Google).
    const [criada] = await t.banco.insert(usuarios).values({ email: "ana@empresa.com", nome: "Ana", provedor: "DEV" }).returning({ id: usuarios.id });
    const linha = async () =>
      (await t.banco.select({ provedor: usuarios.provedor, provedorId: usuarios.provedorId, ultimoLoginEm: usuarios.ultimoLoginEm, nome: usuarios.nome }).from(usuarios).where(eq(usuarios.id, criada.id)))[0];
    // Entre o select e o upsert, outra conta Google prende o e-mail a ela.
    const banco = antesDoInsert(t.banco, usuarios, () =>
      t.banco.update(usuarios).set({ provedor: "GOOGLE", provedorId: "sub-outro" }).where(eq(usuarios.id, criada.id)),
    );
    await assert.rejects(entrarComGoogle(deps(banco, ANA), "tok-ana"), (e: Error) => e instanceof ErroDeLogin && /não é a mesma/.test(e.message));
    assert.deepEqual(await linha(), { provedor: "GOOGLE", provedorId: "sub-outro", ultimoLoginEm: null, nome: "Ana" });
    assert.equal((await t.banco.select().from(sessoes)).length, 0);
  });

  it("duas contas Google com o mesmo e-mail entrando juntas pela primeira vez: só a primeira fica com a conta", async () => {
    for (let i = 0; i < 20; i++) {
      await t.limpar();
      const perfis = { a: perfil("ana@empresa.com", "sub-a"), b: perfil("ana@empresa.com", "sub-b") };
      const resultados = await Promise.allSettled([entrarComGoogle(deps(t.banco, perfis), "a"), entrarComGoogle(deps(t.banco, perfis), "b")]);
      const ok = resultados.filter((r) => r.status === "fulfilled");
      const recusas = resultados.filter((r) => r.status === "rejected");
      assert.equal(ok.length, 1);
      assert.ok(recusas[0].reason instanceof ErroDeLogin && /não é a mesma/.test(recusas[0].reason.message));
      const vencedor = resultados[0].status === "fulfilled" ? "sub-a" : "sub-b";
      const [conta] = await t.banco.select({ provedorId: usuarios.provedorId }).from(usuarios).where(eq(usuarios.email, "ana@empresa.com"));
      assert.equal(conta.provedorId, vencedor);
      assert.equal((await t.banco.select().from(sessoes)).length, 1);
    }
  });

  it("ADMIN só por ADMIN_EMAILS: entra admin, sai da lista e volta a comum", async () => {
    const admin = await entrarComGoogle(deps(t.banco, ANA, { adminEmails: ["ana@empresa.com"] }), "tok-ana");
    assert.equal(admin.usuario.papel, "ADMIN");
    const depois = await entrarComGoogle(deps(t.banco, ANA, { adminEmails: [] }), "tok-ana");
    assert.equal(depois.usuario.papel, "COMMON_USER");
  });

  it("ADMIN gravado direto no banco não sobrevive ao login", async () => {
    const r = await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    await t.banco.update(usuarios).set({ papel: "ADMIN" }).where(eq(usuarios.id, r.usuario.id));
    assert.equal((await entrarComGoogle(deps(t.banco, ANA), "tok-ana")).usuario.papel, "COMMON_USER");
  });

  it("MANAGER promovido pela tela continua MANAGER no login seguinte", async () => {
    const r = await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    await t.banco.update(usuarios).set({ papel: "MANAGER" }).where(eq(usuarios.id, r.usuario.id));
    assert.equal((await entrarComGoogle(deps(t.banco, ANA), "tok-ana")).usuario.papel, "MANAGER");
  });
});

describe("resolverSessao: ADMIN_EMAILS reavaliada a cada requisição, na mesma sessão", () => {
  const papelNaColuna = async (id: string) => (await t.banco.select({ papel: usuarios.papel }).from(usuarios).where(eq(usuarios.id, id)))[0].papel;

  it("sair de ADMIN_EMAILS tira o ADMIN na requisição seguinte e corrige a coluna", async () => {
    const r = await entrarComGoogle(deps(t.banco, ANA, { adminEmails: ["ana@empresa.com"] }), "tok-ana");
    assert.equal((await resolverSessao(deps(t.banco, {}, { adminEmails: ["ana@empresa.com"] }), r.cookie))?.usuario.papel, "ADMIN");
    assert.equal((await resolverSessao(deps(t.banco, {}, { adminEmails: [] }), r.cookie))?.usuario.papel, "COMMON_USER");
    assert.equal(await papelNaColuna(r.usuario.id), "COMMON_USER");
  });

  it("ADMIN gravado direto no banco não vale nem na sessão aberta", async () => {
    const r = await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    await t.banco.update(usuarios).set({ papel: "ADMIN" }).where(eq(usuarios.id, r.usuario.id));
    assert.equal((await resolverSessao(deps(t.banco, {}, { adminEmails: [] }), r.cookie))?.usuario.papel, "COMMON_USER");
    assert.equal(await papelNaColuna(r.usuario.id), "COMMON_USER");
  });

  it("MANAGER continua MANAGER (e a coluna não é tocada)", async () => {
    const r = await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    await t.banco.update(usuarios).set({ papel: "MANAGER" }).where(eq(usuarios.id, r.usuario.id));
    assert.equal((await resolverSessao(deps(t.banco, {}, { adminEmails: [] }), r.cookie))?.usuario.papel, "MANAGER");
    assert.equal(await papelNaColuna(r.usuario.id), "MANAGER");
  });

  it("entrar em ADMIN_EMAILS dá ADMIN na requisição seguinte e grava na coluna", async () => {
    const r = await entrarComGoogle(deps(t.banco, ANA, { adminEmails: [] }), "tok-ana");
    assert.equal((await resolverSessao(deps(t.banco, {}, { adminEmails: [] }), r.cookie))?.usuario.papel, "COMMON_USER");
    assert.equal((await resolverSessao(deps(t.banco, {}, { adminEmails: ["ana@empresa.com"] }), r.cookie))?.usuario.papel, "ADMIN");
    assert.equal(await papelNaColuna(r.usuario.id), "ADMIN");
  });
});

describe("resolverSessao: o cookie é uma alegação, o banco decide", () => {
  it("devolve o usuário do banco (papel atual, não o do login)", async () => {
    const r = await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    await t.banco.update(usuarios).set({ papel: "MANAGER" }).where(eq(usuarios.id, r.usuario.id));
    assert.equal((await resolverSessao(deps(t.banco), r.cookie))?.usuario.papel, "MANAGER");
  });

  it("conta desativada derruba a sessão na requisição seguinte, com o mesmo cookie", async () => {
    const r = await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    await t.banco.update(usuarios).set({ ativo: false }).where(eq(usuarios.id, r.usuario.id));
    assert.equal(await resolverSessao(deps(t.banco), r.cookie), null);
  });

  it("usuário apagado do banco: sessão inválida", async () => {
    const r = await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    await t.banco.delete(usuarios).where(eq(usuarios.id, r.usuario.id));
    assert.equal(await resolverSessao(deps(t.banco), r.cookie), null);
  });

  it("cookie assinado com outro segredo é recusado", async () => {
    const r = await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    const token = lerTokenAssinado(r.cookie, deps(t.banco).config.segredo)!;
    assert.equal(await resolverSessao(deps(t.banco), assinarToken(token, "outro-segredo-com-mais-de-32-caracteres!")), null);
  });

  it("token com assinatura válida mas sem sessão no banco é recusado", async () => {
    assert.equal(await resolverSessao(deps(t.banco), assinarToken(novoToken(), deps(t.banco).config.segredo)), null);
  });

  it("sessão vencida é recusada", async () => {
    const agora = new Date("2026-10-16T12:00:00Z");
    const r = await entrarComGoogle(deps(t.banco, ANA, {}, () => agora), "tok-ana");
    const depois = new Date(agora.getTime() + VALIDADE_DA_SESSAO_MS + 1000);
    assert.equal(await resolverSessao(deps(t.banco, {}, {}, () => depois), r.cookie), null);
    const antes = new Date(agora.getTime() + VALIDADE_DA_SESSAO_MS - 1000);
    assert.ok(await resolverSessao(deps(t.banco, {}, {}, () => antes), r.cookie));
  });

  it("sem cookie ou cookie malformado: sem sessão", async () => {
    for (const v of [undefined, null, "", "lixo", "a.b"]) assert.equal(await resolverSessao(deps(t.banco), v), null);
  });

  it("o usuário resolvido não carrega mais que o necessário", async () => {
    const r = await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    const s = await resolverSessao(deps(t.banco), r.cookie);
    // Dos dados pessoais, só se faltam (nunca CPF, nascimento, telefone ou endereço na sessão).
    assert.deepEqual(Object.keys(s!.usuario).sort(), ["avatarUrl", "dadosPendentes", "email", "id", "nome", "papel"]);
    assert.equal(s!.usuario.dadosPendentes, true);
  });
});

describe("encerrarSessao", () => {
  it("sair apaga a sessão: o mesmo cookie (até copiado) não serve mais", async () => {
    const r = await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    const outra = await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    await encerrarSessao(deps(t.banco), r.cookie);
    assert.equal(await resolverSessao(deps(t.banco), r.cookie), null);
    // Só aquela sessão: a de outro navegador continua.
    assert.ok(await resolverSessao(deps(t.banco), outra.cookie));
  });
  it("cookie inválido não apaga nada", async () => {
    await entrarComGoogle(deps(t.banco, ANA), "tok-ana");
    await encerrarSessao(deps(t.banco), "lixo.assinatura");
    assert.equal((await t.banco.select().from(sessoes)).length, 1);
  });
});

describe("login desligado (desenvolvimento)", () => {
  it("só funciona com loginDesligado ligado", async () => {
    await assert.rejects(entrarSemLogin(deps(t.banco)), /só funciona em desenvolvimento/);
  });
  it("cria a conta de desenvolvimento uma vez só e não mexe em quem já existe", async () => {
    const d = deps(t.banco, {}, { loginDesligado: true });
    const a = await entrarSemLogin(d);
    await t.banco.update(usuarios).set({ nome: "Nome mudado" }).where(eq(usuarios.id, a.usuario.id));
    const b = await entrarSemLogin(d);
    assert.equal(a.usuario.id, b.usuario.id);
    assert.equal(b.usuario.nome, "Nome mudado");
    assert.equal((await t.banco.select().from(usuarios)).length, 1);
  });
  it("conta de desenvolvimento desativada não entra, não abre sessão e não grava último login", async () => {
    const a = await entrarSemLogin(deps(t.banco, {}, { loginDesligado: true }));
    await t.banco.update(usuarios).set({ ativo: false }).where(eq(usuarios.id, a.usuario.id));
    const ultimo = async () => (await t.banco.select({ u: usuarios.ultimoLoginEm }).from(usuarios).where(eq(usuarios.id, a.usuario.id)))[0].u;
    const antes = await ultimo();
    const sessoesAntes = (await t.banco.select().from(sessoes)).length;
    const umaHoraDepois = () => new Date(Date.now() + 3_600_000);
    await assert.rejects(entrarSemLogin(deps(t.banco, {}, { loginDesligado: true }, umaHoraDepois)), /desativada/);
    assert.deepEqual(await ultimo(), antes);
    assert.equal((await t.banco.select().from(sessoes)).length, sessoesAntes);
  });
  it("conta de desenvolvimento em ADMIN_EMAILS nasce ADMIN", async () => {
    const r = await entrarSemLogin(deps(t.banco, {}, { loginDesligado: true, adminEmails: ["dev@contabilizadev.local"] }));
    assert.equal(r.usuario.papel, "ADMIN");
  });
  it("religado o login, a sessão da conta de desenvolvimento deixa de valer", async () => {
    const r = await entrarSemLogin(deps(t.banco, {}, { loginDesligado: true }));
    assert.ok(await resolverSessao(deps(t.banco, {}, { loginDesligado: true }), r.cookie));
    assert.equal(await resolverSessao(deps(t.banco, {}, { loginDesligado: false }), r.cookie), null);
  });
});
