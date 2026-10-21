import { test } from "node:test";
import assert from "node:assert/strict";
import { buscarPtax, emReais, ErroPtax, fechamentoAte, moedaValida, urlDaCotacao } from "./ptax.ts";

// Resposta no formato da API Olinda (CotacaoMoedaPeriodo), com os três boletins do dia e o de fechamento.
const RESPOSTA = {
  value: [
    { cotacaoCompra: 5.401, cotacaoVenda: 5.4016, dataHoraCotacao: "2026-10-15 10:08:21.011", tipoBoletim: "Abertura" },
    { cotacaoCompra: 5.4123, cotacaoVenda: 5.4129, dataHoraCotacao: "2026-10-15 13:06:33.402", tipoBoletim: "Fechamento" },
    { cotacaoCompra: 5.3987, cotacaoVenda: 5.3993, dataHoraCotacao: "2026-10-16 13:03:27.790", tipoBoletim: "Fechamento" },
    { cotacaoCompra: 5.39, cotacaoVenda: 5.3906, dataHoraCotacao: "2026-10-16 11:03:27.790", tipoBoletim: "Intermediário" },
  ],
};

function fetchFalso(corpo: unknown, status = 200) {
  const urls: string[] = [];
  const f = (async (url: string | URL | Request) => {
    urls.push(String(url));
    return new Response(JSON.stringify(corpo), { status });
  }) as typeof fetch;
  return Object.assign(f, { urls });
}

test("URL da API: moeda e janela de 10 dias até a data, no formato MM-DD-AAAA", () => {
  const url = urlDaCotacao("EUR", "2026-10-18");
  assert.match(url, /^https:\/\/olinda\.bcb\.gov\.br\/olinda\/servico\/PTAX\/versao\/v1\/odata\/CotacaoMoedaPeriodo/);
  assert.match(url, /@moeda='EUR'&@dataInicial='10-08-2026'&@dataFinalCotacao='10-18-2026'/);
});

test("fechamento do dia, ou o do último dia útil antes (sábado usa sexta); ignora abertura e intermediário", () => {
  assert.deepEqual(fechamentoAte("USD", "2026-10-16", RESPOSTA), { moeda: "USD", data: "2026-10-16", compra: 5.3987, venda: 5.3993 });
  assert.deepEqual(fechamentoAte("USD", "2026-10-17", RESPOSTA)?.data, "2026-10-16");
  assert.deepEqual(fechamentoAte("USD", "2026-10-15", RESPOSTA)?.compra, 5.4123);
  assert.equal(fechamentoAte("USD", "2026-10-14", RESPOSTA), null);
  assert.equal(fechamentoAte("USD", "2026-10-16", { value: [] }), null);
  assert.equal(fechamentoAte("USD", "2026-10-16", null), null);
});

test("buscarPtax: chama a API uma vez e devolve a cotação; erros viram mensagem própria", async () => {
  const f = fetchFalso(RESPOSTA);
  assert.deepEqual(await buscarPtax("USD", "2026-10-18", f), { moeda: "USD", data: "2026-10-16", compra: 5.3987, venda: 5.3993 });
  assert.equal(f.urls.length, 1);
  await assert.rejects(buscarPtax("USD", "2026-10-18", fetchFalso({}, 500)), (e) => e instanceof ErroPtax && /Banco Central não respondeu/.test(e.message));
  await assert.rejects(buscarPtax("USD", "2026-10-10", fetchFalso(RESPOSTA)), /Não há cotação PTAX/);
  const caiu = (async () => {
    throw new Error("rede");
  }) as unknown as typeof fetch;
  await assert.rejects(buscarPtax("USD", "2026-10-18", caiu), ErroPtax);
  await assert.rejects(buscarPtax("XYZ" as "USD", "2026-10-18", f), /Moeda/);
  await assert.rejects(buscarPtax("USD", "2026-02-30", f), /Data inválida/);
  assert.equal(f.urls.length, 1); // moeda e data inválidas não chamam nada
});

test("conversão ao centavo pela cotação de compra", () => {
  assert.equal(emReais(4_259.8, { compra: 5.3987 }), 22_997.38);
  assert.equal(emReais(0, { compra: 5.3987 }), 0);
  assert.equal(moedaValida("EUR"), true);
  assert.equal(moedaValida("BRL"), false);
  assert.equal(moedaValida("toString"), false);
});
