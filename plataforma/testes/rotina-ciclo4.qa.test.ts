// QA ciclo 4 (Parte 6): bordas do valor da receita que arredondam para zero centavo: com moeda estrangeira, o valor em reais preenchido mas inválido
// é recusado; só o campo vazio (null/undefined) leva à conversão pela PTAX. Nada sai da máquina: cliente falso e PTAX gravada.
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

describe("QA ciclo 4: valor que arredonda para R$ 0,00 não pode virar receita lançada", () => {
  for (const digitado of ["0,001", "0,004", "0.004"]) {
    it(`reais informado "${digitado}" com moeda estrangeira é recusado`, async () => {
      const acesso = await empresa();
      const { deps } = dependencias();
      const r = await lancarReceita(deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "USD", valorMoeda: 1_000, valorBrl: numero(digitado) });
      assert.deepEqual(r, { ok: false, mensagem: MENSAGENS_DA_ROTINA.receitaInvalida });
      assert.equal((await t.banco.select().from(receitasLancadas)).length, 0);
    });
    it(`receita em reais "${digitado}" é recusada`, async () => {
      const acesso = await empresa();
      const { deps } = dependencias();
      const r = await lancarReceita(deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "BRL", valorMoeda: numero(digitado) });
      assert.deepEqual(r, { ok: false, mensagem: MENSAGENS_DA_ROTINA.receitaInvalida });
      assert.equal((await t.banco.select().from(receitasLancadas)).length, 0);
    });
  }

  it("\"R$\" sozinho no campo de reais é recusado (não cai na PTAX)", async () => {
    const acesso = await empresa();
    const { deps, consultas } = dependencias();
    const r = await lancarReceita(deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "USD", valorMoeda: 1_000, valorBrl: numero("R$") });
    assert.deepEqual(r, { ok: false, mensagem: MENSAGENS_DA_ROTINA.receitaInvalida });
    assert.equal(consultas.length, 0);
  });

  it("valor no limite VALOR_MAXIMO em reais é aceito e 1 centavo acima é recusado", async () => {
    const acesso = await empresa();
    const { deps } = dependencias();
    const ok = await lancarReceita(deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "USD", valorMoeda: 1_000_000, valorBrl: numero("4.800.000,00") });
    assert.equal(ok.ok, true);
    const nao = await lancarReceita(deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "USD", valorMoeda: 1_000_000, valorBrl: numero("4.800.000,01") });
    assert.deepEqual(nao, { ok: false, mensagem: MENSAGENS_DA_ROTINA.receitaInvalida });
  });
});
