// Portão do acesso em camadas (lib/empresas/portao.ts) contra o Postgres de teste: os três caminhos (sem empresa, sem
// plano, liberado), o acesso aos dados só no caminho liberado, e o mesmo usuário com duas empresas alternando a ativa.
// O plano hoje sempre libera (Parte 9): o caminho "sem plano" é provado injetando a conferência do plano.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { lerRespostaCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { respostaGravada } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { empresaUsuarios } from "@/banco/esquema";
import { entrarComGoogle, resolverSessao } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa, SemAcessoEmpresa } from "@/lib/empresas/acesso";
import { abrirPortao, exigirAcessoAoConteudo, planoAtivo, SemPlanoAtivo, type Portao } from "@/lib/empresas/portao";
import { salvarConsulta, ultimaConsulta } from "@/lib/empresas/receita";
import { criarEmpresa, definirEmpresaAtiva, empresasDaSessao, listarEmpresasDoUsuario } from "@/lib/empresas/servico";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps, perfil } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const PERFIS = { ana: perfil("ana@a.com", "sub-ana"), beto: perfil("beto@b.com", "sub-beto") };
const AGORA = new Date("2026-10-17T15:00:00Z");
// CNPJs das respostas gravadas da Receita (nucleo/src/brasilapi/exemplos).
const CNPJ_FATOR_R = "12345678000195"; // ti-fator-r: EXEMPLO SOFTWARE LTDA
const CNPJ_ANEXO_III = "98765432000198"; // ti-anexo-iii

// O que o servidor faz a cada requisição (sessaoAtual + exigirConteudo), sem o Next: sessão do cookie, empresas do
// usuário, empresa ativa e a decisão do portão.
async function portaoDaRequisicao(cookie: string, opcoes: Parameters<typeof abrirPortao>[3] = {}) {
  const sessao = (await resolverSessao(deps(t.banco), cookie))!;
  const { empresas, empresaAtiva } = await empresasDaSessao(t.banco, sessao);
  return { sessao, empresas, empresaAtiva, portao: await abrirPortao(t.banco, sessao.usuario, empresaAtiva, opcoes) };
}

function liberado(portao: Portao) {
  assert.equal(portao.estado, "liberado");
  return portao as Extract<Portao, { estado: "liberado" }>;
}

describe("planoAtivo (ponto único da exigência de plano)", () => {
  it("hoje sempre libera: a cobrança chega na Parte 9", async () => {
    assert.equal(await planoAtivo({ id: "00000000-0000-0000-0000-000000000000" }), true);
  });
});

