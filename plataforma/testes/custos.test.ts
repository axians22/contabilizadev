// Custo por cliente das chamadas ao Serpro (lib/serpro/custos.ts, tela /admin/custos): o cálculo pela faixa do total do
// tipo no período, a agregação no banco de TESTE (contabilizadev_teste) e a fronteira 20/21 no horário de Brasília.
// Nenhuma chamada externa: as chamadas são gravadas direto em serpro_chamadas (e pelo registro do núcleo, sem transporte).
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { custoMensal, type TipoRequisicao } from "@contabilizadev/nucleo/serpro/precos";
import { empresas, serproChamadas } from "@/banco/esquema";
import { removerEmpresa } from "@/lib/empresas/remocao";
import { criarEmpresa } from "@/lib/empresas/servico";
import { calcularCustos, custosPorCliente, DESDE_O_INICIO, escolhaDoEndereco, periodosComChamadas, type Grupo, type Quem } from "@/lib/serpro/custos";
import { registroNoBanco } from "@/lib/serpro/registro";
import { entrarComGoogle, resolverSessao } from "@/lib/autenticacao/servico";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps, perfil } from "./apoio";

const A: Quem = { tipo: "empresa", empresaId: "a" };
const B: Quem = { tipo: "empresa", empresaId: "b" };
const g = (periodo: string, quem: Quem, tipo: TipoRequisicao, quantidade: number): Grupo => ({ periodo, quem, tipo, quantidade });
const somaDasLinhas = (c: ReturnType<typeof calcularCustos>) => c.linhas.reduce((s, l) => s + l.centavos, 0);

