// QA da Parte 3 (cadastro pessoal e prova de posse), ciclo 1: casos que os testes do engenheiro não cobrem. Só o banco
// contabilizadev_teste; a consulta de CNPJ é a gravada e nada sai da máquina (o registro de chamada é gravado direto).
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { buscarExemplo, buscarFalso } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { CPF_RESPONSAVEL_DE_TESTE } from "@contabilizadev/nucleo/certificado-teste";
import { serproChamadas } from "@/banco/esquema";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { ehProvisorio, exigirAcessoAoTermo, type AcessoProvisorio } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro } from "@/lib/empresas/cadastro";
import { comprovarPosse } from "@/lib/empresas/posse";
import { COMPROVADA_POR_OUTRA, desistirDoCadastro, ErroDeEmpresa } from "@/lib/empresas/servico";
import { registroNoBanco } from "@/lib/serpro/registro";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";
import { dadosDeSocio } from "./apoio-empresa";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const AGORA = new Date();
const EMPRESA = "12345678000195"; // ti-fator-r: FULANA DE TAL EXEMPLO e BELTRANO EXEMPLO ("***123456**")
const PERFIS = { ana: perfil("ana@qa3.com", "sub-ana-qa3"), beto: perfil("beto@qa3.com", "sub-beto-qa3") };
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
  return acesso;
}

describe("QA parte 3: desistir do cadastro provisório depois de um envio do termo que a Receita recusou", () => {
  it("o gasto registrado fica anonimizado, como na remoção da empresa (sem CNPJ, sem mensagens)", async () => {
    const acesso = await provisorio("ana", "Fulana de Tal Exemplo", CPF_RESPONSAVEL_DE_TESTE, true);
    // O envio recusado já foi registrado (é uma chamada paga): com a empresa cadastrada, entra com vínculo, CNPJ e mensagens.
    await registroNoBanco(t.banco).registrar({
      quando: AGORA,
      acao: "Apoiar",
      servico: "ENVIOXMLASSINADO81",
      finalidade: `Enviar o termo de autorização da empresa ${EMPRESA}`,
      contribuinte: EMPRESA,
      status: 403,
      mensagens: "[AcessoNegado-AUTENTICAPROCURADOR-013] texto da API",
      custo: 0.4,
    });
    const [antes] = await t.banco.select().from(serproChamadas);
    assert.equal(antes.empresaId, acesso.empresaId);

    await desistirDoCadastro(t.banco, acesso);

    const [depois] = await t.banco.select().from(serproChamadas).where(eq(serproChamadas.id, antes.id));
    assert.equal(depois.empresaId, null);
    assert.equal(depois.contribuinte, null, "o CNPJ da empresa apagada continua no registro de gasto");
    assert.equal(depois.mensagens, "", "as mensagens da empresa apagada continuam no registro de gasto");
    assert.doesNotMatch(depois.finalidade, new RegExp(EMPRESA));
  });
});

describe("QA parte 3: depois da comprovação", () => {
  it("quem teve o provisório derrubado e tenta cadastrar de novo recebe 'comprovada por outra conta', sem saber qual", async () => {
    const deAna = await provisorio("ana", "Fulana de Tal Exemplo", CPF_RESPONSAVEL_DE_TESTE, true);
    await provisorio("beto", "Beltrano Exemplo", "11112345663", false);
    await comprovarPosse(t.banco, deAna, EMPRESA, AGORA);
    const beto = await entrar("beto");
    await assert.rejects(
      consultarParaCadastro(t.banco, beto, EMPRESA, { segredo: SEGREDO, agora: AGORA, buscar: buscarFalso() }),
      (e: unknown) => e instanceof ErroDeEmpresa && e.message === COMPROVADA_POR_OUTRA && !/ana|fulana/i.test(e.message),
    );
  });
});
