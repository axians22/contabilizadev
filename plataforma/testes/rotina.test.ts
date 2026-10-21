// Parte 6, passo 18: a rotina do mês de ponta a ponta, contra o banco de teste, com a empresa cadastrada pela Parte 3 e o
// histórico importado pela Parte 5. Nada sai da máquina: o cliente do contrato é o falso do núcleo (respostas gravadas no
// formato oficial; extrato e declaração com o texto do extrato real de 09/2026 anonimizado), a PTAX vem de um fetch falso
// e o certificado do cliente é um e-CNPJ A1 de teste gerado na hora. Confere: receita lançada (reais, PTAX e valor
// informado), apuração igual ao caso real (DAS de 09/2026 = R$ 1.000,76), simulação antes de transmitir, confirmação,
// idempotência (duplo clique, transmissão sem resposta), retificação explícita, guias (inclusive vencida com juros, banco
// primeiro), DCTFWeb assinada no servidor (empresa da plataforma) e no navegador (cliente), sem autorização, isolamento,
// PDFs pela porta de acesso, registro em serpro_chamadas e a remoção da empresa apagando tudo.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { lerPfx } from "@contabilizadev/nucleo/certificado";
import { certificadoDeTeste, certificadoIcpDeTeste } from "@contabilizadev/nucleo/certificado-teste";
import { verificarAssinatura } from "@contabilizadev/nucleo/assinatura";
import type { Transporte } from "@contabilizadev/nucleo/http";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import { cnpj, criarClienteSerpro, ErroSemResposta, type Resposta } from "@contabilizadev/nucleo/serpro/cliente";
import { pdfComTexto, xmlDctf } from "@contabilizadev/nucleo/serpro/dctf-exemplo";
import { ATIVIDADE_29, pdfDaDeclaracao, respostaDeclaracoes, respostaExtrato, respostaPagamentos } from "@contabilizadev/nucleo/serpro/historico-exemplo";
import { abrirCertificado } from "@contabilizadev/nucleo/serpro/termo-autorizacao";
import {
  cotacoesPtax,
  dctfwebEnvios,
  guias,
  historicoConsultas,
  pgdasdDas,
  pgdasdDeclaracoes,
  pgdasdEnvios,
  pgdasdExtratos,
  prolabores,
  receitasLancadas,
  serproChamadas,
} from "@/banco/esquema";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro } from "@/lib/empresas/cadastro";
import { removerEmpresa } from "@/lib/empresas/remocao";
import { documentoDaEmpresa } from "@/lib/historico/documentos";
import { importar } from "@/lib/historico/importacao";
import { registroNoBanco } from "@/lib/serpro/registro";
import { baseDoMes } from "@/lib/rotina/base";
import { conferirDctfMes, prepararTransmissaoDctf, situacaoDctf, transmitirDctfMes } from "@/lib/rotina/dctfweb";
import type { DependenciasRotina } from "@/lib/rotina/dependencias";
import { avisoFatorR } from "@/lib/rotina/fator-r";
import { gerarGuia, guiaDoMes } from "@/lib/rotina/guias";
import { MENSAGENS_DA_ROTINA } from "@/lib/rotina/mensagens";
import { enviosDoMes, motivoParaNaoTransmitirMes, simularMes, transmitirMes } from "@/lib/rotina/pgdasd";
import { informarProLabore, lancarReceita, removerReceita } from "@/lib/rotina/receitas";
import { ErroTermoAutorizacao } from "@/lib/termo/termo";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const em = (iso: string) => new Date(`${iso}-03:00`);
const AGORA = em("2026-10-18T10:00:00"); // apura 09/2026; DAS e DARF vencem em 20/10/2026
const DEPOIS_DO_VENCIMENTO = em("2026-10-26T10:00:00"); // segunda-feira
const SUPORTE = "98765432000198"; // exemplo ti-anexo-iii: 6209 (Anexo III fixo, atividade 30)
const DESENVOLVIMENTO = "12345678000195"; // exemplo ti-fator-r: 6201 (Fator R, atividade 29)
const PERFIS = { ana: perfil("ana@a.com", "sub-ana"), beto: perfil("beto@b.com", "sub-beto") };
const TOKEN = "b06feea3-1ca8-49f4-bdb4-211ab006cb92";

// Receitas de 09/2025 a 07/2026 da empresa de referência (item 2.2 do extrato real de 09/2026). Com a de 08/2026
// (26.908,25, declarada), somam a RBT12 de 09/2026: R$ 352.998,85.
const ANTERIORES = {
  "2025-09": 25_228.39, "2025-10": 19_224.3, "2025-11": 27_350.21, "2025-12": 24_655.48, "2026-01": 21_869.17, "2026-02": 25_798.12,
  "2026-03": 37_582, "2026-04": 24_985.4, "2026-05": 45_494.12, "2026-06": 47_400, "2026-07": 26_503.41,
};
const VALORES_REAIS = [{ codigoTributo: 1001, valor: 78.65 }, { codigoTributo: 1002, valor: 68.81 }, { codigoTributo: 1006, valor: 853.3 }];

const ok = (dados: unknown): Resposta => ({ status: 200, dados, mensagens: [{ codigo: "Sucesso-PGDASD", texto: "ok" }] });
const simulacaoOk = (valores = VALORES_REAIS) => ok([{ valoresDevidos: valores }]);
const transmissaoOk = (numero: string, pa = "2026-09", receita = 23_000) =>
  ok([{ idDeclaracao: numero, valoresDevidos: VALORES_REAIS, declaracao: pdfDaDeclaracao({ pa, receita }), recibo: pdfComTexto("Recibo de Entrega").toString("base64") }]);
const PDF = pdfComTexto("Documento de Arrecadacao", "Valor Total do Documento", "1.030,78").toString("base64");
const dasEmitido = (numero: string, valores: Record<string, number> = { principal: 1000.76, total: 1000.76 }) =>
  ok([{ pdf: PDF, detalhamento: { numeroDocumento: numero, dataVencimento: "20261020", valores } }]);

async function empresa(quem: "ana" | "beto" = "ana", exemplo: "ti-anexo-iii" | "ti-fator-r" = "ti-anexo-iii") {
  const usuario = (await entrarComGoogle(depsLogin(t.banco, PERFIS), quem)).usuario;
  const numero = exemplo === "ti-anexo-iii" ? "98.765.432/0001-98" : "12.345.678/0001-95";
  const r = await consultarParaCadastro(t.banco, usuario, numero, { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo(exemplo) });
  assert.equal(r.tipo, "previa");
  const empresaId = await cadastrarPelaPrevia(t.banco, usuario, r.previa.token, { segredo: SEGREDO, agora: AGORA });
  return { usuario, empresaId, acesso: await exigirAcessoEmpresa(t.banco, usuario, empresaId) };
}

