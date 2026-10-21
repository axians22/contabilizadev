import { test } from "node:test";
import assert from "node:assert/strict";
import { idAtividadeExportacao, regraDoCnae } from "../cnae.ts";
import { calcularDas, fatorR, janelaDoze } from "../simples.ts";
import { CONTRIBUINTE, clienteFalso } from "./cliente-falso.ts";
import { ErroSemResposta } from "./cliente.ts";
import {
  bloqueioTransmissao,
  dadosDeclaracao,
  emitirDas,
  folhasDaDeclaracao,
  motivoParaNaoTransmitir,
  receitasAnterioresDaDeclaracao,
  nomeTributo,
  simular,
  transmitir,
  valoresDoDas,
  valoresIguais,
} from "./pgdasd.ts";

const CNPJ = "11.222.333/0001-81";
const dasReal = calcularDas({ pa: "2026-09", receita: 23_000, rbt12: 352_998.85, anexo: "III", mercado: "externo" });
const VALORES_REAIS = { 1001: 78.65, 1002: 68.81, 1006: 853.3 };
const ok = (dados: unknown, status = 200) => ({ status, dados, mensagens: [{ codigo: "MSG", texto: "ok" }] });

test("valores do cálculo no formato da Receita (caso real de 09/2026)", () => {
  assert.deepEqual(valoresDoDas(dasReal), VALORES_REAIS);
  assert.equal(nomeTributo(1006), "INSS/CPP");
  assert.equal(nomeTributo(9999), "9999");
});

test("valores iguais com tolerância de meio centavo e tributo ausente vale zero", () => {
  assert.equal(valoresIguais({ 1001: 78.65 }, { 1001: 78.654 }), true);
  assert.equal(valoresIguais({ 1001: 78.65 }, { 1001: 78.66 }), false);
  assert.equal(valoresIguais({ 1001: 1, 1004: 0 }, { 1001: 1 }), true);
  assert.equal(valoresIguais({ 1001: 1 }, { 1001: 1, 1010: 0.01 }), false);
});

test("monta a declaração com o CNPJ e a atividade recebidos", () => {
  const d = dadosDeclaracao({ cnpj: CNPJ, pa: "2026-09", receitaExterna: 23_000, idAtividade: 30, transmitir: false, retificadora: false });
  assert.equal(d.cnpjCompleto, "11222333000181");
  assert.equal(d.pa, 202609);
  assert.equal(d.declaracao.tipoDeclaracao, 1);
  assert.equal(d.declaracao.receitaPaCompetenciaExterno, 23_000);
  assert.deepEqual(d.declaracao.estabelecimentos[0], {
    cnpjCompleto: "11222333000181",
    atividades: [{ idAtividade: 30, valorAtividade: 23_000, receitasAtividade: [{ valor: 23_000 }] }],
  });
  assert.equal("valoresParaComparacao" in d, false);
  const zero = dadosDeclaracao({ cnpj: CNPJ, pa: "2026-09", receitaExterna: 0, idAtividade: 30, transmitir: true, retificadora: true, comparar: { 1001: 0 } });
  assert.deepEqual(zero.declaracao.estabelecimentos[0], { cnpjCompleto: "11222333000181" });
  assert.equal(zero.declaracao.tipoDeclaracao, 2);
  assert.deepEqual(zero.valoresParaComparacao, []);
  assert.throws(() => dadosDeclaracao({ cnpj: "123", pa: "2026-09", receitaExterna: 1, idAtividade: 30, transmitir: false, retificadora: false }), /CNPJ/);
  assert.throws(() => dadosDeclaracao({ cnpj: CNPJ, pa: "2026-9", receitaExterna: 1, idAtividade: 30, transmitir: false, retificadora: false }), /inválido/);
});

