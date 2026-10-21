// Isolamento entre empresas contra o Postgres de teste: um usuário não lê nem altera dado de empresa de outro.
// A tabela "notas_de_teste" existe só no banco de teste e faz o papel de qualquer tabela de dado de cliente
// (com empresa_id), para provar a regra de lib/empresas/acesso.ts sem inventar tabela no esquema do site.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq, sql } from "drizzle-orm";
import { pgTable, serial, text, uuid } from "drizzle-orm/pg-core";
import { empresas, empresaUsuarios, sessoes, usuarios } from "@/banco/esquema";
import { entrarComGoogle, resolverSessao } from "@/lib/autenticacao/servico";
import { dadosDaEmpresa, daEmpresa, exigirAcessoEmpresa, SemAcessoEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { criarEmpresa, definirEmpresaAtiva, ErroDeEmpresa, escolherAtiva, listarEmpresasDoUsuario } from "@/lib/empresas/servico";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps, perfil } from "./apoio";

const notas = pgTable("notas_de_teste", {
  id: serial("id").primaryKey(),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  texto: text("texto").notNull(),
});

let t: BancoDeTeste;
before(async () => {
  t = await prepararBancoDeTeste();
  await t.banco.execute(sql`create table if not exists notas_de_teste (
    id serial primary key, empresa_id uuid not null references empresas(id) on delete cascade, texto text not null)`);
});
beforeEach(async () => {
  await t.limpar();
  await t.banco.execute(sql`truncate notas_de_teste`);
});
after(() => t.fechar());

const PERFIS = { ana: perfil("ana@a.com", "sub-ana"), beto: perfil("beto@b.com", "sub-beto"), caio: perfil("caio@c.com", "sub-caio") };

// Ana é dona da Empresa A; Beto é dono da Empresa B; Caio é membro da A.
async function cenario() {
  const ana = await entrarComGoogle(deps(t.banco, PERFIS), "ana");
  const beto = await entrarComGoogle(deps(t.banco, PERFIS), "beto");
  const caio = await entrarComGoogle(deps(t.banco, PERFIS), "caio");
  const a = await criarEmpresa(t.banco, ana.usuario, { cnpj: "11.222.333/0001-81", razaoSocial: "Empresa A Ltda" });
  const b = await criarEmpresa(t.banco, beto.usuario, { cnpj: "45.723.174/0001-10", razaoSocial: "Empresa B Ltda" });
  await t.banco.insert(empresaUsuarios).values({ empresaId: a.id, usuarioId: caio.usuario.id, papel: "MEMBRO" });
  const acessoA = await exigirAcessoEmpresa(t.banco, ana.usuario, a.id);
  const acessoB = await exigirAcessoEmpresa(t.banco, beto.usuario, b.id);
  await dadosDaEmpresa(t.banco, acessoA).inserir(notas, { texto: "nota da A" });
  await dadosDaEmpresa(t.banco, acessoB).inserir(notas, { texto: "nota da B" });
  return { ana, beto, caio, a, b, acessoA, acessoB };
}

describe("exigirAcessoEmpresa", () => {
  it("dono e membro da empresa têm acesso, com o papel certo", async () => {
    const { ana, caio, a } = await cenario();
    assert.equal((await exigirAcessoEmpresa(t.banco, ana.usuario, a.id)).papel, "DONO");
    assert.equal((await exigirAcessoEmpresa(t.banco, caio.usuario, a.id)).papel, "MEMBRO");
  });
  it("usuário sem vínculo não acessa a empresa de outro", async () => {
    const { ana, b } = await cenario();
    await assert.rejects(exigirAcessoEmpresa(t.banco, ana.usuario, b.id), SemAcessoEmpresa);
  });
  it("empresa inexistente e empresa de outro dão o mesmo erro (não revela o que existe)", async () => {
    const { ana, b } = await cenario();
    const deOutro = await exigirAcessoEmpresa(t.banco, ana.usuario, b.id).catch((e: Error) => e.message);
    const inexistente = await exigirAcessoEmpresa(t.banco, ana.usuario, "00000000-0000-4000-8000-000000000000").catch((e: Error) => e.message);
    assert.equal(deOutro, inexistente);
  });
  it("id malformado, vazio ou nulo é só 'não encontrada' (sem erro do Postgres)", async () => {
    const { ana } = await cenario();
    for (const id of ["1 or 1=1", "", null, undefined, "'; drop table empresas; --"]) {
      await assert.rejects(exigirAcessoEmpresa(t.banco, ana.usuario, id), SemAcessoEmpresa, String(id));
    }
  });
  it("ação de dono: o membro é recusado", async () => {
    const { ana, caio, a } = await cenario();
    await exigirAcessoEmpresa(t.banco, ana.usuario, a.id, { papel: "DONO" });
    await assert.rejects(exigirAcessoEmpresa(t.banco, caio.usuario, a.id, { papel: "DONO" }), /Só o dono/);
  });
  it("ADMIN da plataforma sem vínculo também não lê a empresa", async () => {
    const { b } = await cenario();
    const admin = await entrarComGoogle(deps(t.banco, { adm: perfil("adm@x.dev", "sub-adm") }, { adminEmails: ["adm@x.dev"] }), "adm");
    assert.equal(admin.usuario.papel, "ADMIN");
    await assert.rejects(exigirAcessoEmpresa(t.banco, admin.usuario, b.id), SemAcessoEmpresa);
  });
  it("tirar o vínculo corta o acesso na hora", async () => {
    const { caio, a } = await cenario();
    await t.banco.delete(empresaUsuarios).where(eq(empresaUsuarios.usuarioId, caio.usuario.id));
    await assert.rejects(exigirAcessoEmpresa(t.banco, caio.usuario, a.id), SemAcessoEmpresa);
  });
  it("um acesso montado à mão (sem passar por exigirAcessoEmpresa) é recusado", async () => {
    const { b } = await cenario();
    const falso = { empresaId: b.id, usuarioId: "x", papel: "DONO" } as unknown as AcessoEmpresa;
    assert.throws(() => dadosDaEmpresa(t.banco, falso), SemAcessoEmpresa);
  });
  it("um acesso copiado com spread (mesmo com a empresa trocada) é recusado, e o original não muda", async () => {
    const { acessoA, b } = await cenario();
    const copiaIgual = { ...acessoA } as AcessoEmpresa;
    const copiaTrocada = { ...acessoA, empresaId: b.id } as AcessoEmpresa;
    assert.throws(() => dadosDaEmpresa(t.banco, copiaIgual), SemAcessoEmpresa);
    assert.throws(() => dadosDaEmpresa(t.banco, copiaTrocada), SemAcessoEmpresa);
    assert.throws(() => daEmpresa(copiaTrocada, notas), SemAcessoEmpresa);
    assert.throws(() => Object.assign(acessoA, { empresaId: b.id }), TypeError);
    assert.deepEqual((await dadosDaEmpresa(t.banco, acessoA).listar(notas)).map((n) => n.texto), ["nota da A"]);
  });
});

