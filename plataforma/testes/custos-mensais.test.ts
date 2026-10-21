// Custo mensal e custo total das chamadas ao Serpro (lib/serpro/custos.ts, tela /admin/custos): uma linha por período de
// cobrança com o preço da faixa de cada tipo, o período atual mesmo vazio e o total, que tem de bater com a soma dos meses
// e com o "Desde o início" do custo por cliente. Banco de TESTE (contabilizadev_teste); nenhuma chamada externa.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { custoMensal, type TipoRequisicao } from "@contabilizadev/nucleo/serpro/precos";
import { empresas, serproChamadas } from "@/banco/esquema";
import { removerEmpresa } from "@/lib/empresas/remocao";
import { criarEmpresa } from "@/lib/empresas/servico";
import { calcularCustos, calcularCustosMensais, custosMensais, custosPorCliente, DESDE_O_INICIO, type Grupo, type Quem } from "@/lib/serpro/custos";
import { registroNoBanco } from "@/lib/serpro/registro";
import { entrarComGoogle, resolverSessao } from "@/lib/autenticacao/servico";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps, perfil } from "./apoio";

const A: Quem = { tipo: "empresa", empresaId: "a" };
const B: Quem = { tipo: "empresa", empresaId: "b" };
const g = (periodo: string, quem: Quem, tipo: TipoRequisicao, quantidade: number): Grupo => ({ periodo, quem, tipo, quantidade });
const zero = { consulta: 0, emissao: 0, declaracao: 0 };

describe("custo mensal: o cálculo (sem banco)", () => {
  it("troca de faixa entre meses: cada período com o preço da faixa do seu total, por tipo", () => {
    const m = calcularCustosMensais(
      [g("2026-08-21", A, "consulta", 300), g("2026-09-21", A, "consulta", 1), g("2026-09-21", B, "consulta", 300), g("2026-09-21", B, "emissao", 2)],
      "2026-09-21",
    );
    assert.deepEqual(
      m.periodos.map((p) => [p.periodo, p.quantidades, p.precos, p.centavos]),
      [
        ["2026-09-21", { consulta: 301, emissao: 2, declaracao: 0 }, { consulta: 21, emissao: 32, declaracao: 40 }, 301 * 21 + 2 * 32],
        ["2026-08-21", { consulta: 300, emissao: 0, declaracao: 0 }, { consulta: 24, emissao: 32, declaracao: 40 }, 300 * 24],
      ],
    );
    assert.deepEqual(m.total, { quantidades: { consulta: 601, emissao: 2, declaracao: 0 }, chamadas: 603, centavos: 300 * 24 + 301 * 21 + 64 });
    assert.equal(m.atual.periodo, "2026-09-21");
    assert.equal(m.atual.centavos, 301 * 21 + 64);
  });

  it("o período atual aparece mesmo vazio, no topo, e não muda o total", () => {
    const m = calcularCustosMensais([g("2026-09-21", A, "declaracao", 101)], "2026-10-21");
    assert.deepEqual(m.periodos.map((p) => [p.periodo, p.centavos]), [["2026-10-21", 0], ["2026-09-21", 101 * 36]]);
    assert.deepEqual(m.atual.quantidades, zero);
    assert.equal(m.atual.centavos, 0);
    assert.equal(m.total.centavos, 101 * 36);
    assert.equal(m.total.chamadas, 101);
  });

  it("sem chamadas: só o período atual, zerado; quantidade zero não cria período", () => {
    const m = calcularCustosMensais([g("2026-05-21", A, "consulta", 0)], "2026-10-21");
    assert.deepEqual(m.periodos.map((p) => p.periodo), ["2026-10-21"]);
    assert.deepEqual(m.total, { quantidades: zero, chamadas: 0, centavos: 0 });
  });

  it("soma dos meses = total = 'Desde o início' por cliente; cada mês = soma dos clientes nele, em qualquer combinação", () => {
    let semente = 11;
    const aleatorio = (max: number) => ((semente = (semente * 1_103_515_245 + 12_345) % 2_147_483_648), semente % max);
    const quem: Quem[] = [A, B, { tipo: "removidas" }, { tipo: "plataforma" }];
    const periodos = ["2026-06-21", "2026-07-21", "2026-08-21", "2026-09-21"];
    for (let rodada = 0; rodada < 200; rodada++) {
      const grupos: Grupo[] = [];
      for (const periodo of periodos)
        for (const q of quem)
          for (const tipo of ["consulta", "emissao", "declaracao"] as const) grupos.push(g(periodo, q, tipo, aleatorio(4) === 0 ? aleatorio(12_000) : aleatorio(40)));
      const m = calcularCustosMensais(grupos, "2026-10-21");
      assert.equal(m.periodos.reduce((s, p) => s + p.centavos, 0), m.total.centavos, `rodada ${rodada}`);
      assert.equal(m.total.centavos, calcularCustos(grupos).total.centavos, `rodada ${rodada}`);
      for (const p of m.periodos) {
        const doPeriodo = calcularCustos(grupos.filter((x) => x.periodo === p.periodo));
        assert.equal(p.centavos, doPeriodo.linhas.reduce((s, l) => s + l.centavos, 0), `${rodada} ${p.periodo}`);
        assert.equal(p.centavos, Math.round(custoMensal(p.quantidades) * 100), `${rodada} ${p.periodo}`);
      }
    }
  });
});

