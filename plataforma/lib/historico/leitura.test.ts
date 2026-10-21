// Os 12 meses do Histórico montados com o que está no banco (função pura): situação de cada mês, pagamento, extrato da
// declaração vigente e a conferência do CNAE; e os avisos do sino.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AtividadeDiagnosticada, Diagnostico } from "@contabilizadev/nucleo/diagnostico";
import { avisosDoHistorico, montarHistorico, type DadosDoHistorico } from "./leitura";

const em = (iso: string) => new Date(`${iso}-03:00`);
const AGORA = em("2026-10-18T10:00:00"); // meses de 2025-10 a 2026-09
const E = "00000000-0000-0000-0000-000000000001";

const declaracao = (pa: string, numero: string, transmitidaEm: string, tipo: "original" | "retificadora" = "original") => ({
  id: numero,
  empresaId: E,
  pa,
  numero,
  tipo,
  transmitidaEm,
  malha: null,
  vistaEm: AGORA,
});
const das = (pa: string, numero: string, emitidoEm: string, pago = false) => ({ id: numero, empresaId: E, pa, numero, emitidoEm, pago, vistoEm: AGORA });
type OpcoesExtrato = {
  numeroDas?: string | null;
  origem?: "extrato" | "declaracao";
  receita?: number;
  valorDas?: number | null;
  pagoEm?: string | null;
  valorPago?: number | null;
  atividade?: number | null;
  consultadoEm?: Date;
};
const extrato = (pa: string, numeroDeclaracao: string, o: OpcoesExtrato = {}) => ({
  id: `x-${numeroDeclaracao}`,
  empresaId: E,
  pa,
  numeroDeclaracao,
  origem: o.origem ?? ("extrato" as const),
  numeroDas: o.numeroDas === undefined ? "07202600000000001" : o.numeroDas,
  receita: o.receita ?? 23_000,
  valorDas: o.valorDas === undefined ? 1000.76 : o.valorDas,
  vencimento: null,
  pagoEm: o.pagoEm ?? null,
  valorPago: o.valorPago ?? null,
  fatorR: null,
  atividades: [{ idAtividade: o.atividade === undefined ? 30 : o.atividade, descricao: "", receita: o.receita ?? 23_000, valor: o.valorDas ?? 1000.76 }],
  consultadoEm: o.consultadoEm ?? AGORA,
});
const pagamento = (pa: string, pagoEm: string, numero = `p-${pa}`, valor = 1000.76) => ({
  id: `p-${numero}`,
  empresaId: E,
  numero,
  tipo: "DAS" as const,
  pa,
  pagoEm,
  valor,
  documento: {},
  vistoEm: AGORA,
});

const dados = (d: Partial<DadosDoHistorico> = {}): DadosDoHistorico => ({ declaracoes: [], das: [], extratos: [], pagamentos: [], anosConsultados: new Set([2025, 2026]), ...d });
const atividade = (tributacao: AtividadeDiagnosticada["tributacao"]): AtividadeDiagnosticada => ({
  cnae: tributacao === "fator-r" ? "6201501" : "6209100",
  descricao: "",
  principal: true,
  tributacao,
  anexo: tributacao === "fator-r" ? "III ou V" : "III",
  fundamento: "",
});
const SUPORTE: Pick<Diagnostico, "atividades" | "anexo"> = { atividades: [atividade("anexo-fixo")], anexo: "III" };
const DEV: Pick<Diagnostico, "atividades" | "anexo"> = { atividades: [atividade("fator-r")], anexo: "III ou V" };

const mes = (meses: ReturnType<typeof montarHistorico>, pa: string) => meses.find((m) => m.pa === pa)!;

