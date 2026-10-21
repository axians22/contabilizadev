// QA (custo mensal e total, /admin/custos): casos de borda que os testes do engenheiro não cobrem — virada de ano,
// limites exatos de faixa de cada tipo, chamadas recusadas, muitos períodos e coerência com o custo por cliente.
// Banco de TESTE (contabilizadev_teste); nenhuma chamada externa.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { custoMensal, type TipoRequisicao } from "@contabilizadev/nucleo/serpro/precos";
import { empresas, serproChamadas } from "@/banco/esquema";
import { calcularCustosMensais, custosMensais, custosPorCliente, DESDE_O_INICIO, type Grupo, type Quem } from "@/lib/serpro/custos";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";

const A: Quem = { tipo: "empresa", empresaId: "a" };
const g = (periodo: string, tipo: TipoRequisicao, quantidade: number): Grupo => ({ periodo, quem: A, tipo, quantidade });

describe("QA custo mensal: limites exatos de faixa por tipo", () => {
  const casos: [TipoRequisicao, number, number][] = [
    ["consulta", 300, 24], ["consulta", 301, 21], ["consulta", 1000, 21], ["consulta", 1001, 18], ["consulta", 30000, 9], ["consulta", 30001, 6],
    ["emissao", 500, 32], ["emissao", 501, 29], ["emissao", 50000, 12], ["emissao", 50001, 8],
    ["declaracao", 100, 40], ["declaracao", 101, 36], ["declaracao", 10000, 16], ["declaracao", 10001, 12],
  ];
  for (const [tipo, n, preco] of casos)
    it(`${tipo} ${n} → ${preco} centavos, custo = n × preço, igual ao custoMensal do núcleo`, () => {
      const m = calcularCustosMensais([g("2026-09-21", tipo, n)], "2026-10-21");
      const p = m.periodos.find((x) => x.periodo === "2026-09-21")!;
      assert.equal(p.precos[tipo], preco);
      assert.equal(p.centavos, n * preco);
      assert.equal(p.centavos, Math.round(custoMensal(p.quantidades) * 100));
      assert.ok(Number.isInteger(p.centavos));
    });

  it("faixa somada entre clientes no mesmo período (200 + 101 consultas → todas a 0,21)", () => {
    const m = calcularCustosMensais(
      [g("2026-09-21", "consulta", 200), { periodo: "2026-09-21", quem: { tipo: "plataforma" }, tipo: "consulta", quantidade: 101 }],
      "2026-10-21",
    );
    assert.equal(m.periodos[1].precos.consulta, 21);
    assert.equal(m.total.centavos, 301 * 21);
  });
});

