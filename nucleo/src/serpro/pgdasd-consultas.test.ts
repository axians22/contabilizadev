import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTRIBUINTE, clienteFalso } from "./cliente-falso.ts";
import { textoDoPdf } from "../pdf.ts";
import { lerExtrato } from "./extrato.ts";
import { respostaDeclaracaoRecibo, respostaDeclaracoes, respostaExtrato } from "./historico-exemplo.ts";
import {
  consultarDeclaracaoRecibo,
  consultarDeclaracoes,
  consultarExtrato,
  dasDaDeclaracaoVigente,
  dasDaDeclaracaoVigenteTodos,
  dataHoraDaReceita,
  declaracaoVigente,
  lerDeclaracoes,
  paDoPeriodo,
} from "./pgdasd-consultas.ts";

// O "Json do campo dados" do exemplo oficial (CONSDECLARACAO13), com as grafias de lá ("anocalendario", "datahoraEmissaoDas").
const OFICIAL = {
  anocalendario: 2018,
  periodos: [
    {
      periodoApuracao: 201801,
      operacoes: [
        { tipoOperacao: "Original", indiceDeclaracao: { numeroDeclaracao: "00000000201801001", dataHoraTransmissao: "20220331032512", malha: "" }, indiceDas: null },
        { tipoOperacao: "Geração de DAS", indiceDeclaracao: null, indiceDas: { numeroDas: "07202219799007800", datahoraEmissaoDas: "20220606033456", dasPago: false } },
      ],
    },
    {
      periodoApuracao: 201802,
      operacoes: [
        { tipoOperacao: "Original", indiceDeclaracao: { numeroDeclaracao: "00000000201802001", dataHoraTransmissao: "20220331032533", malha: "" }, indiceDas: null },
        { tipoOperacao: "Retificadora", indiceDeclaracao: { numeroDeclaracao: "00000000201802002", dataHoraTransmissao: "20220606033046", malha: "" }, indiceDas: null },
        { tipoOperacao: "Geração de DAS", indiceDeclaracao: null, indiceDas: { numeroDas: "07202215999990940", datahoraEmissaoDas: "20220608111510", dasPago: false } },
        { tipoOperacao: "Geração de DAS", indiceDeclaracao: null, indiceDas: { numeroDas: "07202215999991106", datahoraEmissaoDas: "20220608112922", dasPago: true } },
      ],
    },
    {
      periodoApuracao: 201803,
      operacoes: [
        { tipoOperacao: "Original", indiceDeclaracao: { numeroDeclaracao: "00000000201803001", dataHoraTransmissao: "20220331032551", malha: "Retida em Malha" }, indiceDas: null },
        { tipoOperacao: "Retificadora", indiceDeclaracao: { numeroDeclaracao: "00000000201803002", dataHoraTransmissao: "20220606033107", malha: "" }, indiceDas: null },
      ],
    },
  ],
};

test("datas e período no formato da Receita", () => {
  assert.equal(dataHoraDaReceita("20220331032512"), "2022-03-31T03:25:12");
  assert.equal(dataHoraDaReceita(20220331032512), "2022-03-31T03:25:12");
  assert.equal(dataHoraDaReceita(""), null);
  assert.equal(dataHoraDaReceita(null), null);
  assert.equal(dataHoraDaReceita("2022"), null);
  assert.equal(paDoPeriodo(202609), "2026-09");
  assert.equal(paDoPeriodo("202613"), null);
  assert.equal(paDoPeriodo(undefined), null);
});

test("lê o exemplo oficial: declarações (original e retificadora), DAS e malha", () => {
  const p = lerDeclaracoes(OFICIAL);
  assert.deepEqual(p.map((x) => x.pa), ["2018-01", "2018-02", "2018-03"]);
  assert.deepEqual(p[0].declaracoes, [{ numero: "00000000201801001", tipo: "original", transmitidaEm: "2022-03-31T03:25:12", malha: null }]);
  assert.deepEqual(p[0].das, [{ numero: "07202219799007800", emitidoEm: "2022-06-06T03:34:56", pago: false }]);
  assert.equal(p[1].declaracoes[1].tipo, "retificadora");
  assert.equal(p[1].das[1].pago, true);
  assert.equal(p[2].declaracoes[0].malha, "Retida em Malha");
  assert.deepEqual(p[2].das, []);
});

