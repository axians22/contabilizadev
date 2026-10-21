// QA, Parte 6 ciclo 6: receita em moeda de cotação baixa (iene). O limite de VALOR_MAXIMO é em reais, não na moeda.
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
import { lancarReceita } from "@/lib/rotina/receitas";
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

describe("QA: receita em iene (moeda aceita na lista) acima de 4,8 milhões na moeda, mas pequena em reais", () => {
  it("JPY 5.000.000 pela PTAX (0,0354) = R$ 177.000,00 deve ser aceito", async () => {
    const acesso = await empresa();
    const r = await lancarReceita(dependencias().deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "JPY", valorMoeda: 5_000_000 });
    assert.equal(r.ok && r.valorBrl, 177_000);
  });

  it("JPY 5.000.000 com R$ 177.000,00 informado deve ser aceito", async () => {
    const acesso = await empresa();
    const r = await lancarReceita(dependencias().deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "JPY", valorMoeda: 5_000_000, valorBrl: 177_000 });
    assert.equal(r.ok && r.valorBrl, 177_000);
  });

  it("JPY 200.000.000 = R$ 7.080.000,00 continua recusado (acima de VALOR_MAXIMO em reais)", async () => {
    const acesso = await empresa();
    const r = await lancarReceita(dependencias().deps, acesso, { pa: "2026-09", recebidaEm: "2026-10-16", moeda: "JPY", valorMoeda: 200_000_000 });
    assert.deepEqual(r, { ok: false, mensagem: MENSAGENS_DA_ROTINA.receitaInvalida });
  });
});