describe("situação de cada mês", () => {
  it("12 meses, do mais antigo ao mais recente, com o vencimento de cada um", () => {
    const meses = montarHistorico(dados(), AGORA, null);
    assert.deepEqual([meses[0].pa, meses[11].pa, meses.length], ["2025-10", "2026-09", 12]);
    assert.equal(mes(meses, "2026-09").vencimento, "2026-10-20");
    assert.equal(mes(meses, "2026-08").vencimento, "2026-09-21"); // 20/09/2026 é domingo: o DAS vai para o dia útil seguinte (CGSN 140/2018, art. 40, § 3º)
  });

  it("pago pelo pagamento, pelo extrato ou pela marca da lista de DAS; data do pagamento", () => {
    const meses = montarHistorico(
      dados({
        declaracoes: [declaracao("2026-09", "D9", "2026-10-05T13:35:43"), declaracao("2026-08", "D8", "2026-09-05T10:00:00"), declaracao("2026-07", "D7", "2026-08-05T10:00:00")],
        das: [das("2026-09", "S9", "2026-10-05T13:36:00"), das("2026-08", "S8", "2026-09-05T10:01:00"), das("2026-07", "S7", "2026-08-05T10:01:00", true)],
        extratos: [extrato("2026-09", "D9", { numeroDas: "S9" }), extrato("2026-08", "D8", { numeroDas: "S8", pagoEm: "2026-09-15" })],
        pagamentos: [pagamento("2026-09", "2026-10-13", "S9")],
      }),
      AGORA,
      SUPORTE,
    );
    assert.deepEqual([mes(meses, "2026-09").situacao, mes(meses, "2026-09").pagoEm, mes(meses, "2026-09").receita, mes(meses, "2026-09").valorDas], ["pago", "2026-10-13", 23_000, 1000.76]);
    assert.deepEqual([mes(meses, "2026-08").situacao, mes(meses, "2026-08").pagoEm], ["pago", "2026-09-15"]);
    // Pago pela marca da lista, sem data conhecida e sem extrato.
    assert.deepEqual([mes(meses, "2026-07").situacao, mes(meses, "2026-07").pagoEm, mes(meses, "2026-07").valorDas], ["pago", null, null]);
  });

  it("em aberto no prazo, vencido depois; sem valor; sem guia; não declarado e no prazo; não importado", () => {
    const antes = em("2026-10-10T10:00:00");
    const base = dados({
      declaracoes: [declaracao("2026-09", "D9", "2026-10-05T13:35:43"), declaracao("2026-06", "D6", "2026-07-05T10:00:00"), declaracao("2026-05", "D5", "2026-06-05T10:00:00")],
      das: [das("2026-09", "S9", "2026-10-05T13:36:00"), das("2026-06", "S6", "2026-07-05T10:01:00")],
      extratos: [extrato("2026-09", "D9"), extrato("2026-06", "D6", { valorDas: 0, receita: 0 })],
    });
    assert.equal(mes(montarHistorico(base, antes, null), "2026-09").situacao, "em-aberto");
    assert.equal(mes(montarHistorico(base, em("2026-10-21T08:00:00"), null), "2026-09").situacao, "vencido");
    const meses = montarHistorico(base, AGORA, null);
    assert.equal(mes(meses, "2026-06").situacao, "sem-valor");
    assert.equal(mes(meses, "2026-05").situacao, "sem-guia");
    assert.equal(mes(meses, "2026-04").situacao, "nao-declarado");
    assert.equal(mes(montarHistorico(dados(), antes, null), "2026-09").situacao, "no-prazo");
    assert.equal(mes(montarHistorico(dados({ anosConsultados: new Set([2026]) }), AGORA, null), "2025-12").situacao, "nao-importado");
  });
});

