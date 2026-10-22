// Cadastro pelo CNPJ e dados da Receita contra o Postgres de teste. A BrasilAPI nunca é chamada: o fetch é o falso
// do núcleo, com as respostas gravadas (nucleo/src/brasilapi/exemplos).
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { ErroConsultaCnpj, lerRespostaCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { buscarExemplo, buscarFalso, respostaGravada, type Exemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { cnpjsConsultados, consultasCnpj, empresas, empresaUsuarios } from "@/banco/esquema";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa, SemAcessoEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro, NAO_ATENDIDA } from "@/lib/empresas/cadastro";
import { dadosDaReceita, salvarConsulta, ultimaConsulta } from "@/lib/empresas/receita";
import { COMPROVADA_POR_OUTRA, criarEmpresa, ErroDeEmpresa } from "@/lib/empresas/servico";
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
const depois = (ms: number) => new Date(AGORA.getTime() + ms);

// Ana e Beto, os dois sócios do exemplo ti-fator-r ("Seus dados" preenchidos: o cadastro confere o quadro de sócios).
async function usuarios() {
  const ana = (await entrarComGoogle(deps(t.banco, PERFIS), "ana")).usuario;
  const beto = (await entrarComGoogle(deps(t.banco, PERFIS), "beto")).usuario;
  await dadosDeSocio(t.banco, ana, "12345678000195", { nome: "Fulana de Tal Exemplo" });
  await dadosDeSocio(t.banco, beto, "12345678000195", { nome: "Beltrano Exemplo" });
  return { ana, beto };
}

// Ana cadastra a empresa de TI do exemplo pelo fluxo completo e comprova (no site, pelo termo assinado com o e-CNPJ).
async function cadastrada() {
  const { ana, beto } = await usuarios();
  const r = await consultarParaCadastro(t.banco, ana, "12.345.678/0001-95", { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-fator-r") });
  assert.equal(r.tipo, "previa");
  const empresaId = await cadastrarPelaPrevia(t.banco, ana, r.previa.token, { segredo: SEGREDO, agora: depois(60_000) });
  await comprovar(t.banco, ana, empresaId);
  const acesso = await exigirAcessoEmpresa(t.banco, ana, empresaId);
  return { ana, beto, empresaId, acesso };
}

// Empresa não atendida não passa pelo cadastro: para conferir a consulta guardada dela, cria a empresa direto (como um
// cadastro antigo) e guarda a resposta gravada.
async function guardarDireto(usuario: { id: string }, cnpj: string, exemplo: Exemplo) {
  const empresa = await criarEmpresa(t.banco, usuario, { cnpj, razaoSocial: "Exemplo" });
  return salvarConsulta(t.banco, await exigirAcessoEmpresa(t.banco, usuario, empresa.id), lerRespostaCnpj(respostaGravada(exemplo)), AGORA);
}

describe("consultarParaCadastro", () => {
  it("CNPJ novo: consulta uma vez, guarda só a consulta pública e devolve dados, diagnóstico, o quadro de sócios conferido e a prévia", async () => {
    const { ana } = await usuarios();
    const buscar = buscarExemplo("ti-fator-r");
    const r = await consultarParaCadastro(t.banco, ana, "12.345.678/0001-95", { segredo: SEGREDO, agora: AGORA, buscar });
    assert.equal(buscar.chamadas.length, 1);
    assert.equal(r.tipo, "previa");
    assert.equal(r.previa.dados.razaoSocial, "EXEMPLO SOFTWARE LTDA");
    assert.equal(r.previa.diagnostico.anexo, "III ou V");
    assert.equal(r.previa.diagnostico.atendido, true);
    assert.equal(r.previa.qsa, "confere");
    assert.equal(r.previa.consultadaEm, AGORA.toISOString());
    assert.equal((await t.banco.select().from(empresas)).length, 0);
    assert.equal((await t.banco.select().from(consultasCnpj)).length, 0);
    // Banco primeiro: a consulta pública fica guardada (sem usuário nem empresa) e a seguinte não chama de novo.
    assert.equal((await t.banco.select().from(cnpjsConsultados)).length, 1);
    const nada = buscarFalso();
    const deNovo = await consultarParaCadastro(t.banco, ana, "12345678000195", { segredo: SEGREDO, agora: depois(DIA), buscar: nada });
    assert.equal(deNovo.tipo, "previa");
    assert.equal(nada.chamadas.length, 0);
  });

  it("MEI: prévia sem anexo e sem Fator R, com o motivo; a consulta guardada (empresa já existente) também", async () => {
    const { ana } = await usuarios();
    const r = await consultarParaCadastro(t.banco, ana, "24.681.357/0001-40", { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("mei") });
    assert.equal(r.tipo, "previa");
    assert.equal(r.previa.diagnostico.atendido, false);
    assert.equal(r.previa.diagnostico.anexo, null);
    assert.ok(!("explicacaoFatorR" in r.previa.diagnostico), "texto do Fator R não vai para o diagnóstico");
    assert.ok(r.previa.diagnostico.impedimentos.map((n) => n.detalhe).some((m) => /MEI/.test(m)));
    const guardada = await guardarDireto(ana, "24681357000140", "mei");
    assert.equal(guardada.diagnostico.anexo, null);
    assert.equal(guardada.diagnostico.dependeFatorR, false);
    assert.ok(!("explicacaoFatorR" in guardada.diagnostico), "texto do Fator R não vai para o diagnóstico");
  });

  it("CNAE fora do escopo numa empresa do Simples: prévia e consulta guardada ficam sem anexo e sem Fator R", async () => {
    const { ana } = await usuarios();
    const r = await consultarParaCadastro(t.banco, ana, "13.579.246/0001-01", { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("fora-do-escopo") });
    assert.equal(r.tipo, "previa");
    assert.equal(r.previa.diagnostico.atendido, false);
    assert.ok(r.previa.diagnostico.impedimentos.map((n) => n.detalhe).some((m) => /^CNAE 4751-2\/01 .*não é atendido/.test(m)));
    assert.equal(r.previa.diagnostico.anexo, null);
    assert.equal(r.previa.diagnostico.dependeFatorR, false);
    assert.ok(!("explicacaoFatorR" in r.previa.diagnostico), "texto do Fator R não vai para o diagnóstico");
    const guardada = await guardarDireto(ana, "13579246000101", "fora-do-escopo");
    assert.equal(guardada.diagnostico.atendido, false);
    assert.equal(guardada.diagnostico.anexo, null);
    assert.equal(guardada.diagnostico.dependeFatorR, false);
    assert.ok(!("explicacaoFatorR" in guardada.diagnostico), "texto do Fator R não vai para o diagnóstico");
  });

  it("CNPJ inválido não chega à BrasilAPI", async () => {
    const { ana } = await usuarios();
    const buscar = buscarFalso();
    for (const cnpj of ["12.345.678/0001-96", "123", ""]) {
      await assert.rejects(consultarParaCadastro(t.banco, ana, cnpj, { segredo: SEGREDO, buscar }), /CNPJ inválido/);
    }
    assert.equal(buscar.chamadas.length, 0);
  });

  it("banco primeiro: CNPJ já comprovado não consulta nada (o dono volta a ela; outro recebe 'comprovada por outra conta')", async () => {
    const { ana, beto, empresaId } = await cadastrada();
    const buscar = buscarFalso();
    assert.deepEqual(await consultarParaCadastro(t.banco, ana, "12345678000195", { segredo: SEGREDO, buscar }), { tipo: "ja-cadastrada", empresaId });
    await assert.rejects(consultarParaCadastro(t.banco, beto, "12345678000195", { segredo: SEGREDO, buscar }), (e: unknown) => e instanceof ErroDeEmpresa && e.message === COMPROVADA_POR_OUTRA);
    assert.equal(buscar.chamadas.length, 0);
  });

  it("CNPJ só com o provisório de outro: segue como novo (não revela o outro cadastro) e quem já tem o provisório volta a ele", async () => {
    const { ana, beto } = await usuarios();
    const r = await consultarParaCadastro(t.banco, ana, "12345678000195", { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-fator-r") });
    assert.ok(r.tipo === "previa");
    const empresaId = await cadastrarPelaPrevia(t.banco, ana, r.previa.token, { segredo: SEGREDO, agora: AGORA });
    const nada = buscarFalso();
    const deBeto = await consultarParaCadastro(t.banco, beto, "12345678000195", { segredo: SEGREDO, agora: AGORA, buscar: nada });
    assert.equal(deBeto.tipo, "previa");
    assert.equal(nada.chamadas.length, 0, "a consulta pública guardada serve");
    assert.doesNotMatch(JSON.stringify(deBeto), /já está cadastrad|aguarda/);
    assert.deepEqual(await consultarParaCadastro(t.banco, ana, "12345678000195", { segredo: SEGREDO, buscar: nada }), { tipo: "ja-cadastrada", empresaId });
  });

  it("erro da BrasilAPI chega com a mensagem para o cliente", async () => {
    const { ana } = await usuarios();
    await assert.rejects(
      consultarParaCadastro(t.banco, ana, "11222333000181", { segredo: SEGREDO, buscar: buscarFalso({ status: 404 }) }),
      (e: unknown) => e instanceof ErroConsultaCnpj && /não encontrado/.test(e.message),
    );
  });
});

describe("cadastrarPelaPrevia", () => {
  it("cria o cadastro provisório (aguardando comprovação), sem nenhum dado na empresa", async () => {
    const { ana } = await usuarios();
    const r = await consultarParaCadastro(t.banco, ana, "12345678000195", { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-fator-r") });
    assert.ok(r.tipo === "previa");
    const empresaId = await cadastrarPelaPrevia(t.banco, ana, r.previa.token, { segredo: SEGREDO, agora: AGORA });
    const [vinculo] = await t.banco.select().from(empresaUsuarios).where(eq(empresaUsuarios.empresaId, empresaId));
    assert.deepEqual([vinculo.usuarioId, vinculo.papel], [ana.id, "PROVISORIO"]);
    assert.equal((await t.banco.select().from(consultasCnpj)).length, 0);
    await assert.rejects(exigirAcessoEmpresa(t.banco, ana, empresaId), /aguarda comprovação/);
  });

  it("comprovada (termo aceito): a razão social da Receita, o usuário como DONO e a consulta do cadastro guardada com o diagnóstico", async () => {
    const { ana, empresaId } = await cadastrada();
    const [empresa] = await t.banco.select().from(empresas).where(eq(empresas.id, empresaId));
    assert.deepEqual([empresa.cnpj, empresa.razaoSocial], ["12345678000195", "EXEMPLO SOFTWARE LTDA"]);
    const [vinculo] = await t.banco.select().from(empresaUsuarios).where(eq(empresaUsuarios.empresaId, empresaId));
    assert.deepEqual([vinculo.usuarioId, vinculo.papel], [ana.id, "DONO"]);
    const linhas = await t.banco.select().from(consultasCnpj);
    assert.equal(linhas.length, 1);
    const c = linhas[0];
    assert.equal(c.empresaId, empresaId);
    assert.equal(c.consultadaEm.toISOString(), AGORA.toISOString());
    assert.equal(c.cnaePrincipal, "6201501");
    assert.deepEqual(c.cnaesSecundarios, ["6202300", "6204000", "6209100"]);
    assert.equal(c.situacaoCadastral, "ATIVA");
    assert.equal(c.optanteSimples, true);
    assert.equal(c.optanteMei, false);
    assert.equal(c.atendida, true);
    assert.equal(c.dados.socios.length, 2);
    assert.equal(c.diagnostico.anexo, "III ou V");
    assert.equal(c.diagnostico.dependeFatorR, true);
  });

  it("empresa que ainda não atendemos não é cadastrada: nada é criado e o erro explica", async () => {
    const { ana } = await usuarios();
    for (const [cnpj, exemplo] of [["24681357000140", "mei"], ["13579246000101", "fora-do-escopo"], ["55566677000183", "baixada"]] as const) {
      const r = await consultarParaCadastro(t.banco, ana, cnpj, { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo(exemplo) });
      assert.equal(r.tipo, "previa");
      assert.equal(r.previa.diagnostico.atendido, false, exemplo);
      await assert.rejects(cadastrarPelaPrevia(t.banco, ana, r.previa.token, { segredo: SEGREDO, agora: AGORA }), (e: unknown) => e instanceof ErroDeEmpresa && e.message === NAO_ATENDIDA);
    }
    assert.equal((await t.banco.select().from(empresas)).length, 0);
    assert.equal((await t.banco.select().from(empresaUsuarios)).length, 0);
    assert.equal((await t.banco.select().from(consultasCnpj)).length, 0);
  });

  it("o diagnóstico da confirmação usa o dia da consulta (assinado), não o relógio de quem confirma", async () => {
    // Exclusão do Simples marcada para o dia seguinte à consulta: na consulta a empresa é atendida; a confirmação, 20
    // minutos depois e já no outro dia, continua valendo (o que vale é a prévia que o cliente conferiu).
    const { ana } = await usuarios();
    const resposta = respostaGravada("ti-fator-r");
    resposta.data_exclusao_do_simples = "2026-10-17";
    const quase = new Date("2026-10-17T02:50:00Z"); // 23h50 de 16/10 em Brasília
    const r = await consultarParaCadastro(t.banco, ana, "12345678000195", { segredo: SEGREDO, agora: quase, buscar: buscarFalso({ status: 200, corpo: resposta }) });
    assert.ok(r.tipo === "previa" && r.previa.diagnostico.atendido);
    assert.ok(await cadastrarPelaPrevia(t.banco, ana, r.previa.token, { segredo: SEGREDO, agora: new Date(quase.getTime() + 20 * 60_000) }));
  });

  it("prévia de outro usuário ou vencida é recusada, e nada é criado", async () => {
    const { ana, beto } = await usuarios();
    const r = await consultarParaCadastro(t.banco, ana, "12345678000195", { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-fator-r") });
    assert.equal(r.tipo, "previa");
    await assert.rejects(cadastrarPelaPrevia(t.banco, beto, r.previa.token, { segredo: SEGREDO, agora: AGORA }), /expirou ou não confere/);
    await assert.rejects(cadastrarPelaPrevia(t.banco, ana, r.previa.token, { segredo: SEGREDO, agora: depois(31 * 60_000) }), /expirou/);
    assert.equal((await t.banco.select().from(empresas)).length, 0);
  });

  it("duas pessoas do quadro com a prévia do mesmo CNPJ: as duas ficam com o próprio provisório (o CNPJ não fica bloqueado)", async () => {
    const { ana, beto } = await usuarios();
    const opcoes = { segredo: SEGREDO, agora: AGORA };
    const pa = await consultarParaCadastro(t.banco, ana, "12345678000195", { ...opcoes, buscar: buscarExemplo("ti-fator-r") });
    const pb = await consultarParaCadastro(t.banco, beto, "12345678000195", { ...opcoes, buscar: buscarFalso() });
    assert.ok(pa.tipo === "previa" && pb.tipo === "previa");
    const idA = await cadastrarPelaPrevia(t.banco, ana, pa.previa.token, opcoes);
    const idB = await cadastrarPelaPrevia(t.banco, beto, pb.previa.token, opcoes);
    assert.equal(idA, idB);
    const vinculos = await t.banco.select().from(empresaUsuarios).where(eq(empresaUsuarios.empresaId, idA));
    assert.deepEqual(vinculos.map((v) => v.papel).sort(), ["PROVISORIO", "PROVISORIO"]);
    assert.equal((await t.banco.select().from(consultasCnpj)).length, 0);
    // Comprovada por um, o outro não entra mais.
    await comprovar(t.banco, ana, idA);
    const pc = await consultarParaCadastro(t.banco, ana, "12345678000195", { ...opcoes, buscar: buscarFalso() });
    assert.equal(pc.tipo, "ja-cadastrada");
    await assert.rejects(cadastrarPelaPrevia(t.banco, beto, pb.previa.token, opcoes), (e: unknown) => e instanceof ErroDeEmpresa && e.message === COMPROVADA_POR_OUTRA);
  });
});

describe("dadosDaReceita: banco primeiro", () => {
  it("consulta em dia vem do banco, sem chamar a BrasilAPI", async () => {
    const { acesso } = await cadastrada();
    const buscar = buscarFalso();
    const r = await dadosDaReceita(t.banco, acesso, { agora: depois(29 * DIA), buscar });
    assert.equal(r.fonte, "banco");
    assert.equal(r.consulta?.consultadaEm.toISOString(), AGORA.toISOString());
    assert.equal(buscar.chamadas.length, 0);
  });

  it("consulta vencida (mais de 30 dias): consulta de novo, guarda outra linha e acompanha a razão social", async () => {
    const { acesso, empresaId } = await cadastrada();
    const resposta = respostaGravada("ti-fator-r");
    resposta.razao_social = "EXEMPLO SOFTWARE E CONSULTORIA LTDA";
    const buscar = buscarFalso({ status: 200, corpo: resposta });
    const r = await dadosDaReceita(t.banco, acesso, { agora: depois(31 * DIA), buscar });
    assert.equal(r.fonte, "receita");
    assert.deepEqual(buscar.chamadas, ["https://brasilapi.com.br/api/cnpj/v1/12345678000195"]);
    assert.equal((await t.banco.select().from(consultasCnpj)).length, 2);
    assert.equal((await ultimaConsulta(t.banco, acesso))?.consultadaEm.toISOString(), depois(31 * DIA).toISOString());
    const [empresa] = await t.banco.select().from(empresas).where(eq(empresas.id, empresaId));
    assert.equal(empresa.razaoSocial, "EXEMPLO SOFTWARE E CONSULTORIA LTDA");
  });

  it("sem consulta guardada: consulta e guarda", async () => {
    const { ana } = await usuarios();
    const empresa = await criarEmpresa(t.banco, ana, { cnpj: "98765432000198", razaoSocial: "Suporte" });
    const acesso = await exigirAcessoEmpresa(t.banco, ana, empresa.id);
    const r = await dadosDaReceita(t.banco, acesso, { agora: AGORA, buscar: buscarExemplo("ti-anexo-iii") });
    assert.equal(r.fonte, "receita");
    assert.equal(r.consulta?.diagnostico.anexo, "III");
  });

  it("atualizar (forcar): consulta mesmo em dia, mas não duas vezes em menos de 5 minutos", async () => {
    const { acesso } = await cadastrada();
    const buscar = buscarExemplo("ti-fator-r");
    const r = await dadosDaReceita(t.banco, acesso, { agora: depois(DIA), forcar: true, buscar });
    assert.equal(r.fonte, "receita");
    const repetido = await dadosDaReceita(t.banco, acesso, { agora: depois(DIA + 4 * 60_000), forcar: true, buscar: buscarFalso() });
    assert.equal(repetido.fonte, "banco");
    assert.match(repetido.aviso!, /menos de 5 minutos/);
    assert.equal((await t.banco.select().from(consultasCnpj)).length, 2);
  });

  it("BrasilAPI fora do ar: mostra a consulta guardada com o erro; sem guardada, só o erro", async () => {
    const { ana, acesso } = await cadastrada();
    const r = await dadosDaReceita(t.banco, acesso, { agora: depois(40 * DIA), buscar: buscarFalso({ status: 503 }) });
    assert.equal(r.fonte, "banco");
    assert.ok(r.consulta);
    assert.match(r.erro!, /erro 503/);

    const outra = await criarEmpresa(t.banco, ana, { cnpj: "98765432000198", razaoSocial: "Suporte" });
    const vazio = await dadosDaReceita(t.banco, await exigirAcessoEmpresa(t.banco, ana, outra.id), { buscar: buscarFalso({ status: 429 }) });
    assert.equal(vazio.consulta, null);
    assert.match(vazio.erro!, /Muitas consultas/);
  });

  it("cada empresa vê só a própria consulta; acesso falso é recusado", async () => {
    const { beto, acesso } = await cadastrada();
    const deBeto = await criarEmpresa(t.banco, beto, { cnpj: "98765432000198", razaoSocial: "Suporte" });
    const acessoBeto = await exigirAcessoEmpresa(t.banco, beto, deBeto.id);
    assert.equal(await ultimaConsulta(t.banco, acessoBeto), null);
    assert.equal((await ultimaConsulta(t.banco, acesso))?.cnaePrincipal, "6201501");
    const falso = { ...acesso } as AcessoEmpresa;
    await assert.rejects(ultimaConsulta(t.banco, falso), SemAcessoEmpresa);
    await assert.rejects(dadosDaReceita(t.banco, falso, { buscar: buscarFalso() }), SemAcessoEmpresa);
    await assert.rejects(salvarConsulta(t.banco, falso, lerRespostaCnpj(respostaGravada("ti-fator-r")), AGORA), SemAcessoEmpresa);
  });

  it("consulta guardada antes das versões curtas do diagnóstico: a leitura refaz o diagnóstico com os dados guardados", async () => {
    const { acesso } = await cadastrada();
    const [linha] = await t.banco.select().from(consultasCnpj);
    const antigo: Partial<typeof linha.diagnostico> = { ...linha.diagnostico };
    delete antigo.impedimentos;
    delete antigo.observacoes;
    await t.banco.update(consultasCnpj).set({ diagnostico: antigo as typeof linha.diagnostico }).where(eq(consultasCnpj.id, linha.id));
    const lida = await ultimaConsulta(t.banco, acesso);
    assert.deepEqual(lida?.diagnostico, linha.diagnostico);
    assert.deepEqual(lida?.diagnostico.observacoes.map((n) => n.pergunta), ["Como declarar atividades de anexos diferentes?"]);
  });

  it("não guarda consulta de outro CNPJ na empresa", async () => {
    const { acesso } = await cadastrada();
    await assert.rejects(salvarConsulta(t.banco, acesso, lerRespostaCnpj(respostaGravada("ti-anexo-iii")), AGORA), /não do desta empresa/);
  });
});
