// Parte 5, passo 17: importação do histórico de ponta a ponta, contra o banco de teste, com a empresa cadastrada pela
// Parte 3. Nada sai da máquina: o cliente do contrato é o falso do núcleo, com respostas gravadas no formato oficial
// (extrato com o texto do extrato real anonimizado), ou o cliente real com um transporte falso (registro e custo).
// Confere: banco primeiro (o que está em dia não é consultado), extrato uma vez por declaração (retificadora pede outro),
// falhas com mensagem própria, limite, empresa sem autorização, corrida, importação parada, isolamento entre empresas,
// PDFs só pela porta de acesso e a remoção da empresa apagando tudo.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import type { Transporte } from "@contabilizadev/nucleo/http";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import { cnpj, criarClienteSerpro, type Resposta } from "@contabilizadev/nucleo/serpro/cliente";
import { pdfComTexto } from "@contabilizadev/nucleo/serpro/dctf-exemplo";
import {
  ATIVIDADE_29,
  respostaDeclaracaoRecibo,
  respostaDeclaracoes,
  respostaDefis,
  respostaExtrato,
  respostaPagamentos,
  respostaProtocolo,
  respostaRelatorio,
} from "@contabilizadev/nucleo/serpro/historico-exemplo";
import * as esquema from "@/banco/esquema";
import { defis, historicoConsultas, importacoes, pagamentos, pgdasdDas, pgdasdDeclaracoes, pgdasdExtratos, serproChamadas, situacoesFiscais } from "@/banco/esquema";
import { entrarComGoogle, resolverSessao } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { ultimaConsulta } from "@/lib/empresas/receita";
import { removerEmpresa } from "@/lib/empresas/remocao";
import { documentoDaEmpresa } from "@/lib/historico/documentos";
import { executarImportacao, importar, iniciarImportacao, type DependenciasImportacao } from "@/lib/historico/importacao";
import { avisosDoHistorico, defisDaEmpresa, defisDoAno, historicoDaEmpresa, importacaoDaEmpresa, situacaoFiscalDaEmpresa } from "@/lib/historico/leitura";
import { MENSAGENS_DO_HISTORICO } from "@/lib/historico/mensagens";
import { registroNoBanco } from "@/lib/serpro/registro";
import { ErroTermoAutorizacao } from "@/lib/termo/termo";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";
import { cadastrarComprovada, consultarComDados } from "./apoio-empresa";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const em = (iso: string) => new Date(`${iso}-03:00`);
const HORA = 60 * 60 * 1000;
const AGORA = em("2026-10-18T10:00:00"); // histórico de 10/2025 a 09/2026
const SUPORTE = "98765432000198"; // exemplo ti-anexo-iii: 6209 (Anexo III fixo)
const PERFIS = { ana: perfil("ana@a.com", "sub-ana"), beto: perfil("beto@b.com", "sub-beto") };
const TOKEN = "b06feea3-1ca8-49f4-bdb4-211ab006cb92";

async function empresa(quem: "ana" | "beto" = "ana", exemplo: "ti-anexo-iii" | "ti-fator-r" = "ti-anexo-iii") {
  const usuario = (await entrarComGoogle(depsLogin(t.banco, PERFIS), quem)).usuario;
  const numero = exemplo === "ti-anexo-iii" ? "98.765.432/0001-98" : "12.345.678/0001-95";
  const r = await consultarComDados(t.banco, usuario, numero, { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo(exemplo) });
  assert.equal(r.tipo, "previa");
  const empresaId = await cadastrarComprovada(t.banco, usuario, r.previa.token, { segredo: SEGREDO, agora: AGORA });
  return { usuario, empresaId, acesso: await exigirAcessoEmpresa(t.banco, usuario, empresaId) };
}

const contexto = async () => ({ contribuinte: cnpj(SUPORTE), autorPedidoDados: cnpj(SUPORTE), tokenProcurador: TOKEN });
function dependencias(cliente: DependenciasImportacao["cliente"], agora = AGORA, log: string[] = []): DependenciasImportacao {
  return { banco: t.banco, cliente, contexto, agora: () => agora, esperar: async () => {}, log: (m) => void log.push(m) };
}

const TUDO = { grupos: ["historico", "defis", "situacao"] as ("historico" | "defis" | "situacao")[], manual: false };
const PDF_DEFIS = pdfComTexto("DEFIS 2025").toString("base64");

