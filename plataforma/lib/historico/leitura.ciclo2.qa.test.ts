// QA, Parte 5 (ciclo 2): DAS gerado de novo (reemissão) para a mesma declaração, depois que o primeiro foi pago.
// Na Receita cada "Gerar DAS" cria um número novo; quem gera de novo (perdeu o PDF, reimprimiu) e paga o primeiro tem
// o mês quitado: os dois DAS cobram o mesmo débito da mesma declaração.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { montarHistorico, type DadosDoHistorico } from "./leitura";

const em = (iso: string) => new Date(`${iso}-03:00`);
const AGORA = em("2026-10-18T10:00:00");
const E = "00000000-0000-0000-0000-000000000001";
const declaracao = (pa: string, numero: string, transmitidaEm: string) => ({ id: numero, empresaId: E, pa, numero, tipo: "original" as const, transmitidaEm, malha: null, vistaEm: AGORA });
const das = (pa: string, numero: string, emitidoEm: string, pago = false) => ({ id: numero, empresaId: E, pa, numero, emitidoEm, pago, vistoEm: AGORA });
const dados = (d: Partial<DadosDoHistorico> = {}): DadosDoHistorico => ({ declaracoes: [], das: [], extratos: [], pagamentos: [], anosConsultados: new Set([2025, 2026]), ...d });

const S1 = "07202608000000001";
const S2 = "07202608000000002";
// 08/2026: declaração D8 em 05/09; DAS S1 gerado em 05/09 e pago em 15/09; DAS S2 gerado de novo em 10/09 (não pago).
const base = (extra: Partial<DadosDoHistorico>) =>
  dados({
    declaracoes: [declaracao("2026-08", "D8", "2026-09-05T10:00:00")],
    das: [das("2026-08", S1, "2026-09-05T10:01:00", true), das("2026-08", S2, "2026-09-10T09:00:00", false)],
    extratos: [
      {
        id: "x-D8", empresaId: E, pa: "2026-08", numeroDeclaracao: "D8", numeroDas: S1, receita: 23_000, valorDas: 1000.76,
        vencimento: "2026-09-18", pagoEm: "2026-09-15", valorPago: 1000.76, fatorR: null,
        atividades: [{ idAtividade: 30, descricao: "", receita: 23_000, valor: 1000.76 }], consultadoEm: AGORA,
      },
    ],
    ...extra,
  });

describe("QA: DAS gerado de novo depois do pago", () => {
  it("o mês continua pago (lista de DAS marca o primeiro como pago)", () => {
    const m = montarHistorico(base({}), AGORA, null).find((x) => x.pa === "2026-08")!;
    assert.equal(m.situacao, "pago");
  });
  it("o mês continua pago (consulta de pagamentos traz o primeiro DAS)", () => {
    const d = base({
      das: [das("2026-08", S1, "2026-09-05T10:01:00", false), das("2026-08", S2, "2026-09-10T09:00:00", false)],
      pagamentos: [{ id: "p1", empresaId: E, numero: S1, tipo: "DAS", pa: "2026-08", pagoEm: "2026-09-15", valor: 1000.76, documento: {}, vistoEm: AGORA }],
    });
    const m = montarHistorico(d, AGORA, null).find((x) => x.pa === "2026-08")!;
    assert.equal(m.situacao, "pago");
  });
});