describe("dadosDaEmpresa: um usuário não lê nem altera dado de outra empresa", () => {
  it("listar devolve só as linhas da própria empresa", async () => {
    const { acessoA, acessoB } = await cenario();
    assert.deepEqual((await dadosDaEmpresa(t.banco, acessoA).listar(notas)).map((n) => n.texto), ["nota da A"]);
    assert.deepEqual((await dadosDaEmpresa(t.banco, acessoB).listar(notas)).map((n) => n.texto), ["nota da B"]);
  });
  it("buscar pelo id de uma linha de outra empresa não acha nada", async () => {
    const { acessoA, acessoB } = await cenario();
    const [daB] = await dadosDaEmpresa(t.banco, acessoB).listar(notas);
    assert.deepEqual(await dadosDaEmpresa(t.banco, acessoA).listar(notas, eq(notas.id, daB.id)), []);
  });
  it("alterar uma linha de outra empresa não altera nada", async () => {
    const { acessoA, acessoB } = await cenario();
    const [daB] = await dadosDaEmpresa(t.banco, acessoB).listar(notas);
    const alteradas = await dadosDaEmpresa(t.banco, acessoA).alterar(notas, { texto: "invadido" }, eq(notas.id, daB.id));
    assert.equal(alteradas.length, 0);
    assert.equal((await dadosDaEmpresa(t.banco, acessoB).listar(notas))[0].texto, "nota da B");
  });
  it("alterar não consegue mudar o empresa_id (mover a linha para outra empresa)", async () => {
    const { acessoA, acessoB, b } = await cenario();
    const [daA] = await dadosDaEmpresa(t.banco, acessoA).listar(notas);
    const valores = { texto: "movida", empresaId: b.id } as { texto: string };
    await dadosDaEmpresa(t.banco, acessoA).alterar(notas, valores, eq(notas.id, daA.id));
    assert.deepEqual((await dadosDaEmpresa(t.banco, acessoA).listar(notas)).map((n) => n.texto), ["movida"]);
    assert.deepEqual((await dadosDaEmpresa(t.banco, acessoB).listar(notas)).map((n) => n.texto), ["nota da B"]);
  });
  it("apagar uma linha de outra empresa não apaga nada", async () => {
    const { acessoA, acessoB } = await cenario();
    const [daB] = await dadosDaEmpresa(t.banco, acessoB).listar(notas);
    assert.equal((await dadosDaEmpresa(t.banco, acessoA).apagar(notas, eq(notas.id, daB.id))).length, 0);
    assert.equal((await dadosDaEmpresa(t.banco, acessoB).listar(notas)).length, 1);
  });
  it("inserir com o empresa_id de outra empresa grava na empresa do acesso", async () => {
    const { acessoA, acessoB, a, b } = await cenario();
    const valores = { texto: "tentativa", empresaId: b.id } as { texto: string };
    const [nova] = await dadosDaEmpresa(t.banco, acessoA).inserir(notas, valores);
    assert.equal(nova.empresaId, a.id);
    assert.equal((await dadosDaEmpresa(t.banco, acessoB).listar(notas)).length, 1);
  });
  it("daEmpresa sempre inclui o filtro da empresa, mesmo com condição extra", async () => {
    const { acessoA } = await cenario();
    const linhas = await t.banco.select().from(notas).where(daEmpresa(acessoA, notas, sql`true`));
    assert.deepEqual(linhas.map((n) => n.texto), ["nota da A"]);
  });
});