// Respostas da importação inicial: 12/2025, 08/2026 e 09/2026 declarados (com DAS); os outros meses sem declaração.
function respostasIniciais(atividade0826?: string): Resposta[] {
  return [
    respostaDeclaracoes(2025, [{ pa: "2025-12", declaracoes: [{ numero: "98765432202512001", quando: "20260110100000" }], das: [{ numero: "07202512000000001", quando: "20260110100100", pago: true }] }]),
    respostaDeclaracoes(2026, [
      { pa: "2026-08", declaracoes: [{ numero: "98765432202608001", quando: "20260905100000" }], das: [{ numero: "07202608000000001", quando: "20260905100100" }] },
      { pa: "2026-09", declaracoes: [{ numero: "98765432202609001", quando: "20261005133543" }], das: [{ numero: "07202609000000001", quando: "20261005133600" }] },
    ]),
    respostaExtrato("07202512000000001", { pa: "2025-12", receita: 24_655.48, tributos: { irpj: 84.31, csll: 73.77, cpp: 914.73 } }),
    respostaExtrato("07202608000000001", { pa: "2026-08", receita: 26_908.25, atividade: atividade0826, tributos: { irpj: 92.02, csll: 80.51, cpp: 998.31 }, pago: null }),
    respostaExtrato("07202609000000001", { pa: "2026-09", receita: 23_000, pago: null }),
    respostaPagamentos([{ numero: "07202608000000001", pa: "2026-08", data: "2026-09-18", valor: 1170.84 }]),
    respostaDefis(PDF_DEFIS),
    respostaProtocolo,
    respostaRelatorio(),
  ];
}

