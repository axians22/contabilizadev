// Remoção da empresa x gravação da consulta à Receita (salvarConsulta / dadosDaReceita), contra o Postgres de teste.
// Requisito 7 da remoção: quem estava no meio de "Atualizar dados" (outra aba, outro usuário) não quebra, não vê o CNPJ
// da empresa removida e nada fica órfão em consultas_cnpj. A BrasilAPI nunca é chamada (respostas gravadas).
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { lerRespostaCnpj, type Buscar } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { buscarExemplo, respostaGravada } from "@contabilizadev/nucleo/brasilapi/exemplos";
import type { Banco } from "@/banco";
import { consultasCnpj, empresas } from "@/banco/esquema";
import { entrarComGoogle, resolverSessao } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa, SemAcessoEmpresa } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro } from "@/lib/empresas/cadastro";
import { dadosDaReceita, salvarConsulta } from "@/lib/empresas/receita";
import { removerEmpresa } from "@/lib/empresas/remocao";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps, perfil, SEGREDO } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const AGORA = new Date();
const DEPOIS = new Date(AGORA.getTime() + 2 * 60 * 60 * 1000);
const CNPJ = "12345678000195";
const PERFIS = { ana: perfil("ana@a.com", "sub-ana") };
const semLog = () => {};

async function cadastrada() {
  const d = deps(t.banco, PERFIS);
  const { cookie } = await entrarComGoogle(d, "ana");
  const ana = await resolverSessao(d, cookie);
  assert.ok(ana);
  const r = await consultarParaCadastro(t.banco, ana.usuario, CNPJ, { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-fator-r") });
  assert.equal(r.tipo, "previa");
  const empresaId = await cadastrarPelaPrevia(t.banco, ana.usuario, r.previa.token, { segredo: SEGREDO, agora: AGORA });
  const acesso = await exigirAcessoEmpresa(t.banco, ana.usuario, empresaId);
  return { ana, empresaId, acesso };
}

const dados = () => lerRespostaCnpj(respostaGravada("ti-fator-r"));
const consultas = async () => (await t.banco.select().from(consultasCnpj)).length;

describe("salvarConsulta com a empresa removida", () => {
  it("empresa removida antes de gravar: SemAcessoEmpresa sem o CNPJ na mensagem e nada gravado", async () => {
    const { ana, empresaId, acesso } = await cadastrada();
    await removerEmpresa(t.banco, ana, empresaId, CNPJ, { log: semLog });
    const erro = await salvarConsulta(t.banco, acesso, dados(), DEPOIS).then(
      () => assert.fail("gravou a consulta da empresa removida"),
      (e: unknown) => e,
    );
    assert.ok(erro instanceof SemAcessoEmpresa);
    assert.equal(erro.message, "Empresa não encontrada.");
    assert.ok(!erro.message.includes(CNPJ));
    assert.equal(await consultas(), 0);
  });

  it("CNPJ realmente diferente continua com o erro de CNPJ (não é confundido com empresa removida)", async () => {
    const { acesso } = await cadastrada();
    await assert.rejects(salvarConsulta(t.banco, acesso, lerRespostaCnpj(respostaGravada("ti-anexo-iii")), DEPOIS), /não do desta empresa/);
  });

  it("remoção que chega durante a gravação espera a trava e apaga a consulta junto (nada órfão, nada quebra)", async () => {
    const { ana, empresaId, acesso } = await cadastrada();
    let liberar!: () => void;
    const segura = new Promise<void>((r) => (liberar = r));
    let gravou!: () => void;
    const gravada = new Promise<void>((r) => (gravou = r));
    // A gravação fica com a transação aberta (e a empresa travada) até liberar.
    const gravacao = t.banco.transaction(async (tx) => {
      await salvarConsulta(tx as unknown as Banco, acesso, dados(), DEPOIS);
      gravou();
      await segura;
    });
    await gravada;
    let removida = false;
    const remocao = removerEmpresa(t.banco, ana, empresaId, CNPJ, { log: semLog }).then(() => (removida = true));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(removida, false, "a remoção não esperou a gravação em andamento");
    liberar();
    await gravacao;
    await remocao;
    assert.equal(await consultas(), 0, "sobrou consulta da empresa removida");
    assert.equal((await t.banco.select().from(empresas)).length, 0);
  });
});

describe("dadosDaReceita com a empresa removida durante a consulta", () => {
  it("devolve { erro: 'Empresa não encontrada.' } sem consulta (nem a guardada, que foi apagada) e sem exceção", async () => {
    const { ana, empresaId, acesso } = await cadastrada();
    const buscar: Buscar = async () => {
      await removerEmpresa(t.banco, ana, empresaId, CNPJ, { log: semLog });
      const corpo = respostaGravada("ti-fator-r");
      return { status: 200, json: async () => corpo };
    };
    const r = await dadosDaReceita(t.banco, acesso, { forcar: true, agora: DEPOIS, buscar });
    assert.deepEqual(r, { consulta: null, fonte: "banco", erro: "Empresa não encontrada." });
    assert.equal(await consultas(), 0);
  });

  it("empresa já removida antes da consulta: não chama a Receita e devolve o mesmo erro", async () => {
    const { ana, empresaId, acesso } = await cadastrada();
    await removerEmpresa(t.banco, ana, empresaId, CNPJ, { log: semLog });
    const buscar = buscarExemplo("ti-fator-r");
    const r = await dadosDaReceita(t.banco, acesso, { forcar: true, agora: DEPOIS, buscar });
    assert.equal(r.erro, "Empresa não encontrada.");
    assert.equal(r.consulta, null);
    assert.equal(buscar.chamadas.length, 0);
  });
});