describe("QA custo mensal: no banco de teste", () => {
  let t: BancoDeTeste;
  before(async () => (t = await prepararBancoDeTeste()));
  beforeEach(() => t.limpar());
  after(() => t.fechar());

  const gravar = (lista: { quando: string; acao: string; empresaId?: string | null; semContribuinte?: boolean; status?: number }[]) =>
    t.banco.insert(serproChamadas).values(
      lista.map((c) => ({
        quando: new Date(c.quando),
        acao: c.acao,
        servico: "TESTE",
        finalidade: "teste",
        empresaId: c.empresaId ?? null,
        semContribuinte: c.semContribuinte ?? false,
        status: c.status ?? 200,
        mensagens: "",
        custo: 0.24,
      })),
    );
  const nova = async () => (await t.banco.insert(empresas).values({ cnpj: "11222333000181", razaoSocial: "Alfa Ltda" }).returning({ id: empresas.id }))[0].id;

  it("virada de ano: 25/12 e 10/01 no mesmo período (21/12 a 20/01); 21/01 abre o seguinte; ordem do mais novo ao mais antigo", async () => {
    const a = await nova();
    await gravar([
      { quando: "2026-12-25T10:00:00-03:00", acao: "Consultar", empresaId: a },
      { quando: "2027-01-10T10:00:00-03:00", acao: "Consultar", empresaId: a },
      { quando: "2027-01-20T23:59:59-03:00", acao: "Emitir", empresaId: a },
      { quando: "2027-01-21T00:00:00-03:00", acao: "Declarar", empresaId: a },
      { quando: "2026-11-21T00:00:00-03:00", acao: "Consultar", empresaId: a },
    ]);
    const m = await custosMensais(t.banco, new Date("2027-02-25T10:00:00-03:00"));
    assert.deepEqual(
      m.periodos.map((p) => [p.periodo, p.quantidades, p.centavos]),
      [
        ["2027-02-21", { consulta: 0, emissao: 0, declaracao: 0 }, 0],
        ["2027-01-21", { consulta: 0, emissao: 0, declaracao: 1 }, 40],
        ["2026-12-21", { consulta: 2, emissao: 1, declaracao: 0 }, 2 * 24 + 32],
        ["2026-11-21", { consulta: 1, emissao: 0, declaracao: 0 }, 24],
      ],
    );
    assert.equal(m.atual.periodo, "2027-02-21");
    assert.equal(m.total.centavos, (await custosPorCliente(t.banco, DESDE_O_INICIO)).total.centavos);
  });

  it("chamadas recusadas (status 4xx/5xx) entram no total, igual ao custo por cliente", async () => {
    const a = await nova();
    await gravar([
      { quando: "2026-10-05T10:00:00-03:00", acao: "Consultar", empresaId: a, status: 403 },
      { quando: "2026-10-05T10:00:00-03:00", acao: "Consultar", empresaId: a, status: 500 },
      { quando: "2026-10-05T10:00:00-03:00", acao: "Consultar", empresaId: a },
    ]);
    const m = await custosMensais(t.banco, new Date("2026-10-21T10:00:00-03:00"));
    assert.equal(m.total.chamadas, 3);
    assert.equal(m.total.centavos, 72);
    const doPeriodo = await custosPorCliente(t.banco, "2026-09-21");
    assert.equal(doPeriodo.total.centavos, m.periodos.find((p) => p.periodo === "2026-09-21")!.centavos);
  });

  it("muitos períodos (15): todos na lista, em ordem, soma = total = 'Desde o início' por cliente", async () => {
    const a = await nova();
    const lista = [];
    for (let i = 0; i < 15; i++) {
      const d = new Date(Date.UTC(2025, 7 + i, 25, 13));
      for (let k = 0; k <= i; k++) lista.push({ quando: d.toISOString(), acao: k % 3 === 0 ? "Emitir" : "Consultar", empresaId: a });
    }
    await gravar(lista);
    const m = await custosMensais(t.banco, new Date("2026-10-25T10:00:00-03:00"));
    assert.equal(m.periodos.length, 15);
    const chaves = m.periodos.map((p) => p.periodo);
    assert.deepEqual(chaves, [...chaves].sort().reverse());
    assert.equal(m.periodos.reduce((s, p) => s + p.centavos, 0), m.total.centavos);
    assert.equal(m.total.chamadas, (15 * 16) / 2);
    const inicio = await custosPorCliente(t.banco, DESDE_O_INICIO);
    assert.equal(inicio.total.centavos, m.total.centavos);
    for (const p of m.periodos) assert.equal((await custosPorCliente(t.banco, p.periodo)).total.centavos, p.centavos, p.periodo);
  });

  it("só Autenticar no banco: só o período atual, zerado, e nenhuma chamada cobrada", async () => {
    await gravar([
      { quando: "2026-08-25T10:00:00-03:00", acao: "Autenticar", semContribuinte: true },
      { quando: "2026-10-22T10:00:00-03:00", acao: "Autenticar", semContribuinte: true },
    ]);
    const m = await custosMensais(t.banco, new Date("2026-10-25T10:00:00-03:00"));
    assert.deepEqual(m.periodos.map((p) => p.periodo), ["2026-10-21"]);
    assert.equal(m.total.chamadas, 0);
    assert.equal(m.total.centavos, 0);
  });
});