describe("importação inicial (empresa autorizada, respostas gravadas)", () => {
  it("importa declarações, extratos, pagamentos, DEFIS e situação fiscal; guarda tudo e mostra os 12 meses", async () => {
    const { acesso } = await empresa();
    const cliente = clienteFalso(...respostasIniciais());
    const inicio = await importar(dependencias(cliente), acesso, TUDO);
    assert.equal(inicio.estado, "iniciada");
    assert.deepEqual(
      cliente.chamadas.map((c) => `${c.acao} ${c.pedido.idSistema}/${c.pedido.idServico}`),
      [
        "Consultar PGDASD/CONSDECLARACAO13",
        "Consultar PGDASD/CONSDECLARACAO13",
        "Consultar PGDASD/CONSEXTRATO16",
        "Consultar PGDASD/CONSEXTRATO16",
        "Consultar PGDASD/CONSEXTRATO16",
        "Consultar PAGTOWEB/PAGAMENTOS71",
        "Consultar DEFIS/CONSULTIMADECREC143",
        "Apoiar SITFIS/SOLICITARPROTOCOLO91",
        "Emitir SITFIS/RELATORIOSITFIS92",
      ],
    );
    // Toda chamada em nome da empresa, com o token do termo de autorização.
    assert.ok(cliente.chamadas.every((c) => c.opcoes.tokenProcurador === TOKEN && c.opcoes.contribuinte.numero === SUPORTE));
    // Pagamentos de 10/2025 até hoje.
    assert.deepEqual((cliente.chamadas[5].pedido.dados as { intervaloDataArrecadacao: unknown }).intervaloDataArrecadacao, { dataInicial: "2025-10-01", dataFinal: "2026-10-18" });

    const imp = await importacaoDaEmpresa(t.banco, acesso, AGORA);
    assert.equal(imp?.motivo, "inicial");
    assert.equal(imp?.rodando, false);
    assert.deepEqual(imp?.etapas.map((e) => [e.id, e.estado]), [["declaracoes", "feito"], ["extratos", "feito"], ["pagamentos", "feito"], ["defis", "feito"], ["situacao", "feito"]]);
    assert.deepEqual(imp?.etapas[1].feitos, 3);

    const diagnostico = (await ultimaConsulta(t.banco, acesso))!.diagnostico;
    const meses = await historicoDaEmpresa(t.banco, acesso, AGORA, diagnostico);
    const mes = (pa: string) => meses.find((m) => m.pa === pa)!;
    assert.deepEqual([mes("2025-12").situacao, mes("2025-12").receita, mes("2025-12").valorDas, mes("2025-12").pagoEm], ["pago", 24_655.48, 1072.81, "2026-01-13"]);
    assert.deepEqual([mes("2026-08").situacao, mes("2026-08").pagoEm, mes("2026-08").valorDas], ["pago", "2026-09-18", 1170.84]);
    assert.deepEqual([mes("2026-09").situacao, mes("2026-09").valorDas, mes("2026-09").receita], ["em-aberto", 1000.76, 23_000]);
    assert.equal(mes("2026-05").situacao, "nao-declarado");
    // Suporte (6209) declarado como atividade 30: confere.
    assert.ok(meses.every((m) => m.divergencia === null));

    const situacao = await situacaoFiscalDaEmpresa(t.banco, acesso);
    assert.equal(situacao.atual?.regular, true);
    const anuais = await defisDaEmpresa(t.banco, acesso);
    assert.deepEqual(anuais.map((d) => [d.ano, d.situacao, d.declaracao, d.recibo]), [[2025, "entregue", true, true]]);
    // Só a presença dos PDFs: os bytes não saem do banco nesta leitura (ela roda no painel).
    assert.ok(anuais.every((d) => typeof d.declaracao === "boolean" && typeof d.recibo === "boolean"));
    assert.ok(!Object.values(anuais[0]).some((v) => Buffer.isBuffer(v) || v instanceof Uint8Array));
    const doAno = await defisDoAno(t.banco, acesso, 2025);
    assert.deepEqual(Object.keys(doAno!).sort(), ["consultadaEm", "situacao"]);
    assert.equal(doAno!.situacao, "entregue");
    assert.equal(await defisDoAno(t.banco, acesso, 2024), null);

    // PDFs guardados no banco e lidos de volta só pela porta de acesso.
    const extrato = mes("2026-09").extrato!;
    const doc = await documentoDaEmpresa(t.banco, acesso, "extrato", extrato.id);
    assert.equal(doc?.nome, "extrato-2026-09.pdf");
    assert.equal(doc?.pdf.subarray(0, 5).toString(), "%PDF-");
    assert.ok(await documentoDaEmpresa(t.banco, acesso, "situacao", situacao.atual!.id));
    assert.ok(await documentoDaEmpresa(t.banco, acesso, "recibo-defis", anuais[0].id));
    assert.equal(await documentoDaEmpresa(t.banco, acesso, "extrato", "nao-e-uuid"), null);
    assert.equal(await documentoDaEmpresa(t.banco, acesso, "outro", extrato.id), null);
  });

  it("banco primeiro: logo depois, nada a consultar (nenhuma chamada); o botão respeita o intervalo mínimo", async () => {
    const { acesso } = await empresa();
    await importar(dependencias(clienteFalso(...respostasIniciais())), acesso, TUDO);
    const nada = clienteFalso();
    assert.deepEqual(await importar(dependencias(nada, new Date(AGORA.getTime() + HORA)), acesso, TUDO), { estado: "em-dia" });
    assert.deepEqual(await importar(dependencias(nada, new Date(AGORA.getTime() + 5 * 60_000)), acesso, { grupos: ["historico"], manual: true }), { estado: "espere", minutos: 5 });
    assert.equal(nada.chamadas.length, 0);
  });

  it("retificadora: no dia seguinte, a lista mostra a declaração nova e só o extrato dela é buscado", async () => {
    const { acesso } = await empresa();
    await importar(dependencias(clienteFalso(...respostasIniciais())), acesso, TUDO);
    const amanha = em("2026-10-19T11:00:00");
    const cliente = clienteFalso(
      respostaDeclaracoes(2025, [{ pa: "2025-12", declaracoes: [{ numero: "98765432202512001", quando: "20260110100000" }], das: [{ numero: "07202512000000001", quando: "20260110100100", pago: true }] }]),
      respostaDeclaracoes(2026, [
        { pa: "2026-08", declaracoes: [{ numero: "98765432202608001", quando: "20260905100000" }], das: [{ numero: "07202608000000001", quando: "20260905100100" }] },
        {
          pa: "2026-09",
          declaracoes: [{ numero: "98765432202609001", quando: "20261005133543" }, { numero: "98765432202609002", quando: "20261019090000", retificadora: true }],
          das: [{ numero: "07202609000000001", quando: "20261005133600" }, { numero: "07202609000000002", quando: "20261019090100" }],
        },
      ]),
      respostaExtrato("07202609000000002", { pa: "2026-09", receita: 25_000, retificadora: true, tributos: { irpj: 85.49, csll: 74.79, cpp: 927.5 }, pago: null }),
      respostaPagamentos([]),
    );
    const r = await importar(dependencias(cliente, amanha), acesso, { grupos: ["historico"], manual: true });
    assert.equal(r.estado, "iniciada");
    assert.equal(cliente.chamadas.length, 4);
    assert.deepEqual(cliente.chamadas[2].pedido.dados, { numeroDas: "07202609000000002" });
    const set = (await historicoDaEmpresa(t.banco, acesso, amanha, null)).find((m) => m.pa === "2026-09")!;
    assert.equal(set.declaracao?.tipo, "retificadora");
    assert.equal(set.receita, 25_000);
    assert.equal(set.extrato?.daDeclaracaoVigente, true);
    // O extrato antigo continua guardado (histórico), e a declaração original também.
    assert.equal((await t.banco.select().from(pgdasdExtratos).where(eq(pgdasdExtratos.pa, "2026-09"))).length, 2);
  });
});