describe("custo mensal: no banco de teste", () => {
  let t: BancoDeTeste;
  before(async () => (t = await prepararBancoDeTeste()));
  beforeEach(() => t.limpar());
  after(() => t.fechar());

  type Chamada = { quando: string; acao: string; empresaId?: string | null; semContribuinte?: boolean };
  const gravar = (lista: Chamada[]) =>
    t.banco.insert(serproChamadas).values(
      lista.map((c) => ({
        quando: new Date(c.quando),
        acao: c.acao,
        servico: "TESTE",
        finalidade: "teste",
        empresaId: c.empresaId ?? null,
        semContribuinte: c.semContribuinte ?? false,
        status: 200,
        mensagens: "",
        custo: 0.24,
      })),
    );
  const nova = async (cnpj: string, razaoSocial: string) => (await t.banco.insert(empresas).values({ cnpj, razaoSocial }).returning({ id: empresas.id }))[0].id;
  const vezes = (n: number, c: Chamada): Chamada[] => Array.from({ length: n }, () => c);
  const agora = new Date("2026-10-21T10:00:00-03:00");

  it("banco vazio: só o período atual, zerado", async () => {
    const m = await custosMensais(t.banco, agora);
    assert.deepEqual(m.periodos.map((p) => [p.periodo, p.centavos]), [["2026-10-21", 0]]);
    assert.deepEqual(m.total, { quantidades: zero, chamadas: 0, centavos: 0 });
  });

  it("fronteira 20/21 no horário de Brasília e Autenticar fora (período só com autenticação não vira linha)", async () => {
    const a = await nova("11222333000181", "Alfa Ltda");
    await gravar([
      { quando: "2026-09-20T23:59:59-03:00", acao: "Consultar", empresaId: a },
      { quando: "2026-09-21T00:00:00-03:00", acao: "Consultar", empresaId: a },
      // Já 21/10 em UTC, ainda 20/10 em Brasília: do período de 21/09.
      { quando: "2026-10-21T02:30:00Z", acao: "Emitir", empresaId: a },
      { quando: "2026-10-21T00:00:00-03:00", acao: "Declarar", empresaId: a },
      ...vezes(4, { quando: "2026-10-21T08:00:00-03:00", acao: "Autenticar", semContribuinte: true }),
      { quando: "2026-06-30T10:00:00-03:00", acao: "Autenticar", semContribuinte: true },
    ]);
    const m = await custosMensais(t.banco, agora);
    assert.deepEqual(
      m.periodos.map((p) => [p.periodo, p.quantidades, p.centavos]),
      [
        ["2026-10-21", { consulta: 0, emissao: 0, declaracao: 1 }, 40],
        ["2026-09-21", { consulta: 1, emissao: 1, declaracao: 0 }, 24 + 32],
        ["2026-08-21", { consulta: 1, emissao: 0, declaracao: 0 }, 24],
      ],
    );
    assert.equal(m.total.chamadas, 4);
    assert.equal(m.total.centavos, 120);
    // No dia 20 às 23h, o atual ainda é o de 21/09 (o de 21/10 tem chamada e continua na lista, mas não é o atual).
    const antes = await custosMensais(t.banco, new Date("2026-10-20T23:00:00-03:00"));
    assert.equal(antes.atual.periodo, "2026-09-21");
    assert.equal(antes.atual.centavos, 56);
  });

  it("empresas removidas e a plataforma contam no total; soma dos meses = total = 'Desde o início' por cliente", async () => {
    const d = deps(t.banco, { ana: perfil("ana@a.com", "sub-ana") });
    const sessao = await resolverSessao(d, (await entrarComGoogle(d, "ana")).cookie);
    assert.ok(sessao);
    const removida = (await criarEmpresa(t.banco, sessao.usuario, { cnpj: "45723174000110", razaoSocial: "Beta Ltda" })).id;
    const a = await nova("11222333000181", "Alfa Ltda");
    const plataforma = await nova("43079489000141", "Plataforma Ltda");
    const registro = registroNoBanco(t.banco);
    const base = { servico: "TESTE", finalidade: "teste", status: 200, mensagens: "", custo: 0.24 };
    for (let i = 0; i < 3; i++) await registro.registrar({ ...base, quando: new Date("2026-08-25T10:00:00-03:00"), acao: "Declarar", contribuinte: "45723174000110" });
    await removerEmpresa(t.banco, sessao, removida, "45723174000110", { log: () => {} });
    await gravar([
      ...vezes(250, { quando: "2026-09-25T10:00:00-03:00", acao: "Consultar", empresaId: a }),
      ...vezes(60, { quando: "2026-10-10T10:00:00-03:00", acao: "Consultar", empresaId: plataforma }),
      ...vezes(2, { quando: "2026-10-10T10:00:00-03:00", acao: "Consultar", semContribuinte: true }),
      ...vezes(5, { quando: "2026-08-22T10:00:00-03:00", acao: "Emitir", semContribuinte: true }),
      { quando: "2026-10-22T10:00:00-03:00", acao: "Emitir", empresaId: a },
    ]);

    const m = await custosMensais(t.banco, new Date("2026-10-25T10:00:00-03:00"));
    assert.deepEqual(
      m.periodos.map((p) => [p.periodo, p.quantidades, p.precos, p.centavos]),
      [
        ["2026-10-21", { consulta: 0, emissao: 1, declaracao: 0 }, { consulta: 24, emissao: 32, declaracao: 40 }, 32],
        // 250 + 60 + 2 = 312 consultas: passou de 300, todas a R$ 0,21.
        ["2026-09-21", { consulta: 312, emissao: 0, declaracao: 0 }, { consulta: 21, emissao: 32, declaracao: 40 }, 312 * 21],
        // As 3 declarações da empresa removida e as 5 emissões da plataforma sem contribuinte.
        ["2026-08-21", { consulta: 0, emissao: 5, declaracao: 3 }, { consulta: 24, emissao: 32, declaracao: 40 }, 5 * 32 + 3 * 40],
      ],
    );
    const total = 32 + 312 * 21 + 5 * 32 + 3 * 40;
    assert.deepEqual(m.total, { quantidades: { consulta: 312, emissao: 6, declaracao: 3 }, chamadas: 321, centavos: total });
    assert.equal(m.periodos.reduce((s, p) => s + p.centavos, 0), m.total.centavos);

    const inicio = await custosPorCliente(t.banco, DESDE_O_INICIO);
    assert.equal(inicio.total.centavos, m.total.centavos);
    assert.deepEqual(inicio.total.quantidades, m.total.quantidades);
    assert.ok(inicio.linhas.some((l) => l.nome === "Empresas removidas"));
    assert.ok(inicio.linhas.some((l) => l.nome === "Plataforma (sem empresa)"));
    // O custo de cada mês é a soma dos clientes naquele período.
    for (const p of m.periodos) {
      const doPeriodo = await custosPorCliente(t.banco, p.periodo);
      assert.equal(doPeriodo.linhas.reduce((s, l) => s + l.centavos, 0), p.centavos, p.periodo);
      assert.deepEqual(doPeriodo.total.quantidades, p.quantidades, p.periodo);
    }
  });
});
