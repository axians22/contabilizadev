// Regra de consulta do histórico (banco primeiro): o que está velho, o intervalo do botão e o plano de cada pedido.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  anoDaDefis,
  anosDoHistorico,
  declaracoesVencidas,
  defisVencida,
  esperaManual,
  mesesDoHistorico,
  pagamentosVencidos,
  planejar,
  proximaSituacao,
  situacaoVencida,
  type EstadoDoBanco,
} from "./prazos";

const em = (iso: string) => new Date(`${iso}-03:00`); // horário de Brasília
const HORA = 60 * 60 * 1000;
const AGORA = em("2026-10-18T10:00:00");

const vazio = (extra: Partial<EstadoDoBanco> = {}): EstadoDoBanco => ({
  consultas: new Map(),
  ultimoProntoSituacao: null,
  situacaoProcessando: false,
  defisEntregues: new Set(),
  dasSemPagamentoVencido: false,
  extratosFaltando: 0,
  ...extra,
});
const consultas = (o: Record<string, Date>) => new Map(Object.entries(o).map(([k, d]) => [k, { em: d, ok: true }]));

describe("meses e anos do histórico", () => {
  it("os 12 meses antes do mês atual (Brasília), do mais antigo ao mais recente", () => {
    const meses = mesesDoHistorico(AGORA);
    assert.equal(meses.length, 12);
    assert.equal(meses[0], "2025-10");
    assert.equal(meses[11], "2026-09");
    assert.deepEqual(anosDoHistorico(AGORA), [2025, 2026]);
    // Janeiro: só o ano anterior.
    assert.deepEqual(anosDoHistorico(em("2027-01-05T12:00:00")), [2026]);
    // 31/12 às 22h em Brasília já é 01/01 em UTC: vale o dia do Brasil.
    assert.equal(mesesDoHistorico(new Date("2027-01-01T01:00:00Z"))[11], "2026-11");
  });

  it("ano da DEFIS: o anterior depois de 31 de março; antes disso, o retrasado", () => {
    assert.equal(anoDaDefis(em("2026-10-18T10:00:00")), 2025);
    assert.equal(anoDaDefis(em("2027-03-31T23:00:00")), 2025);
    assert.equal(anoDaDefis(em("2027-04-01T00:30:00")), 2026);
  });
});

describe("prazos de cada consulta", () => {
  it("declarações: nunca consultadas, vencidas depois de 1 dia; ano anterior só até a consulta depois de 1º de fevereiro", () => {
    assert.equal(declaracoesVencidas(2026, undefined, AGORA), true);
    assert.equal(declaracoesVencidas(2026, new Date(AGORA.getTime() - 23 * HORA), AGORA), false);
    assert.equal(declaracoesVencidas(2026, new Date(AGORA.getTime() - 25 * HORA), AGORA), true);
    // 2025 consultado em 2026-02-02: não muda mais sozinho.
    assert.equal(declaracoesVencidas(2025, em("2026-02-02T09:00:00"), AGORA), false);
    // 2025 consultado em janeiro (antes da declaração de dezembro vencer): consulta de novo.
    assert.equal(declaracoesVencidas(2025, em("2026-01-15T09:00:00"), AGORA), true);
    assert.equal(declaracoesVencidas(2025, undefined, AGORA), true);
  });

  it("pagamentos: só com DAS sem pagamento conhecido e vencido, e no máximo 1 vez por dia", () => {
    assert.equal(pagamentosVencidos(undefined, AGORA, false), true);
    assert.equal(pagamentosVencidos(new Date(AGORA.getTime() - 2 * 24 * HORA), AGORA, false), false);
    assert.equal(pagamentosVencidos(new Date(AGORA.getTime() - 2 * 24 * HORA), AGORA, true), true);
    assert.equal(pagamentosVencidos(new Date(AGORA.getTime() - 2 * HORA), AGORA, true), false);
  });

  it("situação fiscal: a cada 2 meses do último pronto; tentativa recente espera 1 dia", () => {
    assert.equal(proximaSituacao(em("2026-08-18T15:00:00")), "2026-10-18");
    assert.equal(proximaSituacao(em("2026-12-31T15:00:00")), "2027-02-28");
    assert.equal(situacaoVencida(null, undefined, AGORA), true);
    assert.equal(situacaoVencida(em("2026-08-18T15:00:00"), em("2026-08-18T15:00:00"), AGORA), true);
    assert.equal(situacaoVencida(em("2026-08-19T15:00:00"), em("2026-08-19T15:00:00"), AGORA), false);
    // Falhou há 2 horas: não tenta de novo hoje, mesmo sem relatório.
    assert.equal(situacaoVencida(null, new Date(AGORA.getTime() - 2 * HORA), AGORA), false);
  });

  it("DEFIS: entregue não volta sozinha; sem ela, uma consulta depois do prazo por ano", () => {
    assert.equal(defisVencida(2025, undefined, false, AGORA), true);
    assert.equal(defisVencida(2025, undefined, true, AGORA), false);
    // Consultada antes do prazo (31/03/2026): consulta de novo agora.
    assert.equal(defisVencida(2025, em("2026-03-10T10:00:00"), false, AGORA), true);
    // Já consultada depois do prazo e não encontrada: só pelo botão.
    assert.equal(defisVencida(2025, em("2026-04-02T10:00:00"), false, AGORA), false);
  });

  it("botão Atualizar: minutos que faltam para o intervalo mínimo", () => {
    assert.equal(esperaManual(undefined, AGORA, 10), 0);
    assert.equal(esperaManual(new Date(AGORA.getTime() - 3 * 60_000), AGORA, 10), 7);
    assert.equal(esperaManual(new Date(AGORA.getTime() - 9.5 * 60_000), AGORA, 10), 1);
    assert.equal(esperaManual(new Date(AGORA.getTime() - 10 * 60_000), AGORA, 10), 0);
  });
});