describe("mês declarado sem DAS", () => {
  it("busca a declaração uma vez (débito declarado); com valor e sem guia, vencido sem consultar pagamentos todo dia; DAS gerado depois troca pelo extrato", async () => {
    const { acesso } = await empresa();
    const lista = (comDas: boolean) =>
      respostaDeclaracoes(2026, [
        { pa: "2026-07", declaracoes: [{ numero: "98765432202607001", quando: "20260805100000" }], das: comDas ? [{ numero: "07202607000000009", quando: "20261019100000" }] : [] },
      ]);
    const cliente = clienteFalso(
      respostaDeclaracoes(2025, []),
      lista(false),
      respostaDeclaracaoRecibo("98765432202607001", { pa: "2026-07", receita: 20_000, tributos: { irpj: 70, csll: 60, cpp: 700 } }),
      respostaPagamentos([]),
    );
    await importar(dependencias(cliente), acesso, { grupos: ["historico"], manual: false });
    assert.deepEqual(cliente.chamadas.map((c) => c.pedido.idServico), ["CONSDECLARACAO13", "CONSDECLARACAO13", "CONSDECREC15", "PAGAMENTOS71"]);
    assert.deepEqual(cliente.chamadas[2].pedido.dados, { numeroDeclaracao: "98765432202607001" });
    const julho = (await historicoDaEmpresa(t.banco, acesso, AGORA, null)).find((m) => m.pa === "2026-07")!;
    assert.deepEqual([julho.situacao, julho.valorDas, julho.receita, julho.das, julho.extrato?.origem], ["vencido", 830, 20_000, null, "declaracao"]);
    assert.equal((await documentoDaEmpresa(t.banco, acesso, "extrato", julho.extrato!.id))?.nome, "declaracao-2026-07.pdf");

    // Dia seguinte: a lista é consultada (1 vez por dia), a declaração não é buscada de novo e os pagamentos não rodam
    // (sem DAS não há pagamento para achar).
    const amanha = new Date(AGORA.getTime() + 25 * HORA);
    const segundo = clienteFalso(lista(false));
    await importar(dependencias(segundo, amanha), acesso, { grupos: ["historico"], manual: false });
    assert.deepEqual(segundo.chamadas.map((c) => c.pedido.idServico), ["CONSDECLARACAO13"]);

    // Depois o DAS é gerado para a declaração: o extrato dele substitui a declaração guardada.
    const depois = new Date(amanha.getTime() + 25 * HORA);
    const terceiro = clienteFalso(
      lista(true),
      respostaExtrato("07202607000000009", { pa: "2026-07", receita: 20_000, tributos: { irpj: 70, csll: 60, cpp: 700 }, pago: null }),
    );
    await importar(dependencias(terceiro, depois), acesso, { grupos: ["historico"], manual: false });
    assert.deepEqual(terceiro.chamadas.map((c) => c.pedido.idServico), ["CONSDECLARACAO13", "CONSEXTRATO16"]);
    const agora = (await historicoDaEmpresa(t.banco, acesso, depois, null)).find((m) => m.pa === "2026-07")!;
    assert.deepEqual([agora.situacao, agora.das, agora.extrato?.origem], ["vencido", "07202607000000009", "extrato"]);
    assert.equal((await t.banco.select().from(pgdasdExtratos)).length, 1);
    // Com o DAS gerado e vencido, a próxima atualização automática consulta os pagamentos (dá para achar o pagamento).
    const quarto = clienteFalso(lista(true), respostaPagamentos([]));
    await importar(dependencias(quarto, new Date(depois.getTime() + 25 * HORA)), acesso, { grupos: ["historico"], manual: false });
    assert.deepEqual(quarto.chamadas.map((c) => c.pedido.idServico), ["CONSDECLARACAO13", "PAGAMENTOS71"]);
  });
});

describe("conferência do CNAE com a atividade declarada", () => {
  it("6209 declarado como atividade 29 em 08/2026: aviso no histórico e no sino", async () => {
    const { acesso } = await empresa();
    await importar(dependencias(clienteFalso(...respostasIniciais(ATIVIDADE_29))), acesso, TUDO);
    const diagnostico = (await ultimaConsulta(t.banco, acesso))!.diagnostico;
    const meses = await historicoDaEmpresa(t.banco, acesso, AGORA, diagnostico);
    const agosto = meses.find((m) => m.pa === "2026-08")!;
    assert.equal(agosto.divergencia?.declarada, 29);
    assert.equal(agosto.divergencia?.esperada, 30);
    assert.equal(
      agosto.divergencia?.texto,
      "Em 08/2026 a declaração usou serviço para o exterior, Anexo III ou V pelo Fator R; pelo seu CNAE seria serviço para o exterior, Anexo III fixo.",
    );
    const avisos = avisosDoHistorico(meses, await situacaoFiscalDaEmpresa(t.banco, acesso));
    assert.deepEqual(avisos.map((a) => a.titulo), ["Atividade declarada em 08/2026 não bate com o CNAE"]);
  });
});