describe("abrirPortao: os três caminhos", () => {
  it("sem empresa cadastrada: 'sem-empresa', sem acesso nenhum a dado de empresa", async () => {
    const ana = await entrarComGoogle(deps(t.banco, PERFIS), "ana");
    const { empresas, empresaAtiva, portao } = await portaoDaRequisicao(ana.cookie);
    assert.deepEqual(empresas, []);
    assert.equal(empresaAtiva, null);
    assert.deepEqual(portao, { estado: "sem-empresa" });
    assert.ok(!("acesso" in portao));
  });

  it("com empresa e sem plano ativo (injetado): 'sem-plano' com a empresa, mas sem o acesso aos dados", async () => {
    const ana = await entrarComGoogle(deps(t.banco, PERFIS), "ana");
    const a = await criarEmpresa(t.banco, ana.usuario, { cnpj: CNPJ_FATOR_R, razaoSocial: "Empresa A" });
    const perguntado: string[] = [];
    const { portao } = await portaoDaRequisicao(ana.cookie, {
      planoAtivo: (e) => {
        perguntado.push(e.id);
        return false;
      },
    });
    assert.equal(portao.estado, "sem-plano");
    assert.equal(portao.estado === "sem-plano" && portao.empresa.id, a.id);
    assert.ok(!("acesso" in portao), "sem plano não sai o AcessoEmpresa");
    assert.deepEqual(perguntado, [a.id], "o plano é conferido para a empresa ativa");
    // Assíncrono também (a Parte 9 vai consultar o banco).
    assert.equal((await portaoDaRequisicao(ana.cookie, { planoAtivo: async () => false })).portao.estado, "sem-plano");
  });

  it("com empresa e plano ativo (o padrão de hoje): 'liberado', e o acesso lê os dados da empresa", async () => {
    const ana = await entrarComGoogle(deps(t.banco, PERFIS), "ana");
    const a = await criarEmpresa(t.banco, ana.usuario, { cnpj: CNPJ_FATOR_R, razaoSocial: "Empresa A" });
    await salvarConsulta(t.banco, await exigirAcessoEmpresa(t.banco, ana.usuario, a.id), lerRespostaCnpj(respostaGravada("ti-fator-r")), AGORA);
    const p = liberado((await portaoDaRequisicao(ana.cookie)).portao);
    assert.equal(p.empresa.id, a.id);
    assert.equal(p.acesso.empresaId, a.id);
    assert.equal(p.acesso.papel, "DONO");
    assert.equal((await ultimaConsulta(t.banco, p.acesso))?.dados.cnpj, CNPJ_FATOR_R);
  });

  it("vínculo tirado depois de a sessão escolher a empresa: volta a 'sem-empresa' (não vaza o acesso)", async () => {
    const ana = await entrarComGoogle(deps(t.banco, PERFIS), "ana");
    const a = await criarEmpresa(t.banco, ana.usuario, { cnpj: CNPJ_FATOR_R, razaoSocial: "Empresa A" });
    const [empresaAtiva] = await listarEmpresasDoUsuario(t.banco, ana.usuario);
    await t.banco.delete(empresaUsuarios).where(and(eq(empresaUsuarios.empresaId, a.id), eq(empresaUsuarios.usuarioId, ana.usuario.id)));
    assert.deepEqual(await abrirPortao(t.banco, ana.usuario, empresaAtiva), { estado: "sem-empresa" });
  });

  it("empresa de outro usuário apontada como ativa: 'sem-empresa', e o plano nem é perguntado", async () => {
    const ana = await entrarComGoogle(deps(t.banco, PERFIS), "ana");
    const beto = await entrarComGoogle(deps(t.banco, PERFIS), "beto");
    const b = await criarEmpresa(t.banco, beto.usuario, { cnpj: CNPJ_ANEXO_III, razaoSocial: "Empresa B" });
    let perguntou = false;
    const portao = await abrirPortao(t.banco, ana.usuario, { id: b.id, cnpj: b.cnpj, razaoSocial: b.razaoSocial, papel: "DONO" }, {
      planoAtivo: () => (perguntou = true),
    });
    assert.deepEqual(portao, { estado: "sem-empresa" });
    assert.equal(perguntou, false);
  });
});

describe("exigirAcessoAoConteudo (server actions)", () => {
  it("com vínculo e plano: devolve o acesso; sem plano: SemPlanoAtivo (que é um SemAcessoEmpresa); sem vínculo: SemAcessoEmpresa", async () => {
    const ana = await entrarComGoogle(deps(t.banco, PERFIS), "ana");
    const beto = await entrarComGoogle(deps(t.banco, PERFIS), "beto");
    const a = await criarEmpresa(t.banco, ana.usuario, { cnpj: CNPJ_FATOR_R, razaoSocial: "Empresa A" });
    assert.equal((await exigirAcessoAoConteudo(t.banco, ana.usuario, a.id)).empresaId, a.id);
    const semPlano = exigirAcessoAoConteudo(t.banco, ana.usuario, a.id, { planoAtivo: () => false });
    await assert.rejects(semPlano, SemPlanoAtivo);
    await assert.rejects(exigirAcessoAoConteudo(t.banco, ana.usuario, a.id, { planoAtivo: () => false }), SemAcessoEmpresa);
    await assert.rejects(exigirAcessoAoConteudo(t.banco, ana.usuario, a.id, { planoAtivo: () => false }), /escolha um plano/);
    await assert.rejects(exigirAcessoAoConteudo(t.banco, beto.usuario, a.id), (e) => e instanceof SemAcessoEmpresa && !(e instanceof SemPlanoAtivo));
  });
});