describe("plano de cada pedido", () => {
  const TUDO = { grupos: ["historico", "defis", "situacao"] as const, manual: false };

  it("importação inicial (nada no banco): tudo", () => {
    const p = planejar(vazio(), { ...TUDO, grupos: [...TUDO.grupos] }, AGORA);
    assert.deepEqual(p, {
      etapas: [{ id: "declaracoes", anos: [2025, 2026] }, { id: "extratos" }, { id: "pagamentos" }, { id: "defis", anos: [2025] }, { id: "situacao" }],
      espera: 0,
    });
  });

  it("tudo em dia: nada a consultar (nenhuma chamada)", () => {
    const e = vazio({
      consultas: consultas({
        "declaracoes:2025": em("2026-02-10T10:00:00"),
        "declaracoes:2026": new Date(AGORA.getTime() - HORA),
        pagamentos: new Date(AGORA.getTime() - 3 * 24 * HORA),
        "defis:2025": em("2026-04-10T10:00:00"),
        situacao: em("2026-10-01T10:00:00"),
      }),
      ultimoProntoSituacao: em("2026-10-01T10:00:00"),
    });
    assert.deepEqual(planejar(e, { grupos: ["historico", "defis", "situacao"], manual: false }, AGORA), { etapas: [], espera: 0 });
  });

  it("automático só com o que venceu; extrato que falta é buscado sem consultar a lista de novo", () => {
    const e = vazio({
      consultas: consultas({ "declaracoes:2025": em("2026-02-10T10:00:00"), "declaracoes:2026": new Date(AGORA.getTime() - 30 * HORA), pagamentos: new Date(AGORA.getTime() - HORA) }),
      dasSemPagamentoVencido: true,
    });
    assert.deepEqual(planejar(e, { grupos: ["historico"], manual: false }, AGORA).etapas, [{ id: "declaracoes", anos: [2026] }, { id: "extratos" }]);
    const soExtrato = vazio({
      consultas: consultas({ "declaracoes:2025": em("2026-02-10T10:00:00"), "declaracoes:2026": new Date(AGORA.getTime() - HORA), pagamentos: new Date(AGORA.getTime() - HORA) }),
      extratosFaltando: 2,
    });
    assert.deepEqual(planejar(soExtrato, { grupos: ["historico"], manual: false }, AGORA).etapas, [{ id: "extratos" }]);
  });

  it("manual: tudo do grupo, mas não antes do intervalo mínimo", () => {
    const recente = vazio({ consultas: consultas({ "declaracoes:2026": new Date(AGORA.getTime() - 4 * 60_000) }) });
    assert.deepEqual(planejar(recente, { grupos: ["historico"], manual: true }, AGORA), { etapas: [], espera: 6 });
    const antigo = vazio({ consultas: consultas({ "declaracoes:2026": new Date(AGORA.getTime() - 11 * 60_000) }) });
    assert.deepEqual(planejar(antigo, { grupos: ["historico"], manual: true }, AGORA).etapas, [
      { id: "declaracoes", anos: [2025, 2026] },
      { id: "extratos" },
      { id: "pagamentos" },
    ]);
    // DEFIS pelo botão: o ano anterior (pode ter sido entregue antes do prazo) mesmo já entregue.
    assert.deepEqual(planejar(vazio({ defisEntregues: new Set([2025]) }), { grupos: ["defis"], manual: true }, AGORA).etapas, [{ id: "defis", anos: [2025] }]);
    assert.deepEqual(planejar(vazio(), { grupos: ["defis"], manual: true }, em("2027-02-10T10:00:00")).etapas, [{ id: "defis", anos: [2026, 2025] }]);
    // Situação fiscal: 30 minutos, e nunca com um pedido em andamento.
    assert.equal(planejar(vazio({ consultas: consultas({ situacao: new Date(AGORA.getTime() - 20 * 60_000) }) }), { grupos: ["situacao"], manual: true }, AGORA).espera, 10);
    assert.deepEqual(planejar(vazio({ situacaoProcessando: true }), { grupos: ["situacao"], manual: true }, AGORA), { etapas: [], espera: 0 });
  });
});