const contextoDe = (numero: string) => async () => ({ contribuinte: cnpj(numero), autorPedidoDados: cnpj(numero), tokenProcurador: TOKEN });

function dependencias(cliente: DependenciasRotina["cliente"], o: Omit<Partial<DependenciasRotina>, "agora" | "log"> & { agora?: Date; numero?: string; log?: string[] } = {}): DependenciasRotina {
  const log = o.log ?? [];
  return {
    banco: t.banco,
    cliente,
    contexto: o.contexto ?? contextoDe(o.numero ?? SUPORTE),
    certificadoDaPlataforma: o.certificadoDaPlataforma,
    buscarPtax: o.buscarPtax,
    agora: () => o.agora ?? AGORA,
    log: (m) => void log.push(m),
  };
}

// Histórico da Parte 5: 08/2026 declarado, com o extrato trazendo as receitas anteriores (item 2.2).
async function importarHistorico(acesso: AcessoEmpresa, extra: Parameters<typeof respostaExtrato>[1] = { pa: "2026-08", receita: 26_908.25 }) {
  const cliente = clienteFalso(
    respostaDeclaracoes(2025, []),
    respostaDeclaracoes(2026, [
      { pa: "2026-08", declaracoes: [{ numero: "98765432202608001", quando: "20260905100000" }], das: [{ numero: "07202608000000001", quando: "20260905100100", pago: true }] },
    ]),
    respostaExtrato("07202608000000001", { anteriores: ANTERIORES, ...extra }),
    respostaPagamentos([]),
  );
  const r = await importar({ banco: t.banco, cliente, contexto: contextoDe(SUPORTE), agora: () => AGORA, esperar: async () => {}, log: () => {} }, acesso, { grupos: ["historico"], manual: false });
  assert.equal(r.estado, "iniciada");
  assert.equal(cliente.chamadas.length, 4);
}

async function prontaParaDeclarar() {
  const e = await empresa();
  await importarHistorico(e.acesso);
  const r = await lancarReceita(dependencias(null), e.acesso, { pa: "2026-09", recebidaEm: "2026-10-05", moeda: "BRL", valorMoeda: 23_000, usuarioId: e.usuario.id });
  assert.ok(r.ok);
  return e;
}

const CONFIRMACAO = { receita: 23_000, total: 1000.76 };

describe("receita do mês: lançar em reais, em moeda estrangeira pela PTAX ou com o valor em reais informado", () => {
  const PTAX = { value: [{ cotacaoCompra: 5.3987, cotacaoVenda: 5.3993, dataHoraCotacao: "2026-10-16 13:03:27.790", tipoBoletim: "Fechamento" }] };
  function fetchPtax() {
    const urls: string[] = [];
    const f = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(JSON.stringify(PTAX), { status: 200 });
    }) as typeof fetch;
    return Object.assign(f, { urls });
  }

  it("reais: soma no mês; dólar pela PTAX de compra do último dia útil (sábado usa sexta), guardada e reaproveitada", async () => {
    const { acesso, usuario } = await empresa();
    const f = fetchPtax();
    const d = dependencias(null, { buscarPtax: f });
    assert.ok((await lancarReceita(d, acesso, { pa: "2026-09", recebidaEm: "2026-10-05", moeda: "BRL", valorMoeda: 10_000, usuarioId: usuario.id })).ok);
    const usd = await lancarReceita(d, acesso, { pa: "2026-09", recebidaEm: "2026-10-17", moeda: "USD", valorMoeda: 2_000, observacao: "  invoice 42 " });
    assert.ok(usd.ok && usd.valorBrl === 10_797.4);
    assert.equal(f.urls.length, 1);
    // Mesma moeda e data: banco primeiro, sem nova consulta.
    assert.ok((await lancarReceita(d, acesso, { pa: "2026-09", recebidaEm: "2026-10-17", moeda: "USD", valorMoeda: 100 })).ok);
    assert.equal(f.urls.length, 1);
    const [cotacao] = await t.banco.select().from(cotacoesPtax);
    assert.deepEqual([cotacao.moeda, cotacao.data, cotacao.boletim, cotacao.compra], ["USD", "2026-10-17", "2026-10-16", 5.3987]);
    // Valor em reais informado vale sobre a PTAX (é o que caiu na conta) e não consulta nada.
    const informado = await lancarReceita(d, acesso, { pa: "2026-09", recebidaEm: "2026-10-18", moeda: "EUR", valorMoeda: 1_000, valorBrl: 6_300 });
    assert.ok(informado.ok && informado.valorBrl === 6_300);
    assert.equal(f.urls.length, 1);

    const base = await baseDoMes(t.banco, acesso, "2026-09", AGORA);
    assert.equal(base.receitaLancada, 10_000 + 10_797.4 + 539.87 + 6_300);
    assert.equal(base.lancamentos.length, 4);
    assert.equal(base.lancamentos[1].observacao, "invoice 42");
    assert.deepEqual([base.lancamentos[1].origemValor, base.lancamentos[1].cotacaoData], ["ptax", "2026-10-16"]);
    assert.equal(base.lancamentos[3].origemValor, "informado");

    assert.ok(await removerReceita(t.banco, acesso, base.lancamentos[0].id));
    assert.equal(await removerReceita(t.banco, acesso, base.lancamentos[0].id), false);
    assert.equal((await t.banco.select().from(receitasLancadas)).length, 3);
  });

  it("recusa mês que não terminou, data futura ou antes do mês, moeda sem PTAX e valor inválido; PTAX fora do ar vira mensagem", async () => {
    const { acesso } = await empresa();
    const d = dependencias(null, { buscarPtax: fetchPtax() });
    const base = { pa: "2026-09", recebidaEm: "2026-10-05", moeda: "BRL", valorMoeda: 1 };
    assert.deepEqual(await lancarReceita(d, acesso, { ...base, pa: "2026-10" }), { ok: false, mensagem: MENSAGENS_DA_ROTINA.mesAberto });
    const errados: Partial<Parameters<typeof lancarReceita>[2]>[] = [{ recebidaEm: "2026-10-19" }, { recebidaEm: "2026-08-31" }, { recebidaEm: "2026-02-30" }, { moeda: "ARS" }, { valorMoeda: 0 }, { valorMoeda: Number.NaN }, { valorMoeda: 5_000_000 }];
    for (const errado of errados) {
      assert.deepEqual(await lancarReceita(d, acesso, { ...base, ...errado }), { ok: false, mensagem: MENSAGENS_DA_ROTINA.receitaInvalida }, JSON.stringify(errado));
    }
    const foraDoAr = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    const r = await lancarReceita(dependencias(null, { buscarPtax: foraDoAr }), acesso, { ...base, moeda: "USD" });
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.mensagem : "", /Informe o valor em reais/);
    assert.equal((await t.banco.select().from(receitasLancadas)).length, 0);
  });

  it("pró-labore do mês: grava, atualiza e recusa valor inválido ou mês futuro", async () => {
    const { acesso } = await empresa();
    const d = dependencias(null);
    assert.ok((await informarProLabore(d, acesso, { mes: "2026-09", valor: 1_518 })).ok);
    assert.ok((await informarProLabore(d, acesso, { mes: "2026-09", valor: 1_621 })).ok);
    assert.equal((await informarProLabore(d, acesso, { mes: "2026-11", valor: 1 })).ok, false);
    assert.equal((await informarProLabore(d, acesso, { mes: "2026-09", valor: -1 })).ok, false);
    const linhas = await t.banco.select().from(prolabores);
    assert.deepEqual(linhas.map((l) => [l.mes, l.valor]), [["2026-09", 1_621]]);
  });
});

