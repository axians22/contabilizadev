// Remoção definitiva da empresa (lib/empresas/remocao.ts) contra o Postgres de teste: só o DONO remove, com o CNPJ
// digitado; some tudo o que tem empresa_id (nenhuma linha órfã nem CNPJ/razão social em tabela nenhuma do banco), o
// registro interno do gasto com as chamadas fica só como número (anonimizado), as sessões não quebram e o CNPJ volta a
// poder ser cadastrado.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { desc, eq, sql } from "drizzle-orm";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { consultasCnpj, empresas, empresaUsuarios, serproChamadas, sessoes, termosAutorizacao } from "@/banco/esquema";
import { entrarComGoogle, resolverSessao } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa, SemAcessoEmpresa } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, CNPJ_RESERVADO, consultarParaCadastro } from "@/lib/empresas/cadastro";
import { abrirPortao } from "@/lib/empresas/portao";
import { CNPJ_NAO_CONFERE, removerEmpresa, TABELAS_ANONIMIZADAS, TABELAS_APAGADAS_COM_A_EMPRESA } from "@/lib/empresas/remocao";
import { criarEmpresa, definirEmpresaAtiva, empresasDaSessao, ErroDeEmpresa } from "@/lib/empresas/servico";
import { registroNoBanco } from "@/lib/serpro/registro";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps, perfil, SEGREDO } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const PERFIS = {
  ana: perfil("ana@a.com", "sub-ana"),
  beto: perfil("beto@b.com", "sub-beto"),
  caio: perfil("caio@c.com", "sub-caio"),
  adm: perfil("adm@x.dev", "sub-adm"),
};
const CONFIG = { adminEmails: ["adm@x.dev"] };
const CNPJ_A = "12345678000195"; // o da resposta gravada "ti-fator-r"
const CNPJ_B = "45723174000110";
const CNPJ_C = "11222333000181";
const AGORA = new Date("2026-10-16T15:00:00Z");
const semLog = () => {};

// Entra e devolve a sessão como o site a vê (com o sessaoId).
async function entrar(quem: keyof typeof PERFIS) {
  const d = deps(t.banco, PERFIS, CONFIG);
  const { cookie } = await entrarComGoogle(d, quem);
  const sessao = await resolverSessao(d, cookie);
  assert.ok(sessao);
  return sessao;
}

