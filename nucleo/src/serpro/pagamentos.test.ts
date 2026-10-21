import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTRIBUINTE, clienteFalso } from "./cliente-falso.ts";
import { ErroSemResposta } from "./cliente.ts";
import { buscarPagamentos, classificarPagamento, emitirComprovante, guiasAProcurar, lerPagamento, valorPago } from "./pagamentos.ts";

test("classifica DAS e DARF do INSS (receita 1099 no topo ou nos desmembramentos)", () => {
  assert.equal(classificarPagamento({ tipo: { codigo: 9, descricao: "DAS" } }), "DAS");
  assert.equal(classificarPagamento({ tipo: "DOCUMENTO SIMPLES NACIONAL" }), "DAS");
  assert.equal(classificarPagamento({ tipo: { codigo: 1 }, receitaPrincipal: { codigo: "1099" } }), "INSS");
  assert.equal(classificarPagamento({ tipo: { codigo: 1 }, receitaPrincipal: { codigo: 1410 }, desmembramentos: [{ receitaPrincipal: { codigo: 1099 } }] }), "INSS");
  assert.equal(classificarPagamento({ tipo: { codigo: 1 }, receitaPrincipal: "0211" }), null);
});

test("lê o pagamento: mês de apuração, data e valor principal", () => {
  assert.deepEqual(
    lerPagamento({ numeroDocumento: "07.1", tipo: { codigo: 9 }, periodoApuracao: "2026-09-01", dataArrecadacao: "2026-10-20T00:00:00", valorPrincipal: 1000.76, valorTotal: 1000.76 }),
    { numero: "07.1", tipo: "DAS", mes: "2026-09", pagoEm: "2026-10-20", valor: 1000.76 },
  );
  assert.equal(lerPagamento({ tipo: { codigo: 9 }, periodoApuracao: "2026-09-01" }), null);
});

test("valor pago: o total do documento (com multa e juros do atraso), não o principal; sem total, o principal", () => {
  const atrasado = { numeroDocumento: "1", tipo: { codigo: 1 }, receitaPrincipal: { codigo: "1099" }, periodoApuracao: "2026-08-01", valorPrincipal: 100, valorTotal: 112.5 };
  assert.equal(valorPago(atrasado), 112.5);
  assert.equal(lerPagamento(atrasado)?.valor, 100, "o pagamento lido continua com o principal (valor do INSS do mês)");
  assert.equal(valorPago({ valorPrincipal: 100 }), 100);
  assert.equal(valorPago({ valorTotal: 0, valorPrincipal: 5 }), 0);
  assert.equal(valorPago({}), null);
  assert.equal(valorPago(null), null);
});

test("busca em páginas de 100 até a última incompleta", async () => {
  const pagina = (n: number) => ({ status: 200, dados: Array.from({ length: n }, (_, i) => ({ numeroDocumento: String(i), tipo: { codigo: 9 }, periodoApuracao: "2026-09-01" })), mensagens: [] });
  const cliente = clienteFalso(pagina(100), pagina(3));
  const r = await buscarPagamentos(cliente, CONTRIBUINTE, "2025-10-01", "2026-10-16");
  assert.equal(r.documentos.length, 103);
  assert.equal(r.pagamentos.length, 103);
  assert.equal(cliente.chamadas.length, 2);
  assert.equal((cliente.chamadas[1].pedido.dados as { primeiroDaPagina: number }).primeiroDaPagina, 100);
});

