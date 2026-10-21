// QA (Parte 2, remover empresa, ciclo 3): a remoção acontece enquanto outra sessão (outro usuário com a mesma empresa
// ativa, ou outra aba) está no meio de "Atualizar dados" (consulta à Receita). Requisito 7: "nada quebra". Esperado:
// a atualização termina com "Empresa não encontrada." (SemAcessoEmpresa ou { erro }), sem exceção genérica, sem o CNPJ
// da empresa removida na mensagem e sem linha órfã em consultas_cnpj.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { respostaGravada } from "@contabilizadev/nucleo/brasilapi/exemplos";
import type { Buscar } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { consultasCnpj } from "@/banco/esquema";
import { entrarComGoogle, resolverSessao } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa, SemAcessoEmpresa } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro } from "@/lib/empresas/cadastro";
import { dadosDaReceita } from "@/lib/empresas/receita";
import { removerEmpresa } from "@/lib/empresas/remocao";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps, perfil, SEGREDO } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const AGORA = new Date();
const DEPOIS = new Date(AGORA.getTime() + 2 * 60 * 60 * 1000);
const EMPRESA = "12345678000195";
const PERFIS = { ana: perfil("ana@a.com", "sub-ana") };

describe("QA remoção x Atualizar dados (consulta à Receita em andamento)", () => {
  it("a atualização que termina depois da remoção não quebra nem mostra o CNPJ removido", async () => {
    const d = deps(t.banco, PERFIS);
    const { cookie } = await entrarComGoogle(d, "ana");
    const ana = await resolverSessao(d, cookie);
    assert.ok(ana);
    const r = await consultarParaCadastro(t.banco, ana.usuario, EMPRESA, { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-fator-r") });
    assert.equal(r.tipo, "previa");
    const empresaId = await cadastrarPelaPrevia(t.banco, ana.usuario, r.previa.token, { segredo: SEGREDO, agora: AGORA });
    const acesso = await exigirAcessoEmpresa(t.banco, ana.usuario, empresaId);

    // A consulta à Receita está em andamento (rede lenta) e o dono confirma a remoção nesse meio tempo.
    const buscar: Buscar = async () => {
      await removerEmpresa(t.banco, ana, empresaId, EMPRESA, { log: () => {} });
      const corpo = respostaGravada("ti-fator-r");
      return { status: 200, json: async () => corpo };
    };

    let resultado: { ok?: Awaited<ReturnType<typeof dadosDaReceita>>; erro?: unknown };
    try {
      resultado = { ok: await dadosDaReceita(t.banco, acesso, { forcar: true, agora: DEPOIS, buscar }) };
    } catch (erro) {
      resultado = { erro };
    }

    if (resultado.erro !== undefined) {
      const msg = (resultado.erro as Error)?.message ?? String(resultado.erro);
      assert.ok(resultado.erro instanceof SemAcessoEmpresa, `exceção não tratada (a tela quebra): ${msg}`);
      assert.ok(!msg.includes(EMPRESA), `a mensagem mostra o CNPJ da empresa removida: ${msg}`);
    } else {
      assert.equal(resultado.ok?.erro, "Empresa não encontrada.");
    }
    assert.equal((await t.banco.select().from(consultasCnpj)).length, 0, "sobrou consulta da empresa removida");
  });
});
