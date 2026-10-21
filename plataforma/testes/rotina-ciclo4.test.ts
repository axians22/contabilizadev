// Rotina do mês (Parte 6), correção do ciclo 4 do QA: com moeda estrangeira, o valor em reais preenchido mas inválido
// é recusado; só o campo vazio (null/undefined) leva à conversão pela PTAX. Nada sai da máquina: cliente falso e PTAX gravada.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import { cnpj } from "@contabilizadev/nucleo/serpro/cliente";
import { mesesSemReceita, prolabores, receitasLancadas } from "@/banco/esquema";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro } from "@/lib/empresas/cadastro";
import type { DependenciasRotina } from "@/lib/rotina/dependencias";
import { MENSAGENS_DA_ROTINA } from "@/lib/rotina/mensagens";
import { informarProLabore, lancarReceita, marcarSemReceita } from "@/lib/rotina/receitas";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const AGORA = new Date("2026-10-18T10:00:00-03:00");
const TOKEN = "b06feea3-1ca8-49f4-bdb4-211ab006cb92";
const PTAX = { value: [{ cotacaoCompra: 5.3987, cotacaoVenda: 5.3993, dataHoraCotacao: "2026-10-16 13:03:27.790", tipoBoletim: "Fechamento" }] };

// A mesma função que a ação usa para ler o que o cliente digitou (lida do fonte para não divergir).
const fonte = fs.readFileSync(path.join(import.meta.dirname, "..", "app", "(painel)", "roteiro", "acoes.ts"), "utf8");
const corpo = /function numero\(v: string\): number \{([\s\S]*?)\n\}/.exec(fonte)?.[1];
const numero = new Function("v", corpo ?? "throw new Error('numero() não encontrada')") as (v: string) => number;

async function empresa() {
  const usuario = (await entrarComGoogle(depsLogin(t.banco, { ana: perfil("ana@a.com", "sub-ana") }), "ana")).usuario;
  const r = await consultarParaCadastro(t.banco, usuario, "98.765.432/0001-98", { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-anexo-iii") });
  assert.equal(r.tipo, "previa");
  return exigirAcessoEmpresa(t.banco, usuario, await cadastrarPelaPrevia(t.banco, usuario, r.previa.token, { segredo: SEGREDO, agora: AGORA }));
}

function dependencias() {
  const consultas: string[] = [];
  const deps: DependenciasRotina = {
    banco: t.banco,
    cliente: clienteFalso(),
    contexto: async () => ({ contribuinte: cnpj("98765432000198"), autorPedidoDados: cnpj("98765432000198"), tokenProcurador: TOKEN }),
    agora: () => AGORA,
    log: () => {},
    buscarPtax: (async (url: string) => {
      consultas.push(String(url));
      return new Response(JSON.stringify(PTAX), { status: 200 });
    }) as unknown as typeof fetch,
  };
  return { deps, consultas };
}

describe("moeda estrangeira: valor em reais preenchido e inválido é recusado, nunca convertido pela PTAX", () => {
  for (const digitado of ["1e5", "5.000,0,0", "-6300", "abc", "0,00", "Infinity"]) {
    it(`"${digitado}" é recusado sem consultar a cotação nem gravar nada`, async () => {
      const acesso = await empresa();
      const { deps, consultas } = dependencias();
      const r = await lancarReceita(deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "USD", valorMoeda: 1_000, valorBrl: numero(digitado) });
      assert.deepEqual(r, { ok: false, mensagem: MENSAGENS_DA_ROTINA.receitaInvalida });
      assert.equal(consultas.length, 0);
      assert.equal((await t.banco.select().from(receitasLancadas)).length, 0);
    });
  }

  it("NaN direto também é recusado (qualquer número informado passa pela validação)", async () => {
    const acesso = await empresa();
    const { deps } = dependencias();
    const r = await lancarReceita(deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "USD", valorMoeda: 1_000, valorBrl: Number.NaN });
    assert.deepEqual(r, { ok: false, mensagem: MENSAGENS_DA_ROTINA.receitaInvalida });
  });

  it("valor em reais válido é gravado como informado, com a cotação implícita", async () => {
    const acesso = await empresa();
    const { deps, consultas } = dependencias();
    const r = await lancarReceita(deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "USD", valorMoeda: 1_000, valorBrl: numero("5.350,00") });
    assert.deepEqual(r.ok && r.valorBrl, 5_350);
    assert.equal(consultas.length, 0);
    const [linha] = await t.banco.select().from(receitasLancadas);
    assert.deepEqual([linha.origemValor, linha.cotacao], ["informado", 5.35]);
  });

  for (const vazio of [null, undefined]) {
    it(`campo vazio (${vazio}) converte pela PTAX de compra`, async () => {
      const acesso = await empresa();
      const { deps, consultas } = dependencias();
      const r = await lancarReceita(deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "USD", valorMoeda: 1_000, valorBrl: vazio });
      assert.deepEqual(r.ok && r.valorBrl, 5_398.7);
      assert.ok(consultas.length > 0);
      const [linha] = await t.banco.select().from(receitasLancadas);
      assert.equal(linha.origemValor, "ptax");
    });
  }
});