describe("situação fiscal", () => {
  it("relatório com pendências: irregular, pendências guardadas, aviso vermelho no sino; o botão espera 30 minutos", async () => {
    const { acesso } = await empresa();
    const cliente = clienteFalso(respostaProtocolo, { status: 202, dados: { tempoEspera: 2000 }, mensagens: [] }, respostaRelatorio(["Pendência - Débito (SIEF)", "IRPJ - PA 05/2026 - saldo devedor"]));
    assert.equal((await importar(dependencias(cliente), acesso, { grupos: ["situacao"], manual: true })).estado, "iniciada");
    const s = await situacaoFiscalDaEmpresa(t.banco, acesso);
    assert.equal(s.atual?.regular, false);
    assert.equal(s.atual?.pendencias, "Pendência - Débito (SIEF)\nIRPJ - PA 05/2026 - saldo devedor");
    assert.equal(s.processando, false);
    assert.deepEqual(avisosDoHistorico([], s).map((a) => [a.nivel, a.titulo]), [["vencida", "Situação fiscal irregular"]]);
    assert.deepEqual(await importar(dependencias(clienteFalso(), new Date(AGORA.getTime() + 20 * 60_000)), acesso, { grupos: ["situacao"], manual: true }), { estado: "espere", minutos: 10 });
  });

  it("relatório que não sai: pedido marcado como erro, e a situação anterior continua valendo", async () => {
    const { acesso } = await empresa();
    await importar(dependencias(clienteFalso(respostaProtocolo, respostaRelatorio())), acesso, { grupos: ["situacao"], manual: true });
    const depois = new Date(AGORA.getTime() + HORA);
    await importar(dependencias(clienteFalso({ status: 500, dados: null, mensagens: [] }), depois), acesso, { grupos: ["situacao"], manual: true });
    const linhas = await t.banco.select().from(situacoesFiscais);
    assert.deepEqual(linhas.map((l) => l.situacao).sort(), ["erro", "pronto"]);
    assert.equal((await situacaoFiscalDaEmpresa(t.banco, acesso)).atual?.regular, true);
  });
});

describe("falhas, limite e autorização", () => {
  it("extrato que falha: etapa com mensagem própria (detalhe só no log); sozinho, só tenta de novo depois de 1 dia", async () => {
    const { acesso } = await empresa();
    const respostas = respostasIniciais();
    respostas[3] = { status: 500, dados: null, mensagens: [{ codigo: "[Erro-PGDASD-500]", texto: "falha interna" }] };
    const log: string[] = [];
    await importar(dependencias(clienteFalso(...respostas), AGORA, log), acesso, TUDO);
    const imp = await importacaoDaEmpresa(t.banco, acesso, AGORA);
    const extratos = imp!.etapas.find((e) => e.id === "extratos")!;
    assert.deepEqual([extratos.estado, extratos.mensagem], ["erro", MENSAGENS_DO_HISTORICO.falhou]);
    assert.ok(imp!.etapas.filter((e) => e.id !== "extratos").every((e) => e.estado === "feito"));
    assert.ok(log.some((l) => l.includes("[Erro-PGDASD-500]: falha interna")));
    assert.doesNotMatch(JSON.stringify(imp!.etapas), /PGDASD|falha interna/);
    // Uma hora depois: nada (a falha conta como tentativa).
    assert.deepEqual(await importar(dependencias(clienteFalso(), new Date(AGORA.getTime() + HORA)), acesso, TUDO), { estado: "em-dia" });
    // No dia seguinte: só o extrato que faltou (as listas ainda valem) e a lista do ano atual (1 vez por dia).
    const amanha = new Date(AGORA.getTime() + 25 * HORA);
    const cliente = clienteFalso(respostasIniciais()[1], respostaExtrato("07202608000000001", { pa: "2026-08", receita: 26_908.25 }));
    await importar(dependencias(cliente, amanha), acesso, TUDO);
    assert.deepEqual(cliente.chamadas.map((c) => c.pedido.idServico), ["CONSDECLARACAO13", "CONSEXTRATO16"]);
  });

  it("limite de chamadas do contrato: mensagem própria e nada gravado como sucesso", async () => {
    const { acesso } = await empresa();
    const limite = new Error("Limite de 40 chamadas no período de cobrança atingido. Nada foi enviado.");
    await importar(dependencias(clienteFalso(limite, limite, limite, limite, limite, limite)), acesso, TUDO);
    const imp = await importacaoDaEmpresa(t.banco, acesso, AGORA);
    assert.ok(imp!.etapas.filter((e) => e.id !== "extratos").every((e) => e.estado === "erro" && e.mensagem === MENSAGENS_DO_HISTORICO.limite));
    assert.equal((await t.banco.select().from(pgdasdDeclaracoes)).length, 0);
    assert.ok((await t.banco.select().from(historicoConsultas)).every((c) => !c.ok));
  });

  it("empresa sem autorização em dia: nenhuma chamada, cada etapa com o motivo próprio; sem contrato, nada é planejado", async () => {
    const { acesso } = await empresa();
    const cliente = clienteFalso();
    const d = { ...dependencias(cliente), contexto: async () => Promise.reject(new ErroTermoAutorizacao("sem-termo")) };
    await importar(d, acesso, TUDO);
    const imp = await importacaoDaEmpresa(t.banco, acesso, AGORA);
    assert.equal(cliente.chamadas.length, 0);
    assert.ok(imp!.etapas.every((e) => e.estado === "erro" && e.mensagem === new ErroTermoAutorizacao("sem-termo").message));
    const { acesso: outro } = await empresa("beto", "ti-fator-r");
    assert.deepEqual(await iniciarImportacao(dependencias(null), outro, TUDO), { estado: "indisponivel" });
    assert.equal((await t.banco.select().from(importacoes).where(eq(importacoes.empresaId, outro.empresaId))).length, 0);
  });
});