test("bloqueios da transmissão", () => {
  const base = { pa: "2026-09", mesAtual: "2026-10", declarada: false, transmitidaPelaPlataforma: false };
  assert.equal(bloqueioTransmissao(base), null);
  assert.match(bloqueioTransmissao({ ...base, pa: "2026-10" })!, /não terminou/);
  assert.match(bloqueioTransmissao({ ...base, declarada: true })!, /já foi declarado/);
  assert.match(bloqueioTransmissao({ ...base, transmitidaPelaPlataforma: true })!, /já foi transmitida/);
  // Retificação é pedido explícito: só para mês declarado (e a plataforma pode retificar o que ela mesma transmitiu).
  assert.match(bloqueioTransmissao({ ...base, declarada: true })!, /faça uma retificação/);
  assert.equal(bloqueioTransmissao({ ...base, declarada: true, transmitidaPelaPlataforma: true, retificar: true }), null);
  assert.match(bloqueioTransmissao({ ...base, retificar: true })!, /não há declaração para retificar/);
  assert.match(bloqueioTransmissao({ ...base, pa: "2026-10", declarada: true, retificar: true })!, /não terminou/);
  assert.match(motivoParaNaoTransmitir(null, null, 1, {})!, /simulação antes/);
  assert.match(motivoParaNaoTransmitir(null, { receita: 2, valores: {} }, 1, {})!, /receita mudou/);
  assert.match(motivoParaNaoTransmitir(null, { receita: 1, valores: { 1001: 1 } }, 1, { 1001: 2 })!, /não bateu/);
  assert.equal(motivoParaNaoTransmitir(null, { receita: 1, valores: VALORES_REAIS }, 1, VALORES_REAIS), null);
});

test("simular: devolve os valores da Receita sem transmitir (resposta gravada)", async () => {
  const cliente = clienteFalso(ok([{ valoresDevidos: [{ codigoTributo: 1001, valor: 78.65 }, { codigoTributo: 1002, valor: 68.81 }, { codigoTributo: 1006, valor: 853.3 }] }]));
  const r = await simular(cliente, CONTRIBUINTE, { cnpj: CNPJ, pa: "2026-09", receitaExterna: 23_000, idAtividade: 30, retificadora: true, mesAtual: "2026-10" });
  assert.equal(r.ok, true);
  assert.ok(r.ok && valoresIguais(r.valores, valoresDoDas(dasReal)));
  const { acao, pedido } = cliente.chamadas[0];
  assert.equal(acao, "Declarar");
  assert.equal((pedido.dados as { indicadorTransmissao: boolean }).indicadorTransmissao, false);
  assert.equal(cliente.chamadas[0].opcoes.confirmado, undefined);
});

test("simular: mês corrente não é enviado; erro vira resultado", async () => {
  const cliente = clienteFalso(new Error("rede caiu"), ok(null, 400));
  const base = { cnpj: CNPJ, pa: "2026-09", receitaExterna: 1, idAtividade: 30, retificadora: false };
  assert.deepEqual(await simular(cliente, CONTRIBUINTE, { ...base, mesAtual: "2026-09" }), { ok: false, detalhe: "Não enviado: o mês ainda não terminou." });
  assert.deepEqual(await simular(cliente, CONTRIBUINTE, { ...base, mesAtual: "2026-10" }), { ok: false, detalhe: "rede caiu" });
  assert.equal((await simular(cliente, CONTRIBUINTE, { ...base, mesAtual: "2026-10" })).ok, false);
});

test("transmitir: só com simulação igual e confirmação; envia os valores para comparação", async () => {
  const d = { cnpj: CNPJ, pa: "2026-09", receitaExterna: 23_000, idAtividade: 30, valores: VALORES_REAIS, bloqueio: null, retificadora: false };
  const semConfirmar = clienteFalso();
  const r1 = await transmitir(semConfirmar, CONTRIBUINTE, { ...d, simulacao: { receita: 23_000, valores: VALORES_REAIS }, confirmado: false });
  assert.match(r1.detalhe, /confirmação/);
  const r2 = await transmitir(semConfirmar, CONTRIBUINTE, { ...d, simulacao: { receita: 23_000, valores: { 1001: 1 } }, confirmado: true });
  assert.match(r2.detalhe, /não bateu/);
  assert.equal(semConfirmar.chamadas.length, 0);

  const cliente = clienteFalso(ok([{ idDeclaracao: "11222333202609001", valoresDevidos: [{ codigoTributo: 1001, valor: 78.65 }], declaracao: "UERG", recibo: "UkVD" }]));
  const r = await transmitir(cliente, CONTRIBUINTE, { ...d, simulacao: { receita: 23_000, valores: VALORES_REAIS }, confirmado: true });
  assert.ok(r.ok);
  assert.equal(r.idDeclaracao, "11222333202609001");
  assert.equal(r.declaracaoPdf, "UERG");
  const dados = cliente.chamadas[0].pedido.dados as { indicadorTransmissao: boolean; valoresParaComparacao: unknown[] };
  assert.equal(dados.indicadorTransmissao, true);
  assert.equal(dados.valoresParaComparacao.length, 3);
  assert.equal(cliente.chamadas[0].opcoes.confirmado, true);
  assert.equal((dados as unknown as { declaracao: { tipoDeclaracao: number } }).declaracao.tipoDeclaracao, 1);
});