describe("apuração com o histórico importado (caso real de referência)", () => {
  it("RBT12 dos extratos (item 2.2 e receita declarada) + receita lançada: DAS de 09/2026 = R$ 1.000,76 no Anexo III", async () => {
    const { acesso } = await prontaParaDeclarar();
    const base = await baseDoMes(t.banco, acesso, "2026-09", AGORA);
    assert.equal(base.receita, 23_000);
    assert.equal(base.apuracao?.rbt12.valor, 352_998.85);
    assert.equal(base.apuracao?.anexo, "III");
    assert.equal(base.apuracao?.idAtividade, 30);
    assert.equal(base.apuracao?.das.total, 1000.76);
    assert.deepEqual(base.apuracao?.mesesSemReceita, []);
    assert.equal(base.fontesReceita["2026-08"], "declarada");
    assert.equal(base.fontesReceita["2025-09"], "receita-federal");
    assert.equal(base.vigente, null);
    // O extrato importado guardou os itens 2.2 e 2.3 separados.
    const [extrato] = await t.banco.select().from(pgdasdExtratos);
    assert.equal(extrato.receitasAnteriores?.length, 11);
  });

  it("extrato guardado antes da Parte 6 (sem os itens separados): lido de novo do PDF guardado, uma vez", async () => {
    const { acesso } = await prontaParaDeclarar();
    await t.banco.update(pgdasdExtratos).set({ receitasAnteriores: null, folhasAnteriores: null });
    const base = await baseDoMes(t.banco, acesso, "2026-09", AGORA);
    assert.equal(base.apuracao?.rbt12.valor, 352_998.85);
    const [extrato] = await t.banco.select().from(pgdasdExtratos);
    assert.equal(extrato.receitasAnteriores?.length, 11);
  });

  it("sem histórico: os meses sem receita aparecem (histórico incompleto) e a receita lançada nos meses anteriores entra", async () => {
    const { acesso } = await empresa();
    const d = dependencias(null);
    await lancarReceita(d, acesso, { pa: "2026-08", recebidaEm: "2026-09-05", moeda: "BRL", valorMoeda: 26_908.25 });
    await lancarReceita(d, acesso, { pa: "2026-09", recebidaEm: "2026-10-05", moeda: "BRL", valorMoeda: 23_000 });
    const base = await baseDoMes(t.banco, acesso, "2026-09", AGORA);
    assert.equal(base.fontesReceita["2026-08"], "lancada");
    assert.equal(base.apuracao?.rbt12.valor, 26_908.25);
    assert.equal(base.apuracao?.mesesSemReceita.length, 11);
  });
});

