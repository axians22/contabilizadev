import { test } from "node:test";
import assert from "node:assert/strict";
import { assinarEsocial } from "../assinatura.ts";
import { certificadoDeTeste } from "../certificado-teste.ts";
import { lerPfx } from "../certificado.ts";
import {
  baixar,
  cadastroDosEventos,
  dataHora,
  ErroConsultaEsocial,
  idsTrabalhador,
  janelaDeRecepcao,
  lerDownload,
  lerIdentificadores,
  lerPagamentos,
  lerRemuneracao,
  lerRespostaDownload,
  mesesPendentes,
  pedidoDownload,
  pedidoIdsTrabalhador,
  rubricasDoS1200,
} from "./leitura.ts";
import { DOWNLOAD, DOWNLOAD_DO_SOCIO, ERRO_308, IDENTIFICADORES_DO_SOCIO, LIMITE_405, S1200_GRAVADO, S1210_GRAVADO, esocialFalso, resposta, soap } from "./respostas-exemplo.ts";

const empregador = { cnpj: "11222333000181" };
const pem = lerPfx(certificadoDeTeste());
const em = (iso: string) => new Date(`${iso}-03:00`);

test("lê os eventos baixados (só os com cdResposta 201)", () => {
  const eventos = lerDownload(resposta(DOWNLOAD).doc);
  assert.equal(eventos.length, 1);
  assert.deepEqual([eventos[0].id, eventos[0].tipo, eventos[0].recibo], ["ID1", "evtRemun", "1.1.1"]);
  assert.match(eventos[0].xml, /<perApur>2026-09<\/perApur>/);
});

test("pedidos sem assinatura (quem chama assina): o empregador pelo CNPJ raiz, o CPF e a janela em hora de Brasília", () => {
  const xml = pedidoIdsTrabalhador(empregador, "529.982.247-25", em("2026-10-01T00:00:00"), em("2026-10-15T08:50:00"));
  assert.match(xml, /<nrInsc>11222333<\/nrInsc>.*<cpfTrab>52998224725<\/cpfTrab><dtIni>2026-10-01T00:00:00<\/dtIni><dtFim>2026-10-15T08:50:00<\/dtFim>/);
  assert.doesNotMatch(xml, /Signature/);
  assert.equal(dataHora(new Date("2026-10-15T12:00:00Z")), "2026-10-15T09:00:00");
  assert.match(pedidoDownload(empregador, ["A", "B"]), /<solicDownloadEvtsPorId><id>A<\/id><id>B<\/id><\/solicDownloadEvtsPorId>/);
  assert.throws(() => pedidoDownload(empregador, []), /1 a 50/);
});

test("respostas gravadas: identificadores do sócio, download com S-1200 e S-1210, 406 = nada, 308 e 405 viram erro com o código", () => {
  assert.deepEqual(lerIdentificadores(resposta(IDENTIFICADORES_DO_SOCIO)).map((i) => i.recibo), ["1.1.0000000000000000101", "1.1.0000000000000000102"]);
  assert.deepEqual(lerIdentificadores(resposta(soap("<status><cdResposta>406</cdResposta></status>"))), []);
  assert.throws(() => lerIdentificadores(resposta(LIMITE_405)), (e: unknown) => e instanceof ErroConsultaEsocial && e.cdResposta === "405");
  const baixados = lerRespostaDownload(resposta(DOWNLOAD_DO_SOCIO));
  assert.deepEqual(baixados.map((b) => [b.tipo, b.recibo]), [["evtRemun", "1.1.0000000000000000101"], ["evtPgtos", "1.1.0000000000000000102"]]);
  assert.throws(() => lerRespostaDownload(resposta(ERRO_308)), (e: unknown) => e instanceof ErroConsultaEsocial && e.cdResposta === "308");
});

