// QA (Parte 2, remover empresa, ciclo 4): portão com a consulta guardada vencida (carregar /empresa) e remoção
// concorrente sem pausas artificiais (corrida real, repetida), contra o Postgres de teste. A BrasilAPI nunca é chamada.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Buscar } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { buscarExemplo, respostaGravada } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { consultasCnpj, empresas, empresaUsuarios } from "@/banco/esquema";
import { entrarComGoogle, resolverSessao } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa, SemAcessoEmpresa } from "@/lib/empresas/acesso";
import { dadosDaReceita } from "@/lib/empresas/receita";
import { removerEmpresa } from "@/lib/empresas/remocao";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps, perfil, SEGREDO } from "./apoio";
import { cadastrarComprovada, consultarComDados } from "./apoio-empresa";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const AGORA = new Date();
const VENCIDA = new Date(AGORA.getTime() + 31 * 24 * 60 * 60 * 1000);
const CNPJ = "12345678000195";
const PERFIS = { ana: perfil("ana@a.com", "sub-ana") };
const semLog = () => {};

async function cadastrada() {
  const d = deps(t.banco, PERFIS);
  const { cookie } = await entrarComGoogle(d, "ana");
  const ana = await resolverSessao(d, cookie);
  assert.ok(ana);
  const r = await consultarComDados(t.banco, ana.usuario, CNPJ, { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-fator-r") });
  assert.equal(r.tipo, "previa");
  const empresaId = await cadastrarComprovada(t.banco, ana.usuario, r.previa.token, { segredo: SEGREDO, agora: AGORA });
  const acesso = await exigirAcessoEmpresa(t.banco, ana.usuario, empresaId);
  return { ana, empresaId, acesso };
}

describe("QA ciclo 4: remoção x consulta à Receita", () => {
  it("carregar /empresa com a consulta vencida enquanto a empresa é removida: erro curto, sem consulta, nada órfão", async () => {
    const { ana, empresaId, acesso } = await cadastrada();
    const buscar: Buscar = async () => {
      await removerEmpresa(t.banco, ana, empresaId, CNPJ, { log: semLog });
      const corpo = respostaGravada("ti-fator-r");
      return { status: 200, json: async () => corpo };
    };
    const r = await dadosDaReceita(t.banco, acesso, { agora: VENCIDA, buscar });
    assert.equal(r.erro, "Empresa não encontrada.");
    assert.equal(r.consulta, null);
    assert.equal((await t.banco.select().from(consultasCnpj)).length, 0);
  });

  it("corrida real repetida (Atualizar dados e remover ao mesmo tempo): nunca exceção genérica, nada órfão, CNPJ livre", async () => {
    for (let i = 0; i < 8; i++) {
      await t.limpar();
      const { ana, empresaId, acesso } = await cadastrada();
      const [atualizacao, remocao] = await Promise.allSettled([
        dadosDaReceita(t.banco, acesso, { forcar: true, agora: VENCIDA, buscar: buscarExemplo("ti-fator-r") }),
        removerEmpresa(t.banco, ana, empresaId, CNPJ, { log: semLog }),
      ]);
      assert.equal(remocao.status, "fulfilled", `remoção falhou: ${remocao.status === "rejected" ? String(remocao.reason) : ""}`);
      if (atualizacao.status === "rejected") {
        assert.ok(atualizacao.reason instanceof SemAcessoEmpresa, `exceção genérica: ${String(atualizacao.reason)}`);
        assert.ok(!String(atualizacao.reason.message).includes(CNPJ));
      } else if (atualizacao.value.erro) {
        assert.ok(!atualizacao.value.erro.includes(CNPJ));
      }
      assert.equal((await t.banco.select().from(consultasCnpj)).length, 0, `iteração ${i}: consulta órfã`);
      assert.equal((await t.banco.select().from(empresas)).length, 0);
      assert.equal((await t.banco.select().from(empresaUsuarios)).length, 0);
    }
  });
});