test("transmitir retificadora: tipoDeclaracao 2 e a finalidade registra a retificação", async () => {
  const cliente = clienteFalso(ok([{ idDeclaracao: "11222333202609002", valoresDevidos: [{ codigoTributo: 1001, valor: 78.65 }] }]));
  const r = await transmitir(cliente, CONTRIBUINTE, {
    cnpj: CNPJ, pa: "2026-09", receitaExterna: 23_000, idAtividade: 30, valores: VALORES_REAIS, bloqueio: null, retificadora: true,
    simulacao: { receita: 23_000, valores: VALORES_REAIS }, confirmado: true,
  });
  assert.ok(r.ok);
  assert.equal((cliente.chamadas[0].pedido.dados as { declaracao: { tipoDeclaracao: number } }).declaracao.tipoDeclaracao, 2);
  assert.match(cliente.chamadas[0].finalidade, /retificadora/);
});

test("emitir DAS: só depois da declaração; DAS vencido com data de pagamento válida", async () => {
  const cliente = clienteFalso(
    ok([{ pdf: "JVBERi0=", detalhamento: { numeroDocumento: "07202627851592322", dataVencimento: "20261020", valores: { principal: 1000.76, total: 1000.76 } } }]),
    ok([{ pdf: "JVBERi0=", detalhamento: { valores: { principal: 1000.76, multa: 20.02, juros: 10, total: 1030.78 } } }]),
  );
  assert.match((await emitirDas(cliente, CONTRIBUINTE, { pa: "2026-09", declarado: false })).detalhe, /depois da declaração/);
  const r = await emitirDas(cliente, CONTRIBUINTE, { pa: "2026-09", declarado: true });
  assert.ok(r.ok);
  assert.equal(r.total, 1000.76);
  assert.equal(r.numero, "07202627851592322");
  assert.deepEqual(cliente.chamadas[0].pedido.dados, { periodoApuracao: "202609" });

  const sabado = await emitirDas(cliente, CONTRIBUINTE, { pa: "2026-09", declarado: true, pagarEm: "2026-10-24", hoje: "2026-10-21" });
  assert.match(sabado.detalhe, /dia útil/);
  const atualizado = await emitirDas(cliente, CONTRIBUINTE, { pa: "2026-09", declarado: true, pagarEm: "2026-10-26", hoje: "2026-10-21" });
  assert.ok(atualizado.ok);
  assert.equal(atualizado.multa, 20.02);
  assert.deepEqual(cliente.chamadas[1].pedido.dados, { periodoApuracao: "202609", dataConsolidacao: "20261026" });
});

test("atividade 29 (exportação sujeita ao fator r): a declaração leva a folha de salários dos 12 meses", () => {
  const idAtividade = idAtividadeExportacao(regraDoCnae("6201-5/01"));
  assert.equal(idAtividade, 29);
  const meses = janelaDoze("2026-09"); // 2025-09 a 2026-08
  const folhas = Object.fromEntries(meses.slice(2).map((m) => [m, 3_400.1]));
  const receitas = Object.fromEntries(meses.map((m) => [m, 10_000]));
  assert.equal(fatorR("2026-09", folhas, receitas).anexo, "III"); // 34.001 / 120.000 = 0,2833
  const d = dadosDeclaracao({ cnpj: CNPJ, pa: "2026-09", receitaExterna: 23_000, idAtividade, folhasSalario: folhas, transmitir: false, retificadora: false });
  assert.deepEqual(d.declaracao.folhasSalario, [
    { pa: 202509, valor: 0 },
    { pa: 202510, valor: 0 },
    ...meses.slice(2).map((m) => ({ pa: Number(m.replace("-", "")), valor: 3_400.1 })),
  ]);
  assert.equal(d.declaracao.folhasSalario!.length, 12);
  assert.deepEqual(d.declaracao.estabelecimentos[0], {
    cnpjCompleto: "11222333000181",
    atividades: [{ idAtividade: 29, valorAtividade: 23_000, receitasAtividade: [{ valor: 23_000 }] }],
  });
  // Sem a folha a declaração não é montada (o PGDAS-D usaria fator r 0,01 e o Anexo V).
  assert.throws(
    () => dadosDeclaracao({ cnpj: CNPJ, pa: "2026-09", receitaExterna: 23_000, idAtividade, transmitir: false, retificadora: false }),
    /sujeita ao fator r: informe a folha/,
  );
  // Mês sem receita não tem atividade e não precisa de folha.
  const zero = dadosDeclaracao({ cnpj: CNPJ, pa: "2026-09", receitaExterna: 0, idAtividade, transmitir: false, retificadora: false });
  assert.equal("folhasSalario" in zero.declaracao, false);
  // Atividade 30 (Anexo III fixo) não manda folha, mesmo se informada.
  const trinta = dadosDeclaracao({ cnpj: CNPJ, pa: "2026-09", receitaExterna: 1, idAtividade: 30, folhasSalario: folhas, transmitir: false, retificadora: false });
  assert.equal("folhasSalario" in trinta.declaracao, false);
});

