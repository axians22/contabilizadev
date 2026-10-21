import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { documentoReal } from "../casos-reais.ts";
import { textoDoPdf } from "../pdf.ts";
import { cpf } from "./cliente.ts";
import { CONTRIBUINTE, clienteFalso } from "./cliente-falso.ts";
import { pdfComTexto } from "./dctf-exemplo.ts";
import { gerarRelatorio, lerDiagnostico, proximaVerificacao } from "./sitfis.ts";

test("lê o diagnóstico: regular, com pendência ou indefinido", () => {
  assert.equal(lerDiagnostico("Diagnóstico Fiscal\nNão foram detectadas pendências\nFinal do Relatório").regular, true);
  const pendente = lerDiagnostico("Cabeçalho\nDiagnóstico Fiscal\n____\nPendência - Débito (SIEF)\nFinal do Relatório\nRodapé");
  assert.equal(pendente.regular, false);
  assert.equal(pendente.diagnostico, "Pendência - Débito (SIEF)");
  assert.equal(lerDiagnostico("texto qualquer").regular, null);
});

const REAL = documentoReal("SITFIS-20261015-1.pdf");
test("caso real: SITFIS de 15/10/2026 sem pendências", { skip: !REAL && "PDF do ../fiscal não encontrado" }, () => {
  assert.equal(lerDiagnostico(textoDoPdf(fs.readFileSync(REAL!))).regular, true);
});

test("próxima verificação 2 meses depois", () => {
  assert.equal(proximaVerificacao(new Date(2026, 9, 15)), "2026-12-15");
  assert.equal(proximaVerificacao(new Date(2026, 11, 1)), "2027-02-01");
});

test("gera o relatório: protocolo, espera e PDF (respostas gravadas)", async () => {
  const pdf = pdfComTexto("Diagnóstico Fiscal", "Não foram detectadas pendências", "Final do Relatório").toString("base64");
  const cliente = clienteFalso(
    { status: 200, dados: { protocoloRelatorio: "P1", tempoEspera: 2000 }, mensagens: [] },
    { status: 202, dados: { tempoEspera: 50_000 }, mensagens: [] },
    { status: 200, dados: { pdf }, mensagens: [{ codigo: "OK", texto: "Relatório emitido" }] },
  );
  const esperas: number[] = [];
  const socio = { contribuinte: cpf("529.982.247-25") };
  const r = await gerarRelatorio(cliente, socio, "do CPF do sócio", async (ms) => void esperas.push(ms));
  assert.ok(r.ok);
  assert.equal(r.regular, true);
  assert.deepEqual(esperas, [2000, 30_000]); // limita a espera em 30 s
  assert.deepEqual(cliente.chamadas.map((c) => c.acao), ["Apoiar", "Emitir", "Emitir"]);
  assert.equal(cliente.chamadas[0].opcoes.contribuinte.tipo, 1);
});

test("relatório: sem protocolo, erro do Serpro ou ainda processando depois de 4 tentativas", async () => {
  const semEspera = async () => {};
  assert.equal((await gerarRelatorio(clienteFalso({ status: 403, dados: null, mensagens: [] }), CONTRIBUINTE, "da empresa", semEspera)).detalhe, "HTTP 403");
  const erro = clienteFalso({ status: 200, dados: { protocoloRelatorio: "P" }, mensagens: [] }, { status: 500, dados: null, mensagens: [{ codigo: "E", texto: "falhou" }] });
  assert.equal((await gerarRelatorio(erro, CONTRIBUINTE, "da empresa", semEspera)).detalhe, "E: falhou");
  const processando = { status: 202, dados: {}, mensagens: [] };
  const demorado = clienteFalso({ status: 200, dados: { protocoloRelatorio: "P" }, mensagens: [] }, processando, processando, processando, processando);
  assert.match((await gerarRelatorio(demorado, CONTRIBUINTE, "da empresa", semEspera)).detalhe, /processando/);
});