describe("PGDAS-D: simular, confirmar e transmitir (empresa autorizada, respostas gravadas)", () => {
  it("simula sem transmitir, guarda o resultado e só então transmite com a confirmação; o mês passa a constar como declarado", async () => {
    const { acesso, usuario } = await prontaParaDeclarar();
    const cliente = clienteFalso(simulacaoOk(), transmissaoOk("98765432202609001"));
    const d = dependencias(cliente);
    // Sem simulação, nada é transmitido.
    assert.deepEqual(await transmitirMes(d, acesso, "2026-09", { retificar: false, confirmado: true, confirmacao: CONFIRMACAO }), { ok: false, mensagem: MENSAGENS_DA_ROTINA.simuleAntes });

    const sim = await simularMes(d, acesso, "2026-09", { retificar: false, usuarioId: usuario.id });
    assert.ok(sim.ok && sim.bateu);
    assert.deepEqual(sim.ok && sim.valoresReceita, { 1001: 78.65, 1002: 68.81, 1006: 853.3 });
    const dadosSim = cliente.chamadas[0].pedido.dados as { indicadorTransmissao: boolean; declaracao: { tipoDeclaracao: number; estabelecimentos: { atividades: { idAtividade: number }[] }[] } };
    assert.equal(dadosSim.indicadorTransmissao, false);
    assert.equal(dadosSim.declaracao.tipoDeclaracao, 1);
    assert.equal(dadosSim.declaracao.estabelecimentos[0].atividades[0].idAtividade, 30);
    assert.equal(cliente.chamadas[0].opcoes.confirmado, undefined);
    assert.equal(cliente.chamadas[0].opcoes.tokenProcurador, TOKEN);

    // Confirmação ausente ou de outro resumo: nada sai.
    assert.deepEqual(await transmitirMes(d, acesso, "2026-09", { retificar: false, confirmado: false, confirmacao: CONFIRMACAO }), { ok: false, mensagem: MENSAGENS_DA_ROTINA.semConfirmacao });
    assert.deepEqual(await transmitirMes(d, acesso, "2026-09", { retificar: false, confirmado: true, confirmacao: { receita: 23_000, total: 1000.77 } }), { ok: false, mensagem: MENSAGENS_DA_ROTINA.confirmacaoMudou });
    assert.equal(cliente.chamadas.length, 1);

    const r = await transmitirMes(d, acesso, "2026-09", { retificar: false, confirmado: true, confirmacao: CONFIRMACAO, usuarioId: usuario.id });
    assert.deepEqual(r, { ok: true, numeroDeclaracao: "98765432202609001" });
    const dadosTx = cliente.chamadas[1].pedido.dados as { indicadorTransmissao: boolean; indicadorComparacao: boolean };
    assert.deepEqual([dadosTx.indicadorTransmissao, dadosTx.indicadorComparacao], [true, true]);
    assert.equal(cliente.chamadas[1].opcoes.confirmado, true);

    // Banco primeiro: a declaração entra no histórico na hora (com o PDF da declaração e o recibo guardados).
    const [declarada] = await t.banco.select().from(pgdasdDeclaracoes).where(eq(pgdasdDeclaracoes.pa, "2026-09"));
    assert.deepEqual([declarada.numero, declarada.tipo], ["98765432202609001", "original"]);
    const base = await baseDoMes(t.banco, acesso, "2026-09", AGORA);
    assert.equal(base.vigente?.numero, "98765432202609001");
    assert.equal(base.receitaDeclarada, 23_000);
    const [transmissao] = (await enviosDoMes(t.banco, acesso, "2026-09")).filter((e) => e.etapa === "transmissao");
    assert.deepEqual([transmissao.estado, transmissao.temDeclaracao, transmissao.temRecibo], ["ok", true, true]);
    const recibo = await documentoDaEmpresa(t.banco, acesso, "recibo-pgdasd", transmissao.id);
    assert.equal(recibo?.nome, "recibo-pgdasd-2026-09.pdf");
    assert.equal(recibo?.pdf.subarray(0, 5).toString(), "%PDF-");

    // Não transmite duas vezes o mesmo mês: original de novo é recusada sem chamar nada.
    const de_novo = await transmitirMes(d, acesso, "2026-09", { retificar: false, confirmado: true, confirmacao: CONFIRMACAO });
    assert.equal(de_novo.ok, false);
    assert.match(!de_novo.ok ? de_novo.mensagem : "", /faça uma retificação/);
    assert.equal((await simularMes(d, acesso, "2026-09", { retificar: false })).ok, false);
    assert.equal(cliente.chamadas.length, 2);
  });

  it("simulação que não bate não libera a transmissão; receita mudada depois da simulação pede simular de novo", async () => {
    const { acesso } = await prontaParaDeclarar();
    const cliente = clienteFalso(simulacaoOk([{ codigoTributo: 1001, valor: 78.66 }, ...VALORES_REAIS.slice(1)]), simulacaoOk());
    const d = dependencias(cliente);
    const sim = await simularMes(d, acesso, "2026-09", { retificar: false });
    assert.ok(sim.ok && !sim.bateu);
    assert.deepEqual(await transmitirMes(d, acesso, "2026-09", { retificar: false, confirmado: true, confirmacao: CONFIRMACAO }), { ok: false, mensagem: MENSAGENS_DA_ROTINA.simulacaoDiferente });
    assert.ok((await simularMes(d, acesso, "2026-09", { retificar: false })).ok);
    // Banco primeiro: a mesma simulação no mesmo dia não é pedida de novo.
    const repetida = await simularMes(d, acesso, "2026-09", { retificar: false });
    assert.ok(repetida.ok && repetida.bateu);
    assert.equal(cliente.chamadas.length, 2);
    await lancarReceita(d, acesso, { pa: "2026-09", recebidaEm: "2026-10-06", moeda: "BRL", valorMoeda: 100 });
    const base = await baseDoMes(t.banco, acesso, "2026-09", AGORA);
    assert.equal(await motivoParaNaoTransmitirMes(t.banco, acesso, base, false), MENSAGENS_DA_ROTINA.receitaMudou);
    assert.equal(cliente.chamadas.length, 2);
  });

  it("duplo clique (duas transmissões ao mesmo tempo): uma chamada só", async () => {
    const { acesso } = await prontaParaDeclarar();
    const cliente = clienteFalso(simulacaoOk(), transmissaoOk("98765432202609001"));
    const d = dependencias(cliente);
    await simularMes(d, acesso, "2026-09", { retificar: false });
    const [a, b] = await Promise.all([
      transmitirMes(d, acesso, "2026-09", { retificar: false, confirmado: true, confirmacao: CONFIRMACAO }),
      transmitirMes(d, acesso, "2026-09", { retificar: false, confirmado: true, confirmacao: CONFIRMACAO }),
    ]);
    assert.equal([a, b].filter((r) => r.ok).length, 1);
    assert.equal(cliente.chamadas.length, 2); // a simulação e uma transmissão
    const recusada = [a, b].find((r) => !r.ok)!;
    assert.match(!recusada.ok ? recusada.mensagem : "", /transmitida|sendo transmitida/);
  });

  it("transmissão sem resposta fica incerta: nada é transmitido de novo até o histórico mostrar o que aconteceu", async () => {
    const { acesso } = await prontaParaDeclarar();
    const log: string[] = [];
    const cliente = clienteFalso(simulacaoOk(), new ErroSemResposta("O servidor não respondeu em 60 segundos."), transmissaoOk("98765432202609001"));
    const d = dependencias(cliente, { log });
    await simularMes(d, acesso, "2026-09", { retificar: false });
    assert.deepEqual(await transmitirMes(d, acesso, "2026-09", { retificar: false, confirmado: true, confirmacao: CONFIRMACAO }), { ok: false, mensagem: MENSAGENS_DA_ROTINA.incerta });
    assert.ok(log.some((l) => l.startsWith("[serpro]") && /sem resposta/.test(l)));
    assert.deepEqual(await transmitirMes(d, acesso, "2026-09", { retificar: false, confirmado: true, confirmacao: CONFIRMACAO }), { ok: false, mensagem: MENSAGENS_DA_ROTINA.incerta });
    assert.equal(cliente.chamadas.length, 2);

    // O histórico foi consultado depois e não tem a declaração: a transmissão incerta é liberada.
    const depois = new Date(AGORA.getTime() + 60 * 60_000);
    await t.banco.insert(historicoConsultas).values({ empresaId: acesso.empresaId, tipo: "declaracoes:2026", consultadaEm: depois, ok: true }).onConflictDoUpdate({
      target: [historicoConsultas.empresaId, historicoConsultas.tipo],
      set: { consultadaEm: depois },
    });
    const r = await transmitirMes(dependencias(cliente, { agora: depois }), acesso, "2026-09", { retificar: false, confirmado: true, confirmacao: CONFIRMACAO });
    assert.ok(r.ok);
    const estados = (await enviosDoMes(t.banco, acesso, "2026-09")).filter((e) => e.etapa === "transmissao").map((e) => e.estado).sort();
    assert.deepEqual(estados, ["erro", "ok"]);
  });

  it("transmissão incerta que chegou na Receita: o histórico mostra a declaração e ela vira transmitida (sem transmitir de novo)", async () => {
    const { acesso } = await prontaParaDeclarar();
    const cliente = clienteFalso(simulacaoOk(), new ErroSemResposta("caiu"));
    const d = dependencias(cliente);
    await simularMes(d, acesso, "2026-09", { retificar: false });
    await transmitirMes(d, acesso, "2026-09", { retificar: false, confirmado: true, confirmacao: CONFIRMACAO });
    await t.banco.insert(pgdasdDeclaracoes).values({ empresaId: acesso.empresaId, pa: "2026-09", numero: "98765432202609001", tipo: "original", transmitidaEm: "2026-10-18T10:00:30", vistaEm: AGORA });
    const r = await transmitirMes(d, acesso, "2026-09", { retificar: false, confirmado: true, confirmacao: CONFIRMACAO });
    assert.equal(r.ok, false);
    const [tx] = (await enviosDoMes(t.banco, acesso, "2026-09")).filter((e) => e.etapa === "transmissao");
    assert.deepEqual([tx.estado, tx.numeroDeclaracao], ["ok", "98765432202609001"]);
    assert.equal(cliente.chamadas.length, 2);
  });

  it("retificação explícita: só com retificar, presa à declaração que corrige (tipo 2); sem declaração, não há o que retificar", async () => {
    const { acesso } = await prontaParaDeclarar();
    const semDeclaracao = await simularMes(dependencias(clienteFalso()), acesso, "2026-09", { retificar: true });
    assert.deepEqual(semDeclaracao, { ok: false, mensagem: MENSAGENS_DA_ROTINA.nadaARetificar });

    const cliente = clienteFalso(simulacaoOk(), transmissaoOk("98765432202609001"));
    const d = dependencias(cliente);
    await simularMes(d, acesso, "2026-09", { retificar: false });
    assert.ok((await transmitirMes(d, acesso, "2026-09", { retificar: false, confirmado: true, confirmacao: CONFIRMACAO })).ok);

    // Receita a mais lançada: a retificadora usa a soma dos lançamentos.
    await lancarReceita(d, acesso, { pa: "2026-09", recebidaEm: "2026-10-06", moeda: "BRL", valorMoeda: 1_000 });
    const base = await baseDoMes(t.banco, acesso, "2026-09", AGORA);
    assert.equal(base.receita, 24_000);
    const valores = base.apuracao!.das.tributos;
    const devolvidos = [{ codigoTributo: 1001, valor: valores.irpj }, { codigoTributo: 1002, valor: valores.csll }, { codigoTributo: 1006, valor: valores.cpp }];
    const ret = clienteFalso(ok([{ valoresDevidos: devolvidos }]), ok([{ idDeclaracao: "98765432202609002", valoresDevidos: devolvidos }]));
    const dr = dependencias(ret);
    assert.ok((await simularMes(dr, acesso, "2026-09", { retificar: true })).ok);
    const r = await transmitirMes(dr, acesso, "2026-09", { retificar: true, confirmado: true, confirmacao: { receita: 24_000, total: base.apuracao!.das.total } });
    assert.ok(r.ok);
    assert.equal((ret.chamadas[1].pedido.dados as { declaracao: { tipoDeclaracao: number } }).declaracao.tipoDeclaracao, 2);
    const [tx] = (await enviosDoMes(t.banco, acesso, "2026-09")).filter((e) => e.etapa === "transmissao" && e.tipo === "retificadora");
    assert.deepEqual([tx.retifica, tx.numeroDeclaracao], ["98765432202609001", "98765432202609002"]);
    assert.equal((await baseDoMes(t.banco, acesso, "2026-09", AGORA)).vigente?.numero, "98765432202609002");
  });

  it("sem autorização (termo ausente, vencido ou recusado) ou sem contrato: nada é chamado e a mensagem é própria", async () => {
    const { acesso } = await prontaParaDeclarar();
    const cliente = clienteFalso();
    const semTermo = dependencias(cliente, {
      contexto: async () => {
        throw new ErroTermoAutorizacao("sem-termo");
      },
    });
    const r = await simularMes(semTermo, acesso, "2026-09", { retificar: false });
    assert.equal(r.ok, false);
    assert.doesNotMatch(!r.ok ? r.mensagem : "", /serpro|integra/i);
    assert.deepEqual(await simularMes(dependencias(null), acesso, "2026-09", { retificar: false }), { ok: false, mensagem: MENSAGENS_DA_ROTINA.indisponivel });
    assert.deepEqual(await gerarGuia(semTermo, acesso, "2026-08", "DAS"), { ok: false, mensagem: r.ok ? "" : r.mensagem });
    assert.equal(cliente.chamadas.length, 0);
  });

  it("mês que não terminou não é simulado nem transmitido", async () => {
    const { acesso } = await prontaParaDeclarar();
    const cliente = clienteFalso();
    const r = await simularMes(dependencias(cliente), acesso, "2026-10", { retificar: false });
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.mensagem : "", /não terminou/);
    assert.equal(cliente.chamadas.length, 0);
  });
});