test("lê a consulta por mês (objeto `periodo`), lista vazia e lixo sem quebrar", () => {
  const um = lerDeclaracoes({ anoCalendario: 2026, periodo: { periodoApuracao: 202609, operacoes: [OFICIAL.periodos[0].operacoes[0]] } });
  assert.deepEqual(um.map((x) => x.pa), ["2026-09"]);
  assert.deepEqual(lerDeclaracoes({ anoCalendario: 2026, periodos: [] }), []);
  assert.deepEqual(lerDeclaracoes(null), []);
  assert.deepEqual(lerDeclaracoes({ periodos: [{ periodoApuracao: "x", operacoes: [] }, { periodoApuracao: 202601, operacoes: null }] }), [{ pa: "2026-01", declaracoes: [], das: [] }]);
});

test("declaração vigente e o DAS cujo extrato a mostra", () => {
  const [jan, fev, mar] = lerDeclaracoes(OFICIAL);
  assert.equal(declaracaoVigente(fev)?.numero, "00000000201802002");
  // Dois DAS depois da retificadora: vale o último.
  assert.equal(dasDaDeclaracaoVigente(fev)?.numero, "07202215999991106");
  assert.equal(dasDaDeclaracaoVigente(jan)?.numero, "07202219799007800");
  // Retificadora sem DAS novo: não há extrato da declaração vigente.
  assert.equal(dasDaDeclaracaoVigente(mar), null);
  // Retificadora depois do DAS: o DAS antigo mostra a declaração anterior.
  const antigo = { pa: "2026-08", declaracoes: [...jan.declaracoes, { numero: "X2", tipo: "retificadora" as const, transmitidaEm: "2022-07-01T00:00:00", malha: null }], das: jan.das };
  assert.equal(dasDaDeclaracaoVigente(antigo), null);
  assert.equal(declaracaoVigente({ pa: "2026-01", declaracoes: [], das: jan.das }), null);
});

test("todos os DAS gerados depois da declaração vigente, em ordem (guia gerada de novo quita o mesmo débito)", () => {
  const [jan, fev, mar] = lerDeclaracoes(OFICIAL);
  assert.deepEqual(dasDaDeclaracaoVigenteTodos(fev).map((d) => d.numero), fev.das.filter((d) => d.emitidoEm! >= declaracaoVigente(fev)!.transmitidaEm!).map((d) => d.numero).sort());
  assert.equal(dasDaDeclaracaoVigenteTodos(fev).at(-1)?.numero, dasDaDeclaracaoVigente(fev)?.numero);
  assert.deepEqual(dasDaDeclaracaoVigenteTodos(jan).map((d) => d.numero), ["07202219799007800"]);
  assert.deepEqual(dasDaDeclaracaoVigenteTodos(mar), []);
  const reemitido = {
    pa: "2026-08",
    declaracoes: [{ numero: "D8", tipo: "original" as const, transmitidaEm: "2026-09-05T10:00:00", malha: null }],
    das: [
      { numero: "S2", emitidoEm: "2026-09-10T09:00:00", pago: false },
      { numero: "S0", emitidoEm: "2026-09-01T09:00:00", pago: true }, // antes da declaração: não conta
      { numero: "S1", emitidoEm: "2026-09-05T10:01:00", pago: true },
    ],
  };
  assert.deepEqual(dasDaDeclaracaoVigenteTodos(reemitido).map((d) => d.numero), ["S1", "S2"]);
  assert.deepEqual(dasDaDeclaracaoVigenteTodos({ pa: "2026-08", declaracoes: [], das: reemitido.das }), []);
});