// Ana é DONA da Empresa A (cadastrada pelo fluxo completo, com a consulta da Receita guardada), com termo cifrado e
// chamadas de custo registradas; Caio é MEMBRO da A e da B; Beto é DONO da B. A está ativa nas sessões de Ana e Caio.
async function cenario() {
  const ana = await entrar("ana");
  const beto = await entrar("beto");
  const caio = await entrar("caio");
  const r = await consultarParaCadastro(t.banco, ana.usuario, CNPJ_A, { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-fator-r") });
  assert.equal(r.tipo, "previa");
  const a = await cadastrarPelaPrevia(t.banco, ana.usuario, r.previa.token, { segredo: SEGREDO, agora: new Date(AGORA.getTime() + 60_000) });
  const b = (await criarEmpresa(t.banco, beto.usuario, { cnpj: CNPJ_B, razaoSocial: "Empresa B Ltda" })).id;
  await t.banco.insert(empresaUsuarios).values([
    { empresaId: a, usuarioId: caio.usuario.id, papel: "MEMBRO" },
    { empresaId: b, usuarioId: caio.usuario.id, papel: "MEMBRO" },
  ]);
  for (const termoDe of [a, b]) {
    await t.banco.insert(termosAutorizacao).values({
      empresaId: termoDe,
      contratante: "43079489000141",
      enviadoPorId: ana.usuario.id,
      enviadoEm: AGORA,
      dataAssinatura: "2026-10-16",
      vigencia: "2027-10-16",
      certificadoValidoAte: new Date("2027-12-31T00:00:00Z"),
      signatarioCnpj: termoDe === a ? CNPJ_A : CNPJ_B,
      signatarioNome: "EMPRESA",
      xmlHash: `hash-${termoDe}`,
      termoCifrado: "termo-cifrado",
      tokenCifrado: "token-cifrado",
      tokenExpiraEm: new Date(AGORA.getTime() + 3_600_000),
    });
  }
  const registro = registroNoBanco(t.banco);
  const chamada = { quando: AGORA, acao: "Consultar" as const, servico: "PGDASD/CONSEXTRATO16", finalidade: "teste", status: 200, mensagens: "", custo: 0.4 };
  await registro.registrar({ ...chamada, contribuinte: CNPJ_A });
  await registro.registrar({ ...chamada, contribuinte: CNPJ_B });
  await definirEmpresaAtiva(t.banco, ana, a);
  await definirEmpresaAtiva(t.banco, caio, a);
  return { ana, beto, caio, a, b };
}

// Toda coluna do banco que aponta para empresas (chave estrangeira) ou se chama empresa_id, em qualquer tabela,
// inclusive as que o esquema ainda não conhece: nenhuma pode ficar com o id da empresa removida.
async function colunasDeEmpresa(): Promise<{ tabela: string; coluna: string }[]> {
  const linhas = await t.banco.execute<{ tabela: string; coluna: string }>(sql`
    select c.conrelid::regclass::text as tabela, a.attname as coluna
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
     where c.contype = 'f' and c.confrelid = 'public.empresas'::regclass
    union
    select table_name, column_name from information_schema.columns where table_schema = 'public' and column_name = 'empresa_id'`);
  return [...linhas];
}

async function linhasCom(empresaId: string) {
  const contagem: Record<string, number> = {};
  for (const { tabela, coluna } of await colunasDeEmpresa()) {
    const [r] = await t.banco.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier(tabela)} where ${sql.identifier(coluna)} = ${empresaId}`);
    contagem[`${tabela}.${coluna}`] = r.n;
  }
  return contagem;
}

describe("removerEmpresa: o DONO remove e tudo some", () => {
  it("apaga a empresa e as linhas de todas as tabelas com empresa_id; nenhuma linha órfã em lugar nenhum", async () => {
    const { ana, a, b } = await cenario();
    const antes = await linhasCom(a);
    // Confere que o cenário tem dado de verdade em cada lugar (senão o teste mede o vazio).
    for (const chave of ["empresa_usuarios.empresa_id", "consultas_cnpj.empresa_id", "termos_autorizacao.empresa_id", "serpro_chamadas.empresa_id", "sessoes.empresa_ativa_id"]) {
      assert.ok(antes[chave] > 0, `cenário sem linha em ${chave}`);
    }

    const r = await removerEmpresa(t.banco, ana, a, "12.345.678/0001-95", { log: semLog });
    assert.equal(r.removida.id, a);

    const depois = await linhasCom(a);
    for (const [chave, n] of Object.entries(depois)) assert.equal(n, 0, `linha órfã em ${chave}`);
    assert.equal((await t.banco.select().from(empresas).where(eq(empresas.id, a))).length, 0);
    // A outra empresa não perde nada.
    const daB = await linhasCom(b);
    assert.ok(daB["empresa_usuarios.empresa_id"] === 2 && daB["termos_autorizacao.empresa_id"] === 1 && daB["serpro_chamadas.empresa_id"] === 1);
  });

  it("o gasto das chamadas fica só como número: sem empresa_id, sem CNPJ e sem mensagens; data, tipo, serviço, status e custo ficam", async () => {
    const { ana, a } = await cenario();
    // Uma chamada de antes do cadastro (sem empresa_id, só com o CNPJ), com o CNPJ na finalidade e nas mensagens.
    await t.banco.insert(serproChamadas).values({
      quando: new Date("2026-10-01T12:00:00Z"),
      acao: "Emitir",
      servico: "PGDASD/GERARDAS12",
      finalidade: "Gerar a guia de 12.345.678/0001-95 (12345678000195)",
      contribuinte: CNPJ_A,
      empresaId: null,
      status: 400,
      mensagens: "Contribuinte 12345678000195 sem declaração",
      custo: 0.8,
    });
    await removerEmpresa(t.banco, ana, a, CNPJ_A, { log: semLog });

    const linhas = await t.banco.select().from(serproChamadas).orderBy(serproChamadas.id);
    const daB = linhas.filter((l) => l.contribuinte === CNPJ_B);
    assert.equal(daB.length, 1, "a chamada da outra empresa não muda");
    assert.ok(daB[0].empresaId);
    const anonimas = linhas.filter((l) => l.contribuinte === null);
    assert.equal(anonimas.length, 2);
    for (const l of anonimas) {
      assert.equal(l.empresaId, null);
      assert.equal(l.mensagens, "");
      assert.doesNotMatch(l.finalidade, /12345678000195|12\.345\.678\/0001-95/);
    }
    assert.deepEqual(
      anonimas.map((l) => [l.quando.toISOString(), l.acao, l.servico, l.status, l.custo]),
      [
        [AGORA.toISOString(), "Consultar", "PGDASD/CONSEXTRATO16", 200, 0.4],
        ["2026-10-01T12:00:00.000Z", "Emitir", "PGDASD/GERARDAS12", 400, 0.8],
      ],
    );
    assert.equal(anonimas[1].finalidade, "Gerar a guia de [removido] ([removido])");
    // O consumo do contrato (limite do período) continua contando as chamadas anonimizadas.
    const uso = await registroNoBanco(t.banco).consumo(new Date("2026-09-21T03:00:00Z"));
    assert.deepEqual(uso, { consulta: 2, emissao: 1, declaracao: 0 });
  });

  it("nenhuma coluna de texto de tabela nenhuma guarda o CNPJ ou a razão social da empresa removida", async () => {
    const { ana, a } = await cenario();
    const [empresa] = await t.banco.select().from(empresas).where(eq(empresas.id, a));
    const procurar = [CNPJ_A, "12.345.678/0001-95", empresa.razaoSocial];
    const colunas = await t.banco.execute<{ tabela: string; coluna: string }>(sql`
      select table_name as tabela, column_name as coluna from information_schema.columns
       where table_schema = 'public' and data_type in ('text', 'character varying', 'jsonb', 'json', 'ARRAY')`);
    assert.ok(colunas.length > 10);
    const achados = async () => {
      const lista: string[] = [];
      for (const { tabela, coluna } of colunas) {
        for (const valor of procurar) {
          const [r] = await t.banco.execute<{ n: number }>(
            sql`select count(*)::int as n from ${sql.identifier(tabela)} where ${sql.identifier(coluna)}::text ilike ${"%" + valor + "%"}`,
          );
          if (r.n > 0) lista.push(`${tabela}.${coluna} (${valor})`);
        }
      }
      return lista;
    };
    // Confere que a busca acha o dado antes (senão o teste mede o vazio).
    const antes = await achados();
    for (const c of ["empresas.cnpj", "empresas.razao_social", "consultas_cnpj.dados", "termos_autorizacao.signatario_cnpj", "serpro_chamadas.contribuinte"]) {
      assert.ok(antes.some((x) => x.startsWith(c + " ")), `cenário sem ${c}: ${antes.join(", ")}`);
    }
    await removerEmpresa(t.banco, ana, a, CNPJ_A, { log: semLog });
    assert.deepEqual(await achados(), []);
  });

  it("aceita o CNPJ sem pontuação, com espaços", async () => {
    const { ana, a } = await cenario();
    await removerEmpresa(t.banco, ana, a, " 12345678000195 ", { log: semLog });
    assert.equal((await t.banco.select().from(empresas).where(eq(empresas.id, a))).length, 0);
  });

  it("a lista de tabelas apagadas sai do esquema e cobre os vínculos, as consultas da Receita e o termo", () => {
    for (const n of ["empresa_usuarios", "consultas_cnpj", "termos_autorizacao"]) assert.ok(TABELAS_APAGADAS_COM_A_EMPRESA.includes(n), n);
    assert.deepEqual(TABELAS_ANONIMIZADAS, ["serpro_chamadas"]);
    assert.ok(!TABELAS_APAGADAS_COM_A_EMPRESA.includes("serpro_chamadas"));
  });

  it("registra no log quem removeu e quando, sem CNPJ nem razão social", async () => {
    const { ana, a } = await cenario();
    const log: string[] = [];
    await removerEmpresa(t.banco, ana, a, CNPJ_A, { log: (m) => log.push(m), agora: AGORA });
    assert.equal(log.length, 1);
    assert.ok(log[0].includes(a) && log[0].includes(ana.usuario.id) && log[0].includes(AGORA.toISOString()), log[0]);
    assert.doesNotMatch(log[0], /12345678000195|12\.345\.678|EXEMPLO SOFTWARE/i);
  });
});

describe("removerEmpresa: quem não pode", () => {
  async function continuaTudo(a: string) {
    const n = await linhasCom(a);
    assert.equal((await t.banco.select().from(empresas).where(eq(empresas.id, a))).length, 1);
    assert.ok(n["consultas_cnpj.empresa_id"] > 0 && n["termos_autorizacao.empresa_id"] > 0 && n["empresa_usuarios.empresa_id"] === 2);
  }

  it("MEMBRO não remove (nem com o CNPJ certo)", async () => {
    const { caio, a } = await cenario();
    await assert.rejects(removerEmpresa(t.banco, caio, a, CNPJ_A, { log: semLog }), (e) => e instanceof SemAcessoEmpresa && /Só o dono/.test(e.message));
    await continuaTudo(a);
  });

  it("usuário de outra empresa não remove (e recebe o mesmo erro de empresa inexistente)", async () => {
    const { beto, a } = await cenario();
    const erro = await removerEmpresa(t.banco, beto, a, CNPJ_A, { log: semLog }).catch((e: Error) => e);
    assert.ok(erro instanceof SemAcessoEmpresa);
    const inexistente = await removerEmpresa(t.banco, beto, "00000000-0000-4000-8000-000000000000", CNPJ_A, { log: semLog }).catch((e: Error) => e);
    assert.equal((erro as Error).message, (inexistente as Error).message);
    await continuaTudo(a);
  });

  it("id malformado é só 'não encontrada'", async () => {
    const { ana } = await cenario();
    for (const id of ["", "1 or 1=1", "'; drop table empresas; --"]) {
      await assert.rejects(removerEmpresa(t.banco, ana, id, CNPJ_A, { log: semLog }), SemAcessoEmpresa, id);
    }
  });

  it("CNPJ digitado errado, incompleto ou vazio não remove nada", async () => {
    const { ana, a } = await cenario();
    for (const cnpj of ["12.345.678/0001-96", CNPJ_B, "1234567800019", "", "   "]) {
      await assert.rejects(removerEmpresa(t.banco, ana, a, cnpj, { log: semLog }), (e) => e instanceof ErroDeEmpresa && e.message === CNPJ_NAO_CONFERE, cnpj);
    }
    await continuaTudo(a);
  });

  it("CNPJ errado não deixa log de remoção", async () => {
    const { ana, a } = await cenario();
    const log: string[] = [];
    await removerEmpresa(t.banco, ana, a, CNPJ_B, { log: (m) => log.push(m) }).catch(() => {});
    assert.deepEqual(log, []);
  });
});

describe("removerEmpresa: empresa ativa e sessões", () => {
  it("sem outra empresa: a sessão fica sem empresa ativa e o portão cai no estado vazio", async () => {
    const { ana, a } = await cenario();
    const r = await removerEmpresa(t.banco, ana, a, CNPJ_A, { log: semLog });
    assert.equal(r.novaAtiva, null);
    const [s] = await t.banco.select().from(sessoes).where(eq(sessoes.id, ana.sessaoId));
    assert.equal(s.empresaAtivaId, null);
    const { empresas: lista, empresaAtiva } = await empresasDaSessao(t.banco, { ...ana, empresaAtivaId: s.empresaAtivaId });
    assert.deepEqual(lista, []);
    assert.equal((await abrirPortao(t.banco, ana.usuario, empresaAtiva)).estado, "sem-empresa");
  });

  it("com duas empresas: a outra vira a ativa", async () => {
    const { ana, a } = await cenario();
    const c = (await criarEmpresa(t.banco, ana.usuario, { cnpj: CNPJ_C, razaoSocial: "Empresa C Ltda" })).id;
    await definirEmpresaAtiva(t.banco, ana, a);
    const r = await removerEmpresa(t.banco, ana, a, CNPJ_A, { log: semLog });
    assert.equal(r.ativaMudou, true);
    assert.deepEqual(r.novaAtiva, { id: c, razaoSocial: "Empresa C Ltda" });
    const [s] = await t.banco.select().from(sessoes).where(eq(sessoes.id, ana.sessaoId));
    assert.equal(s.empresaAtivaId, c);
    const portao = await abrirPortao(t.banco, ana.usuario, (await empresasDaSessao(t.banco, { ...ana, empresaAtivaId: c })).empresaAtiva);
    assert.equal(portao.estado, "liberado");
  });

  it("removendo uma empresa que não é a ativa (aba antiga): a ativa da sessão continua a mesma", async () => {
    const { ana, a } = await cenario();
    const c = (await criarEmpresa(t.banco, ana.usuario, { cnpj: CNPJ_C, razaoSocial: "Empresa C Ltda" })).id;
    await definirEmpresaAtiva(t.banco, ana, c);
    const r = await removerEmpresa(t.banco, ana, a, CNPJ_A, { log: semLog });
    assert.equal(r.ativaMudou, false);
    assert.equal(r.novaAtiva, null);
    const [s] = await t.banco.select().from(sessoes).where(eq(sessoes.id, ana.sessaoId));
    assert.equal(s.empresaAtivaId, c);
  });

  it("sessões de outros usuários com a empresa ativa ficam sem empresa ativa e continuam funcionando", async () => {
    const { ana, caio, a, b } = await cenario();
    // Outra sessão da própria Ana (outro navegador) também tinha a empresa ativa.
    const outraDaAna = await entrar("ana");
    await definirEmpresaAtiva(t.banco, outraDaAna, a);
    await removerEmpresa(t.banco, ana, a, CNPJ_A, { log: semLog });

    const [sCaio] = await t.banco.select().from(sessoes).where(eq(sessoes.id, caio.sessaoId));
    assert.equal(sCaio.empresaAtivaId, null);
    const [sOutra] = await t.banco.select().from(sessoes).where(eq(sessoes.id, outraDaAna.sessaoId));
    assert.equal(sOutra.empresaAtivaId, null);
    // A sessão do Caio continua valendo; na tela, a empresa que sobrou para ele (B) aparece, e a removida não.
    const d = deps(t.banco, PERFIS, CONFIG);
    const relida = await resolverSessao(d, (await entrarComGoogle(d, "caio")).cookie);
    assert.ok(relida);
    const daSessao = await empresasDaSessao(t.banco, { usuario: caio.usuario, empresaAtivaId: sCaio.empresaAtivaId });
    assert.deepEqual(daSessao.empresas.map((e) => e.id), [b]);
    assert.equal(daSessao.empresaAtiva?.id, b);
    await assert.rejects(exigirAcessoEmpresa(t.banco, caio.usuario, a), SemAcessoEmpresa);
  });

  it("corrida: duas remoções ao mesmo tempo, uma remove e a outra recebe 'não encontrada', sem erro do banco", async () => {
    const { ana, a } = await cenario();
    const outra = await entrar("ana");
    const resultados = await Promise.allSettled([
      removerEmpresa(t.banco, ana, a, CNPJ_A, { log: semLog }),
      removerEmpresa(t.banco, outra, a, CNPJ_A, { log: semLog }),
      removerEmpresa(t.banco, ana, a, CNPJ_A, { log: semLog }),
    ]);
    assert.equal(resultados.filter((r) => r.status === "fulfilled").length, 1);
    for (const r of resultados) if (r.status === "rejected") assert.ok(r.reason instanceof SemAcessoEmpresa, String(r.reason));
    for (const [chave, n] of Object.entries(await linhasCom(a))) assert.equal(n, 0, chave);
  });
});

describe("depois de remover, o CNPJ pode ser cadastrado de novo", () => {
  async function cadastrar(sessao: { usuario: { id: string; papel?: "COMMON_USER" | "MANAGER" | "ADMIN" } }, cnpjReservado?: string) {
    const r = await consultarParaCadastro(t.banco, sessao.usuario, CNPJ_A, { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-fator-r"), cnpjReservado });
    assert.equal(r.tipo, "previa");
    return cadastrarPelaPrevia(t.banco, sessao.usuario, r.previa.token, { segredo: SEGREDO, agora: new Date(AGORA.getTime() + 60_000), cnpjReservado });
  }

  it("pelo assistente, pelo mesmo dono ou por outra pessoa", async () => {
    const { ana, beto, a } = await cenario();
    await removerEmpresa(t.banco, ana, a, CNPJ_A, { log: semLog });
    const deNovo = await cadastrar(ana);
    assert.notEqual(deNovo, a);
    // A empresa nova começa limpa: só o vínculo de dono e a consulta nova, sem termo antigo.
    assert.equal((await t.banco.select().from(termosAutorizacao).where(eq(termosAutorizacao.empresaId, deNovo))).length, 0);
    assert.equal((await t.banco.select().from(consultasCnpj).where(eq(consultasCnpj.empresaId, deNovo))).length, 1);

    const sessaoNova = await entrar("ana");
    await removerEmpresa(t.banco, sessaoNova, deNovo, CNPJ_A, { log: semLog });
    const doBeto = await cadastrar(beto);
    assert.equal((await exigirAcessoEmpresa(t.banco, beto.usuario, doBeto)).papel, "DONO");
  });

  it("a empresa da plataforma: depois de removida, só ADMIN cadastra de novo", async () => {
    const adm = await entrar("adm");
    const beto = await entrar("beto");
    assert.equal(adm.usuario.papel, "ADMIN");
    const id = await cadastrar(adm, CNPJ_A);
    await removerEmpresa(t.banco, adm, id, CNPJ_A, { log: semLog });
    await assert.rejects(
      consultarParaCadastro(t.banco, beto.usuario, CNPJ_A, { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-fator-r"), cnpjReservado: CNPJ_A }),
      (e) => e instanceof ErroDeEmpresa && e.message === CNPJ_RESERVADO,
    );
    const deNovo = await cadastrar(adm, CNPJ_A);
    assert.equal((await exigirAcessoEmpresa(t.banco, adm.usuario, deNovo)).papel, "DONO");
  });
});

describe("registro de chamadas: vínculo com a empresa pelo CNPJ", () => {
  it("liga a chamada à empresa do CNPJ; CNPJ sem empresa cadastrada (ou sem contribuinte) entra sem CNPJ e sem vínculo", async () => {
    const { a } = await cenario();
    const registro = registroNoBanco(t.banco);
    const base = { quando: AGORA, acao: "Consultar" as const, servico: "X/Y", finalidade: "teste", status: 200, mensagens: "", custo: 0 };
    await registro.registrar({ ...base, contribuinte: CNPJ_C });
    await registro.registrar({ ...base, acao: "Autenticar" as const, contribuinte: null });
    const linhas = await t.banco.select({ c: serproChamadas.contribuinte, e: serproChamadas.empresaId }).from(serproChamadas).orderBy(serproChamadas.id);
    assert.deepEqual(linhas.map((l) => [l.c, l.e]), [
      [CNPJ_A, a],
      [CNPJ_B, linhas[1].e],
      [null, null],
      [null, null],
    ]);
    assert.ok(linhas[1].e);
  });

  it("chamada que termina depois da remoção entra já anonimizada (e conta no consumo)", async () => {
    const { ana, a } = await cenario();
    await removerEmpresa(t.banco, ana, a, CNPJ_A, { log: semLog });
    const registro = registroNoBanco(t.banco);
    await registro.registrar({ quando: AGORA, acao: "Consultar", servico: "X/Y", finalidade: "guia de 12.345.678/0001-95", contribuinte: CNPJ_A, status: 200, mensagens: `CNPJ ${CNPJ_A}`, custo: 0.4 });
    assert.equal((await t.banco.select().from(serproChamadas).where(eq(serproChamadas.contribuinte, CNPJ_A))).length, 0);
    const [ultima] = await t.banco.select().from(serproChamadas).orderBy(desc(serproChamadas.id)).limit(1);
    assert.deepEqual([ultima.contribuinte, ultima.empresaId, ultima.mensagens, ultima.finalidade, ultima.custo], [null, null, "", "guia de [removido]", 0.4]);
    assert.equal((await registro.consumo(new Date("2026-09-21T03:00:00Z"))).consulta, 3);
  });

  it("corrida: chamadas registradas enquanto a remoção corre não travam nem deixam o CNPJ", async () => {
    const { ana, a } = await cenario();
    const registro = registroNoBanco(t.banco);
    const chamada = { quando: AGORA, acao: "Consultar" as const, servico: "X/Y", finalidade: "teste", contribuinte: CNPJ_A, status: 200, mensagens: `CNPJ ${CNPJ_A}`, custo: 0.4 };
    const resultados = await Promise.allSettled([
      registro.registrar(chamada),
      removerEmpresa(t.banco, ana, a, CNPJ_A, { log: semLog }),
      registro.registrar(chamada),
      registro.registrar(chamada),
    ]);
    for (const r of resultados) assert.equal(r.status, "fulfilled", String((r as PromiseRejectedResult).reason));
    const linhas = await t.banco.select().from(serproChamadas);
    assert.equal(linhas.length, 5);
    for (const l of linhas.filter((l) => l.contribuinte !== CNPJ_B)) {
      assert.equal(l.contribuinte, null);
      assert.equal(l.empresaId, null);
      assert.doesNotMatch(l.mensagens, /12345678000195/);
    }
  });

  it("a remoção não espera o registro de uma chamada feita durante o envio do termo (trava sem bloquear a chave estrangeira)", async () => {
    const { ana, a } = await cenario();
    // Uma transação segura a empresa como o envio do termo faz, e o registro roda em outra conexão no meio dela.
    await t.banco.transaction(async (tx) => {
      await tx.select({ id: empresas.id }).from(empresas).where(eq(empresas.id, a)).for("no key update");
      await Promise.race([
        registroNoBanco(t.banco).registrar({ quando: AGORA, acao: "Consultar", servico: "X/Y", finalidade: "teste", contribuinte: CNPJ_A, status: 200, mensagens: "", custo: 0 }),
        new Promise((_, falhar) => setTimeout(() => falhar(new Error("registro travado pela trava da empresa")), 3000)),
      ]);
    });
    assert.equal((await t.banco.select().from(serproChamadas).where(eq(serproChamadas.empresaId, a))).length, 2);
    await removerEmpresa(t.banco, ana, a, CNPJ_A, { log: semLog });
  });
});