describe("pago é o DAS da declaração vigente", () => {
  // 08/2026: original D8 com DAS S8 pago; retificadora D8R aumentou o imposto e gerou S8R com a diferença.
  const retificada = (o: { s8rPago?: boolean; pagamentoS8R?: boolean } = {}) =>
    dados({
      declaracoes: [declaracao("2026-08", "D8", "2026-09-05T10:00:00"), declaracao("2026-08", "D8R", "2026-09-25T10:00:00", "retificadora")],
      das: [das("2026-08", "S8", "2026-09-05T10:01:00", true), das("2026-08", "S8R", "2026-09-25T10:01:00", o.s8rPago ?? false)],
      extratos: [extrato("2026-08", "D8R", { numeroDas: "S8R", valorDas: 300 })],
      pagamentos: [pagamento("2026-08", "2026-09-15", "S8", 1000), ...(o.pagamentoS8R ? [pagamento("2026-08", "2026-10-02", "S8R", 300)] : [])],
    });

  it("guia da diferença sem pagamento: vencido, com o valor da guia nova, mesmo com a guia original paga", () => {
    const m = mes(montarHistorico(retificada(), AGORA, null), "2026-08");
    assert.deepEqual([m.situacao, m.valorDas, m.das, m.pagoEm], ["vencido", 300, "S8R", null]);
  });

  it("guia da diferença paga (consulta de pagamentos ou marca da lista): pago, com a data dela", () => {
    const m = mes(montarHistorico(retificada({ pagamentoS8R: true }), AGORA, null), "2026-08");
    assert.deepEqual([m.situacao, m.pagoEm], ["pago", "2026-10-02"]);
    assert.equal(mes(montarHistorico(retificada({ s8rPago: true }), AGORA, null), "2026-08").situacao, "pago");
  });

  it("extrato com arrecadação de um DAS anterior não paga o DAS vigente", () => {
    const d = retificada();
    d.pagamentos = [];
    d.extratos.push(extrato("2026-08", "D8", { numeroDas: "S8", pagoEm: "2026-09-15", consultadoEm: em("2026-09-10T10:00:00") }));
    assert.equal(mes(montarHistorico(d, AGORA, null), "2026-08").situacao, "vencido");
  });
});

describe("DAS gerado de novo para a mesma declaração: pagar qualquer um quita o mês", () => {
  // 08/2026: declaração D8 em 05/09; S1 gerado em 05/09 (R$ 1.000,76) e S2 gerado de novo em 20/09, depois do vencimento,
  // com multa e juros (R$ 1.050,00). Os dois cobram o mesmo débito.
  const reemitido = (o: { s1?: "pagamento" | "marca" | "extrato"; s2?: "pagamento" } = {}) =>
    dados({
      declaracoes: [declaracao("2026-08", "D8", "2026-09-05T10:00:00")],
      das: [das("2026-08", "S1", "2026-09-05T10:01:00", o.s1 === "marca"), das("2026-08", "S2", "2026-09-20T09:00:00")],
      extratos: [extrato("2026-08", "D8", { numeroDas: "S1", pagoEm: o.s1 === "extrato" ? "2026-09-15" : null, valorPago: o.s1 === "extrato" ? 1000.76 : null })],
      pagamentos: [
        ...(o.s1 === "pagamento" ? [pagamento("2026-08", "2026-09-16", "S1", 1000.76)] : []),
        ...(o.s2 === "pagamento" ? [pagamento("2026-08", "2026-09-22", "S2", 1050)] : []),
      ],
    });

  it("o primeiro pago (pela consulta de pagamentos, pela marca da lista ou pelo extrato): pago, com o número, valor e data dele", () => {
    const pelaConsulta = mes(montarHistorico(reemitido({ s1: "pagamento" }), AGORA, null), "2026-08");
    assert.deepEqual([pelaConsulta.situacao, pelaConsulta.das, pelaConsulta.valorDas, pelaConsulta.pagoEm], ["pago", "S1", 1000.76, "2026-09-16"]);
    const pelaMarca = mes(montarHistorico(reemitido({ s1: "marca" }), AGORA, null), "2026-08");
    assert.deepEqual([pelaMarca.situacao, pelaMarca.das], ["pago", "S1"]);
    const peloExtrato = mes(montarHistorico(reemitido({ s1: "extrato" }), AGORA, null), "2026-08");
    assert.deepEqual([peloExtrato.situacao, peloExtrato.das, peloExtrato.pagoEm], ["pago", "S1", "2026-09-15"]);
  });

  it("o segundo pago: pago, com a data e o valor do pagamento dele", () => {
    const m = mes(montarHistorico(reemitido({ s2: "pagamento" }), AGORA, null), "2026-08");
    assert.deepEqual([m.situacao, m.das, m.valorDas, m.pagoEm], ["pago", "S2", 1050, "2026-09-22"]);
  });

  it("nenhum pago: vencido, pelo último DAS gerado", () => {
    const m = mes(montarHistorico(reemitido(), AGORA, null), "2026-08");
    assert.deepEqual([m.situacao, m.das, m.pagoEm], ["vencido", "S2", null]);
  });
});