test("consulta de identificadores assinada por quem chama; erro do eSocial vira exceção", async () => {
  const ws = esocialFalso(
    resposta(soap("<status><cdResposta>201</cdResposta></status><identificadoresEvts><identificadorEvt><id>ID9</id><nrRec>1.1.9</nrRec></identificadorEvt></identificadoresEvts>")),
    resposta(soap("<status><cdResposta>406</cdResposta></status>")),
    resposta(soap("<status><cdResposta>501</cdResposta><descResposta>Erro interno</descResposta></status>")),
    resposta(DOWNLOAD),
  );
  const l = { cliente: ws, empregador, assinar: (xml: string) => assinarEsocial(xml, pem) };
  const [inicio, fim] = [em("2026-10-01T00:00:00"), em("2026-10-31T23:59:59")];
  assert.deepEqual(await idsTrabalhador(l, "529.982.247-25", inicio, fim), [{ id: "ID9", recibo: "1.1.9" }]);
  assert.match(ws.chamadas[0].conteudo, /<cpfTrab>52998224725<\/cpfTrab>/);
  assert.match(ws.chamadas[0].conteudo, /<Signature/);
  assert.deepEqual(await idsTrabalhador(l, "52998224725", inicio, fim), []);
  await assert.rejects(idsTrabalhador(l, "52998224725", inicio, fim), /501: Erro interno/);
  assert.equal((await baixar(l, ["ID1"])).length, 1);
  assert.deepEqual(await baixar(l, []), []);
});

test("cadastro tirado do S-1200 e do S-1210 gravados: categoria, matrícula, lotação, rubricas e o dia do pagamento", () => {
  const r = lerRemuneracao(S1200_GRAVADO)!;
  assert.deepEqual([r.perApur, r.cpf, r.ideDmDev, r.indRetif, r.categoria, r.matricula, r.lotacao], ["2026-09", "52998224725", "092026MENSAL05102026132358", 1, "723", "1", "1"]);
  const pagamentos = lerPagamentos(S1210_GRAVADO);
  assert.deepEqual(pagamentos, [{ perApur: "2026-09", cpf: "52998224725", dtPgto: "2026-09-05", perRef: "2026-08", ideDmDev: "082026MENSAL02092026160358", vrLiq: 1442.69 }]);
  // O S-1210 de 09 paga o demonstrativo de 08 (não o deste S-1200): vale como o padrão do sócio (dia 5, mês seguinte).
  assert.deepEqual(cadastroDosEventos(r, pagamentos), {
    cpf: "52998224725", categoria: "723", matricula: "1", lotacao: "1", tabRubrica: "0001", rubricaProLabore: "100", rubricaInss: "843",
    qtdProLabore: "220.00", diaPagamento: 5, pagamentoNoMes: "seguinte",
  });
  assert.equal(cadastroDosEventos(r)?.diaPagamento, null);
  // Sem a rubrica do INSS perto de 11%, não dá para adivinhar: o cliente preenche.
  assert.equal(cadastroDosEventos({ ...r, itens: [r.itens[0]] }), null);
  assert.equal(cadastroDosEventos({ ...r, itens: [r.itens[0], { ...r.itens[1], vrRubr: 500 }] }), null);
  assert.equal(lerRemuneracao(S1210_GRAVADO), null);
  assert.deepEqual(lerPagamentos(S1200_GRAVADO), []);
});

test("rubricas de um S-1200 sem repetir", () => {
  const xml = "<itensRemun><codRubr>100</codRubr><ideTabRubr>0001</ideTabRubr></itensRemun>".repeat(2) + "<codRubr>843</codRubr><ideTabRubr>0001</ideTabRubr>";
  assert.deepEqual(rubricasDoS1200(xml), [{ codRubr: "100", ideTabRubr: "0001" }, { codRubr: "843", ideTabRubr: "0001" }]);
});

test("meses a procurar: a partir do dia 16 do mês seguinte e uma vez na busca automática", () => {
  const s = { mesAtual: "2026-10", hoje: "2026-10-16", temRemuneracao: (m: string) => m < "2026-07", procurado: (m: string) => m === "2026-07" };
  assert.deepEqual(mesesPendentes({ ...s, manual: false }), ["2026-08", "2026-09"]);
  assert.deepEqual(mesesPendentes({ ...s, manual: true }), ["2026-07", "2026-08", "2026-09"]);
  assert.deepEqual(mesesPendentes({ ...s, hoje: "2026-10-15", manual: true }), ["2026-07", "2026-08"]);
  assert.deepEqual(mesesPendentes({ mesAtual: "2027-01", hoje: "2027-01-15", manual: true, temRemuneracao: () => false, procurado: () => false }).at(-1), "2026-11");
});

test("janela de recepção: o mês seguinte em hora de Brasília, terminando 70 minutos antes de agora", () => {
  const { inicio, fim } = janelaDeRecepcao("2026-09", em("2026-10-16T12:00:00"));
  assert.equal(dataHora(inicio), "2026-10-01T00:00:00");
  assert.equal(dataHora(fim), "2026-10-16T10:50:00");
  assert.equal(dataHora(janelaDeRecepcao("2026-08", em("2026-10-16T12:00:00")).fim), "2026-09-30T23:59:59");
});
