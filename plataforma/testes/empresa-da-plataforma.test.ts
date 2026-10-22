// A empresa da plataforma (o PLATAFORMA_CNPJ, com um dono ADMIN) é gerenciada como qualquer outra e passa por todos os
// fluxos: cadastro, importação do histórico (declarações, extratos, pagamentos, DEFIS e situação fiscal), Caixa Postal,
// rotina do mês (lançar, simular, transmitir o PGDAS-D, gerar o DAS e a guia vencida com juros), DCTFWeb, eSocial,
// botões da guia (comprovante buscado uma vez), avisos e remoção. A única diferença: não tem termo de autorização (é a
// contratante; as chamadas saem com o autor do pedido = contratante e sem token) e, onde a Receita exige a assinatura do
// declarante (DCTFWeb, eSocial), assina no servidor com o certificado da plataforma, que é o e-CNPJ dela.
// Aqui a situação e o contexto vêm do termo de verdade (situacaoTermo/contextoSerpro com o contratante = a empresa),
// como em lib/*/servidor.ts. Nada sai da máquina: o contrato e o eSocial são falsos, com respostas gravadas.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { verificarAssinatura } from "@contabilizadev/nucleo/assinatura";
import { lerPfx } from "@contabilizadev/nucleo/certificado";
import { certificadoDeTeste } from "@contabilizadev/nucleo/certificado-teste";
import { resposta, soap } from "@contabilizadev/nucleo/esocial/respostas-exemplo";
import { INTIMACAO, respostaListaCaixa } from "@contabilizadev/nucleo/serpro/caixa-postal-exemplo";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import type { Transporte } from "@contabilizadev/nucleo/http";
import { criarClienteSerpro, type Resposta } from "@contabilizadev/nucleo/serpro/cliente";
import { pdfComTexto, xmlDctf } from "@contabilizadev/nucleo/serpro/dctf-exemplo";
import { pdfDaDeclaracao, respostaDeclaracoes, respostaDefis, respostaExtrato, respostaProtocolo, respostaRelatorio } from "@contabilizadev/nucleo/serpro/historico-exemplo";
import { empresas, guias, serproChamadas } from "@/banco/esquema";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { avisosDaEmpresa } from "@/lib/avisos/coleta";
import { atualizarCaixaPostal, mensagensDaEmpresa } from "@/lib/caixa-postal/caixa-postal";
import { exigirAcessoEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { CNPJ_RESERVADO } from "@/lib/empresas/cadastro";
import { removerEmpresa } from "@/lib/empresas/remocao";
import { salvarConfigEsocial, type DadosDaConfig } from "@/lib/esocial/configuracao";
import { enviarEsocialPelaPlataforma, type DependenciasEsocial } from "@/lib/esocial/envio";
import { documentoDaEmpresa } from "@/lib/historico/documentos";
import { importar } from "@/lib/historico/importacao";
import { defisDaEmpresa, historicoDaEmpresa, situacaoFiscalDaEmpresa } from "@/lib/historico/leitura";
import { conferirDctfMes, transmitirDctfMes } from "@/lib/rotina/dctfweb";
import type { DependenciasRotina } from "@/lib/rotina/dependencias";
import { respostaDaGuiaDoMes } from "@/lib/rotina/documento-da-guia";
import { buscarGuiaDoMes, entradasDoHistorico, gerarGuia, guiaDoMes } from "@/lib/rotina/guias";
import { simularMes, transmitirMes } from "@/lib/rotina/pgdasd";
import { registroNoBanco } from "@/lib/serpro/registro";
import { informarProLabore, lancarReceita } from "@/lib/rotina/receitas";
import { liberada } from "@/lib/termo/situacao";
import { contextoSerpro, ErroTermoAutorizacao, parametrosDoTermo, situacaoTermo, type DependenciasTermo } from "@/lib/termo/termo";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";
import { cadastrarComprovada, consultarComDados } from "./apoio-empresa";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const em = (iso: string) => new Date(`${iso}-03:00`);
const AGORA = em("2026-10-18T10:00:00"); // apura 09/2026; DAS e DARF vencem em 20/10/2026
const DEPOIS_DO_VENCIMENTO = em("2026-10-26T10:00:00");
const PLATAFORMA = "98765432000198"; // o PLATAFORMA_CNPJ = a empresa do exemplo ti-anexo-iii (6209, Anexo III)
const ADMIN = "admin@plataforma.com";
const PERFIS = { admin: perfil(ADMIN, "sub-admin"), ana: perfil("ana@a.com", "sub-ana") };
const CHAVE = randomBytes(32);
// O certificado da plataforma: o e-CNPJ A1 dela (o mesmo CNPJ), que assina o que a Receita exige do declarante.
const PEM = lerPfx(certificadoDeTeste({ titular: `SUPORTE TI LTDA:${PLATAFORMA}` }));

const ok = (dados: unknown): Resposta => ({ status: 200, dados, mensagens: [{ codigo: "Sucesso", texto: "ok" }] });
const ANTERIORES = {
  "2025-09": 25_228.39, "2025-10": 19_224.3, "2025-11": 27_350.21, "2025-12": 24_655.48, "2026-01": 21_869.17, "2026-02": 25_798.12,
  "2026-03": 37_582, "2026-04": 24_985.4, "2026-05": 45_494.12, "2026-06": 47_400, "2026-07": 26_503.41,
};
const VALORES = [{ codigoTributo: 1001, valor: 78.65 }, { codigoTributo: 1002, valor: 68.81 }, { codigoTributo: 1006, valor: 853.3 }];
const PDF = pdfComTexto("Documento de Arrecadacao", "Valor Total do Documento", "1.000,76").toString("base64");
const DARF = ok({ PDFByteArrayBase64: pdfComTexto("Documento de Arrecadacao", "Valor Total do Documento", "178,31").toString("base64") });
const COMPROVANTE = ok({ pdf: pdfComTexto("Comprovante de Arrecadacao").toString("base64") });

// Pagamentos de 08/2026 (PAGTOWEB): o DAS e o DARF do INSS (receita 1099), pagos fora da plataforma.
const PAGAMENTOS: Resposta = {
  status: 200,
  dados: [
    { numeroDocumento: "7202608000000001", tipo: { codigo: 9, descricao: "DAS" }, periodoApuracao: "2026-08-01", dataArrecadacao: "2026-09-18T00:00:00", valorPrincipal: 1213.55, valorTotal: 1213.55 },
    { numeroDocumento: "7162608000000002", tipo: { codigo: 1, descricao: "DARF" }, receitaPrincipal: { codigo: "1099" }, periodoApuracao: "2026-08-01", dataArrecadacao: "2026-09-08T00:00:00", valorPrincipal: 178.31, valorTotal: 178.31 },
  ],
  mensagens: [],
};

const termo = (): DependenciasTermo => ({ banco: t.banco, chave: CHAVE, cliente: clienteFalso(), contratante: { numero: PLATAFORMA, nome: "SUPORTE TI LTDA" }, adminEmails: [ADMIN], agora: () => AGORA });
const entrar = async (quem: keyof typeof PERFIS) => (await entrarComGoogle(depsLogin(t.banco, PERFIS, { adminEmails: [ADMIN] }), quem)).usuario;

// A empresa da plataforma cadastrada pelo ADMIN (o assistente passa o PLATAFORMA_CNPJ como reservado).
async function daPlataforma() {
  const usuario = await entrar("admin");
  const r = await consultarComDados(t.banco, usuario, "98.765.432/0001-98", { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-anexo-iii"), cnpjReservado: PLATAFORMA });
  assert.equal(r.tipo, "previa");
  const empresaId = await cadastrarComprovada(t.banco, usuario, r.previa.token, { segredo: SEGREDO, agora: AGORA, cnpjReservado: PLATAFORMA });
  const acesso = await exigirAcessoEmpresa(t.banco, usuario, empresaId);
  return { usuario, empresaId, acesso };
}

// As dependências como o servidor monta (lib/rotina/servidor.ts): o contexto vem do termo de verdade.
const rotina = (acesso: AcessoEmpresa, cliente: DependenciasRotina["cliente"], agora = AGORA): DependenciasRotina => ({
  banco: t.banco,
  cliente,
  contexto: () => contextoSerpro(termo(), acesso),
  certificadoDaPlataforma: () => PEM,
  agora: () => agora,
  log: () => {},
});

// Sem termo e sem token: o autor do pedido é o contratante (o padrão do cliente do contrato) e o contribuinte é a empresa.
function semTermo(cliente: ReturnType<typeof clienteFalso>) {
  assert.ok(cliente.chamadas.length > 0);
  for (const c of cliente.chamadas) {
    assert.equal(c.opcoes.contribuinte.numero, PLATAFORMA);
    assert.equal(c.opcoes.autorPedidoDados, undefined, c.pedido.idServico);
    assert.equal(c.opcoes.tokenProcurador, undefined, c.pedido.idServico);
  }
}

// Histórico da Receita: 08/2026 declarado e pago fora da plataforma; DEFIS e situação fiscal.
async function comHistorico() {
  const e = await daPlataforma();
  const cliente = clienteFalso(
    respostaDeclaracoes(2025, []),
    respostaDeclaracoes(2026, [
      { pa: "2026-08", declaracoes: [{ numero: "98765432202608001", quando: "20260905100000" }], das: [{ numero: "07202608000000001", quando: "20260905100100", pago: true }] },
    ]),
    respostaExtrato("07202608000000001", { pa: "2026-08", receita: 26_908.25, anteriores: ANTERIORES }),
    PAGAMENTOS,
    respostaDefis(pdfComTexto("DEFIS 2025").toString("base64")),
    respostaProtocolo,
    respostaRelatorio(),
  );
  const d = { ...rotina(e.acesso, cliente), esperar: async () => {} };
  assert.equal((await importar(d as Parameters<typeof importar>[0], e.acesso, { grupos: ["historico", "defis", "situacao"], manual: false })).estado, "iniciada");
  return { ...e, cliente };
}

describe("empresa da plataforma: cadastro e autorização sem termo", () => {
  it("só um ADMIN cadastra o PLATAFORMA_CNPJ; a empresa fica 'propria' (autorizada, sem termo), com o contexto do contratante", async () => {
    const ana = await entrar("ana");
    await assert.rejects(consultarComDados(t.banco, ana, "98.765.432/0001-98", { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-anexo-iii"), cnpjReservado: PLATAFORMA }), { message: CNPJ_RESERVADO });
    const { acesso } = await daPlataforma();
    const situacao = await situacaoTermo(termo(), acesso);
    assert.equal(situacao.estado, "propria");
    assert.equal(liberada(situacao), true);
    assert.deepEqual(await contextoSerpro(termo(), acesso), { contribuinte: { numero: PLATAFORMA, tipo: 2 } });
    // A única diferença: não há termo para assinar.
    await assert.rejects(parametrosDoTermo(termo(), acesso), (e: Error) => e instanceof ErroTermoAutorizacao && e.motivo === "propria");
    // Avisos: nada de "assine a autorização".
    const avisos = await avisosDaEmpresa(t.banco, acesso, AGORA, { termo: situacao, log: () => {} });
    assert.ok(!avisos.some((a) => a.link?.href === "/autorizacao"), JSON.stringify(avisos));
  });
});

describe("empresa da plataforma: todos os fluxos, como as outras", () => {
  it("importação do histórico, DEFIS e situação fiscal; Caixa Postal", async () => {
    const { acesso, cliente } = await comHistorico();
    assert.deepEqual(
      cliente.chamadas.map((c) => c.pedido.idServico),
      ["CONSDECLARACAO13", "CONSDECLARACAO13", "CONSEXTRATO16", "PAGAMENTOS71", "CONSULTIMADECREC143", "SOLICITARPROTOCOLO91", "RELATORIOSITFIS92"],
    );
    semTermo(cliente);
    const meses = await historicoDaEmpresa(t.banco, acesso, AGORA, null);
    assert.deepEqual(meses.find((m) => m.pa === "2026-08")?.situacao, "pago");
    assert.equal((await situacaoFiscalDaEmpresa(t.banco, acesso)).atual?.regular, true);
    assert.deepEqual((await defisDaEmpresa(t.banco, acesso)).map((d) => [d.ano, d.situacao]), [[2025, "entregue"]]);

    const caixa = clienteFalso(respostaListaCaixa([INTIMACAO]));
    await atualizarCaixaPostal(rotina(acesso, caixa), acesso, { manual: true });
    assert.equal((await mensagensDaEmpresa(t.banco, acesso)).length, 1);
    semTermo(caixa);
  });

  it("rotina do mês: lançar, simular, transmitir o PGDAS-D, gerar o DAS e, vencido, a guia com multa e juros", async () => {
    const { acesso, usuario } = await comHistorico();
    assert.ok((await lancarReceita(rotina(acesso, null), acesso, { pa: "2026-09", recebidaEm: "2026-10-05", moeda: "BRL", valorMoeda: 23_000, usuarioId: usuario.id })).ok);
    const cliente = clienteFalso(
      ok([{ valoresDevidos: VALORES }]),
      ok([{ idDeclaracao: "98765432202609001", valoresDevidos: VALORES, declaracao: pdfDaDeclaracao({ pa: "2026-09", receita: 23_000 }), recibo: pdfComTexto("Recibo").toString("base64") }]),
      ok([{ pdf: PDF, detalhamento: { numeroDocumento: "07202609000000009", dataVencimento: "20261020", valores: { principal: 1000.76, total: 1000.76 } } }]),
    );
    const d = rotina(acesso, cliente);
    const sim = await simularMes(d, acesso, "2026-09", { retificar: false, usuarioId: usuario.id });
    assert.ok(sim.ok && sim.bateu, JSON.stringify(sim));
    const tr = await transmitirMes(d, acesso, "2026-09", { retificar: false, confirmado: true, confirmacao: { receita: 23_000, total: 1000.76 } });
    assert.ok(tr.ok, JSON.stringify(tr));
    assert.equal(cliente.chamadas[1].opcoes.confirmado, true);
    const das = await gerarGuia(d, acesso, "2026-09", "DAS");
    assert.ok(das.ok && das.guia.total === 1000.76);
    semTermo(cliente);

    // Vencido e sem pagamento: a guia com multa e juros para o dia escolhido.
    const vencida = clienteFalso(ok([{ pdf: PDF, detalhamento: { numeroDocumento: "07202609000000010", dataVencimento: "20261027", valores: { principal: 1000.76, multa: 20.02, juros: 10, total: 1030.78 } } }]));
    const r = await gerarGuia(rotina(acesso, vencida, DEPOIS_DO_VENCIMENTO), acesso, "2026-09", "DAS", { pagarEm: "2026-10-27" });
    assert.ok(r.ok && r.guia.total === 1030.78 && r.guia.pagarEm === "2026-10-27");
    assert.deepEqual(vencida.chamadas[0].pedido.dados, { periodoApuracao: "202609", dataConsolidacao: "20261027" });
    semTermo(vencida);
  });

  it("DCTFWeb: assinada no servidor com o certificado da plataforma (o e-CNPJ da própria empresa), com confirmação; o DARF sai", async () => {
    const { acesso } = await daPlataforma();
    const cliente = clienteFalso(ok({ XMLStringBase64: Buffer.from(xmlDctf(), "utf8").toString("base64") }), ok({ numeroRecibo: "50000534643844" }), DARF);
    const d = rotina(acesso, cliente);
    await informarProLabore(d, acesso, { mes: "2026-09", valor: 1_621 });
    assert.ok((await conferirDctfMes(d, acesso, "2026-09")).ok);
    assert.deepEqual(await transmitirDctfMes(d, acesso, "2026-09", { confirmado: true, confirmacao: { aPagar: 178.31 } }), { ok: true, recibo: "50000534643844" });
    const enviado = Buffer.from((cliente.chamadas[1].pedido.dados as { xmlAssinadoBase64: string }).xmlAssinadoBase64, "base64").toString("utf8");
    assert.equal(verificarAssinatura(enviado, PEM.certificado), true);
    const g = await gerarGuia(d, acesso, "2026-09", "INSS");
    assert.ok(g.ok && g.guia.total === 178.31);
    semTermo(cliente);
  });

  it("eSocial: o pró-labore assinado no servidor com o certificado da plataforma, com a mesma confirmação", async () => {
    const { acesso } = await daPlataforma();
    const CONFIG: DadosDaConfig = {
      cpf: "529.982.247-25", categoria: "723", matricula: "1", lotacao: "1", tabRubrica: "0001", rubricaProLabore: "100", rubricaInss: "843", qtdProLabore: "220.00", diaPagamento: 5, pagamentoNoMes: "seguinte",
    };
    assert.ok((await salvarConfigEsocial({ banco: t.banco, agora: () => AGORA }, acesso, CONFIG)).ok);
    assert.ok((await informarProLabore({ banco: t.banco, agora: () => AGORA }, acesso, { mes: "2026-09", valor: 1_621 })).ok);
    const chamadas: string[] = [];
    const ws = {
      async chamar(_servico: string, _ambiente: string, conteudo: string) {
        chamadas.push(conteudo);
        return resposta(soap(`<retornoEnvioLoteEventos><status><cdResposta>201</cdResposta><descResposta>Lote Recebido com Sucesso.</descResposta></status><dadosRecepcaoLote><protocoloEnvio>1.2.202610.0000000000000000001</protocoloEnvio></dadosRecepcaoLote></retornoEnvioLoteEventos>`));
      },
      async consultasRestantes() {
        return 10;
      },
    } as unknown as NonNullable<DependenciasEsocial["cliente"]>;
    // Como lib/esocial/servidor.ts: "propria" vem da situação do termo.
    const propria = (await situacaoTermo(termo(), acesso)).estado === "propria";
    const d: DependenciasEsocial = { banco: t.banco, cliente: ws, transmissor: "11444777000161", propria, certificadoDaPlataforma: () => PEM, agora: () => AGORA, log: () => {} };
    assert.deepEqual(await enviarEsocialPelaPlataforma(d, acesso, "2026-09", { confirmado: true, confirmacao: { proLabore: 1621 } }), { ok: true, estado: "aguardando" });
    const eventos = [...chamadas[0].matchAll(/<evento Id="[^"]+">(<eSocial[\s\S]*?<\/eSocial>)<\/evento>/g)].map((m) => m[1]);
    assert.ok(eventos.length > 0);
    for (const xml of eventos) assert.equal(verificarAssinatura(xml, PEM.certificado), true);
  });

  it("botões da guia: o mês pago fora da plataforma busca o comprovante na Receita uma vez (registrado com o custo) e guarda", async () => {
    const { acesso } = await comHistorico();
    const das = await guiaDoMes(t.banco, acesso, "2026-08", "DAS", AGORA);
    assert.deepEqual([das.paga, das.original, das.pagamento?.numero], [true, null, "7202608000000001"]);
    const inss = await guiaDoMes(t.banco, acesso, "2026-08", "INSS", AGORA);
    assert.deepEqual([inss.paga, inss.pagaEm, inss.pagamento?.valor], [true, "2026-09-08", 178.31]);

    const cliente = clienteFalso(COMPROVANTE, COMPROVANTE);
    const d = rotina(acesso, cliente);
    const r = await buscarGuiaDoMes(d, acesso, "2026-08", "DAS");
    assert.ok(r.ok && r.nova && r.comprovante);
    assert.deepEqual(cliente.chamadas[0].pedido, { idSistema: "PAGTOWEB", idServico: "COMPARRECADACAO72", versaoSistema: "1.0", dados: { numeroDocumento: "7202608000000001" } });
    // Banco primeiro: a segunda vez não chama.
    const de_novo = await buscarGuiaDoMes(d, acesso, "2026-08", "DAS");
    assert.ok(de_novo.ok && !de_novo.nova && r.ok && de_novo.guia.id === r.guia.id);
    assert.ok((await buscarGuiaDoMes(d, acesso, "2026-08", "INSS")).ok);
    assert.equal(cliente.chamadas.length, 2);
    semTermo(cliente);
    assert.equal((await documentoDaEmpresa(t.banco, acesso, "guia", r.ok ? r.guia.id : ""))?.nome, "comprovante-das-2026-08.pdf");
  });

  it("cliente real do núcleo (transporte falso): o comprovante buscado fica em serpro_chamadas com o custo de emissão", async () => {
    const { acesso } = await comHistorico();
    const respostas = [
      { status: 200, texto: JSON.stringify({ access_token: "acesso", jwt_token: "jwt", expires_in: 3600 }) },
      { status: 200, texto: JSON.stringify({ status: 200, dados: JSON.stringify({ pdf: pdfComTexto("Comprovante").toString("base64") }), mensagens: [] }) },
    ];
    const corpos: string[] = [];
    const transporte: Transporte = async (_url, _cabecalhos, corpo) => {
      corpos.push(corpo);
      return respostas.shift()!;
    };
    const cliente = criarClienteSerpro({
      consumerKey: "chave", consumerSecret: "segredo", certificado: { pfx: Buffer.from("pfx"), senha: "x" }, contratante: PLATAFORMA,
      limitePorPeriodo: 40, registro: registroNoBanco(t.banco), transporte, agora: () => AGORA,
    });
    const r = await buscarGuiaDoMes(rotina(acesso, cliente), acesso, "2026-08", "INSS");
    assert.ok(r.ok && r.comprovante, JSON.stringify(r));
    // Contratante, autor do pedido e contribuinte: a própria plataforma.
    const corpo = JSON.parse(corpos[1]);
    assert.deepEqual([corpo.contratante.numero, corpo.autorPedidoDados.numero, corpo.contribuinte.numero], [PLATAFORMA, PLATAFORMA, PLATAFORMA]);
    const registradas = (await t.banco.select().from(serproChamadas)).filter((c) => c.servico === "PAGTOWEB/COMPARRECADACAO72");
    assert.deepEqual(registradas.map((c) => [c.acao, c.status, c.custo, c.empresaId]), [["Emitir", 200, 0.32, acesso.empresaId]]);
    assert.match(registradas[0].finalidade, /comprovante de arrecadação do documento pago 7162608000000002/);
  });

  it("remoção: a empresa da plataforma é removida como as outras", async () => {
    const { acesso, usuario, empresaId } = await comHistorico();
    void acesso;
    const r = await removerEmpresa(t.banco, { sessaoId: "00000000-0000-0000-0000-000000000000", usuario }, empresaId, PLATAFORMA, { log: () => {} });
    assert.ok(r, JSON.stringify(r));
    assert.equal((await t.banco.select().from(empresas).where(eq(empresas.id, empresaId))).length, 0);
    assert.equal((await t.banco.select().from(guias)).length, 0);
    // O gasto com a Receita fica, anonimizado.
    const linhas = await t.banco.select().from(serproChamadas);
    assert.ok(linhas.every((l) => l.empresaId === null && l.contribuinte === null));
  });
});

describe("rota dos botões da guia (/documentos/guia-do-mes/<tipo>/<mês>)", () => {
  it("busca uma vez e devolve o PDF (abrir ou baixar); o Histórico passa a apontar para o guardado", async () => {
    const { acesso } = await comHistorico();
    const historico = await historicoDaEmpresa(t.banco, acesso, AGORA, null);
    const antes = (await entradasDoHistorico(t.banco, acesso, historico, true)).get("2026-08");
    assert.deepEqual(antes && [antes.situacao, antes.guardada, antes.pagamento, antes.referencia], ["pago", null, "7202608000000001", "98765432202608001"]);
    assert.equal((await entradasDoHistorico(t.banco, acesso, historico, true)).has("2026-05"), false); // não declarado: sem guia

    const cliente = clienteFalso(COMPROVANTE);
    const d = { ...rotina(acesso, cliente), autorizada: true };
    const abrir = await respostaDaGuiaDoMes(d, acesso, { tipo: "DAS", pa: "2026-08", baixar: false, deOutroSite: false });
    assert.equal(abrir.status, 200);
    assert.equal(abrir.headers.get("content-type"), "application/pdf");
    assert.equal(abrir.headers.get("content-disposition"), 'inline; filename="comprovante-das-2026-08.pdf"');
    assert.match(Buffer.from(await abrir.arrayBuffer()).toString("latin1"), /^%PDF/);
    const baixar = await respostaDaGuiaDoMes(d, acesso, { tipo: "DAS", pa: "2026-08", baixar: true, deOutroSite: false });
    assert.equal(baixar.headers.get("content-disposition"), 'attachment; filename="comprovante-das-2026-08.pdf"');
    assert.equal(cliente.chamadas.length, 1);
    const depois = (await entradasDoHistorico(t.banco, acesso, historico, true)).get("2026-08");
    assert.ok(depois?.guardada);
  });

  it("de outro site ou sem autorização: só o que já está no banco, sem chamar a Receita; pedido inválido é 404", async () => {
    const { acesso } = await comHistorico();
    const cliente = clienteFalso();
    const d = { ...rotina(acesso, cliente), autorizada: true };
    const cruzado = await respostaDaGuiaDoMes(d, acesso, { tipo: "DAS", pa: "2026-08", baixar: false, deOutroSite: true });
    assert.equal(cruzado.status, 409);
    assert.match(cruzado.headers.get("content-type")!, /text\/html/);
    assert.match(await cruzado.text(), /Abra a guia pelo painel da plataforma/);
    const semAutorizacao = await respostaDaGuiaDoMes({ ...d, autorizada: false }, acesso, { tipo: "INSS", pa: "2026-08", baixar: false, deOutroSite: false });
    assert.match(await semAutorizacao.text(), /Disponível depois da autorização da empresa/);
    for (const [tipo, pa] of [["XYZ", "2026-08"], ["DAS", "2026-13"], ["DAS", "2026-10"], ["DAS", "<script>"]]) {
      assert.equal((await respostaDaGuiaDoMes(d, acesso, { tipo, pa, baixar: false, deOutroSite: false })).status, 404, `${tipo} ${pa}`);
    }
    assert.equal(cliente.chamadas.length, 0);
  });

  it("vencida sem a original: não há serviço que devolva a original; a página diz para gerar com multa e juros", async () => {
    const { acesso, usuario } = await comHistorico();
    await lancarReceita(rotina(acesso, null), acesso, { pa: "2026-09", recebidaEm: "2026-10-05", moeda: "BRL", valorMoeda: 23_000, usuarioId: usuario.id });
    const declarar = clienteFalso(
      ok([{ valoresDevidos: VALORES }]),
      ok([{ idDeclaracao: "98765432202609001", valoresDevidos: VALORES, declaracao: pdfDaDeclaracao({ pa: "2026-09", receita: 23_000 }), recibo: pdfComTexto("Recibo").toString("base64") }]),
    );
    assert.ok((await simularMes(rotina(acesso, declarar), acesso, "2026-09", { retificar: false })).ok);
    assert.ok((await transmitirMes(rotina(acesso, declarar), acesso, "2026-09", { retificar: false, confirmado: true, confirmacao: { receita: 23_000, total: 1000.76 } })).ok);
    const cliente = clienteFalso();
    const r = await respostaDaGuiaDoMes({ ...rotina(acesso, cliente, DEPOIS_DO_VENCIMENTO), autorizada: true }, acesso, { tipo: "DAS", pa: "2026-09", baixar: false, deOutroSite: false });
    assert.equal(r.status, 409);
    assert.match(await r.text(), /A guia original venceu e não vale mais/);
    assert.equal(cliente.chamadas.length, 0);
  });
});