describe("uma importação por vez, parada e corrida", () => {
  it("dois pedidos juntos: um inicia, o outro acompanha o mesmo", async () => {
    const { acesso } = await empresa();
    const d = dependencias(clienteFalso());
    const [a, b] = await Promise.all([iniciarImportacao(d, acesso, TUDO), iniciarImportacao(d, acesso, TUDO)]);
    const estados = [a.estado, b.estado].sort();
    assert.deepEqual(estados, ["iniciada", "rodando"]);
    assert.equal((await t.banco.select().from(importacoes)).length, 1);
  });

  it("importação parada (servidor reiniciado): depois de 15 minutos é encerrada como interrompida e outra pode começar", async () => {
    const { acesso } = await empresa();
    const primeira = await iniciarImportacao(dependencias(clienteFalso()), acesso, TUDO);
    assert.equal(primeira.estado, "iniciada");
    const depois = new Date(AGORA.getTime() + 16 * 60_000);
    const segunda = await iniciarImportacao(dependencias(clienteFalso(), depois), acesso, TUDO);
    assert.equal(segunda.estado, "iniciada");
    const [parada] = await t.banco.select().from(importacoes).where(eq(importacoes.id, (primeira as { id: string }).id));
    assert.ok(parada.terminadaEm);
    assert.ok(parada.etapas.every((e) => e.estado === "erro" && e.mensagem === MENSAGENS_DO_HISTORICO.interrompida));
  });
});

describe("isolamento e remoção da empresa", () => {
  it("outra empresa não vê nada nem abre os PDFs desta", async () => {
    const { acesso } = await empresa();
    await importar(dependencias(clienteFalso(...respostasIniciais())), acesso, TUDO);
    const { acesso: outra } = await empresa("beto", "ti-fator-r");
    const extrato = (await t.banco.select().from(pgdasdExtratos))[0];
    assert.equal(await documentoDaEmpresa(t.banco, outra, "extrato", extrato.id), null);
    assert.ok((await historicoDaEmpresa(t.banco, outra, AGORA, null)).every((m) => m.situacao === "nao-importado"));
    assert.equal((await situacaoFiscalDaEmpresa(t.banco, outra)).atual, null);
    assert.deepEqual(await defisDaEmpresa(t.banco, outra), []);
    assert.equal(await defisDoAno(t.banco, outra, 2025), null);
    // Acesso forjado (não emitido pela porta) é recusado.
    await assert.rejects(documentoDaEmpresa(t.banco, { ...acesso } as AcessoEmpresa, "extrato", extrato.id));
  });

  it("remover a empresa apaga declarações, DAS, extratos, pagamentos, DEFIS, situação fiscal, consultas e importações", async () => {
    const { acesso, usuario } = await empresa();
    await importar(dependencias(clienteFalso(...respostasIniciais())), acesso, TUDO);
    const tabelas = [pgdasdDeclaracoes, pgdasdDas, pgdasdExtratos, pagamentos, defis, situacoesFiscais, historicoConsultas, importacoes];
    for (const tabela of tabelas) assert.ok((await t.banco.select().from(tabela)).length > 0);
    const d = depsLogin(t.banco, PERFIS);
    const sessao = await resolverSessao(d, (await entrarComGoogle(d, "ana")).cookie);
    assert.ok(sessao && sessao.usuario.id === usuario.id);
    await removerEmpresa(t.banco, sessao, acesso.empresaId, SUPORTE);
    for (const tabela of tabelas) assert.equal((await t.banco.select().from(tabela)).length, 0);
  });

  it("empresa removida no meio da importação: para sem erro e sem linha órfã", async () => {
    const { acesso } = await empresa();
    const inicio = await iniciarImportacao(dependencias(clienteFalso()), acesso, TUDO);
    assert.equal(inicio.estado, "iniciada");
    // A remoção chega enquanto as chamadas correm (aqui: logo na primeira resposta).
    const respostas = respostasIniciais();
    const cliente = {
      chamadas: 0,
      async chamar() {
        if (this.chamadas++ === 0) await t.banco.delete(esquema.empresas).where(eq(esquema.empresas.id, acesso.empresaId));
        return respostas.shift()!;
      },
    };
    const log: string[] = [];
    await executarImportacao({ ...dependencias(cliente), log: (m) => void log.push(m) }, acesso, (inicio as { id: string }).id);
    for (const tabela of [pgdasdDeclaracoes, pgdasdDas, pgdasdExtratos, importacoes, historicoConsultas]) assert.equal((await t.banco.select().from(tabela)).length, 0);
    assert.ok(log.some((l) => /removida durante a importação/.test(l)));
  });
});