describe("empresas do usuário e empresa ativa", () => {
  it("cada um lista só as empresas com vínculo", async () => {
    const { ana, beto, caio } = await cenario();
    assert.deepEqual((await listarEmpresasDoUsuario(t.banco, ana.usuario)).map((e) => e.razaoSocial), ["Empresa A Ltda"]);
    assert.deepEqual((await listarEmpresasDoUsuario(t.banco, beto.usuario)).map((e) => e.razaoSocial), ["Empresa B Ltda"]);
    assert.deepEqual((await listarEmpresasDoUsuario(t.banco, caio.usuario)).map((e) => [e.razaoSocial, e.papel]), [["Empresa A Ltda", "MEMBRO"]]);
  });
  it("usuário sem empresa: lista vazia e nenhuma ativa", async () => {
    const r = await entrarComGoogle(deps(t.banco, PERFIS), "ana");
    assert.deepEqual(await listarEmpresasDoUsuario(t.banco, r.usuario), []);
    assert.equal(escolherAtiva([], null), null);
  });
  it("definir a empresa ativa com uma empresa de outro é recusado e não grava", async () => {
    const { ana, b } = await cenario();
    const sessao = (await resolverSessao(deps(t.banco), ana.cookie))!;
    await assert.rejects(definirEmpresaAtiva(t.banco, sessao, b.id), SemAcessoEmpresa);
    const [linha] = await t.banco.select().from(sessoes).where(eq(sessoes.id, sessao.sessaoId));
    assert.equal(linha.empresaAtivaId, null);
  });
  it("definir a empresa ativa com vínculo grava na sessão", async () => {
    const { caio, a } = await cenario();
    const sessao = (await resolverSessao(deps(t.banco), caio.cookie))!;
    await definirEmpresaAtiva(t.banco, sessao, a.id);
    assert.equal((await resolverSessao(deps(t.banco), caio.cookie))?.empresaAtivaId, a.id);
  });
  it("a sessão que aponta para empresa sem vínculo cai para a primeira empresa do usuário", async () => {
    const { ana, b } = await cenario();
    const sessao = (await resolverSessao(deps(t.banco), ana.cookie))!;
    // Gravado à força (ex.: vínculo removido depois da escolha).
    await t.banco.update(sessoes).set({ empresaAtivaId: b.id }).where(eq(sessoes.id, sessao.sessaoId));
    const empresasDaAna = await listarEmpresasDoUsuario(t.banco, ana.usuario);
    assert.equal(escolherAtiva(empresasDaAna, b.id)?.razaoSocial, "Empresa A Ltda");
  });
  it("criarEmpresa normaliza o CNPJ e liga quem criou como DONO", async () => {
    const r = await entrarComGoogle(deps(t.banco, PERFIS), "ana");
    const e = await criarEmpresa(t.banco, r.usuario, { cnpj: "12.ABC.345/01DE-35", razaoSocial: "  Alfa Ltda " });
    assert.equal(e.cnpj, "12ABC34501DE35");
    assert.equal(e.razaoSocial, "Alfa Ltda");
    assert.equal((await listarEmpresasDoUsuario(t.banco, r.usuario))[0].papel, "DONO");
  });
  it("CNPJ já cadastrado por outro não é adotado por quem digitou", async () => {
    const { beto } = await cenario();
    await assert.rejects(criarEmpresa(t.banco, beto.usuario, { cnpj: "11222333000181", razaoSocial: "Cópia" }), ErroDeEmpresa);
    assert.deepEqual((await listarEmpresasDoUsuario(t.banco, beto.usuario)).map((e) => e.razaoSocial), ["Empresa B Ltda"]);
  });
  it("CNPJ inválido ou razão social vazia são recusados", async () => {
    const r = await entrarComGoogle(deps(t.banco, PERFIS), "ana");
    await assert.rejects(criarEmpresa(t.banco, r.usuario, { cnpj: "123", razaoSocial: "X" }), /CNPJ inválido/);
    await assert.rejects(criarEmpresa(t.banco, r.usuario, { cnpj: "11222333000181", razaoSocial: "  " }), /razão social/);
  });
  it("o banco também recusa CNPJ fora do formato (constraint)", async () => {
    await assert.rejects(t.banco.insert(empresas).values({ cnpj: "11.222.333/0001-81", razaoSocial: "X" }));
  });
  it("apagar o usuário apaga os vínculos e as sessões dele, não a empresa", async () => {
    const { caio, a } = await cenario();
    await t.banco.delete(usuarios).where(eq(usuarios.id, caio.usuario.id));
    assert.equal((await t.banco.select().from(empresaUsuarios).where(eq(empresaUsuarios.usuarioId, caio.usuario.id))).length, 0);
    assert.equal((await t.banco.select().from(empresas).where(eq(empresas.id, a.id))).length, 1);
  });
});