test("folha da declaração: mesma janela do Fator R (2027 em diante) e valores inválidos recusados", () => {
  assert.deepEqual(folhasDaDeclaracao("2027-01", { "2025-12": 1, "2026-11": 2.005, "2026-12": 99 }).map((f) => [f.pa, f.valor]), [
    [202512, 1], [202601, 0], [202602, 0], [202603, 0], [202604, 0], [202605, 0],
    [202606, 0], [202607, 0], [202608, 0], [202609, 0], [202610, 0], [202611, 2.01],
  ]);
  assert.throws(() => folhasDaDeclaracao("2026-09", { "2026-01": -1 }), /Valor inválido em folhasSalario \(2026-01\)/);
  assert.throws(() => folhasDaDeclaracao("2026-09", { "2026-01": Number.NaN }), /Valor inválido/);
});

test("folha da declaração usa os mesmos meses do Fator R em cada regra de início de atividade", () => {
  const meses = (f: { pa: number }[] | undefined) => (f ?? []).map((x) => x.pa);
  const declarar = (pa: string, folhas: Record<string, number>, inicioAtividade?: string) =>
    dadosDeclaracao({ cnpj: CNPJ, pa, receitaExterna: 10_000, idAtividade: 29, folhasSalario: folhas, inicioAtividade, transmitir: false, retificadora: false })
      .declaracao.folhasSalario;

  // Mês de abertura até 2026: só a folha do próprio PA (FSPA, manual PGDAS-D 2018 v4, 8.2.1).
  const abertura = declarar("2026-09", { "2026-09": 5_000 }, "2026-09");
  assert.deepEqual(abertura, [{ pa: 202609, valor: 5_000 }]);
  assert.equal(fatorR("2026-09", { "2026-09": 5_000 }, { "2026-09": 10_000 }, "2026-09").anexo, "III");

  // 2º e 3º mês até 2026: meses anteriores desde o início (os de antes da abertura não existem e somariam zero).
  assert.deepEqual(meses(declarar("2026-10", { "2026-09": 5_000 }, "2026-09")), [202609]);
  assert.deepEqual(meses(declarar("2026-11", {}, "2026-09")), [202609, 202610]);
  const f = fatorR("2026-11", { "2026-09": 1_000, "2026-10": 2_000 }, { "2026-09": 5_000, "2026-10": 5_000 }, "2026-09");
  assert.deepEqual(f.meses, ["2026-09", "2026-10"]);
  assert.deepEqual(meses(declarar("2026-11", {}, "2026-09")), f.meses.map((m) => Number(m.replace("-", ""))));

  // Empresa com mais de 12 meses: 12 anteriores ao PA, com ou sem início informado.
  assert.deepEqual(meses(declarar("2026-09", {}, "2020-01")), janelaDoze("2026-09").map((m) => Number(m.replace("-", ""))));
  assert.equal(meses(declarar("2026-09", {})).length, 12);

  // A partir de 2027: 1º e 2º mês têm fator r fixo em 0,28, sem folha a enviar (e sem exigir folha).
  assert.equal(fatorR("2027-02", {}, {}, "2027-01").regra, "inicio-dois-primeiros-meses");
  const sem = dadosDeclaracao({ cnpj: CNPJ, pa: "2027-02", receitaExterna: 10_000, idAtividade: 29, inicioAtividade: "2027-01", transmitir: false, retificadora: false });
  assert.equal("folhasSalario" in sem.declaracao, false);
  // 3º mês em 2027: a janela termina no mês anterior ao anterior (CGSN 190/2026), desde o início.
  assert.deepEqual(meses(declarar("2027-03", {}, "2027-01")), [202701]);
  assert.deepEqual(fatorR("2027-03", {}, {}, "2027-01").meses, ["2027-01"]);

  // Em todas as regras a lista é exatamente a do Fator R.
  for (const [pa, inicio] of [["2026-09", "2026-09"], ["2026-12", "2026-03"], ["2027-01", "2026-12"], ["2027-05", "2027-01"], ["2028-03", undefined]] as const) {
    assert.deepEqual(folhasDaDeclaracao(pa, {}, inicio).map((x) => x.pa), fatorR(pa, {}, {}, inicio).meses.map((m) => Number(m.replace("-", ""))), `${pa}/${inicio}`);
  }
});