describe("declarado sem DAS: o débito da própria declaração", () => {
  const semDas = (o: OpcoesExtrato | null, extra: Partial<DadosDoHistorico> = {}) =>
    dados({
      declaracoes: [declaracao("2026-07", "D7", "2026-08-05T10:00:00")],
      extratos: o ? [extrato("2026-07", "D7", { origem: "declaracao", numeroDas: null, ...o })] : [],
      ...extra,
    });

  it("débito zero (mês sem receita): sem valor a pagar", () => {
    const m = mes(montarHistorico(semDas({ receita: 0, valorDas: 0 }), AGORA, null), "2026-07");
    assert.deepEqual([m.situacao, m.valorDas, m.das, m.extrato?.origem], ["sem-valor", 0, null, "declaracao"]);
    // Débito não lido do PDF, mas receita zero: também sem valor.
    assert.equal(mes(montarHistorico(semDas({ receita: 0, valorDas: null }), AGORA, null), "2026-07").situacao, "sem-valor");
  });

  it("débito com valor e sem guia: sem guia no prazo, vencido depois", () => {
    assert.equal(mes(montarHistorico(semDas({ valorDas: 830 }), em("2026-08-10T10:00:00"), null), "2026-07").situacao, "sem-guia");
    const m = mes(montarHistorico(semDas({ valorDas: 830 }), AGORA, null), "2026-07");
    assert.deepEqual([m.situacao, m.valorDas, m.das], ["vencido", 830, null]);
  });

  it("débito ainda não buscado: sem guia (não dá para dizer que não há valor)", () => {
    assert.equal(mes(montarHistorico(semDas(null), AGORA, null), "2026-07").situacao, "sem-guia");
  });

  it("retificadora sem guia nova: pago se os pagamentos do mês cobrem o débito declarado; senão, a diferença está vencida", () => {
    const base = (debito: number) =>
      dados({
        declaracoes: [declaracao("2026-07", "D7", "2026-08-05T10:00:00"), declaracao("2026-07", "D7R", "2026-08-15T10:00:00", "retificadora")],
        das: [das("2026-07", "S7", "2026-08-05T10:01:00", true)],
        extratos: [extrato("2026-07", "D7R", { origem: "declaracao", numeroDas: null, valorDas: debito })],
        pagamentos: [pagamento("2026-07", "2026-08-10", "S7", 1000)],
      });
    const menor = mes(montarHistorico(base(900), AGORA, null), "2026-07");
    assert.deepEqual([menor.situacao, menor.pagoEm], ["pago", "2026-08-10"]);
    assert.equal(mes(montarHistorico(base(1000), AGORA, null), "2026-07").situacao, "pago");
    assert.equal(mes(montarHistorico(base(1000.01), AGORA, null), "2026-07").situacao, "vencido");
  });

  it("a conferência do CNAE também vale para a declaração sem DAS", () => {
    const m = mes(montarHistorico(semDas({ valorDas: 830, atividade: 14 }), AGORA, SUPORTE), "2026-07");
    assert.equal(m.divergencia?.esperada, 30);
  });
});

