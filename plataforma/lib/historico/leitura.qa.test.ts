// QA, Parte 5 (passo 17): situação do mês com retificadora que gera DAS complementar.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { montarHistorico, type DadosDoHistorico } from "./leitura";

const em = (iso: string) => new Date(`${iso}-03:00`);
const AGORA = em("2026-10-18T10:00:00");
const E = "00000000-0000-0000-0000-000000000001";
const declaracao = (pa: string, numero: string, transmitidaEm: string, tipo: "original" | "retificadora" = "original") => ({ id: numero, empresaId: E, pa, numero, tipo, transmitidaEm, malha: null, vistaEm: AGORA });
const das = (pa: string, numero: string, emitidoEm: string, pago = false) => ({ id: numero, empresaId: E, pa, numero, emitidoEm, pago, vistoEm: AGORA });
const dados = (d: Partial<DadosDoHistorico> = {}): DadosDoHistorico => ({ declaracoes: [], das: [], extratos: [], pagamentos: [], anosConsultados: new Set([2025, 2026]), ...d });

describe("QA: retificadora com DAS complementar sem pagamento", () => {
  // 08/2026: original D8 com DAS S8 (R$ 1.000,00, pago em 15/09). Retificadora D8R aumentou a receita e gerou o DAS
  // S8R com a diferença, que não foi pago. Vencimento 18/09/2026, hoje 18/10/2026: a diferença está vencida.
  const base = dados({
    declaracoes: [declaracao("2026-08", "D8", "2026-09-05T10:00:00"), declaracao("2026-08", "D8R", "2026-09-25T10:00:00", "retificadora")],
    das: [das("2026-08", "07202608000000001", "2026-09-05T10:01:00", true), das("2026-08", "07202608000000002", "2026-09-25T10:01:00", false)],
    extratos: [
      {
        id: "x-D8R",
        empresaId: E,
        pa: "2026-08",
        numeroDeclaracao: "D8R",
        numeroDas: "07202608000000002",
        receita: 30_000,
        valorDas: 300,
        vencimento: "2026-09-18",
        pagoEm: null,
        valorPago: null,
        fatorR: null,
        atividades: [{ idAtividade: 30, descricao: "", receita: 30_000, valor: 1300 }],
        consultadoEm: AGORA,
      },
    ],
    pagamentos: [{ id: "p1", empresaId: E, numero: "07202608000000001", tipo: "DAS", pa: "2026-08", pagoEm: "2026-09-15", valor: 1000, documento: {}, vistoEm: AGORA }],
  });

  it("o mês não aparece como pago: o DAS da declaração vigente (a diferença) está vencido", () => {
    const m = montarHistorico(base, AGORA, null).find((x) => x.pa === "2026-08")!;
    assert.notEqual(m.situacao, "pago", "o DAS complementar da retificadora (07202608000000002) não foi pago, mas o mês aparece como pago");
  });
});
