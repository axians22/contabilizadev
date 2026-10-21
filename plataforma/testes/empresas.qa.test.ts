// QA: isolamento entre empresas, casos além dos do engenheiro.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { pgTable, serial, text, uuid } from "drizzle-orm/pg-core";
import { empresas } from "@/banco/esquema";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { dadosDaEmpresa, exigirAcessoEmpresa, SemAcessoEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { criarEmpresa, ErroDeEmpresa } from "@/lib/empresas/servico";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps, perfil } from "./apoio";

const notas = pgTable("notas_de_teste_qa", {
  id: serial("id").primaryKey(),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  texto: text("texto").notNull(),
});

let t: BancoDeTeste;
before(async () => {
  t = await prepararBancoDeTeste();
  await t.banco.execute(sql`create table if not exists notas_de_teste_qa (
    id serial primary key, empresa_id uuid not null references empresas(id) on delete cascade, texto text not null)`);
});
beforeEach(async () => {
  await t.limpar();
  await t.banco.execute(sql`truncate notas_de_teste_qa`);
});
after(() => t.fechar());

const PERFIS = { ana: perfil("ana@a.com", "sub-ana"), beto: perfil("beto@b.com", "sub-beto") };

describe("AcessoEmpresa (QA): só lib/empresas/acesso.ts cria um acesso", () => {
  it("copiar o acesso com spread e trocar o empresaId não dá acesso à empresa de outro", async () => {
    const ana = await entrarComGoogle(deps(t.banco, PERFIS), "ana");
    const beto = await entrarComGoogle(deps(t.banco, PERFIS), "beto");
    const a = await criarEmpresa(t.banco, ana.usuario, { cnpj: "11.222.333/0001-81", razaoSocial: "Empresa A" });
    const b = await criarEmpresa(t.banco, beto.usuario, { cnpj: "45.723.174/0001-10", razaoSocial: "Empresa B" });
    const acessoB = await exigirAcessoEmpresa(t.banco, beto.usuario, b.id);
    await dadosDaEmpresa(t.banco, acessoB).inserir(notas, { texto: "segredo da B" });

    const acessoA = await exigirAcessoEmpresa(t.banco, ana.usuario, a.id);
    // Um bug comum de quem chama: reaproveitar o acesso e trocar a empresa (ex.: empresaId vindo do formulário).
    const forjado = { ...acessoA, empresaId: b.id } as AcessoEmpresa;
    let lidas: unknown[] = [];
    try {
      lidas = await dadosDaEmpresa(t.banco, forjado).listar(notas);
    } catch (erro) {
      assert.ok(erro instanceof SemAcessoEmpresa);
    }
    assert.deepEqual(lidas, [], "Ana leu a nota da empresa B com um acesso copiado");
  });
});

describe("AcessoEmpresa (QA, ciclo 2): outras formas de forjar", () => {
  it("Proxy, Object.create e acesso de outro usuário com a empresa trocada são recusados", async () => {
    const ana = await entrarComGoogle(deps(t.banco, PERFIS), "ana");
    const beto = await entrarComGoogle(deps(t.banco, PERFIS), "beto");
    const a = await criarEmpresa(t.banco, ana.usuario, { cnpj: "11.222.333/0001-81", razaoSocial: "Empresa A" });
    const b = await criarEmpresa(t.banco, beto.usuario, { cnpj: "45.723.174/0001-10", razaoSocial: "Empresa B" });
    const acessoB = await exigirAcessoEmpresa(t.banco, beto.usuario, b.id);
    await dadosDaEmpresa(t.banco, acessoB).inserir(notas, { texto: "segredo da B" });
    const acessoA = await exigirAcessoEmpresa(t.banco, ana.usuario, a.id);

    const viaProxy = new Proxy(acessoA, { get: (alvo, chave) => (chave === "empresaId" ? b.id : Reflect.get(alvo, chave)) });
    const viaCreate = Object.create(acessoA, { empresaId: { value: b.id } }) as AcessoEmpresa;
    for (const forjado of [viaProxy, viaCreate, null as unknown as AcessoEmpresa, undefined as unknown as AcessoEmpresa]) {
      assert.throws(() => dadosDaEmpresa(t.banco, forjado), SemAcessoEmpresa);
    }
    assert.ok(Object.isFrozen(acessoA));
    assert.throws(() => {
      (acessoA as { empresaId: string }).empresaId = b.id;
    }, TypeError);
    const daA = await dadosDaEmpresa(t.banco, acessoA).listar(notas);
    assert.deepEqual(daA, []);
    // alterar/apagar com o acesso da A não tocam a nota da B
    assert.deepEqual(await dadosDaEmpresa(t.banco, acessoA).alterar(notas, { texto: "x" }, sql`true`), []);
    assert.deepEqual(await dadosDaEmpresa(t.banco, acessoA).apagar(notas, sql`true`), []);
    const daB = await dadosDaEmpresa(t.banco, acessoB).listar(notas);
    assert.equal(daB.length, 1);
    assert.equal(daB[0].texto, "segredo da B");
  });
});

describe("criarEmpresa (QA): CNPJ repetido ao mesmo tempo", () => {
  it("dois cadastros simultâneos do mesmo CNPJ, 20 vezes: sempre um cria e o outro recebe ErroDeEmpresa (não erro cru do Postgres)", async () => {
    const ana = await entrarComGoogle(deps(t.banco, PERFIS), "ana");
    const beto = await entrarComGoogle(deps(t.banco, PERFIS), "beto");
    for (let rodada = 0; rodada < 20; rodada++) {
      await t.banco.delete(empresas);
      const r = await Promise.allSettled([
        criarEmpresa(t.banco, ana.usuario, { cnpj: "11.222.333/0001-81", razaoSocial: "Empresa A" }),
        criarEmpresa(t.banco, beto.usuario, { cnpj: "11222333000181", razaoSocial: "Empresa A" }),
      ]);
      const falhas = r.filter((x) => x.status === "rejected") as PromiseRejectedResult[];
      assert.equal(falhas.length, 1, `rodada ${rodada}: ${falhas.length} falhas`);
      assert.ok(falhas[0].reason instanceof ErroDeEmpresa, `rodada ${rodada}, erro recebido: ${String(falhas[0].reason)}`);
      assert.equal((await t.banco.select().from(empresas)).length, 1);
    }
  });
});
