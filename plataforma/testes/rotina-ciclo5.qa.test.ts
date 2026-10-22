// QA ciclo 5 (Parte 6): limites do valor convertido em reais e da cotação implícita. Cliente falso e PTAX gravada.
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
import type { DependenciasRotina } from "@/lib/rotina/dependencias";
import { MENSAGENS_DA_ROTINA } from "@/lib/rotina/mensagens";
import { lancarReceita } from "@/lib/rotina/receitas";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";
import { cadastrarComprovada, consultarComDados } from "./apoio-empresa";

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
  const r = await consultarComDados(t.banco, usuario, "98.765.432/0001-98", { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-anexo-iii") });
  assert.equal(r.tipo, "previa");
  return exigirAcessoEmpresa(t.banco, usuario, await cadastrarComprovada(t.banco, usuario, r.previa.token, { segredo: SEGREDO, agora: AGORA }));
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


describe("QA ciclo 5: limites do valor em reais e da cotação", () => {
  it("convertido pela PTAX acima de VALOR_MAXIMO em reais é recusado como o informado", async () => {
    const acesso = await empresa();
    const { deps } = dependencias();
    // USD 1.000.000 x 5,3987 = R$ 5.398.700,00: o mesmo valor em reais informado é recusado; convertido também tem de ser.
    const informado = await lancarReceita(deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "USD", valorMoeda: 1_000_000, valorBrl: 5_398_700 });
    assert.deepEqual(informado, { ok: false, mensagem: MENSAGENS_DA_ROTINA.receitaInvalida });
    const convertido = await lancarReceita(deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "USD", valorMoeda: 1_000_000 });
    assert.deepEqual(convertido, { ok: false, mensagem: MENSAGENS_DA_ROTINA.receitaInvalida });
    assert.equal((await t.banco.select().from(receitasLancadas)).length, 0);
  });

  it("cotação implícita que não cabe na coluna (reais grande, moeda 0,01) é recusada sem estourar o banco", async () => {
    const acesso = await empresa();
    const { deps } = dependencias();
    // R$ 10.000,00 / USD 0,01 = 1.000.000 por dólar: não cabe em numeric(12,6) (máx. 999.999,999999).
    let r;
    try {
      r = await lancarReceita(deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "USD", valorMoeda: numero("0,01"), valorBrl: numero("10.000,00") });
    } catch (erro) {
      assert.fail(`lançamento estourou em vez de recusar: ${(erro as Error).message}`);
    }
    assert.deepEqual(r, { ok: false, mensagem: MENSAGENS_DA_ROTINA.receitaInvalida });
    assert.equal((await t.banco.select().from(receitasLancadas)).length, 0);
  });

  it("valores normais seguem aceitos (borda de 0,005 e cotação com 6 casas)", async () => {
    const acesso = await empresa();
    const { deps } = dependencias();
    const r = await lancarReceita(deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "USD", valorMoeda: numero("1.000,005"), valorBrl: numero("5.398,70") });
    assert.equal(r.ok, true);
  });
});