test("receitas brutas anteriores (primeira declaração): só meses antes do PA, mercado externo", () => {
  assert.deepEqual(receitasAnterioresDaDeclaracao("2026-09", { "2026-08": 26_908.25, "2025-01": 19_878.04 }), [
    { pa: 202501, valorInterno: 0, valorExterno: 19_878.04 },
    { pa: 202608, valorInterno: 0, valorExterno: 26_908.25 },
  ]);
  assert.throws(() => receitasAnterioresDaDeclaracao("2026-09", { "2026-09": 1 }), /fora do período/);
  assert.throws(() => receitasAnterioresDaDeclaracao("2026-09", { "2026-8": 1 }), /fora do período/);
  const d = dadosDeclaracao({ cnpj: CNPJ, pa: "2026-09", receitaExterna: 1, idAtividade: 30, receitasBrutasAnteriores: { "2026-08": 5 }, transmitir: false, retificadora: false });
  assert.deepEqual(d.declaracao.receitasBrutasAnteriores, [{ pa: 202608, valorInterno: 0, valorExterno: 5 }]);
  const sem = dadosDeclaracao({ cnpj: CNPJ, pa: "2026-09", receitaExterna: 1, idAtividade: 30, transmitir: false, retificadora: false });
  assert.equal("receitasBrutasAnteriores" in sem.declaracao, false);
});

test("simular com atividade 29 envia a folha no pedido (resposta gravada)", async () => {
  const cliente = clienteFalso(ok([{ valoresDevidos: [{ codigoTributo: 1001, valor: 78.65 }] }]));
  const folhas = { "2026-08": 7_000 };
  const r = await simular(cliente, CONTRIBUINTE, { cnpj: CNPJ, pa: "2026-09", receitaExterna: 23_000, idAtividade: 29, folhasSalario: folhas, retificadora: false, mesAtual: "2026-10" });
  assert.equal(r.ok, true);
  const dados = cliente.chamadas[0].pedido.dados as { declaracao: { folhasSalario: { pa: number; valor: number }[] } };
  assert.deepEqual(dados.declaracao.folhasSalario.at(-1), { pa: 202608, valor: 7_000 });
  // Sem folha: o erro vira resultado e nada é enviado.
  const semFolha = clienteFalso();
  const r2 = await simular(semFolha, CONTRIBUINTE, { cnpj: CNPJ, pa: "2026-09", receitaExterna: 23_000, idAtividade: 29, retificadora: false, mesAtual: "2026-10" });
  assert.equal(r2.ok, false);
  assert.match(r2.detalhe, /folha de salários/);
  assert.equal(semFolha.chamadas.length, 0);
});

test("emitir DAS vencido: data de pagamento em feriado nacional ou local é recusada antes de chamar o Serpro", async () => {
  const cliente = clienteFalso();
  const finados = await emitirDas(cliente, CONTRIBUINTE, { pa: "2026-09", declarado: true, pagarEm: "2026-11-02", hoje: "2026-11-01" });
  assert.match(finados.detalhe, /dia útil/);
  const local = await emitirDas(cliente, CONTRIBUINTE, { pa: "2026-09", declarado: true, pagarEm: "2026-11-03", hoje: "2026-11-01", feriadosExtras: ["2026-11-03"] });
  assert.match(local.detalhe, /dia útil/);
  assert.equal(cliente.chamadas.length, 0);
});

test("transmitir: pedido que saiu sem resposta volta como semResposta (a plataforma não transmite de novo às cegas)", async () => {
  const cliente = clienteFalso(new ErroSemResposta("O servidor não respondeu em 60 segundos."));
  const r = await transmitir(cliente, CONTRIBUINTE, {
    cnpj: CNPJ, pa: "2026-09", receitaExterna: 23_000, idAtividade: 30, valores: VALORES_REAIS, bloqueio: null, retificadora: false,
    simulacao: { receita: 23_000, valores: VALORES_REAIS }, confirmado: true,
  });
  assert.deepEqual(r, { ok: false, detalhe: "O servidor não respondeu em 60 segundos.", semResposta: true });
});
