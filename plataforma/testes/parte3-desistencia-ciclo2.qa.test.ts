// QA da Parte 3, ciclo 2: a desistência do cadastro provisório depois da troca para apagarEmpresaETudo. Só o banco
// contabilizadev_teste; a consulta de CNPJ é a gravada e nada sai da máquina (o registro de chamada é gravado direto).
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { buscarExemplo, buscarFalso } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { CPF_RESPONSAVEL_DE_TESTE } from "@contabilizadev/nucleo/certificado-teste";
import { cnpjsConsultados, empresas, empresaUsuarios, enviosTermo, serproChamadas, sessoes } from "@/banco/esquema";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { ehProvisorio, exigirAcessoAoTermo, type AcessoProvisorio } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro } from "@/lib/empresas/cadastro";
import { definirEmpresaAtiva, desistirDoCadastro } from "@/lib/empresas/servico";
import { registroNoBanco } from "@/lib/serpro/registro";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";
import { dadosDeSocio } from "./apoio-empresa";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const AGORA = new Date();
const EMPRESA = "12345678000195";
const PERFIS = { ana: perfil("ana@qa3c2.com", "sub-ana-qa3c2"), beto: perfil("beto@qa3c2.com", "sub-beto-qa3c2") };
const entrar = async (quem: keyof typeof PERFIS) => (await entrarComGoogle(depsLogin(t.banco, PERFIS, { adminEmails: [] }), quem)).usuario;

async function provisorio(quem: keyof typeof PERFIS, nome: string, cpf: string, primeiro: boolean): Promise<AcessoProvisorio> {
  const u = await entrar(quem);
  await dadosDeSocio(t.banco, u, EMPRESA, { nome, cpf });
  const opcoes = { segredo: SEGREDO, agora: AGORA };
  const p = await consultarParaCadastro(t.banco, u, EMPRESA, { ...opcoes, buscar: primeiro ? buscarExemplo("ti-fator-r") : buscarFalso() });
  assert.ok(p.tipo === "previa");
  const id = await cadastrarPelaPrevia(t.banco, u, p.previa.token, opcoes);
  const acesso = await exigirAcessoAoTermo(t.banco, u, id);
  assert.ok(ehProvisorio(acesso));
  const [s] = await t.banco.select({ id: sessoes.id }).from(sessoes).where(eq(sessoes.usuarioId, u.id));
  await definirEmpresaAtiva(t.banco, { sessaoId: s.id, usuario: u }, id);
  return acesso;
}

describe("QA parte 3 (ciclo 2): desistência com dois provisórios do mesmo CNPJ", () => {
  it("o primeiro a desistir não apaga nada do outro; o último apaga a empresa e anonimiza o gasto", async () => {
    const deAna = await provisorio("ana", "Fulana de Tal Exemplo", CPF_RESPONSAVEL_DE_TESTE, true);
    const deBeto = await provisorio("beto", "Beltrano Exemplo", "11112345663", false);
    assert.equal(deAna.empresaId, deBeto.empresaId);
    await t.banco.insert(enviosTermo).values({ empresaId: deAna.empresaId, usuarioId: deAna.usuarioId, enviadoEm: AGORA });
    await registroNoBanco(t.banco).registrar({
      quando: AGORA,
      acao: "Apoiar",
      servico: "ENVIOXMLASSINADO81",
      finalidade: `Enviar o termo de autorização da empresa 12.345.678/0001-95`,
      contribuinte: EMPRESA,
      status: 403,
      mensagens: "recusado",
      custo: 0.4,
    });

    await desistirDoCadastro(t.banco, deBeto);
    const [ainda] = await t.banco.select().from(empresas).where(eq(empresas.id, deAna.empresaId));
    assert.ok(ainda, "a empresa caiu enquanto ainda havia outro provisório");
    const vinculos = await t.banco.select().from(empresaUsuarios).where(eq(empresaUsuarios.empresaId, deAna.empresaId));
    assert.deepEqual(vinculos.map((v) => v.usuarioId), [deAna.usuarioId]);
    assert.equal((await t.banco.select().from(enviosTermo)).length, 1, "o limite de envios do outro provisório sumiu");
    const [gasto] = await t.banco.select().from(serproChamadas);
    assert.equal(gasto.empresaId, deAna.empresaId, "o gasto foi anonimizado com a empresa ainda viva");
    assert.equal(gasto.contribuinte, EMPRESA);
    assert.ok((await t.banco.select().from(cnpjsConsultados).where(eq(cnpjsConsultados.cnpj, EMPRESA))).length >= 1);
    const [sessaoAna] = await t.banco.select().from(sessoes).where(eq(sessoes.usuarioId, deAna.usuarioId));
    assert.equal(sessaoAna.empresaAtivaId, deAna.empresaId);

    await desistirDoCadastro(t.banco, deAna);
    assert.equal((await t.banco.select().from(empresas).where(eq(empresas.id, deAna.empresaId))).length, 0);
    assert.equal((await t.banco.select().from(enviosTermo)).length, 0);
    assert.equal((await t.banco.select().from(cnpjsConsultados).where(eq(cnpjsConsultados.cnpj, EMPRESA))).length, 0);
    const [depois] = await t.banco.select().from(serproChamadas);
    assert.equal(depois.empresaId, null);
    assert.equal(depois.contribuinte, null);
    assert.equal(depois.mensagens, "");
    assert.doesNotMatch(depois.finalidade, /12\.345\.678\/0001-95|12345678000195/);
    const sessoesDepois = await t.banco.select().from(sessoes);
    assert.ok(sessoesDepois.every((s) => s.empresaAtivaId === null), "sessão continua com a empresa apagada como ativa");
  });

  it("desistir duas vezes (empresa já apagada) não lança erro", async () => {
    const deAna = await provisorio("ana", "Fulana de Tal Exemplo", CPF_RESPONSAVEL_DE_TESTE, true);
    await desistirDoCadastro(t.banco, deAna);
    await desistirDoCadastro(t.banco, deAna);
    assert.equal((await t.banco.select().from(empresas)).length, 0);
  });
});