test("consulta as declarações do ano (resposta gravada) e o extrato do DAS", async () => {
  const cliente = clienteFalso(
    respostaDeclaracoes(2026, [{ pa: "2026-09", declaracoes: [{ numero: "11222333202609001", quando: "20261005133543" }], das: [{ numero: "07202627800000001", quando: "20261005133600", pago: true }] }]),
    respostaExtrato("07202627800000001", { pa: "2026-09", receita: 23_000 }),
  );
  const r = await consultarDeclaracoes(cliente, CONTRIBUINTE, 2026);
  assert.ok(r.ok);
  assert.equal(r.periodos[0].das[0].pago, true);
  assert.deepEqual(cliente.chamadas[0].pedido, { idSistema: "PGDASD", idServico: "CONSDECLARACAO13", versaoSistema: "1.0", dados: { anoCalendario: "2026" } });
  assert.equal(cliente.chamadas[0].acao, "Consultar");
  const e = await consultarExtrato(cliente, CONTRIBUINTE, "07202627800000001");
  assert.ok(e.ok && e.pdf.length > 100);
  assert.deepEqual(cliente.chamadas[1].pedido.dados, { numeroDas: "07202627800000001" });
});

test("recusas: ano e número inválidos não chamam; erro da API vira falha com o texto (para o log)", async () => {
  const cliente = clienteFalso(
    { status: 400, dados: null, mensagens: [{ codigo: "[EntradaIncorreta-PGDASD-01]", texto: "ano inválido" }] },
    { status: 200, dados: { numeroDas: "1", extrato: {} }, mensagens: [] },
    new Error("rede caiu"),
  );
  assert.equal((await consultarDeclaracoes(cliente, CONTRIBUINTE, 1999)).ok, false);
  assert.equal((await consultarExtrato(cliente, CONTRIBUINTE, "123")).ok, false);
  assert.equal(cliente.chamadas.length, 0);
  assert.deepEqual(await consultarDeclaracoes(cliente, CONTRIBUINTE, 2026), { ok: false, detalhe: "[EntradaIncorreta-PGDASD-01]: ano inválido" });
  assert.deepEqual(await consultarExtrato(cliente, CONTRIBUINTE, "07202627800000001"), { ok: false, detalhe: "HTTP 200" });
  assert.deepEqual(await consultarDeclaracoes(cliente, CONTRIBUINTE, 2026), { ok: false, detalhe: "rede caiu" });
});

test("declaração/recibo (CONSDECREC15) do mês sem DAS: pedido oficial e o débito declarado lido do PDF", async () => {
  const cliente = clienteFalso(
    respostaDeclaracaoRecibo("11222333202607001", { pa: "2026-07", receita: 0, tributos: { irpj: 0, csll: 0, cpp: 0 } }),
    respostaDeclaracaoRecibo("11222333202606001", { pa: "2026-06", receita: 20_000, tributos: { irpj: 70, csll: 60, cpp: 700 } }),
    { status: 200, dados: { numeroDeclaracao: "11222333202605001", recibo: { pdf: "x" } }, mensagens: [] },
  );
  const r = await consultarDeclaracaoRecibo(cliente, CONTRIBUINTE, "11222333202607001");
  assert.ok(r.ok);
  assert.deepEqual(cliente.chamadas[0].pedido, { idSistema: "PGDASD", idServico: "CONSDECREC15", versaoSistema: "1.0", dados: { numeroDeclaracao: "11222333202607001" } });
  assert.equal(cliente.chamadas[0].acao, "Consultar");
  const zero = lerExtrato(textoDoPdf(Buffer.from(r.declaracaoPdf, "base64")));
  assert.equal(zero.pa, "2026-07");
  assert.equal(zero.totalDebito, 0);
  assert.equal(zero.das, null); // a declaração não traz DAS
  const comValor = await consultarDeclaracaoRecibo(cliente, CONTRIBUINTE, "11222333202606001");
  assert.ok(comValor.ok);
  const lido = lerExtrato(textoDoPdf(Buffer.from(comValor.declaracaoPdf, "base64")));
  assert.equal(lido.totalDebito, 830);
  assert.equal(lido.atividades[0].idAtividade, 30);
  // Sem o PDF da declaração: falha (para o log); número inválido nem chama.
  assert.deepEqual(await consultarDeclaracaoRecibo(cliente, CONTRIBUINTE, "11222333202605001"), { ok: false, detalhe: "HTTP 200" });
  assert.equal((await consultarDeclaracaoRecibo(cliente, CONTRIBUINTE, "123")).ok, false);
  assert.equal(cliente.chamadas.length, 3);
});
