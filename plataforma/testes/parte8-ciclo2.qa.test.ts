// QA (Parte 8, passo 22c, ciclo 2): o aviso da declaração anual não pode cobrar a DEFIS de um ano em que a empresa ainda
// não existia (início de atividade depois do ano declarado). O início de atividade já é usado no aviso do PGDAS-D
// (coleta.ts) e não no da declaração anual. Banco de teste, nada sai da máquina.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { consultasCnpj, defis } from "@/banco/esquema";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { avisosDaEmpresa } from "@/lib/avisos/coleta";
import { dadosDaEmpresa, exigirAcessoEmpresa } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro } from "@/lib/empresas/cadastro";
import type { Situacao } from "@/lib/termo/situacao";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const em = (iso: string) => new Date(`${iso}-03:00`);
const CADASTRO = em("2027-01-20T10:00:00");
const PERFIS = { ana: perfil("ana@a.com", "sub-ana") };
const AUSENTE: Situacao = { estado: "ausente" };

// Empresa aberta em 15/01/2027: não esteve no Simples em 2026, não entrega a DEFIS de 2026.
async function empresaAbertaEm2027() {
  const usuario = (await entrarComGoogle(depsLogin(t.banco, PERFIS), "ana")).usuario;
  const r = await consultarParaCadastro(t.banco, usuario, "98.765.432/0001-98", { segredo: SEGREDO, agora: CADASTRO, buscar: buscarExemplo("ti-anexo-iii") });
  assert.equal(r.tipo, "previa");
  const empresaId = await cadastrarPelaPrevia(t.banco, usuario, r.previa.token, { segredo: SEGREDO, agora: CADASTRO });
  await t.banco
    .update(consultasCnpj)
    .set({ dados: sql`jsonb_set(${consultasCnpj.dados}, '{dataInicioAtividade}', '"2027-01-15"')` })
    .where(sql`${consultasCnpj.empresaId} = ${empresaId}`);
  return { acesso: await exigirAcessoEmpresa(t.banco, usuario, empresaId) };
}

describe("QA ciclo 2: declaração anual de ano anterior ao início de atividade", () => {
  it("em março de 2027 não há aviso da DEFIS de 2026 para empresa aberta em janeiro de 2027", async () => {
    const { acesso } = await empresaAbertaEm2027();
    const avisos = await avisosDaEmpresa(t.banco, acesso, em("2027-03-10T10:00:00"), { termo: AUSENTE, log: () => {} });
    assert.deepEqual(
      avisos.filter((a) => a.chave?.startsWith("defis")).map((a) => a.titulo),
      [],
    );
  });

  it("depois do prazo, com a Receita consultada sem DEFIS de 2026, não vira 'atrasada' (a empresa não existia em 2026)", async () => {
    const { acesso } = await empresaAbertaEm2027();
    await dadosDaEmpresa(t.banco, acesso).inserirOuAtualizar(
      defis,
      [{ ano: 2026, situacao: "nao-encontrada", idDefis: null, declaracaoPdf: null, reciboPdf: null, consultadaEm: em("2027-04-02T10:00:00") }],
      [defis.empresaId, defis.ano],
      ["situacao", "consultadaEm"],
    );
    const avisos = await avisosDaEmpresa(t.banco, acesso, em("2027-04-03T10:00:00"), { termo: AUSENTE, log: () => {} });
    assert.deepEqual(
      avisos.filter((a) => a.chave?.startsWith("defis")).map((a) => `${a.nivel}: ${a.titulo}`),
      [],
    );
  });
});