describe("guias: DAS e DARF do INSS, inclusive vencida com multa e juros (banco primeiro)", () => {
  it("DAS da declaração vigente: gerado uma vez, PDF no banco, DAS no histórico; de novo, sem chamar", async () => {
    const { acesso } = await prontaParaDeclarar();
    const cliente = clienteFalso(dasEmitido("07202608000000009"));
    const d = dependencias(cliente);
    assert.deepEqual(await gerarGuia(d, acesso, "2026-09", "DAS"), { ok: false, mensagem: MENSAGENS_DA_ROTINA.semDeclaracao });
    const r = await gerarGuia(d, acesso, "2026-08", "DAS");
    assert.ok(r.ok && r.nova);
    assert.deepEqual(cliente.chamadas[0].pedido.dados, { periodoApuracao: "202608" });
    const g = r.ok ? r.guia : null;
    assert.deepEqual([g?.numero, g?.total, g?.vencimento, g?.referencia, g?.pagarEm], ["07202608000000009", 1000.76, "2026-10-20", "98765432202608001", null]);
    const de_novo = await gerarGuia(d, acesso, "2026-08", "DAS");
    assert.ok(de_novo.ok && !de_novo.nova);
    assert.equal(cliente.chamadas.length, 1);
    assert.ok((await t.banco.select().from(pgdasdDas)).some((das) => das.numero === "07202608000000009"));
    const pdf = await documentoDaEmpresa(t.banco, acesso, "guia", g!.id);
    assert.equal(pdf?.nome, "das-2026-08.pdf");
  });

  it("resposta que não é PDF (DAS e DARF): recusada em linguagem simples, nada guardado, e o próximo pedido busca de novo", async () => {
    const { acesso } = await prontaParaDeclarar();
    const html = Buffer.from("<html>erro interno</html>").toString("base64");
    const cliente = clienteFalso(
      ok([{ pdf: html, detalhamento: { numeroDocumento: "07202608000000009", dataVencimento: "20261020", valores: { principal: 1000.76, total: 1000.76 } } }]),
      dasEmitido("07202608000000009"),
    );
    const logs: string[] = [];
    const d = dependencias(cliente, { log: logs });
    assert.deepEqual(await gerarGuia(d, acesso, "2026-08", "DAS"), { ok: false, mensagem: MENSAGENS_DA_ROTINA.naoEPdf });
    assert.equal((await t.banco.select().from(guias)).length, 0);
    assert.ok((await t.banco.select().from(pgdasdDas)).every((das) => das.numero !== "07202608000000009"), "o DAS sem PDF não entra no histórico");
    assert.match(logs.join("\n"), /\[serpro\] DAS de 2026-08.*não é um PDF/);
    const r = await gerarGuia(d, acesso, "2026-08", "DAS");
    assert.ok(r.ok && r.nova);
    assert.equal(cliente.chamadas.length, 2);
  });

  it("vencida: guia atualizada para a data escolhida (dia útil até o fim do mês), uma por data; no prazo, não", async () => {
    const { acesso } = await prontaParaDeclarar();
    const cliente = clienteFalso(simulacaoOk(), transmissaoOk("98765432202609001"), dasEmitido("07202609000000002", { principal: 1000.76, multa: 20.02, juros: 10, total: 1030.78 }));
    const d = dependencias(cliente);
    await simularMes(d, acesso, "2026-09", { retificar: false });
    await transmitirMes(d, acesso, "2026-09", { retificar: false, confirmado: true, confirmacao: CONFIRMACAO });
    // No prazo (18/10): a guia com juros não se aplica.
    const noPrazo = await gerarGuia(d, acesso, "2026-09", "DAS", { pagarEm: "2026-10-19" });
    assert.equal(noPrazo.ok, false);

    const depois = dependencias(cliente, { agora: DEPOIS_DO_VENCIMENTO });
    const situacao = await guiaDoMes(t.banco, acesso, "2026-09", "DAS", DEPOIS_DO_VENCIMENTO);
    assert.deepEqual([situacao.vencida, situacao.paga, situacao.pagarEmSugerido], [true, false, "2026-10-26"]);
    for (const data of ["2026-10-25", "2026-10-31", "2026-11-02", "2026-10-24"]) {
      assert.deepEqual(await gerarGuia(depois, acesso, "2026-09", "DAS", { pagarEm: data }), { ok: false, mensagem: MENSAGENS_DA_ROTINA.dataDePagamento }, data);
    }
    const r = await gerarGuia(depois, acesso, "2026-09", "DAS", { pagarEm: "2026-10-27" });
    assert.ok(r.ok);
    assert.deepEqual(cliente.chamadas[2].pedido.dados, { periodoApuracao: "202609", dataConsolidacao: "20261027" });
    assert.deepEqual(r.ok && [r.guia.principal, r.guia.multa, r.guia.juros, r.guia.total, r.guia.pagarEm], [1000.76, 20.02, 10, 1030.78, "2026-10-27"]);
    assert.ok((await gerarGuia(depois, acesso, "2026-09", "DAS", { pagarEm: "2026-10-27" })).ok);
    assert.equal(cliente.chamadas.length, 3);
    assert.equal((await guiaDoMes(t.banco, acesso, "2026-09", "DAS", DEPOIS_DO_VENCIMENTO)).atualizada?.pagarEm, "2026-10-27");
    // Passada a data escolhida, a guia atualizada não vale mais.
    assert.equal((await guiaDoMes(t.banco, acesso, "2026-09", "DAS", em("2026-10-28T09:00:00"))).atualizada, null);
  });
});

