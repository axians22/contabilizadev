// QA da Parte 6 (rotina do mês), ciclo 2: casos de borda que os testes do engenheiro não cobrem. Nada sai da máquina:
// cliente falso do núcleo e banco de teste.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { sugestaoFatorR } from "@contabilizadev/nucleo/apuracao";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { regraDoCnae } from "@contabilizadev/nucleo/cnae";
import { vencimentoDarf, vencimentoDas } from "@contabilizadev/nucleo/meses";
import { proLaboreDoDarf } from "@contabilizadev/nucleo/prolabore";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import { cnpj } from "@contabilizadev/nucleo/serpro/cliente";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa } from "@/lib/empresas/acesso";
import { baseDoMes } from "@/lib/rotina/base";
import type { DependenciasRotina } from "@/lib/rotina/dependencias";
import { lancarReceita, marcarSemReceita, removerReceita } from "@/lib/rotina/receitas";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";
import { cadastrarComprovada, consultarComDados } from "./apoio-empresa";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const em = (iso: string) => new Date(`${iso}-03:00`);
const AGORA = em("2026-10-18T10:00:00");
const TOKEN = "b06feea3-1ca8-49f4-bdb4-211ab006cb92";

describe("QA ciclo 2: leitura do valor digitado (acoes.ts)", () => {
  const fonte = fs.readFileSync(path.join(import.meta.dirname, "..", "app", "(painel)", "roteiro", "acoes.ts"), "utf8");
  const corpo = /function numero\(v: string\): number \{([\s\S]*?)\n\}/.exec(fonte)?.[1];
  const numero = new Function("v", corpo ?? "throw new Error('numero() não encontrada')") as (v: string) => number;

  // O campo é texto livre: notação científica e hexadecimal não são valores em reais; "1e5" lançado vira R$ 100.000,00.
  it("\"1e5\", \"0x10\" e \"Infinity\" não são aceitos como valor", () => {
    for (const v of ["1e5", "2E3", "0x10", "0b11", "Infinity"]) assert.ok(Number.isNaN(numero(v)) || !Number.isFinite(numero(v)), `${v} → ${numero(v)}`);
  });
  it("formatos brasileiros de borda", () => {
    assert.equal(numero("0,01"), 0.01);
    assert.equal(numero("1,5"), 1.5);
    assert.equal(numero("R$1.000"), 1000);
  });
});

describe("QA ciclo 2: faixa de atenção do Fator R nas bordas (25% e 30%)", () => {
  const regra = regraDoCnae("6201501");
  // Janela do PA 11/2026: 11/2025 a 10/2026, receita de 10.000 por mês (120.000).
  const receitas: Record<string, number> = {};
  for (const m of ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]) receitas[m] = 10_000;
  const folhasCom = (porMes: number) => Object.fromEntries(Object.keys(receitas).map((m) => [m, porMes]));
  const sugestao = (porMes: number) => sugestaoFatorR({ mesAtual: "2026-10", receitas, folhas: folhasCom(porMes), regra, proLaboreAtual: porMes })!;

  it("28% exato: Anexo III, em atenção, sem aumento e sem economia", () => {
    const s = sugestao(2_800);
    assert.equal(s.anexo, "III");
    assert.equal(s.emAtencao, true);
    assert.equal(s.aumento, 0);
    assert.equal(s.economia, 0);
  });
  it("30% exato: fora da faixa de atenção (Anexo III)", () => {
    const s = sugestao(3_000);
    assert.equal(s.anexo, "III");
    assert.equal(s.emAtencao, false);
  });
  it("25% exato: em atenção, Anexo V, sugere o pró-labore que leva a 28%", () => {
    const s = sugestao(2_500);
    assert.equal(s.anexo, "V");
    assert.equal(s.emAtencao, true);
    // 120.000 × 28% = 33.600; 11 meses × 2.500 = 27.500 → 6.100 no mês corrente.
    assert.equal(s.proLaboreSugerido, 6_100);
    assert.equal(s.aumento, 3_600);
    assert.equal(s.custoInss, 396);
    assert.equal(s.economia, Math.round((s.dasAnexoV - s.dasAnexoIII - s.custoInss) * 100) / 100);
  });
});