// QA ciclo 4 (média): o valor é conferido já arredondado para centavos; o que vira R$ 0,00 não é receita.
describe("valor que arredonda para R$ 0,00 é recusado em todos os campos", () => {
  for (const digitado of ["0,004", "0,001", "0.004", "0,0049"]) {
    it(`receita em reais "${digitado}" é recusada e não apaga a marcação de "sem receita"`, async () => {
      const acesso = await empresa();
      const { deps } = dependencias();
      assert.equal((await marcarSemReceita(deps, acesso, { pa: "2026-09", marcar: true })).ok, true);
      const r = await lancarReceita(deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "BRL", valorMoeda: numero(digitado) });
      assert.deepEqual(r, { ok: false, mensagem: MENSAGENS_DA_ROTINA.receitaInvalida });
      assert.equal((await t.banco.select().from(receitasLancadas)).length, 0);
      assert.equal((await t.banco.select().from(mesesSemReceita)).length, 1);
    });
    it(`valor na moeda estrangeira "${digitado}" é recusado (com e sem reais informado)`, async () => {
      const acesso = await empresa();
      const { deps, consultas } = dependencias();
      for (const valorBrl of [null, 10]) {
        const r = await lancarReceita(deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "USD", valorMoeda: numero(digitado), valorBrl });
        assert.deepEqual(r, { ok: false, mensagem: MENSAGENS_DA_ROTINA.receitaInvalida });
      }
      assert.equal(consultas.length, 0);
      assert.equal((await t.banco.select().from(receitasLancadas)).length, 0);
    });
  }

  it("R$ 0,005 arredonda para 1 centavo e é aceito (borda do arredondamento)", async () => {
    const acesso = await empresa();
    const { deps } = dependencias();
    const r = await lancarReceita(deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "BRL", valorMoeda: numero("0,005") });
    assert.deepEqual(r.ok && r.valorBrl, 0.01);
  });

  it("conversão pela PTAX que daria R$ 0,00 é recusada", async () => {
    const acesso = await empresa();
    const { deps } = dependencias();
    deps.buscarPtax = (async () =>
      new Response(JSON.stringify({ value: [{ ...PTAX.value[0], cotacaoCompra: 0.03, cotacaoVenda: 0.03 }] }), { status: 200 })) as unknown as typeof fetch;
    const r = await lancarReceita(deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "JPY", valorMoeda: 0.1 });
    assert.deepEqual(r, { ok: false, mensagem: MENSAGENS_DA_ROTINA.receitaInvalida });
    assert.equal((await t.banco.select().from(receitasLancadas)).length, 0);
  });

  it("cotação implícita guardada com 6 casas e nunca zero", async () => {
    const acesso = await empresa();
    const { deps } = dependencias();
    const ok = await lancarReceita(deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "USD", valorMoeda: 300, valorBrl: 1 });
    assert.equal(ok.ok, true);
    const [linha] = await t.banco.select().from(receitasLancadas);
    assert.equal(linha.cotacao, 0.003333);
    const nao = await lancarReceita(deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "USD", valorMoeda: 4_000_000, valorBrl: 0.01 });
    assert.deepEqual(nao, { ok: false, mensagem: MENSAGENS_DA_ROTINA.receitaInvalida });
  });

  it("pró-labore: zero vale (não houve), 0,004 é recusado e 0,01 é aceito", async () => {
    const acesso = await empresa();
    const { deps } = dependencias();
    assert.deepEqual(await informarProLabore(deps, acesso, { mes: "2026-09", valor: 0 }), { ok: true });
    assert.deepEqual(await informarProLabore(deps, acesso, { mes: "2026-09", valor: numero("0,004") }), { ok: false, mensagem: MENSAGENS_DA_ROTINA.prolaboreInvalido });
    assert.deepEqual(await informarProLabore(deps, acesso, { mes: "2026-09", valor: numero("0,01") }), { ok: true });
    const [linha] = await t.banco.select().from(prolabores);
    assert.equal(linha.valor, 0.01);
  });
});

describe("leitura do valor digitado: ponto depois de zero é decimal, não milhar", () => {
  const casos: [string, number][] = [["0.004", 0.004], ["0,004", 0.004], ["0.5", 0.5], ["1.000", 1_000], ["1.000,50", 1_000.5], ["1,000.50", 1_000.5], ["0", 0]];
  for (const [digitado, esperado] of casos) it(`"${digitado}" vira ${esperado}`, () => assert.equal(numero(digitado), esperado));
  it('"0.000.004" e "0,000.5" não são número', () => {
    assert.ok(Number.isNaN(numero("0.000.004")));
    assert.ok(Number.isNaN(numero("0,000.5")));
  });
});
