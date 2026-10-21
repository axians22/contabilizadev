// QA (custo por cliente, /admin/custos): casos de borda que os testes do engenheiro não cobrem. Banco de TESTE
// (contabilizadev_teste); nenhuma chamada externa.
//   - o período calculado no SQL (agrupamento) bate com periodoDe/limitesDoPeriodo do núcleo em qualquer instante;
//   - virada de ano (20/01 x 21/01), fevereiro de ano bissexto e 20/03 x 21/03;
//   - faixas altas (acima de 30.000 consultas, 50.000 emissões, 10.000 declarações) somando com custoMensal;
//   - a linha de soma da Tabela aparece no computador e no celular, em todas as páginas da paginação.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { custoMensal, limitesDoPeriodo, periodoDe, ultimoDiaDoPeriodo, type TipoRequisicao } from "@contabilizadev/nucleo/serpro/precos";
import { empresas, serproChamadas } from "@/banco/esquema";
import { calcularCustos, custosPorCliente, DESDE_O_INICIO, periodosComChamadas, type Grupo, type Quem } from "@/lib/serpro/custos";
import { Tabela } from "@/app/tabela";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";

describe("QA custos: cálculo nas faixas altas", () => {
  const A: Quem = { tipo: "empresa", empresaId: "a" };
  const B: Quem = { tipo: "empresa", empresaId: "b" };
  const g = (quem: Quem, tipo: TipoRequisicao, quantidade: number): Grupo => ({ periodo: "2026-10-21", quem, tipo, quantidade });

  it("última faixa de cada tipo: a soma das linhas é o custoMensal em centavos", () => {
    const c = calcularCustos([
      g(A, "consulta", 20_000), g(B, "consulta", 10_001), // 30.001 → R$ 0,06
      g(A, "emissao", 25_000), g(B, "emissao", 25_001), // 50.001 → R$ 0,08
      g(A, "declaracao", 5_000), g(B, "declaracao", 5_001), // 10.001 → R$ 0,12
    ]);
    const porChave = Object.fromEntries(c.linhas.map((l) => [l.chave, l.centavos]));
    assert.equal(porChave["empresa:a"], 20_000 * 6 + 25_000 * 8 + 5_000 * 12);
    assert.equal(porChave["empresa:b"], 10_001 * 6 + 25_001 * 8 + 5_001 * 12);
    assert.equal(c.total.centavos, Math.round(custoMensal({ consulta: 30_001, emissao: 50_001, declaracao: 10_001 }) * 100));
  });

  it("exatamente no limite de cada faixa (300, 500, 100) fica na faixa de baixo", () => {
    const c = calcularCustos([g(A, "consulta", 150), g(B, "consulta", 150), g(A, "emissao", 499), g(B, "emissao", 1), g(B, "declaracao", 100)]);
    assert.equal(c.total.centavos, 300 * 24 + 500 * 32 + 100 * 40);
  });

  it("quantidade zero não cria linha nem muda o total", () => {
    const c = calcularCustos([g(A, "consulta", 0), g(B, "emissao", 1)]);
    assert.deepEqual(c.linhas.map((l) => l.chave), ["empresa:b"]);
    assert.equal(c.total.centavos, 32);
  });
});