describe("QA ciclo 2: vencimentos com feriado nacional em dia de semana", () => {
  // 20/11 é feriado nacional (Dia Nacional de Zumbi e da Consciência Negra, Lei 14.759/2023). Em 2026 cai numa sexta.
  it("10/2026: DAS em 23/11/2026 (dia útil seguinte) e DARF do INSS em 19/11/2026 (dia útil anterior)", () => {
    assert.equal(vencimentoDas("2026-10"), "2026-11-23");
    assert.equal(vencimentoDarf("2026-10"), "2026-11-19");
  });
  it("virada de ano: 12/2026 vence em 20/01/2027 (quarta)", () => {
    assert.equal(vencimentoDas("2026-12"), "2027-01-20");
    assert.equal(vencimentoDarf("2026-12"), "2027-01-20");
  });
});

describe("QA ciclo 2: DARF do INSS perto do teto", () => {
  it("um centavo abaixo do teto não é teto; no teto é", () => {
    const abaixo = proLaboreDoDarf("2026-05", 932.3);
    assert.equal(abaixo.noTeto, undefined);
    assert.equal(abaixo.bruto, 8_475.45);
    const noTeto = proLaboreDoDarf("2026-05", 932.31);
    assert.equal(noTeto.noTeto, true);
    assert.equal(noTeto.bruto, 8_475.55);
    // Teto de 2025 (8.157,41 → 897,32) num mês de 2025.
    assert.equal(proLaboreDoDarf("2025-12", 897.32).noTeto, true);
    assert.equal(proLaboreDoDarf("2025-12", 897.32).bruto, 8_157.41);
  });
});

describe("QA ciclo 2: sem receita x lançamento removido", () => {
  async function empresa() {
    const usuario = (await entrarComGoogle(depsLogin(t.banco, { ana: perfil("ana@a.com", "sub-ana") }), "ana")).usuario;
    const r = await consultarComDados(t.banco, usuario, "98.765.432/0001-98", { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-anexo-iii") });
    assert.equal(r.tipo, "previa");
    const empresaId = await cadastrarComprovada(t.banco, usuario, r.previa.token, { segredo: SEGREDO, agora: AGORA });
    return exigirAcessoEmpresa(t.banco, usuario, empresaId);
  }
  const deps = (): DependenciasRotina => ({
    banco: t.banco,
    cliente: clienteFalso(),
    contexto: async () => ({ contribuinte: cnpj("98765432000198"), autorPedidoDados: cnpj("98765432000198"), tokenProcurador: TOKEN }),
    agora: () => AGORA,
    log: () => {},
  });

  it("remover o único lançamento volta a pendente (não a zero), mesmo que o mês tenha sido marcado antes", async () => {
    const acesso = await empresa();
    const d = deps();
    assert.ok((await marcarSemReceita(d, acesso, { pa: "2026-09", marcar: true })).ok);
    const l = await lancarReceita(d, acesso, { pa: "2026-09", recebidaEm: "2026-10-05", moeda: "BRL", valorMoeda: 1_000 });
    assert.ok(l.ok);
    assert.ok(await removerReceita(t.banco, acesso, l.id));
    const base = await baseDoMes(t.banco, acesso, "2026-09", AGORA);
    assert.deepEqual([base.receitaPendente, base.semReceita, base.receitaLancada], [true, false, null]);
  });

  it("a marcação de um mês não vale para outro mês", async () => {
    const acesso = await empresa();
    const d = deps();
    assert.ok((await marcarSemReceita(d, acesso, { pa: "2026-08", marcar: true })).ok);
    assert.equal((await baseDoMes(t.banco, acesso, "2026-09", AGORA)).receitaPendente, true);
    assert.equal((await baseDoMes(t.banco, acesso, "2026-08", AGORA)).semReceita, true);
  });
});