const conferencia = (xml = xmlDctf()) => ok({ XMLStringBase64: Buffer.from(xml, "utf8").toString("base64") });

describe("DCTFWeb: conferir, assinar e transmitir; DARF do INSS", () => {
  const darf = ok({ PDFByteArrayBase64: pdfComTexto("Documento de Arrecadacao", "Valor Total do Documento", "178,31").toString("base64") });

  it("empresa da plataforma: assina no servidor com o certificado do contrato, transmite com confirmação e gera o DARF", async () => {
    const { acesso } = await empresa();
    const pem = lerPfx(certificadoDeTeste());
    const cliente = clienteFalso(conferencia(), ok({ numeroRecibo: "50000534643844" }), darf);
    const d = dependencias(cliente, { contexto: async () => ({ contribuinte: cnpj(SUPORTE) }), certificadoDaPlataforma: () => pem });
    // Sem pró-labore informado não há INSS esperado.
    const semProLabore = await conferirDctfMes(d, acesso, "2026-09");
    assert.ok(semProLabore.ok);
    assert.deepEqual(await transmitirDctfMes(d, acesso, "2026-09", { confirmado: true, confirmacao: { aPagar: 178.31 } }), { ok: false, mensagem: MENSAGENS_DA_ROTINA.dctfSemProLabore });
    await informarProLabore(d, acesso, { mes: "2026-09", valor: 1_621 }); // INSS 11% = 178,31
    assert.deepEqual(await transmitirDctfMes(d, acesso, "2026-09", { confirmado: false, confirmacao: { aPagar: 178.31 } }), { ok: false, mensagem: MENSAGENS_DA_ROTINA.semConfirmacao });
    assert.deepEqual(await transmitirDctfMes(d, acesso, "2026-09", { confirmado: true, confirmacao: { aPagar: 100 } }), { ok: false, mensagem: MENSAGENS_DA_ROTINA.confirmacaoMudou });
    const r = await transmitirDctfMes(d, acesso, "2026-09", { confirmado: true, confirmacao: { aPagar: 178.31 } });
    assert.deepEqual(r, { ok: true, recibo: "50000534643844" });
    const enviado = Buffer.from((cliente.chamadas[1].pedido.dados as { xmlAssinadoBase64: string }).xmlAssinadoBase64, "base64").toString("utf8");
    assert.equal(verificarAssinatura(enviado, pem.certificado), true);
    assert.equal(cliente.chamadas[1].opcoes.confirmado, true);
    // Transmitida: não confere nem transmite de novo; o DARF sai uma vez.
    assert.ok((await conferirDctfMes(d, acesso, "2026-09")).ok);
    assert.deepEqual(await transmitirDctfMes(d, acesso, "2026-09", { confirmado: true, confirmacao: { aPagar: 178.31 } }), { ok: false, mensagem: MENSAGENS_DA_ROTINA.dctfRetificar });
    const g = await gerarGuia(d, acesso, "2026-09", "INSS");
    assert.ok(g.ok && g.guia.total === 178.31 && g.guia.referencia === "50000534643844");
    assert.ok((await gerarGuia(d, acesso, "2026-09", "INSS")).ok);
    assert.equal(cliente.chamadas.length, 3);
  });

  it("DARF cuja resposta não é PDF: recusado em linguagem simples e nada guardado (o próximo pedido busca de novo)", async () => {
    const { acesso } = await empresa();
    const pem = lerPfx(certificadoDeTeste());
    const vazio = ok({ PDFByteArrayBase64: "AAAA" }); // bytes zerados: decodifica, mas não é PDF
    const cliente = clienteFalso(conferencia(), ok({ numeroRecibo: "50000534643844" }), vazio, darf);
    const d = dependencias(cliente, { contexto: async () => ({ contribuinte: cnpj(SUPORTE) }), certificadoDaPlataforma: () => pem });
    await informarProLabore(d, acesso, { mes: "2026-09", valor: 1_621 });
    assert.ok((await conferirDctfMes(d, acesso, "2026-09")).ok);
    assert.ok((await transmitirDctfMes(d, acesso, "2026-09", { confirmado: true, confirmacao: { aPagar: 178.31 } })).ok);
    assert.deepEqual(await gerarGuia(d, acesso, "2026-09", "INSS"), { ok: false, mensagem: MENSAGENS_DA_ROTINA.naoEPdf });
    assert.equal((await t.banco.select().from(guias)).length, 0);
    const g = await gerarGuia(d, acesso, "2026-09", "INSS");
    assert.ok(g.ok && g.nova && g.guia.total === 178.31);
    assert.equal(cliente.chamadas.length, 4);
  });

  it("cliente: o servidor prepara, o navegador assina com o e-CNPJ A1 da empresa e o servidor confere e transmite", async () => {
    const { acesso } = await empresa();
    const cliente = clienteFalso(conferencia(), ok({ numeroRecibo: "1" }));
    const d = dependencias(cliente);
    await informarProLabore(d, acesso, { mes: "2026-09", valor: 1_621 });
    assert.ok((await conferirDctfMes(d, acesso, "2026-09")).ok);
    assert.equal(cliente.chamadas[0].opcoes.tokenProcurador, TOKEN);

    // Certificado de outra empresa: recusado antes de preparar.
    const outro = certificadoIcpDeTeste({ tipo: "PJ", numero: DESENVOLVIMENTO, nome: "OUTRA", validoDe: new Date("2026-01-01") });
    const deOutro = abrirCertificado(new Uint8Array(outro.pfx), outro.senha);
    const recusado = await prepararTransmissaoDctf(d, acesso, "2026-09", { certificado: deOutro.certificadoBase64 });

    assert.equal(recusado.ok, false);
    assert.match(!recusado.ok ? recusado.mensagem : "", /não o da empresa/);

    const pfx = certificadoIcpDeTeste({ tipo: "PJ", numero: SUPORTE, nome: "SUPORTE TI LTDA", validoDe: new Date("2026-01-01") });
    const aberto = abrirCertificado(new Uint8Array(pfx.pfx), pfx.senha);
    const preparo = await prepararTransmissaoDctf(d, acesso, "2026-09", { certificado: aberto.certificadoBase64 });
    assert.ok(preparo.ok, JSON.stringify(preparo));
    if (!preparo.ok) return;
    assert.equal(preparo.aPagar, 178.31);
    // Assinatura de outra chave não confere: nada é enviado.
    assert.deepEqual(
      await transmitirDctfMes(d, acesso, "2026-09", { confirmado: true, confirmacao: { aPagar: 178.31 }, preparoId: preparo.preparoId, assinatura: deOutro.assinar(preparo.signedInfo) }),
      { ok: false, mensagem: MENSAGENS_DA_ROTINA.assinaturaInvalida },
    );
    const r = await transmitirDctfMes(d, acesso, "2026-09", { confirmado: true, confirmacao: { aPagar: 178.31 }, preparoId: preparo.preparoId, assinatura: aberto.assinar(preparo.signedInfo) });
    assert.deepEqual(r, { ok: true, recibo: "1" });
    assert.equal(cliente.chamadas.length, 2);
    const enviado = Buffer.from((cliente.chamadas[1].pedido.dados as { xmlAssinadoBase64: string }).xmlAssinadoBase64, "base64").toString("utf8");
    assert.match(enviado, new RegExp(aberto.certificadoBase64.slice(0, 40).replace(/[+/]/g, "\\$&")));
    // O mesmo preparo não serve de novo.
    const s = await situacaoDctf(t.banco, acesso, "2026-09", AGORA);
    assert.deepEqual([s.transmitida, s.recibo], [true, "1"]);
    assert.equal((await t.banco.select().from(dctfwebEnvios).where(eq(dctfwebEnvios.estado, "preparada"))).length, 0);
  });

  it("valor da declaração diferente do INSS do pró-labore bloqueia; transmissão sem resposta fica incerta até nova conferência", async () => {
    const { acesso } = await empresa();
    const pem = lerPfx(certificadoDeTeste());
    const cliente = clienteFalso(conferencia(), new ErroSemResposta("caiu"), conferencia(xmlDctf({ recibo: "77" })));
    const d = dependencias(cliente, { contexto: async () => ({ contribuinte: cnpj(SUPORTE) }), certificadoDaPlataforma: () => pem });
    await informarProLabore(d, acesso, { mes: "2026-09", valor: 1_518 });
    await conferirDctfMes(d, acesso, "2026-09");
    assert.deepEqual(await transmitirDctfMes(d, acesso, "2026-09", { confirmado: true, confirmacao: { aPagar: 178.31 } }), { ok: false, mensagem: MENSAGENS_DA_ROTINA.dctfValorDiferente });
    await informarProLabore(d, acesso, { mes: "2026-09", valor: 1_621 });
    assert.deepEqual(await transmitirDctfMes(d, acesso, "2026-09", { confirmado: true, confirmacao: { aPagar: 178.31 } }), { ok: false, mensagem: MENSAGENS_DA_ROTINA.incerta });
    assert.deepEqual(await transmitirDctfMes(d, acesso, "2026-09", { confirmado: true, confirmacao: { aPagar: 178.31 } }), { ok: false, mensagem: MENSAGENS_DA_ROTINA.incerta });
    // Nova conferência mostra o recibo: a transmissão incerta chegou.
    const r = await conferirDctfMes(dependencias(cliente, { agora: new Date(AGORA.getTime() + 60_000), contexto: async () => ({ contribuinte: cnpj(SUPORTE) }) }), acesso, "2026-09");
    assert.ok(r.ok && r.situacao.transmitida && r.situacao.recibo === "77");
    assert.equal(cliente.chamadas.length, 3);
  });
});

