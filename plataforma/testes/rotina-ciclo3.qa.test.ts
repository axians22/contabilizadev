// QA da Parte 6 (rotina do mês), ciclo 3: leitura do valor digitado depois da troca do Number() pela regex.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import { cnpj } from "@contabilizadev/nucleo/serpro/cliente";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro } from "@/lib/empresas/cadastro";
import type { DependenciasRotina } from "@/lib/rotina/dependencias";
import { MENSAGENS_DA_ROTINA } from "@/lib/rotina/mensagens";
import { lancarReceita, VALOR_MAXIMO } from "@/lib/rotina/receitas";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());
const AGORA = new Date("2026-10-18T10:00:00-03:00");
const TOKEN = "b06feea3-1ca8-49f4-bdb4-211ab006cb92";

const fonte = fs.readFileSync(path.join(import.meta.dirname, "..", "app", "(painel)", "roteiro", "acoes.ts"), "utf8");
const corpo = /function numero\(v: string\): number \{([\s\S]*?)\n\}/.exec(fonte)?.[1];
const numero = new Function("v", corpo ?? "throw new Error('numero() não encontrada')") as (v: string) => number;

describe("QA ciclo 3: numero() em acoes.ts", () => {
  it("formatos válidos continuam iguais", () => {
    const casos: Array<[string, number]> = [
      ["0", 0], ["0,00", 0], ["0.5", 0.5], ["1.5", 1.5], ["10", 10], ["1.000", 1000], ["1.000.000,00", 1_000_000],
      ["1,234.56", 1234.56], ["1,234,567.8", 1234567.8], ["1234.56", 1234.56], ["1234,56", 1234.56],
      ["R$ 1.234,56", 1234.56], ["R$ 1.234,56", 1234.56], [" 23.000 ", 23000], ["1 000", 1000], ["007", 7],
      ["0,001", 0.001], ["999.999.999,99", 999999999.99],
    ];
    for (const [v, esperado] of casos) assert.equal(numero(v), esperado, v);
  });
  it("todo formato estranho vira NaN (nunca Infinity nem negativo)", () => {
    const ruins = ["1e5", "1E-2", "0x1F", "0B1", "0O7", "Infinity", "-Infinity", "NaN", "-1", "+1", "- 1", "R$ -5", "1,", ",5",
      ".", ",", "1..0", "1,,0", "1.000,", "1_000", "١٢", "１２", "12a", "a12", "1/2", "1.2.3,4,5", "0x", "1e", "e5"];
    for (const v of ruins) {
      const n = numero(v);
      assert.ok(Number.isNaN(n), `${JSON.stringify(v)} → ${n}`);
    }
  });
  it("número enorme é recusado pela regra (Infinity ou acima do teto)", () => {
    const n = numero("9".repeat(400));
    assert.ok(!(Number.isFinite(n) && n > 0 && n <= VALOR_MAXIMO), `→ ${n}`);
  });
});

describe("QA ciclo 3: valor em reais digitado errado com moeda estrangeira", () => {
  const PTAX = { value: [{ cotacaoCompra: 5.3987, cotacaoVenda: 5.3993, dataHoraCotacao: "2026-10-16 13:03:27.790", tipoBoletim: "Fechamento" }] };
  async function empresa() {
    const usuario = (await entrarComGoogle(depsLogin(t.banco, { ana: perfil("ana@a.com", "sub-ana") }), "ana")).usuario;
    const r = await consultarParaCadastro(t.banco, usuario, "98.765.432/0001-98", { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-anexo-iii") });
    assert.equal(r.tipo, "previa");
    const empresaId = await cadastrarPelaPrevia(t.banco, usuario, r.previa.token, { segredo: SEGREDO, agora: AGORA });
    return exigirAcessoEmpresa(t.banco, usuario, empresaId);
  }
  const deps = (): DependenciasRotina => ({
    banco: t.banco,
    cliente: clienteFalso(),
    contexto: async () => ({ contribuinte: cnpj("98765432000198"), autorPedidoDados: cnpj("98765432000198"), tokenProcurador: TOKEN }),
    agora: () => AGORA,
    log: () => {},
    buscarPtax: (async () => new Response(JSON.stringify(PTAX), { status: 200 })) as unknown as typeof fetch,
  });

  // A ação passa numero(valorBrl) quando o campo "valor em reais" vem preenchido: "1e5", "5.000,0,0" ou "-6300" viram NaN.
  // O cliente digitou um valor em reais; se ele é inválido, a receita deve ser recusada, não lançada pela PTAX em silêncio.
  for (const digitado of ["1e5", "5.000,0,0", "-6300", "abc"]) {
    it(`valor em reais "${digitado}" é recusado (não cai na PTAX em silêncio)`, async () => {
      const acesso = await empresa();
      const r = await lancarReceita(deps(), acesso, { pa: "2026-09", recebidaEm: "2026-10-17", moeda: "USD", valorMoeda: 1_000, valorBrl: numero(digitado) });
      assert.deepEqual(r, { ok: false, mensagem: MENSAGENS_DA_ROTINA.receitaInvalida }, JSON.stringify(r));
    });
  }
});