describe("cliente real do núcleo (transporte falso): cada chamada em serpro_chamadas com o custo", () => {
  it("DEFIS pelo botão: registrada com serviço, finalidade, empresa e o custo da tabela de preços", async () => {
    const { acesso } = await empresa();
    const respostas = [
      { status: 200, texto: JSON.stringify({ access_token: "acesso", jwt_token: "jwt", expires_in: 3600 }) },
      { status: 200, texto: JSON.stringify({ status: 200, dados: JSON.stringify([{ idDefis: "1", declaracao: PDF_DEFIS, recibo: PDF_DEFIS }]), mensagens: [] }) },
    ];
    const enviados: Record<string, string>[] = [];
    const transporte: Transporte = async (_url, headers) => {
      enviados.push(headers);
      return respostas.shift()!;
    };
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
    const r = await importar(dependencias(cliente), acesso, { grupos: ["defis"], manual: true });
    assert.equal(r.estado, "iniciada");
    assert.equal(enviados[1].autenticar_procurador_token, TOKEN);
    const registradas = await t.banco.select().from(serproChamadas);
    assert.deepEqual(
      registradas.map((c) => [c.acao, c.servico, c.status, c.custo, c.empresaId]),
      [
        ["Autenticar", "SAPI", 200, 0, null],
        ["Consultar", "DEFIS/CONSULTIMADECREC143", 200, 0.24, acesso.empresaId],
      ],
    );
    assert.match(registradas[1].finalidade, /DEFIS/);
    assert.equal((await defisDaEmpresa(t.banco, acesso)).length, 1);
  });
});

