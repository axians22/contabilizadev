// QA, Parte 6 ciclo 6 (rodada 2): bordas do teto na moeda estrangeira, lido do texto digitado como a ação faz.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { receitasLancadas } from "@/banco/esquema";
import { after, before, beforeEach, describe, it } from "node:test";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import { cnpj } from "@contabilizadev/nucleo/serpro/cliente";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro } from "@/lib/empresas/cadastro";
import type { DependenciasRotina } from "@/lib/rotina/dependencias";
import { MENSAGENS_DA_ROTINA } from "@/lib/rotina/mensagens";
import { lancarReceita, VALOR_MOEDA_MAXIMO } from "@/lib/rotina/receitas";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const AGORA = new Date("2026-10-18T10:00:00-03:00");
const TOKEN = "b06feea3-1ca8-49f4-bdb4-211ab006cb92";
const PTAX = { value: [{ cotacaoCompra: 0.0354, cotacaoVenda: 0.0355, dataHoraCotacao: "2026-10-16 13:03:27.790", tipoBoletim: "Fechamento" }] };

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

const fonte = fs.readFileSync(path.join(import.meta.dirname, "..", "app", "(painel)", "roteiro", "acoes.ts"), "utf8");
const corpo = /function numero\(v: string\): number \{([\s\S]*?)\n\}/.exec(fonte)?.[1];
const numero = new Function("v", corpo ?? "throw new Error('numero() não encontrada')") as (v: string) => number;
const RECUSA = { ok: false, mensagem: MENSAGENS_DA_ROTINA.receitaInvalida };
const BASE = { pa: "2026-09", recebidaEm: "2026-10-16" };

describe("QA rodada 2: bordas do teto na moeda", () => {
  it("digitado '5.000.000' em JPY pela PTAX vira R$ 177.000,00 e grava ¥ 5.000.000,00", async () => {
    const acesso = await empresa();
    const r = await lancarReceita(dependencias().deps, acesso, { ...BASE, moeda: "JPY", valorMoeda: numero("5.000.000") });
    assert.ok(r.ok);
    assert.equal(r.valorBrl, 177_000);
    const [l] = await t.banco.select().from(receitasLancadas).where(eq(receitasLancadas.id, r.id));
    assert.equal(l.valorMoeda, 5_000_000);
  });

  it("'999.999.999.999,99' digitado com reais informados grava exatamente o teto da coluna", async () => {
    const acesso = await empresa();
    const r = await lancarReceita(dependencias().deps, acesso, { ...BASE, moeda: "JPY", valorMoeda: numero("999.999.999.999,99"), valorBrl: numero("4.000.000,00") });
    assert.ok(r.ok);
    const [l] = await t.banco.select().from(receitasLancadas).where(eq(receitasLancadas.id, r.id));
    assert.equal(l.valorMoeda, VALOR_MOEDA_MAXIMO);
  });

  it("logo acima do teto da coluna (que arredondaria para 1 trilhão) é recusado sem exceção", async () => {
    const acesso = await empresa();
    for (const v of [999_999_999_999.995, 999_999_999_999.999]) {
      assert.deepEqual(await lancarReceita(dependencias().deps, acesso, { ...BASE, moeda: "JPY", valorMoeda: v, valorBrl: 1000 }), RECUSA, String(v));
    }
  });

  it("USD/EUR acima de 4,8 milhões na moeda continuam recusados pelo teto em reais (PTAX 0,0354 não se aplica: usa cotação real)", async () => {
    const acesso = await empresa();
    // Com o valor em reais informado acima do teto, recusa; abaixo, aceita (USD 5 milhões a R$ 0,90 é hipotético mas válido pela regra).
    assert.deepEqual(await lancarReceita(dependencias().deps, acesso, { ...BASE, moeda: "USD", valorMoeda: 5_000_000, valorBrl: 26_993_500 }), RECUSA);
  });

  it("BRL continua com o teto de 4,8 milhões digitado", async () => {
    const acesso = await empresa();
    assert.deepEqual(await lancarReceita(dependencias().deps, acesso, { ...BASE, moeda: "BRL", valorMoeda: numero("5.000.000,00") }), RECUSA);
  });

  it("JPY 0,01 pela PTAX (R$ 0,00) é recusado, mesmo positivo na moeda", async () => {
    const acesso = await empresa();
    assert.deepEqual(await lancarReceita(dependencias().deps, acesso, { ...BASE, moeda: "JPY", valorMoeda: 0.01 }), RECUSA);
  });

  it("moeda fora da lista com valor grande é recusada", async () => {
    const acesso = await empresa();
    assert.deepEqual(await lancarReceita(dependencias().deps, acesso, { ...BASE, moeda: "XYZ", valorMoeda: 5_000_000 }), RECUSA);
  });
});
