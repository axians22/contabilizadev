// QA (Parte 3): cadastro pelo CNPJ e dados da Receita, casos de borda. A BrasilAPI nunca é chamada.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { buscarExemplo, buscarFalso, respostaGravada } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { consultasCnpj, empresas, empresaUsuarios } from "@/banco/esquema";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro, VALIDADE_DA_PREVIA_MS } from "@/lib/empresas/cadastro";
import { dadosDaReceita, ultimaConsulta } from "@/lib/empresas/receita";
import { ErroDeEmpresa } from "@/lib/empresas/servico";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps, perfil, SEGREDO } from "./apoio";
import { comprovar, dadosDeSocio } from "./apoio-empresa";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const PERFIS = { ana: perfil("ana@a.com", "sub-ana"), beto: perfil("beto@b.com", "sub-beto") };
const AGORA = new Date("2026-10-16T15:00:00Z");
const DIA = 24 * 60 * 60 * 1000;
const em = (ms: number) => new Date(AGORA.getTime() + ms);

async function usuarios() {
  const ana = (await entrarComGoogle(deps(t.banco, PERFIS), "ana")).usuario;
  const beto = (await entrarComGoogle(deps(t.banco, PERFIS), "beto")).usuario;
  // Os dois sócios do exemplo ti-fator-r ("Seus dados": o cadastro confere o quadro de sócios).
  await dadosDeSocio(t.banco, ana, "12345678000195", { nome: "FULANA DE TAL EXEMPLO" });
  await dadosDeSocio(t.banco, beto, "12345678000195", { nome: "BELTRANO EXEMPLO" });
  return { ana, beto };
}