describe("aviso do Fator R (passo 19)", () => {
  it("empresa com Fator R perto de 28%: sugestão de pró-labore e economia, com o histórico importado e o pró-labore informado", async () => {
    const { acesso } = await empresa("ana", "ti-fator-r");
    // 12 meses de R$ 25.000 e folha de R$ 6.750 (27%), vindos do extrato de 09/2026 (itens 2.2 e 2.3).
    const meses = ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
    const cliente = clienteFalso(
      respostaDeclaracoes(2025, []),
      respostaDeclaracoes(2026, [{ pa: "2026-09", declaracoes: [{ numero: "12345678202609001", quando: "20261005100000" }], das: [{ numero: "07202609000000001", quando: "20261005100100" }] }]),
      respostaExtrato("07202609000000001", {
        pa: "2026-09", receita: 25_000, atividade: ATIVIDADE_29, fatorR: 0.27,
        anteriores: Object.fromEntries(meses.map((m) => [m, 25_000])),
        folhas: Object.fromEntries(meses.map((m) => [m, 6_750])),
      }),
      respostaPagamentos([]),
    );
    await importar({ banco: t.banco, cliente, contexto: contextoDe(DESENVOLVIMENTO), agora: () => AGORA, esperar: async () => {}, log: () => {} }, acesso, { grupos: ["historico"], manual: false });
    await informarProLabore(dependencias(null), acesso, { mes: "2026-09", valor: 6_750 });
    await informarProLabore(dependencias(null), acesso, { mes: "2026-10", valor: 6_750 });
    const aviso = await avisoFatorR(t.banco, acesso, AGORA);
    assert.ok(aviso);
    assert.equal(aviso.paAfetado, "2026-11");
    assert.equal(aviso.anexo, "V");
    assert.equal(aviso.emAtencao, true);
    assert.equal(aviso.proLaboreInformado, true);
    assert.equal(aviso.proLaboreSugerido, 9_750);
    assert.ok(aviso.economia > 0);

    // Empresa de Anexo III fixo: sem aviso.
    const suporte = await empresa("beto");
    assert.equal(await avisoFatorR(t.banco, suporte.acesso, AGORA), null);
  });
});