describe("custo por cliente: o cálculo (sem banco)", () => {
  it("dentro da primeira faixa: quantidade × preço da faixa, em centavos exatos", () => {
    const c = calcularCustos([g("2026-10-21", A, "consulta", 3), g("2026-10-21", A, "emissao", 2), g("2026-10-21", A, "declaracao", 1)]);
    assert.equal(c.linhas.length, 1);
    assert.deepEqual(c.linhas[0].quantidades, { consulta: 3, emissao: 2, declaracao: 1 });
    assert.equal(c.linhas[0].centavos, 3 * 24 + 2 * 32 + 40);
    assert.equal(c.total.centavos, 176);
  });

  it("a faixa é a do TOTAL do tipo no período: dois clientes que juntos passam de 300 consultas pagam os dois R$ 0,21", () => {
    const c = calcularCustos([g("2026-10-21", A, "consulta", 200), g("2026-10-21", B, "consulta", 101)]);
    const porChave = Object.fromEntries(c.linhas.map((l) => [l.chave, l.centavos]));
    assert.equal(porChave["empresa:a"], 200 * 21);
    assert.equal(porChave["empresa:b"], 101 * 21);
    // Sozinho, cada um ficaria na primeira faixa (R$ 0,24): a troca de faixa vem do total.
    assert.equal(calcularCustos([g("2026-10-21", B, "consulta", 101)]).total.centavos, 101 * 24);
    assert.equal(c.total.centavos, Math.round(custoMensal({ consulta: 301, emissao: 0, declaracao: 0 }) * 100));
  });

  it("na fronteira da faixa: 300 consultas ainda R$ 0,24; 100 declarações R$ 0,40 e a 101ª muda todas para R$ 0,36", () => {
    assert.equal(calcularCustos([g("p", A, "consulta", 299), g("p", B, "consulta", 1)]).total.centavos, 300 * 24);
    assert.equal(calcularCustos([g("p", A, "declaracao", 100)]).total.centavos, 4000);
    assert.equal(calcularCustos([g("p", A, "declaracao", 100), g("p", B, "declaracao", 1)]).total.centavos, 101 * 36);
  });

  it("cada tipo tem a sua faixa: muitas consultas não mudam o preço das emissões", () => {
    const c = calcularCustos([g("p", A, "consulta", 1_001), g("p", A, "emissao", 1)]);
    assert.equal(c.total.centavos, 1_001 * 18 + 32);
  });

  it("desde o início: cada período com a sua faixa, somados (não a faixa do total de todos os períodos)", () => {
    const c = calcularCustos([g("2026-09-21", A, "consulta", 300), g("2026-10-21", A, "consulta", 1), g("2026-10-21", B, "consulta", 300)]);
    const porChave = Object.fromEntries(c.linhas.map((l) => [l.chave, l]));
    assert.equal(porChave["empresa:a"].centavos, 300 * 24 + 1 * 21);
    assert.equal(porChave["empresa:a"].quantidades.consulta, 301);
    assert.equal(porChave["empresa:b"].centavos, 300 * 21);
    assert.equal(c.total.centavos, 300 * 24 + 301 * 21);
  });

  it("ordem: do maior custo para o menor; removidas e plataforma entram como qualquer linha", () => {
    const c = calcularCustos([
      g("p", A, "consulta", 1),
      g("p", { tipo: "removidas" }, "declaracao", 2),
      g("p", { tipo: "plataforma" }, "emissao", 1),
      g("p", B, "consulta", 5),
    ]);
    assert.deepEqual(
      c.linhas.map((l) => [l.chave, l.centavos]),
      [["empresa:b", 120], ["removidas", 80], ["plataforma", 32], ["empresa:a", 24]],
    );
  });

  it("a soma das linhas é exatamente o total e o custoMensal de cada período, em qualquer combinação", () => {
    let semente = 7;
    const aleatorio = (max: number) => ((semente = (semente * 1_103_515_245 + 12_345) % 2_147_483_648), semente % max);
    const quem: Quem[] = [A, B, { tipo: "removidas" }, { tipo: "plataforma" }, { tipo: "empresa", empresaId: "c" }];
    for (let rodada = 0; rodada < 200; rodada++) {
      const grupos: Grupo[] = [];
      const porPeriodo: Record<string, Record<TipoRequisicao, number>> = {};
      for (const periodo of ["2026-08-21", "2026-09-21", "2026-10-21"])
        for (const q of quem)
          for (const tipo of ["consulta", "emissao", "declaracao"] as const) {
            const n = aleatorio(4) === 0 ? aleatorio(12_000) : aleatorio(40);
            grupos.push(g(periodo, q, tipo, n));
            porPeriodo[periodo] ??= { consulta: 0, emissao: 0, declaracao: 0 };
            porPeriodo[periodo][tipo] += n;
          }
      const c = calcularCustos(grupos);
      assert.equal(somaDasLinhas(c), c.total.centavos);
      const esperado = Object.values(porPeriodo).reduce((s, uso) => s + Math.round(custoMensal(uso) * 100), 0);
      assert.equal(c.total.centavos, esperado, `rodada ${rodada}`);
    }
  });

  it("sem chamadas: nenhuma linha e total zero", () => {
    assert.deepEqual(calcularCustos([]), { linhas: [], total: { quantidades: { consulta: 0, emissao: 0, declaracao: 0 }, centavos: 0 } });
  });

  it("o período do endereço: válido, 'inicio' ou, qualquer outra coisa, o atual", () => {
    const agora = new Date("2026-10-21T15:00:00-03:00");
    assert.equal(escolhaDoEndereco("2026-08-21", agora), "2026-08-21");
    assert.equal(escolhaDoEndereco(DESDE_O_INICIO, agora), DESDE_O_INICIO);
    for (const v of [undefined, "", "2026-08-20", "x", ["2026-08-21"], "2026-13-21"]) assert.equal(escolhaDoEndereco(v, agora), "2026-10-21", String(v));
  });
});