describe("QA cadastro pelo CNPJ", () => {
  it("CNPJ alfanumérico digitado em minúsculas: cadastro completo, guardado em maiúsculas", async () => {
    const { ana } = await usuarios();
    const cnpj = String(respostaGravada("alfanumerico").cnpj);
    const r = await consultarParaCadastro(t.banco, ana, cnpj.toLowerCase(), { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("alfanumerico") });
    assert.equal(r.tipo, "previa");
    if (r.tipo !== "previa") return;
    const id = await comprovar(t.banco, ana, await cadastrarPelaPrevia(t.banco, ana, r.previa.token, { segredo: SEGREDO, agora: em(1000) }));
    const [e] = await t.banco.select().from(empresas).where(eq(empresas.id, id));
    assert.equal(e.cnpj, cnpj);
    const acesso = await exigirAcessoEmpresa(t.banco, ana, id, { papel: "DONO" });
    assert.ok(await ultimaConsulta(t.banco, acesso));
  });

  it("a mesma prévia usada duas vezes não cria nada a mais (devolve o mesmo cadastro)", async () => {
    const { ana } = await usuarios();
    const r = await consultarParaCadastro(t.banco, ana, "12345678000195", { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-fator-r") });
    if (r.tipo !== "previa") throw new Error("esperava prévia");
    const id = await cadastrarPelaPrevia(t.banco, ana, r.previa.token, { segredo: SEGREDO, agora: em(1000) });
    assert.equal(await cadastrarPelaPrevia(t.banco, ana, r.previa.token, { segredo: SEGREDO, agora: em(2000) }), id);
    assert.equal((await t.banco.select().from(empresas)).length, 1);
    assert.equal((await t.banco.select().from(empresaUsuarios)).length, 1);
    assert.equal((await t.banco.select().from(consultasCnpj)).length, 0);
  });

  it("prévia com os dados trocados (assinatura da original) é recusada", async () => {
    const { ana } = await usuarios();
    const r = await consultarParaCadastro(t.banco, ana, "12345678000195", { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-fator-r") });
    if (r.tipo !== "previa") throw new Error("esperava prévia");
    const [corpo, assinatura] = r.previa.token.split(".");
    const conteudo = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8"));
    conteudo.dados.razaoSocial = "OUTRA EMPRESA LTDA";
    const falso = `${Buffer.from(JSON.stringify(conteudo)).toString("base64url")}.${assinatura}`;
    await assert.rejects(cadastrarPelaPrevia(t.banco, ana, falso, { segredo: SEGREDO, agora: em(1000) }), ErroDeEmpresa);
    assert.equal((await t.banco.select().from(empresas)).length, 0);
  });

  it("prévia no limite exato de 30 minutos ainda vale; 1 ms depois, não", async () => {
    const { ana } = await usuarios();
    const r = await consultarParaCadastro(t.banco, ana, "12345678000195", { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-fator-r") });
    if (r.tipo !== "previa") throw new Error("esperava prévia");
    await assert.rejects(cadastrarPelaPrevia(t.banco, ana, r.previa.token, { segredo: SEGREDO, agora: em(VALIDADE_DA_PREVIA_MS + 1) }), ErroDeEmpresa);
    assert.ok(await cadastrarPelaPrevia(t.banco, ana, r.previa.token, { segredo: SEGREDO, agora: em(VALIDADE_DA_PREVIA_MS) }));
  });

  it("MEMBRO que consulta o CNPJ da empresa dele não gasta consulta e passa a usá-la", async () => {
    const { ana, beto } = await usuarios();
    const r = await consultarParaCadastro(t.banco, ana, "12345678000195", { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-fator-r") });
    if (r.tipo !== "previa") throw new Error("esperava prévia");
    const id = await comprovar(t.banco, ana, await cadastrarPelaPrevia(t.banco, ana, r.previa.token, { segredo: SEGREDO, agora: em(1000) }));
    await t.banco.insert(empresaUsuarios).values({ empresaId: id, usuarioId: beto.id, papel: "MEMBRO" });
    const buscar = buscarFalso();
    const r2 = await consultarParaCadastro(t.banco, beto, "12.345.678/0001-95", { segredo: SEGREDO, agora: AGORA, buscar });
    assert.deepEqual(r2, { tipo: "ja-cadastrada", empresaId: id });
    assert.equal(buscar.chamadas.length, 0);
  });
});

describe("QA dados da Receita: validade", () => {
  it("exatamente 30 dias: ainda do banco; 30 dias e 1 ms: consulta de novo", async () => {
    const { ana } = await usuarios();
    const r = await consultarParaCadastro(t.banco, ana, "12345678000195", { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-fator-r") });
    if (r.tipo !== "previa") throw new Error("esperava prévia");
    const id = await comprovar(t.banco, ana, await cadastrarPelaPrevia(t.banco, ana, r.previa.token, { segredo: SEGREDO, agora: em(1000) }));
    const acesso = await exigirAcessoEmpresa(t.banco, ana, id);
    const nenhuma = buscarFalso();
    assert.equal((await dadosDaReceita(t.banco, acesso, { agora: em(30 * DIA), buscar: nenhuma })).fonte, "banco");
    assert.equal(nenhuma.chamadas.length, 0);
    const uma = buscarExemplo("ti-fator-r");
    assert.equal((await dadosDaReceita(t.banco, acesso, { agora: em(30 * DIA + 1), buscar: uma })).fonte, "receita");
    assert.equal(uma.chamadas.length, 1);
  });

  it("MEMBRO pode atualizar e a consulta fica na empresa certa", async () => {
    const { ana, beto } = await usuarios();
    const r = await consultarParaCadastro(t.banco, ana, "12345678000195", { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-fator-r") });
    if (r.tipo !== "previa") throw new Error("esperava prévia");
    const id = await comprovar(t.banco, ana, await cadastrarPelaPrevia(t.banco, ana, r.previa.token, { segredo: SEGREDO, agora: em(1000) }));
    await t.banco.insert(empresaUsuarios).values({ empresaId: id, usuarioId: beto.id, papel: "MEMBRO" });
    const acesso = await exigirAcessoEmpresa(t.banco, beto, id);
    const res = await dadosDaReceita(t.banco, acesso, { agora: em(10 * 60 * 1000), forcar: true, buscar: buscarExemplo("ti-fator-r") });
    assert.equal(res.fonte, "receita");
    assert.equal(res.consulta?.empresaId, id);
  });
});