describe("isolamento, registro das chamadas e remoção", () => {
  it("outra empresa não vê lançamentos, envios, guias nem PDFs; a remoção apaga as tabelas novas", async () => {
    const { acesso, usuario, empresaId } = await prontaParaDeclarar();
    const pem = lerPfx(certificadoDeTeste());
    const cliente = clienteFalso(simulacaoOk(), transmissaoOk("98765432202609001"), dasEmitido("07202609000000002"), conferencia(), ok({ numeroRecibo: "9" }));
    const d = dependencias(cliente, { certificadoDaPlataforma: () => pem });
    await simularMes(d, acesso, "2026-09", { retificar: false });
    await transmitirMes(d, acesso, "2026-09", { retificar: false, confirmado: true, confirmacao: CONFIRMACAO });
    const g = await gerarGuia(d, acesso, "2026-09", "DAS");
    await informarProLabore(d, acesso, { mes: "2026-09", valor: 1_621 });
    await conferirDctfMes(d, acesso, "2026-09");
    await t.banco.insert(cotacoesPtax).values({ moeda: "USD", data: "2026-10-01", boletim: "2026-10-01", compra: 5, venda: 5, consultadaEm: AGORA });

    const outra = await empresa("beto", "ti-fator-r");
    assert.equal(await documentoDaEmpresa(t.banco, outra.acesso, "guia", g.ok ? g.guia.id : ""), null);
    assert.deepEqual(await enviosDoMes(t.banco, outra.acesso, "2026-09"), []);
    assert.equal((await baseDoMes(t.banco, outra.acesso, "2026-09", AGORA)).lancamentos.length, 0);
    assert.equal(await removerReceita(t.banco, outra.acesso, (await t.banco.select().from(receitasLancadas))[0].id), false);

    await removerEmpresa(t.banco, { sessaoId: "00000000-0000-0000-0000-000000000000", usuario }, empresaId, SUPORTE, { log: () => {} });
    for (const tabela of [receitasLancadas, prolabores, pgdasdEnvios, dctfwebEnvios, guias]) assert.equal((await t.banco.select().from(tabela)).length, 0);
    // A cotação é dado público da plataforma: fica.
    assert.equal((await t.banco.select().from(cotacoesPtax)).length, 1);
  });

  it("cliente real do núcleo (transporte falso): a simulação fica em serpro_chamadas com o custo de declaração", async () => {
    const { acesso } = await prontaParaDeclarar();
    const respostas = [
      { status: 200, texto: JSON.stringify({ access_token: "acesso", jwt_token: "jwt", expires_in: 3600 }) },
      { status: 200, texto: JSON.stringify({ status: 200, dados: JSON.stringify([{ valoresDevidos: VALORES_REAIS }]), mensagens: [] }) },
    ];
    const transporte: Transporte = async () => respostas.shift()!;
    const cliente = criarClienteSerpro({
      consumerKey: "chave",
      consumerSecret: "segredo",
      certificado: { pfx: Buffer.from("pfx"), senha: "x" },
      contratante: "11444777000161",
      limitePorPeriodo: 40,
      registro: registroNoBanco(t.banco),
      transporte,
      agora: () => AGORA,
    });
    const r = await simularMes(dependencias(cliente), acesso, "2026-09", { retificar: false });
    assert.ok(r.ok && r.bateu);
    const registradas = await t.banco.select().from(serproChamadas);
    assert.deepEqual(
      registradas.map((c) => [c.acao, c.servico, c.status, c.custo, c.empresaId]),
      [
        ["Autenticar", "SAPI", 200, 0, null],
        ["Declarar", "PGDASD/TRANSDECLARACAO11", 200, 0.4, acesso.empresaId],
      ],
    );
    assert.match(registradas[1].finalidade, /Simular a declaração do PGDAS-D de 2026-09 sem transmitir/);
  });
});