test("guias a procurar: automática só vencidas e nunca procuradas; manual todas as que faltam", () => {
  const s = {
    mesAtual: "2026-10",
    hoje: "2026-10-16",
    falta: (mes: string) => mes >= "2026-08",
    procurada: (mes: string, tipo: string) => mes === "2026-08" && tipo === "DAS",
  };
  assert.deepEqual(guiasAProcurar({ ...s, manual: false }), [{ mes: "2026-08", tipo: "INSS" }]);
  assert.equal(guiasAProcurar({ ...s, manual: true }).length, 4);
  // 20/09/2026 é domingo: o DARF do INSS de 08/2026 vence na sexta 18 (antecipado) e já pode ser procurado no sábado 19;
  // o DAS vai para a segunda 21 (prorrogado) e só é procurado no dia 22.
  const agosto = { mesAtual: "2026-09", hoje: "2026-09-19", manual: false, falta: (mes: string) => mes === "2026-08", procurada: () => false };
  assert.deepEqual(guiasAProcurar(agosto), [{ mes: "2026-08", tipo: "INSS" }]);
  assert.deepEqual(guiasAProcurar({ ...agosto, hoje: "2026-09-21" }), [{ mes: "2026-08", tipo: "INSS" }]);
  assert.deepEqual(guiasAProcurar({ ...agosto, hoje: "2026-09-22" }), [{ mes: "2026-08", tipo: "DAS" }, { mes: "2026-08", tipo: "INSS" }]);
  assert.deepEqual(guiasAProcurar({ ...agosto, hoje: "2026-09-18" }), []);
  // Feriado local no dia 20: antecipa o DARF (vence no dia 19) e prorroga o DAS (dia 21).
  const outubro = { ...agosto, mesAtual: "2026-10", hoje: "2026-10-20", falta: (mes: string) => mes === "2026-09" };
  assert.deepEqual(guiasAProcurar(outubro), []);
  assert.deepEqual(guiasAProcurar({ ...outubro, feriadosExtras: ["2026-10-20"] }), [{ mes: "2026-09", tipo: "INSS" }]);
});

test("recusa da consulta de pagamentos lança (não vira lista vazia)", async () => {
  const cliente = clienteFalso({ status: 403, dados: null, mensagens: [{ codigo: "[AcessoNegado-PAGTOWEB-1]", texto: "sem autorização" }] });
  await assert.rejects(buscarPagamentos(cliente, CONTRIBUINTE, "2025-10-01", "2026-10-16"), /sem autorização/);
  // Sem pagamento no período: 200 com a lista vazia.
  const vazio = await buscarPagamentos(clienteFalso({ status: 200, dados: [], mensagens: [] }), CONTRIBUINTE, "2025-10-01", "2026-10-16");
  assert.deepEqual(vazio, { documentos: [], pagamentos: [] });
});

test("comprovante de arrecadação: PAGTOWEB/COMPARRECADACAO72 (Emitir) com o número do documento; lê o PDF em dados.pdf ou dados", async () => {
  const cliente = clienteFalso(
    { status: 200, dados: { pdf: "JVBERi0x" }, mensagens: [{ codigo: "Sucesso", texto: "ok" }] },
    { status: 200, dados: "JVBERi0y", mensagens: [] },
  );
  const r = await emitirComprovante(cliente, CONTRIBUINTE, " 7202627851592322 ");
  assert.deepEqual(r, { ok: true, pdf: "JVBERi0x", detalhe: "Sucesso: ok" });
  assert.equal(cliente.chamadas[0].acao, "Emitir");
  assert.deepEqual(cliente.chamadas[0].pedido, { idSistema: "PAGTOWEB", idServico: "COMPARRECADACAO72", versaoSistema: "1.0", dados: { numeroDocumento: "7202627851592322" } });
  assert.match(cliente.chamadas[0].finalidade, /comprovante de arrecadação/);
  assert.equal(((await emitirComprovante(cliente, CONTRIBUINTE, "07202627851592322")) as { pdf: string }).pdf, "JVBERi0y");
});

test("comprovante: resposta que não é PDF (página de erro, vazio) vira falha, para não ser guardada como a guia", async () => {
  const cliente = clienteFalso(
    { status: 200, dados: { pdf: Buffer.from("<html>erro interno</html>").toString("base64") }, mensagens: [] },
    { status: 200, dados: "AAAA", mensagens: [] },
  );
  for (let i = 0; i < 2; i++) {
    const r = await emitirComprovante(cliente, CONTRIBUINTE, "7202627851592322");
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.detalhe, /^A resposta não é um PDF/);
  }
});

test("comprovante: número inválido não chama; recusa e falta de resposta viram falha", async () => {
  const cliente = clienteFalso(
    { status: 404, dados: null, mensagens: [{ codigo: "Aviso-PAGTOWEB", texto: "Documento não encontrado" }] },
    new ErroSemResposta("tempo esgotado"),
  );
  for (const errado of ["", "abc", "123456789012345678"]) assert.equal((await emitirComprovante(cliente, CONTRIBUINTE, errado)).ok, false);
  assert.equal(cliente.chamadas.length, 0);
  assert.deepEqual(await emitirComprovante(cliente, CONTRIBUINTE, "1"), { ok: false, detalhe: "Aviso-PAGTOWEB: Documento não encontrado" });
  assert.deepEqual(await emitirComprovante(cliente, CONTRIBUINTE, "1"), { ok: false, detalhe: "tempo esgotado", semResposta: true });
});
