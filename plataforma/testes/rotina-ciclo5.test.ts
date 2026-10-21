// Parte 6, ciclo 5: limite do valor convertido pela PTAX e da cotação implícita (bordas). Cliente falso e PTAX gravada.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import { cnpj } from "@contabilizadev/nucleo/serpro/cliente";
import { receitasLancadas } from "@/banco/esquema";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro } from "@/lib/empresas/cadastro";
import type { DependenciasRotina } from "@/lib/rotina/dependencias";
import { MENSAGENS_DA_ROTINA } from "@/lib/rotina/mensagens";
import { COTACAO_MAXIMA, lancarReceita, VALOR_MAXIMO } from "@/lib/rotina/receitas";
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

describe("valor convertido pela PTAX tem o mesmo limite do informado", () => {
  it("USD 889.102 x 5,3987 = R$ 4.799.994,97 (abaixo de VALOR_MAXIMO) é aceito", async () => {
    const acesso = await empresa();
    const r = await lancarReceita(dependencias().deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "USD", valorMoeda: 889_102 });
    assert.equal(r.ok && r.valorBrl, 4_799_994.97);
    assert.ok(4_799_994.97 <= VALOR_MAXIMO);
  });

  it("USD 889.103 x 5,3987 = R$ 4.800.000,37 (acima de VALOR_MAXIMO) é recusado sem gravar", async () => {
    const acesso = await empresa();
    const r = await lancarReceita(dependencias().deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "USD", valorMoeda: 889_103 });
    assert.deepEqual(r, { ok: false, mensagem: MENSAGENS_DA_ROTINA.receitaInvalida });
    assert.equal((await t.banco.select().from(receitasLancadas)).length, 0);
  });
});

describe("cotação implícita limitada ao que cabe na coluna numeric(12,6)", () => {
  it("o teto é 999.999,999999", () => assert.equal(COTACAO_MAXIMA, 999_999.999999));

  it("R$ 9.999,99 / USD 0,01 = 999.999 cabe e é gravada como informada", async () => {
    const acesso = await empresa();
    const r = await lancarReceita(dependencias().deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "USD", valorMoeda: numero("0,01"), valorBrl: numero("9.999,99") });
    assert.equal(r.ok, true);
    const [linha] = await t.banco.select().from(receitasLancadas);
    assert.equal(linha.cotacao, 999_999);
  });

  for (const [moeda, reais] of [["0,01", "10.000,00"], ["0,01", "4.800.000,00"], ["0,10", "100.000,00"]]) {
    it(`R$ ${reais} / USD ${moeda} não cabe na coluna: recusado com a mensagem própria, sem exceção`, async () => {
      const acesso = await empresa();
      const r = await lancarReceita(dependencias().deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "USD", valorMoeda: numero(moeda), valorBrl: numero(reais) });
      assert.deepEqual(r, { ok: false, mensagem: MENSAGENS_DA_ROTINA.receitaInvalida });
      assert.equal((await t.banco.select().from(receitasLancadas)).length, 0);
    });
  }
});