describe("o mesmo usuário com duas empresas", () => {
  it("cadastra duas, é DONO das duas, alterna a ativa e cada uma mostra só os próprios dados", async () => {
    const ana = await entrarComGoogle(deps(t.banco, PERFIS), "ana");

    // Zero empresas: o portão fica fechado ("cadastre a empresa").
    assert.equal((await portaoDaRequisicao(ana.cookie)).portao.estado, "sem-empresa");

    const a = await criarEmpresa(t.banco, ana.usuario, { cnpj: CNPJ_FATOR_R, razaoSocial: "Alfa Software Ltda" });
    const b = await criarEmpresa(t.banco, ana.usuario, { cnpj: CNPJ_ANEXO_III, razaoSocial: "Beta Sistemas Ltda" });
    await salvarConsulta(t.banco, await exigirAcessoEmpresa(t.banco, ana.usuario, a.id), lerRespostaCnpj(respostaGravada("ti-fator-r")), AGORA);
    await salvarConsulta(t.banco, await exigirAcessoEmpresa(t.banco, ana.usuario, b.id), lerRespostaCnpj(respostaGravada("ti-anexo-iii")), AGORA);

    const lista = await listarEmpresasDoUsuario(t.banco, ana.usuario);
    assert.deepEqual(
      lista.map((e) => [e.id, e.razaoSocial, e.papel]),
      [
        [a.id, "Alfa Software Ltda", "DONO"],
        [b.id, "Beta Sistemas Ltda", "DONO"],
      ],
    );

    // Sem escolha na sessão, a ativa é a primeira (Alfa) e o portão libera a Alfa com os dados dela.
    let r = await portaoDaRequisicao(ana.cookie);
    assert.equal(r.empresaAtiva?.id, a.id);
    let p = liberado(r.portao);
    assert.equal(p.acesso.empresaId, a.id);
    assert.equal((await ultimaConsulta(t.banco, p.acesso))?.dados.cnpj, CNPJ_FATOR_R);

    // Troca para a Beta: os dados passam a ser só os da Beta.
    await definirEmpresaAtiva(t.banco, r.sessao, b.id);
    r = await portaoDaRequisicao(ana.cookie);
    assert.equal(r.empresaAtiva?.id, b.id);
    p = liberado(r.portao);
    assert.equal(p.acesso.empresaId, b.id);
    const consultaB = await ultimaConsulta(t.banco, p.acesso);
    assert.equal(consultaB?.dados.cnpj, CNPJ_ANEXO_III);
    assert.equal(consultaB?.empresaId, b.id);

    // E volta para a Alfa.
    await definirEmpresaAtiva(t.banco, r.sessao, a.id);
    p = liberado((await portaoDaRequisicao(ana.cookie)).portao);
    assert.equal(p.acesso.empresaId, a.id);
    const consultaA = await ultimaConsulta(t.banco, p.acesso);
    assert.equal(consultaA?.dados.cnpj, CNPJ_FATOR_R);
    assert.equal(consultaA?.empresaId, a.id);
  });

  it("o plano é por empresa: com a Alfa sem plano, a Alfa fica fechada e a Beta liberada", async () => {
    const ana = await entrarComGoogle(deps(t.banco, PERFIS), "ana");
    const a = await criarEmpresa(t.banco, ana.usuario, { cnpj: CNPJ_FATOR_R, razaoSocial: "Alfa Software Ltda" });
    const b = await criarEmpresa(t.banco, ana.usuario, { cnpj: CNPJ_ANEXO_III, razaoSocial: "Beta Sistemas Ltda" });
    const soBeta = { planoAtivo: (e: { id: string }) => e.id === b.id };
    const r = await portaoDaRequisicao(ana.cookie, soBeta);
    assert.equal(r.portao.estado, "sem-plano");
    assert.equal(r.portao.estado === "sem-plano" && r.portao.empresa.id, a.id);
    await definirEmpresaAtiva(t.banco, r.sessao, b.id);
    assert.equal(liberado((await portaoDaRequisicao(ana.cookie, soBeta)).portao).acesso.empresaId, b.id);
  });
});
