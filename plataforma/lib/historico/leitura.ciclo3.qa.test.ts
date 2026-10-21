// QA, Parte 5 (ciclo 3): DAS gerado de novo x retificadora x valores exibidos.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { montarHistorico, type DadosDoHistorico } from "./leitura";

const em = (iso: string) => new Date(`${iso}-03:00`);
const AGORA = em("2026-10-18T10:00:00");
const E = "00000000-0000-0000-0000-000000000001";
const declaracao = (pa: string, numero: string, transmitidaEm: string, tipo: "original" | "retificadora" = "original") => ({ id: numero, empresaId: E, pa, numero, tipo, transmitidaEm, malha: null, vistaEm: AGORA });
const das = (pa: string, numero: string, emitidoEm: string | null, pago = false) => ({ id: numero, empresaId: E, pa, numero, emitidoEm, pago, vistoEm: AGORA });
const pagamento = (numero: string, pagoEm: string, valor: number) => ({ id: `p-${numero}`, empresaId: E, numero, tipo: "DAS" as const, pa: "2026-08", pagoEm, valor, documento: {}, vistoEm: AGORA });
const extrato = (numeroDeclaracao: string, numeroDas: string, valorDas: number, pagoEm: string | null = null) => ({
  id: `x-${numeroDas}`, empresaId: E, pa: "2026-08", numeroDeclaracao, numeroDas, receita: 23_000, valorDas,
  vencimento: "2026-09-18", pagoEm, valorPago: pagoEm ? valorDas : null, fatorR: null,
  atividades: [{ idAtividade: 30, descricao: "", receita: 23_000, valor: valorDas }], consultadoEm: AGORA,
});
const dados = (d: Partial<DadosDoHistorico> = {}): DadosDoHistorico => ({ declaracoes: [], das: [], extratos: [], pagamentos: [], anosConsultados: new Set([2025, 2026]), ...d });
const agosto = (d: DadosDoHistorico) => montarHistorico(d, AGORA, null).find((x) => x.pa === "2026-08")!;

const S0 = "07202608000000000";
const S1 = "07202608000000001";
const S2 = "07202608000000002";

describe("QA ciclo 3: DAS gerado de novo", () => {
  it("S1 pago pela consulta, extrato só do S2 (com encargos): pago, número/valor/data do S1", () => {
    const m = agosto(dados({
      declaracoes: [declaracao("2026-08", "D8", "2026-09-05T10:00:00")],
      das: [das("2026-08", S1, "2026-09-05T10:01:00"), das("2026-08", S2, "2026-09-25T09:00:00")],
      extratos: [extrato("D8", S2, 1020.5)],
      pagamentos: [pagamento(S1, "2026-09-15", 1000.76)],
    }));
    assert.equal(m.situacao, "pago");
    assert.equal(m.das, S1);
    assert.equal(m.valorDas, 1000.76);
    assert.equal(m.pagoEm, "2026-09-15");
  });

  it("DAS sem data de emissão entram na conta e o pago quita", () => {
    const m = agosto(dados({
      declaracoes: [declaracao("2026-08", "D8", "2026-09-05T10:00:00")],
      das: [das("2026-08", S1, null, true), das("2026-08", S2, null)],
    }));
    assert.equal(m.situacao, "pago");
  });

  it("retificadora com diferença: o DAS pago antes dela não quita; DAS novos sem pagamento = vencido pelo último", () => {
    const m = agosto(dados({
      declaracoes: [declaracao("2026-08", "D8", "2026-09-05T10:00:00"), declaracao("2026-08", "R8", "2026-09-20T10:00:00", "retificadora")],
      das: [das("2026-08", S0, "2026-09-05T10:01:00", true), das("2026-08", S1, "2026-09-20T10:01:00"), das("2026-08", S2, "2026-09-30T10:01:00")],
      pagamentos: [pagamento(S0, "2026-09-10", 900)],
    }));
    assert.equal(m.situacao, "vencido");
    assert.equal(m.das, S2);
    assert.equal(m.pagoEm, null);
  });

  it("retificadora com diferença: o primeiro DAS dela pago pelo extrato quita mesmo com outro gerado depois", () => {
    const m = agosto(dados({
      declaracoes: [declaracao("2026-08", "D8", "2026-09-05T10:00:00"), declaracao("2026-08", "R8", "2026-09-20T10:00:00", "retificadora")],
      das: [das("2026-08", S0, "2026-09-05T10:01:00", true), das("2026-08", S1, "2026-09-20T10:01:00"), das("2026-08", S2, "2026-09-30T10:01:00")],
      extratos: [extrato("R8", S1, 150, "2026-09-25")],
    }));
    assert.equal(m.situacao, "pago");
    assert.equal(m.das, S1);
    assert.equal(m.valorDas, 150);
    assert.equal(m.pagoEm, "2026-09-25");
  });

  it("nenhum DAS pago antes do vencimento: em aberto (mês corrente)", () => {
    const d = dados({
      declaracoes: [{ ...declaracao("2026-09", "D9", "2026-10-05T10:00:00") }],
      das: [das("2026-09", S1.replace("08", "09"), "2026-10-05T10:01:00"), das("2026-09", S2.replace("08", "09"), "2026-10-10T10:01:00")],
    });
    const m = montarHistorico(d, AGORA, null).find((x) => x.pa === "2026-09")!;
    assert.equal(m.situacao, "em-aberto");
    assert.equal(m.das, S2.replace("08", "09"));
  });
});