describe("custo por cliente: a agregação no banco de teste", () => {
  let t: BancoDeTeste;
  before(async () => (t = await prepararBancoDeTeste()));
  beforeEach(() => t.limpar());
  after(() => t.fechar());

  type Chamada = { quando: string; acao: string; empresaId?: string | null; contribuinte?: string | null; semContribuinte?: boolean; custo?: number };
  const gravar = (lista: Chamada[]) =>
    t.banco.insert(serproChamadas).values(
      lista.map((c) => ({
        quando: new Date(c.quando),
        acao: c.acao,
        servico: "TESTE",
        finalidade: "teste",
        contribuinte: c.contribuinte ?? null,
        empresaId: c.empresaId ?? null,
        semContribuinte: c.semContribuinte ?? false,
        status: 200,
        mensagens: "",
        custo: c.custo ?? 0,
      })),
    );
  const nova = async (cnpj: string, razaoSocial: string) => (await t.banco.insert(empresas).values({ cnpj, razaoSocial }).returning({ id: empresas.id }))[0].id;
  const vezes = (n: number, c: Chamada): Chamada[] => Array.from({ length: n }, () => c);

  it("uma linha por empresa com razão social e CNPJ, quantidade por tipo, Autenticar fora; ordenada pelo custo; soma = total", async () => {
    const a = await nova("11222333000181", "Alfa Ltda");
    const b = await nova("45723174000110", "Beta Ltda");
    await gravar([
      ...vezes(2, { quando: "2026-10-22T10:00:00-03:00", acao: "Consultar", empresaId: a, contribuinte: "11222333000181" }),
      { quando: "2026-10-22T10:00:00-03:00", acao: "Apoiar", empresaId: a, contribuinte: "11222333000181" },
      { quando: "2026-10-22T10:00:00-03:00", acao: "Declarar", empresaId: b, contribuinte: "45723174000110" },
      { quando: "2026-10-22T10:00:00-03:00", acao: "Emitir", empresaId: b, contribuinte: "45723174000110" },
      ...vezes(5, { quando: "2026-10-22T10:00:00-03:00", acao: "Autenticar", semContribuinte: true }),
    ]);
    const r = await custosPorCliente(t.banco, "2026-10-21");
    // Empate em R$ 0,72: mais chamadas primeiro (Alfa tem 3, Beta 2).
    assert.deepEqual(
      r.linhas.map((l) => [l.nome, l.cnpj, l.quantidades, l.centavos]),
      [
        ["Alfa Ltda", "11222333000181", { consulta: 3, emissao: 0, declaracao: 0 }, 72],
        ["Beta Ltda", "45723174000110", { consulta: 0, emissao: 1, declaracao: 1 }, 72],
      ],
    );
    assert.deepEqual(r.total, { quantidades: { consulta: 3, emissao: 1, declaracao: 1 }, centavos: 144 });
    assert.equal(r.linhas.reduce((s, l) => s + l.centavos, 0), r.total.centavos);
  });

  it("a faixa vem do total do tipo no período no banco, e não da coluna custo gravada na hora", async () => {
    const a = await nova("11222333000181", "Alfa Ltda");
    const b = await nova("45723174000110", "Beta Ltda");
    await gravar([
      ...vezes(80, { quando: "2026-09-25T10:00:00-03:00", acao: "Declarar", empresaId: a, custo: 0.4 }),
      ...vezes(21, { quando: "2026-10-05T10:00:00-03:00", acao: "Declarar", empresaId: b, custo: 0.4 }),
    ]);
    const r = await custosPorCliente(t.banco, "2026-09-21");
    assert.deepEqual(r.linhas.map((l) => [l.nome, l.centavos]), [["Alfa Ltda", 80 * 36], ["Beta Ltda", 21 * 36]]);
    assert.equal(r.total.centavos, Math.round(custoMensal({ consulta: 0, emissao: 0, declaracao: 101 }) * 100));
  });

  it("fronteira 20/21 no horário de Brasília: 20/10 23:59:59 é do período de 21/09; 21/10 00:00 já é do seguinte", async () => {
    const a = await nova("11222333000181", "Alfa Ltda");
    await gravar([
      { quando: "2026-09-21T00:00:00-03:00", acao: "Consultar", empresaId: a },
      { quando: "2026-09-20T23:59:59-03:00", acao: "Consultar", empresaId: a },
      { quando: "2026-10-20T23:59:59.999-03:00", acao: "Emitir", empresaId: a },
      // Já 21/10 em UTC, ainda 20/10 em Brasília.
      { quando: "2026-10-21T02:30:00Z", acao: "Emitir", empresaId: a },
      { quando: "2026-10-21T00:00:00-03:00", acao: "Declarar", empresaId: a },
    ]);
    const set = await custosPorCliente(t.banco, "2026-09-21");
    assert.deepEqual(set.total.quantidades, { consulta: 1, emissao: 2, declaracao: 0 });
    const out = await custosPorCliente(t.banco, "2026-10-21");
    assert.deepEqual(out.total.quantidades, { consulta: 0, emissao: 0, declaracao: 1 });
    const ago = await custosPorCliente(t.banco, "2026-08-21");
    assert.deepEqual(ago.total.quantidades, { consulta: 1, emissao: 0, declaracao: 0 });
    assert.deepEqual(await periodosComChamadas(t.banco, new Date("2026-10-21T10:00:00-03:00")), ["2026-10-21", "2026-09-21", "2026-08-21"]);
    // No dia 20 às 23h de Brasília, o período atual ainda é o de 21/09 (o de 21/10 só aparece quando chegar).
    assert.deepEqual(await periodosComChamadas(t.banco, new Date("2026-10-20T23:00:00-03:00")), ["2026-09-21", "2026-08-21"]);
  });

  it("o período atual aparece no seletor mesmo sem chamadas; os anteriores só se tiveram chamadas", async () => {
    assert.deepEqual(await periodosComChamadas(t.banco, new Date("2026-10-21T10:00:00-03:00")), ["2026-10-21"]);
    await gravar([{ quando: "2026-06-30T10:00:00-03:00", acao: "Autenticar", semContribuinte: true }]);
    assert.deepEqual(await periodosComChamadas(t.banco, new Date("2026-10-21T10:00:00-03:00")), ["2026-10-21", "2026-06-21"]);
  });

  it("empresas removidas juntas numa linha; chamadas sem contribuinte na linha da plataforma", async () => {
    const a = await nova("11222333000181", "Alfa Ltda");
    await gravar([
      { quando: "2026-10-22T10:00:00-03:00", acao: "Consultar", empresaId: a },
      // Duas empresas removidas (anonimizadas: sem empresa_id e sem contribuinte), de tipos diferentes.
      ...vezes(3, { quando: "2026-10-22T10:00:00-03:00", acao: "Declarar" }),
      { quando: "2026-10-23T10:00:00-03:00", acao: "Emitir" },
      // Da plataforma, sem contribuinte (cobrada) e a autenticação (não cobrada).
      { quando: "2026-10-22T10:00:00-03:00", acao: "Consultar", semContribuinte: true },
      { quando: "2026-10-22T10:00:00-03:00", acao: "Autenticar", semContribuinte: true },
    ]);
    const r = await custosPorCliente(t.banco, "2026-10-21");
    assert.deepEqual(
      r.linhas.map((l) => [l.nome, l.cnpj, l.quantidades, l.centavos]),
      [
        ["Empresas removidas", null, { consulta: 0, emissao: 1, declaracao: 3 }, 3 * 40 + 32],
        ["Alfa Ltda", "11222333000181", { consulta: 1, emissao: 0, declaracao: 0 }, 24],
        ["Plataforma (sem empresa)", null, { consulta: 1, emissao: 0, declaracao: 0 }, 24],
      ],
    );
    assert.equal(r.total.centavos, 152 + 48);
  });

  it("pelo caminho de verdade: o registro do núcleo e a remoção da empresa levam a chamada para 'Empresas removidas'", async () => {
    const d = deps(t.banco, { ana: perfil("ana@a.com", "sub-ana") });
    const sessao = await resolverSessao(d, (await entrarComGoogle(d, "ana")).cookie);
    assert.ok(sessao);
    const a = (await criarEmpresa(t.banco, sessao.usuario, { cnpj: "11222333000181", razaoSocial: "Alfa Ltda" })).id;
    const registro = registroNoBanco(t.banco);
    const base = { servico: "TESTE", finalidade: "teste", status: 200, mensagens: "", custo: 0.24 };
    await registro.registrar({ ...base, quando: new Date("2026-10-22T10:00:00-03:00"), acao: "Consultar", contribuinte: "11222333000181" });
    await registro.registrar({ ...base, quando: new Date("2026-10-22T10:00:00-03:00"), acao: "Autenticar", contribuinte: null, custo: 0 });
    // A plataforma chamando sem contribuinte (cobrada): a linha da plataforma.
    await registro.registrar({ ...base, quando: new Date("2026-10-22T11:00:00-03:00"), acao: "Apoiar", contribuinte: null });
    let r = await custosPorCliente(t.banco, "2026-10-21");
    assert.deepEqual(r.linhas.map((l) => [l.nome, l.centavos]), [["Alfa Ltda", 24], ["Plataforma (sem empresa)", 24]]);

    await removerEmpresa(t.banco, sessao, a, "11222333000181", { log: () => {} });
    r = await custosPorCliente(t.banco, "2026-10-21");
    // Empate em custo e em chamadas: a ordem fixa da chave ("plataforma" antes de "removidas").
    assert.deepEqual(r.linhas.map((l) => [l.nome, l.cnpj, l.centavos]), [["Plataforma (sem empresa)", null, 24], ["Empresas removidas", null, 24]]);
    // E a autenticação ficou marcada como da plataforma, fora da conta.
    const autenticacao = (await t.banco.select().from(serproChamadas)).find((c) => c.acao === "Autenticar");
    assert.equal(autenticacao?.semContribuinte, true);
  });

  it("desde o início: período a período com a sua faixa, somados; a soma das linhas bate com o total", async () => {
    const a = await nova("11222333000181", "Alfa Ltda");
    const b = await nova("45723174000110", "Beta Ltda");
    await gravar([
      ...vezes(300, { quando: "2026-09-10T10:00:00-03:00", acao: "Consultar", empresaId: a }),
      ...vezes(1, { quando: "2026-09-25T10:00:00-03:00", acao: "Consultar", empresaId: a }),
      ...vezes(300, { quando: "2026-10-01T10:00:00-03:00", acao: "Consultar", empresaId: b }),
    ]);
    const r = await custosPorCliente(t.banco, DESDE_O_INICIO);
    // 21/08 a 20/09: 300 de A a R$ 0,24. 21/09 a 20/10: 301 (1 de A, 300 de B) a R$ 0,21.
    assert.deepEqual(r.linhas.map((l) => [l.nome, l.quantidades.consulta, l.centavos]), [["Alfa Ltda", 301, 300 * 24 + 21], ["Beta Ltda", 300, 300 * 21]]);
    assert.equal(r.total.centavos, 300 * 24 + 301 * 21);
    assert.equal(r.linhas.reduce((s, l) => s + l.centavos, 0), r.total.centavos);
    // Se fosse a faixa do total de tudo (601 consultas, R$ 0,21), daria outro valor.
    assert.notEqual(r.total.centavos, 601 * 21);
  });

  it("a empresa da plataforma aparece como qualquer outra", async () => {
    const plataforma = await nova("43079489000141", "Plataforma Ltda");
    await gravar([{ quando: "2026-10-22T10:00:00-03:00", acao: "Emitir", empresaId: plataforma, contribuinte: "43079489000141" }]);
    const r = await custosPorCliente(t.banco, "2026-10-21");
    assert.deepEqual(r.linhas.map((l) => [l.nome, l.cnpj, l.centavos]), [["Plataforma Ltda", "43079489000141", 32]]);
  });
});