// Verificação pedida em 20/10/2026: no banco de desenvolvimento, depois da importação inicial das 16:33, as listas de
// declarações (2025 e 2026) e os pagamentos foram consultados de novo às 18:42. A importação das 18:42 está gravada com
// motivo "manual" e as etapas declarações [2025, 2026], extratos e pagamentos: o plano do botão Atualizar do Histórico
// (o automático nunca grava "manual" nem consulta antes de 1 dia). Estes testes provam que abrir as telas não chama a
// Receita quando o dado do dia já está no banco, e que só o botão refaz as listas no mesmo dia.
describe("listas de declarações e pagamentos: no máximo 1 vez por dia sozinhas, ou pelo botão Atualizar", () => {
  const INICIAL = em("2026-10-21T16:33:48"); // o DAS de 09/2026 (vence 20/10) já está vencido e sem pagamento
  const DUAS_HORAS_DEPOIS = em("2026-10-21T18:42:08");
  // Os pedidos que as telas fazem ao abrir (atualizarAoAbrir): painel, Histórico, Situação fiscal, Declaração anual e a
  // importação inicial (todos os grupos). Roteiro, Guias e as outras não pedem nada (conferido no código abaixo).
  const AO_ABRIR: { tela: string; grupos: ("historico" | "defis" | "situacao")[] }[] = [
    { tela: "painel", grupos: ["situacao"] },
    { tela: "Histórico", grupos: ["historico"] },
    { tela: "Situação fiscal", grupos: ["situacao"] },
    { tela: "Declaração anual", grupos: ["defis"] },
    { tela: "primeira visita", grupos: ["historico", "defis", "situacao"] },
  ];

  it("2 horas depois da importação inicial, abrir qualquer tela não chama a Receita (nem com DAS vencido sem pagamento)", async () => {
    const { acesso } = await empresa();
    await importar(dependencias(clienteFalso(...respostasIniciais()), INICIAL), acesso, TUDO);
    const nada = clienteFalso();
    for (const { tela, grupos } of AO_ABRIR) {
      assert.deepEqual(await importar(dependencias(nada, DUAS_HORAS_DEPOIS), acesso, { grupos, manual: false }), { estado: "em-dia" }, tela);
    }
    // Até o fim do dia (23:59) e até 24 horas depois da consulta, nada.
    assert.deepEqual(await importar(dependencias(nada, em("2026-10-22T16:33:00")), acesso, { grupos: ["historico"], manual: false }), { estado: "em-dia" });
    assert.equal(nada.chamadas.length, 0);
    assert.equal((await t.banco.select().from(importacoes)).length, 1);
    // Passado 1 dia: a lista do ano atual e os pagamentos (há DAS vencido sem pagamento), sozinhos, uma vez.
    const amanha = clienteFalso(respostasIniciais()[1], respostasIniciais()[5]);
    await importar(dependencias(amanha, em("2026-10-22T16:34:00")), acesso, { grupos: ["historico"], manual: false });
    assert.deepEqual(amanha.chamadas.map((c) => c.pedido.idServico), ["CONSDECLARACAO13", "PAGAMENTOS71"]);
  });

  it("falha antiga conta como tentativa: a lista que falhou às 16:33 não é refeita sozinha às 18:42", async () => {
    const { acesso } = await empresa();
    const respostas = respostasIniciais();
    respostas[1] = { status: 500, dados: null, mensagens: [{ codigo: "[Erro-PGDASD-500]", texto: "falha interna" }] };
    await importar(dependencias(clienteFalso(...respostas), INICIAL), acesso, TUDO);
    const nada = clienteFalso();
    for (const { tela, grupos } of AO_ABRIR) {
      assert.deepEqual(await importar(dependencias(nada, DUAS_HORAS_DEPOIS), acesso, { grupos, manual: false }), { estado: "em-dia" }, tela);
    }
    assert.equal(nada.chamadas.length, 0);
  });

  it("só o botão Atualizar do Histórico refaz as listas no mesmo dia: motivo 'manual', declarações [2025, 2026], extratos e pagamentos (o que o banco de desenvolvimento gravou às 18:42)", async () => {
    const { acesso } = await empresa();
    await importar(dependencias(clienteFalso(...respostasIniciais()), INICIAL), acesso, TUDO);
    const botao = clienteFalso(respostasIniciais()[0], respostasIniciais()[1], respostasIniciais()[5]);
    assert.equal((await importar(dependencias(botao, DUAS_HORAS_DEPOIS), acesso, { grupos: ["historico"], manual: true })).estado, "iniciada");
    assert.deepEqual(botao.chamadas.map((c) => c.pedido.idServico), ["CONSDECLARACAO13", "CONSDECLARACAO13", "PAGAMENTOS71"]);
    const imp = await importacaoDaEmpresa(t.banco, acesso, DUAS_HORAS_DEPOIS);
    assert.equal(imp?.motivo, "manual");
    assert.deepEqual(imp?.etapas.map((e) => [e.id, e.anos ?? null]), [["declaracoes", [2025, 2026]], ["extratos", null], ["pagamentos", null]]);
  });

  it("no código: as telas só pedem pelo automático (manual: false); manual: true só nas ações dos botões; Roteiro, Guias e as outras não consultam o histórico ao abrir", () => {
    const APP = path.join(import.meta.dirname, "..", "app");
    const arquivos = (readdirSync(APP, { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f));
    const usam = (padrao: RegExp) => arquivos.filter((f) => padrao.test(readFileSync(path.join(APP, f), "utf8"))).sort();
    assert.deepEqual(usam(/atualizarAoAbrir\(/), ["(painel)/defis/page.tsx", "(painel)/historico/page.tsx", "(painel)/page.tsx", "(painel)/situacao/page.tsx"].map((f) => path.normalize(f)));
    assert.deepEqual(usam(/manual: true/), ["(painel)/historico/acoes.ts", "(painel)/mensagens/acoes.ts"].map((f) => path.normalize(f)));
    // O pedido manual do histórico só sai da ação do botão (form com o clique), nunca de uma página ao abrir.
    assert.deepEqual(usam(/atualizarEmSegundoPlano\(/), [path.normalize("(painel)/historico/acoes.ts")]);
    const painel = readFileSync(path.join(APP, "(painel)", "page.tsx"), "utf8");
    assert.match(painel, /await atualizarAoAbrir\(acesso, \["situacao"\]\)/);
    // atualizarAoAbrir sempre pede o automático, que segue as regras de prazo (prazos.ts).
    const servidor = readFileSync(path.join(import.meta.dirname, "..", "lib", "historico", "servidor.ts"), "utf8");
    assert.equal([...servidor.matchAll(/manual: true/g)].length, 0);
  });
});