describe("retificadora e conferência do CNAE", () => {
  it("atividade 29 numa empresa de suporte (Anexo III fixo): divergência no mês, com o texto do aviso", () => {
    const meses = montarHistorico(
      dados({ declaracoes: [declaracao("2026-09", "D9", "2026-10-05T13:35:43")], das: [das("2026-09", "S9", "2026-10-05T13:36:00")], extratos: [extrato("2026-09", "D9", { atividade: 29 })] }),
      AGORA,
      SUPORTE,
    );
    const m = mes(meses, "2026-09");
    assert.equal(m.divergencia?.esperada, 30);
    assert.match(m.divergencia!.texto, /^Em 09\/2026 a declaração usou/);
    // Caso real (6209 declarado como 30) confere; sem diagnóstico não confere nada.
    const certo = montarHistorico(dados({ declaracoes: [declaracao("2026-09", "D9", "2026-10-05T13:35:43")], extratos: [extrato("2026-09", "D9")] }), AGORA, SUPORTE);
    assert.equal(mes(certo, "2026-09").divergencia, null);
    assert.equal(mes(montarHistorico(dados({ declaracoes: [declaracao("2026-09", "D9", "x")], extratos: [extrato("2026-09", "D9")] }), AGORA, null), "2026-09").divergencia, null);
    // Dev (Fator R) declarado como 30: divergência.
    assert.equal(mes(montarHistorico(dados({ declaracoes: [declaracao("2026-09", "D9", "x")], extratos: [extrato("2026-09", "D9")] }), AGORA, DEV), "2026-09").divergencia?.esperada, 29);
  });

  it("retificadora sem extrato novo: mostra o extrato anterior, mas não acusa (a retificação pode ter corrigido)", () => {
    const meses = montarHistorico(
      dados({
        declaracoes: [declaracao("2026-09", "D9", "2026-10-05T13:35:43"), declaracao("2026-09", "D9R", "2026-10-12T09:00:00", "retificadora")],
        das: [das("2026-09", "S9", "2026-10-05T13:36:00")],
        extratos: [extrato("2026-09", "D9", { atividade: 29 })],
      }),
      AGORA,
      SUPORTE,
    );
    const m = mes(meses, "2026-09");
    assert.equal(m.declaracao?.numero, "D9R");
    assert.equal(m.declaracao?.tipo, "retificadora");
    assert.equal(m.extrato?.daDeclaracaoVigente, false);
    assert.equal(m.receita, 23_000);
    assert.equal(m.divergencia, null);
  });

  it("com o extrato da retificadora, vale ele (e não o antigo)", () => {
    const meses = montarHistorico(
      dados({
        declaracoes: [declaracao("2026-09", "D9", "2026-10-05T13:35:43"), declaracao("2026-09", "D9R", "2026-10-12T09:00:00", "retificadora")],
        das: [das("2026-09", "S9", "2026-10-05T13:36:00"), das("2026-09", "S9R", "2026-10-12T09:01:00")],
        extratos: [extrato("2026-09", "D9", { atividade: 29, consultadoEm: em("2026-10-06T10:00:00") }), extrato("2026-09", "D9R", { atividade: 30, receita: 25_000, consultadoEm: em("2026-10-01T10:00:00") })],
      }),
      AGORA,
      SUPORTE,
    );
    const m = mes(meses, "2026-09");
    assert.equal(m.receita, 25_000);
    assert.equal(m.extrato?.daDeclaracaoVigente, true);
    assert.equal(m.divergencia, null);
  });
});

describe("avisos do sino", () => {
  it("situação irregular (vermelho) e uma divergência por mês (amarelo), cada um com o link", () => {
    const meses = montarHistorico(
      dados({ declaracoes: [declaracao("2026-09", "D9", "x")], extratos: [extrato("2026-09", "D9", { atividade: 29 })] }),
      AGORA,
      SUPORTE,
    );
    const avisos = avisosDoHistorico(meses, { atual: { id: "s", regular: false, pendencias: "Débito", prontoEm: AGORA, temPdf: true }, processando: false });
    assert.deepEqual(
      avisos.map((a) => [a.nivel, a.link.href]),
      [
        ["vencida", "/situacao"],
        ["vence", "/historico"],
      ],
    );
    assert.match(avisos[1].texto, /Retifique a declaração no portal\.$/);
    assert.deepEqual(avisosDoHistorico(montarHistorico(dados(), AGORA, SUPORTE), { atual: null, processando: false }), []);
    assert.deepEqual(avisosDoHistorico([], { atual: { id: "s", regular: true, pendencias: null, prontoEm: AGORA, temPdf: true }, processando: false }), []);
  });
});
