// QA (Parte 2, acesso em camadas): casos de borda do portão contra o Postgres de teste.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { empresaUsuarios } from "@/banco/esquema";
import { entrarComGoogle, resolverSessao } from "@/lib/autenticacao/servico";
import { SemAcessoEmpresa } from "@/lib/empresas/acesso";
import { abrirPortao, exigirAcessoAoConteudo, SemPlanoAtivo } from "@/lib/empresas/portao";
import { criarEmpresa, definirEmpresaAtiva, empresasDaSessao } from "@/lib/empresas/servico";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps, perfil } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const PERFIS = { ana: perfil("ana@a.com", "sub-ana"), beto: perfil("beto@b.com", "sub-beto") };
const CNPJ_A = "12345678000195";
const CNPJ_B = "98765432000198";

async function requisicao(cookie: string, opcoes: Parameters<typeof abrirPortao>[3] = {}) {
  const sessao = (await resolverSessao(deps(t.banco), cookie))!;
  const { empresas, empresaAtiva } = await empresasDaSessao(t.banco, sessao);
  return { sessao, empresas, empresaAtiva, portao: await abrirPortao(t.banco, sessao.usuario, empresaAtiva, opcoes) };
}

describe("QA: portão, casos de borda", () => {
  it("falha ao conferir o plano não libera o conteúdo (erro sobe, não vira 'liberado')", async () => {
    const ana = await entrarComGoogle(deps(t.banco, PERFIS), "ana");
    await criarEmpresa(t.banco, ana.usuario, { cnpj: CNPJ_A, razaoSocial: "Alfa" });
    await assert.rejects(
      requisicao(ana.cookie, {
        planoAtivo: () => {
          throw new Error("banco de planos fora do ar");
        },
      }),
      /banco de planos fora do ar/,
    );
  });

  it("server action com id vazio, nulo ou malformado: SemAcessoEmpresa (não SemPlanoAtivo) e o plano nem é perguntado", async () => {
    const ana = await entrarComGoogle(deps(t.banco, PERFIS), "ana");
    let perguntou = 0;
    const opcoes = { planoAtivo: () => (perguntou++, true) };
    for (const id of ["", null, undefined, "abc", "'; drop table empresas; --"]) {
      await assert.rejects(exigirAcessoAoConteudo(t.banco, ana.usuario, id, opcoes), (e) => e instanceof SemAcessoEmpresa && !(e instanceof SemPlanoAtivo));
    }
    assert.equal(perguntou, 0);
  });

  it("MEMBRO (não dono) também passa pelo portão: liberado com papel MEMBRO; sem plano, fechado", async () => {
    const ana = await entrarComGoogle(deps(t.banco, PERFIS), "ana");
    const beto = await entrarComGoogle(deps(t.banco, PERFIS), "beto");
    const a = await criarEmpresa(t.banco, ana.usuario, { cnpj: CNPJ_A, razaoSocial: "Alfa" });
    await t.banco.insert(empresaUsuarios).values({ empresaId: a.id, usuarioId: beto.usuario.id, papel: "MEMBRO" });
    const r = await requisicao(beto.cookie);
    assert.equal(r.portao.estado, "liberado");
    assert.equal(r.portao.estado === "liberado" && r.portao.acesso.papel, "MEMBRO");
    assert.equal((await requisicao(beto.cookie, { planoAtivo: () => false })).portao.estado, "sem-plano");
  });

  it("vínculo da empresa ativa retirado com outra empresa na conta: a próxima requisição libera a outra, nunca a retirada", async () => {
    const ana = await entrarComGoogle(deps(t.banco, PERFIS), "ana");
    const a = await criarEmpresa(t.banco, ana.usuario, { cnpj: CNPJ_A, razaoSocial: "Alfa" });
    const b = await criarEmpresa(t.banco, ana.usuario, { cnpj: CNPJ_B, razaoSocial: "Beta" });
    const r0 = await requisicao(ana.cookie);
    await definirEmpresaAtiva(t.banco, r0.sessao, b.id);
    await t.banco.delete(empresaUsuarios).where(and(eq(empresaUsuarios.empresaId, b.id), eq(empresaUsuarios.usuarioId, ana.usuario.id)));
    const r = await requisicao(ana.cookie);
    assert.equal(r.empresaAtiva?.id, a.id);
    assert.equal(r.portao.estado === "liberado" && r.portao.acesso.empresaId, a.id);
  });

  it("perde a última empresa: volta ao estado vazio 'sem-empresa'", async () => {
    const ana = await entrarComGoogle(deps(t.banco, PERFIS), "ana");
    const a = await criarEmpresa(t.banco, ana.usuario, { cnpj: CNPJ_A, razaoSocial: "Alfa" });
    assert.equal((await requisicao(ana.cookie)).portao.estado, "liberado");
    await t.banco.delete(empresaUsuarios).where(eq(empresaUsuarios.empresaId, a.id));
    assert.deepEqual((await requisicao(ana.cookie)).portao, { estado: "sem-empresa" });
  });

  it("dois usuários, cada um com a sua: o portão de um nunca libera a empresa do outro", async () => {
    const ana = await entrarComGoogle(deps(t.banco, PERFIS), "ana");
    const beto = await entrarComGoogle(deps(t.banco, PERFIS), "beto");
    const a = await criarEmpresa(t.banco, ana.usuario, { cnpj: CNPJ_A, razaoSocial: "Alfa" });
    const b = await criarEmpresa(t.banco, beto.usuario, { cnpj: CNPJ_B, razaoSocial: "Beta" });
    const ra = await requisicao(ana.cookie);
    const rb = await requisicao(beto.cookie);
    assert.equal(ra.portao.estado === "liberado" && ra.portao.acesso.empresaId, a.id);
    assert.equal(rb.portao.estado === "liberado" && rb.portao.acesso.empresaId, b.id);
    await assert.rejects(definirEmpresaAtiva(t.banco, ra.sessao, b.id), SemAcessoEmpresa);
    assert.equal((await requisicao(ana.cookie)).empresaAtiva?.id, a.id);
  });
});