describe("QA custos: períodos no banco de teste", () => {
  let t: BancoDeTeste;
  before(async () => (t = await prepararBancoDeTeste()));
  beforeEach(() => t.limpar());
  after(() => t.fechar());

  const gravar = (empresaId: string, quandos: Date[], acao = "Consultar") =>
    t.banco.insert(serproChamadas).values(
      quandos.map((quando) => ({ quando, acao, servico: "TESTE", finalidade: "qa", contribuinte: null, empresaId, semContribuinte: false, status: 200, mensagens: "", custo: 0 })),
    );
  const nova = async () => (await t.banco.insert(empresas).values({ cnpj: "11222333000181", razaoSocial: "Alfa QA Ltda" }).returning({ id: empresas.id }))[0].id;

  it("o período do SQL é o mesmo do núcleo em 400 instantes aleatórios (inclusive perto da meia-noite dos dias 20/21)", async () => {
    const a = await nova();
    let semente = 11;
    const aleatorio = (max: number) => ((semente = (semente * 1_103_515_245 + 12_345) % 2_147_483_648), semente % max);
    const inicio = Date.parse("2025-12-01T00:00:00Z");
    const instantes: Date[] = [];
    for (let i = 0; i < 300; i++) instantes.push(new Date(inicio + aleatorio(800) * 86_400_000 + aleatorio(86_400) * 1000));
    // Perto da virada: 21 às 00:00 em Brasília (03:00Z) ± alguns segundos, em vários meses.
    for (let m = 0; m < 25; m++) {
      const virada = Date.UTC(2026, m, 21, 3, 0, 0);
      for (const d of [-1000, 0, 1000, -3 * 3600_000 - 1000]) instantes.push(new Date(virada + d));
    }
    await gravar(a, instantes);
    const esperado = new Map<string, number>();
    for (const q of instantes) esperado.set(periodoDe(q), (esperado.get(periodoDe(q)) ?? 0) + 1);
    // Cada período escolhido conta exatamente as chamadas que o núcleo põe nele.
    for (const [periodo, n] of esperado) {
      const r = await custosPorCliente(t.banco, periodo);
      assert.equal(r.total.quantidades.consulta, n, `período ${periodo}`);
      const { inicio: i, fim: f } = limitesDoPeriodo(periodo);
      assert.equal(instantes.filter((q) => q >= i && q < f).length, n, `limites ${periodo}`);
    }
    const periodos = await periodosComChamadas(t.banco, new Date("2028-12-01T12:00:00Z"));
    assert.deepEqual(periodos.slice(1), [...esperado.keys()].sort().reverse());
    // Desde o início: cada período na sua faixa, somados.
    const todos = await custosPorCliente(t.banco, DESDE_O_INICIO);
    const centavos = [...esperado.values()].reduce((s, n) => s + Math.round(custoMensal({ consulta: n, emissao: 0, declaracao: 0 }) * 100), 0);
    assert.equal(todos.total.centavos, centavos);
    assert.equal(todos.linhas[0].centavos, centavos);
  });

  it("virada de ano e fevereiro bissexto: 20/01 23:59:59 é de 21/12; 29/02/2028 e 20/03/2028 são de 21/02/2028", async () => {
    const a = await nova();
    await gravar(a, [
      new Date("2027-01-20T23:59:59-03:00"),
      new Date("2027-01-21T00:00:00-03:00"),
      new Date("2028-02-29T12:00:00-03:00"),
      new Date("2028-03-20T23:59:59-03:00"),
      new Date("2028-03-21T00:00:00-03:00"),
    ]);
    const n = async (p: string) => (await custosPorCliente(t.banco, p)).total.quantidades.consulta;
    assert.equal(await n("2026-12-21"), 1);
    assert.equal(await n("2027-01-21"), 1);
    assert.equal(await n("2028-02-21"), 2);
    assert.equal(await n("2028-03-21"), 1);
    assert.equal(ultimoDiaDoPeriodo("2026-12-21"), "2027-01-20");
    assert.equal(ultimoDiaDoPeriodo("2028-02-21"), "2028-03-20");
    assert.deepEqual(await periodosComChamadas(t.banco, new Date("2028-04-01T12:00:00-03:00")), ["2028-03-21", "2028-02-21", "2027-01-21", "2026-12-21"]);
  });
});

describe("QA custos: a linha de soma da Tabela", () => {
  it("aparece no computador (tfoot) e no celular, também quando há várias páginas", () => {
    const linhas = Array.from({ length: 25 }, (_, i) => ({ chave: `l${i}`, celulas: { cliente: `Cliente ${i}`, custo: "R$ 0,24" } }));
    const html = renderToStaticMarkup(
      createElement(Tabela, {
        rotulo: "QA",
        colunas: [
          { chave: "cliente", titulo: "Cliente", principal: true },
          { chave: "custo", titulo: "Custo", alinhar: "direita" },
        ],
        linhas,
        rodape: { cliente: "Soma do período", custo: "R$ 6,00" },
      }),
    );
    assert.match(html, /<tfoot>[\s\S]*Soma do período[\s\S]*R\$ 6,00[\s\S]*<\/tfoot>/);
    assert.equal(html.match(/Soma do período/g)?.length, 2, "uma vez na tabela e uma na lista do celular");
    assert.ok(!html.includes("Cliente 10"), "paginada: só a primeira página");
  });
});
