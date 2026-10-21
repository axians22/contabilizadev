// Parte 6 ciclo 6: o teto de VALOR_MAXIMO é em reais; o valor na moeda estrangeira só precisa caber na coluna.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import { cnpj } from "@contabilizadev/nucleo/serpro/cliente";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro } from "@/lib/empresas/cadastro";
import type { DependenciasRotina } from "@/lib/rotina/dependencias";
import { MENSAGENS_DA_ROTINA } from "@/lib/rotina/mensagens";
import { eq } from "drizzle-orm";
import { receitasLancadas } from "@/banco/esquema";
import { lancarReceita, VALOR_MAXIMO, VALOR_MOEDA_MAXIMO } from "@/lib/rotina/receitas";
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

const RECUSA = { ok: false, mensagem: MENSAGENS_DA_ROTINA.receitaInvalida };
const BASE = { pa: "2026-09", recebidaEm: "2026-10-16" };

describe("teto da receita: em reais, não na moeda", () => {
  it("JPY 5.000.000 pela PTAX vira R$ 177.000,00 e guarda o valor na moeda", async () => {
    const acesso = await empresa();
    const r = await lancarReceita(dependencias().deps, acesso, { ...BASE, moeda: "JPY", valorMoeda: 5_000_000 });
    assert.ok(r.ok);
    assert.equal(r.valorBrl, 177_000);
    const [linha] = await t.banco.select().from(receitasLancadas).where(eq(receitasLancadas.id, r.id));
    assert.equal(linha.valorMoeda, 5_000_000);
    assert.equal(linha.origemValor, "ptax");
    assert.equal(linha.cotacao, 0.0354);
  });

  it("JPY 5.000.000 com R$ 177.000,00 informado é aceito sem consultar a PTAX", async () => {
    const acesso = await empresa();
    const { deps, consultas } = dependencias();
    const r = await lancarReceita(deps, acesso, { ...BASE, moeda: "JPY", valorMoeda: 5_000_000, valorBrl: 177_000 });
    assert.equal(r.ok && r.valorBrl, 177_000);
    assert.equal(consultas.length, 0);
  });

  it("JPY 135.593.220 = R$ 4.799.999,99 (no limite em reais) é aceito", async () => {
    const acesso = await empresa();
    const r = await lancarReceita(dependencias().deps, acesso, { ...BASE, moeda: "JPY", valorMoeda: 135_593_220 });
    assert.equal(r.ok && r.valorBrl, 4_799_999.99);
  });

  it("JPY 200.000.000 = R$ 7.080.000,00 continua recusado pela PTAX", async () => {
    const acesso = await empresa();
    assert.deepEqual(await lancarReceita(dependencias().deps, acesso, { ...BASE, moeda: "JPY", valorMoeda: 200_000_000 }), RECUSA);
  });

  it("valor em reais informado acima de VALOR_MAXIMO continua recusado", async () => {
    const acesso = await empresa();
    const r = await lancarReceita(dependencias().deps, acesso, { ...BASE, moeda: "JPY", valorMoeda: 200_000_000, valorBrl: VALOR_MAXIMO + 0.01 });
    assert.deepEqual(r, RECUSA);
  });

  it("em reais (BRL) o valor lançado é a receita: acima de VALOR_MAXIMO é recusado", async () => {
    const acesso = await empresa();
    assert.deepEqual(await lancarReceita(dependencias().deps, acesso, { ...BASE, moeda: "BRL", valorMoeda: VALOR_MAXIMO + 0.01 }), RECUSA);
    const r = await lancarReceita(dependencias().deps, acesso, { ...BASE, moeda: "BRL", valorMoeda: VALOR_MAXIMO });
    assert.equal(r.ok && r.valorBrl, VALOR_MAXIMO);
  });

  it("valor na moeda no teto da coluna numeric(14,2) é aceito com o valor em reais informado", async () => {
    const acesso = await empresa();
    const r = await lancarReceita(dependencias().deps, acesso, { ...BASE, moeda: "JPY", valorMoeda: VALOR_MOEDA_MAXIMO, valorBrl: 3_540_000 });
    assert.equal(r.ok && r.valorBrl, 3_540_000);
  });

  it("valor na moeda acima do que cabe na coluna é recusado (sem estourar o INSERT nem consultar a PTAX)", async () => {
    const acesso = await empresa();
    const { deps, consultas } = dependencias();
    assert.deepEqual(await lancarReceita(deps, acesso, { ...BASE, moeda: "JPY", valorMoeda: 1_000_000_000_000 }), RECUSA);
    assert.deepEqual(await lancarReceita(deps, acesso, { ...BASE, moeda: "JPY", valorMoeda: 1_000_000_000_000, valorBrl: 1000 }), RECUSA);
    assert.equal(consultas.length, 0);
  });

  it("valor na moeda que arredonda para zero, negativo ou NaN é recusado", async () => {
    const acesso = await empresa();
    for (const valorMoeda of [0.004, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.deepEqual(await lancarReceita(dependencias().deps, acesso, { ...BASE, moeda: "JPY", valorMoeda }), RECUSA, String(valorMoeda));
    }
  });
});
