// Parte 7, passo 20: o pró-labore no eSocial de ponta a ponta, contra o banco de teste, com a empresa cadastrada pela Parte
// 3 e o pró-labore lançado na rotina da Parte 6. Nada sai da máquina: o eSocial é um transporte falso com respostas no
// formato do MOD v1.16 (as gravadas do ../fiscal anonimizadas, nucleo/src/esocial/respostas-exemplo.ts) e o cliente
// assina no "navegador" com o assinador único (lib/assinador), o e-CNPJ A1 de teste gerado na hora e a chave importada no
// WebCrypto como não exportável. Confere: importação dos cadastros (identificadores + download, assinados pelo cliente,
// limites do eSocial), formulário, envio mensal (lote com o transmissor = plataforma e o empregador = cliente, eventos
// assinados pelo cliente e válidos no esquema oficial), lotes em ordem, confirmação, idempotência (duplo clique, original
// único, sem resposta repetido com os mesmos eventos, duas consultas ao mesmo tempo), recusa, mês parado no meio,
// retificação explícita, a DCTFWeb transmitida pelo fechamento (sem transmitir duas vezes nem deixar de transmitir) e o
// DARF, a empresa da própria plataforma, o registro das chamadas, isolamento e a remoção da empresa.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { IDBFactory } from "fake-indexeddb";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { verificarAssinatura } from "@contabilizadev/nucleo/assinatura";
import { lerPfx } from "@contabilizadev/nucleo/certificado";
import { certificadoDeTeste, certificadoIcpDeTeste } from "@contabilizadev/nucleo/certificado-teste";
import { validarAssinado } from "@contabilizadev/nucleo/esocial/folha";
import {
  CONSULTA_AGUARDANDO,
  DOWNLOAD_DO_SOCIO,
  ENVIO_ACEITO,
  ENVIO_RECUSADO,
  IDENTIFICADORES_DO_SOCIO,
  OCORRENCIA_GRAVADA,
  consultaProcessada,
  resposta,
  soap,
  type ResultadoFalso,
} from "@contabilizadev/nucleo/esocial/respostas-exemplo";
import { criarClienteEsocial, type RespostaEsocial, type Servico } from "@contabilizadev/nucleo/esocial/ws";
import type { TipoEsquema } from "@contabilizadev/nucleo/esocial/validar";
import type { Transporte } from "@contabilizadev/nucleo/http";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import { cnpj, type Resposta } from "@contabilizadev/nucleo/serpro/cliente";
import { pdfComTexto, xmlDctf } from "@contabilizadev/nucleo/serpro/dctf-exemplo";
import { pemDoCertificado } from "@contabilizadev/nucleo/serpro/termo-autorizacao";
import { dctfwebEnvios, esocialChamadas, esocialConfig, esocialEnvios, esocialEventos, esocialPedidos } from "@/banco/esquema";
import { assinanteDoArquivo, type Assinante } from "@/lib/assinador/assinador";
import { cofreDoNavegador } from "@/lib/assinador/cofre";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { removerEmpresa } from "@/lib/empresas/remocao";
import { importarEventos, importarIdentificadores, importarPelaPlataforma, prepararImportacao, salvarConfigEsocial, type DadosDaConfig } from "@/lib/esocial/configuracao";
import {
  acompanharEnvio,
  enviarEsocialAssinado,
  enviarEsocialPelaPlataforma,
  marcarFeitoNoPortal,
  motivoParaNaoEnviar,
  pendenciaDoMes,
  prepararEnvioEsocial,
  repetirEnvioEsocial,
  situacaoEsocial,
  type DependenciasEsocial,
} from "@/lib/esocial/envio";
import { MENSAGENS_DO_ESOCIAL, mensagemSemDemonstrativo } from "@/lib/esocial/mensagens";
import { registroEsocialNoBanco } from "@/lib/esocial/registro";
import { conferirDctfMes, motivoParaNaoTransmitirDctf, situacaoDctf, transmitirDctfMes } from "@/lib/rotina/dctfweb";
import type { DependenciasRotina } from "@/lib/rotina/dependencias";
import { gerarGuia } from "@/lib/rotina/guias";
import { MENSAGENS_DA_ROTINA } from "@/lib/rotina/mensagens";
import { informarProLabore } from "@/lib/rotina/receitas";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";
import { cadastrarComprovada, consultarComDados } from "./apoio-empresa";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const em = (iso: string) => new Date(`${iso}-03:00`);
const AGORA = em("2026-10-19T10:00:00"); // 09/2026 encerrado; prazo do eSocial de 09 foi 15/10
const NOVEMBRO = em("2026-11-17T10:00:00"); // 10/2026 encerrado
const SUPORTE = "98765432000198"; // exemplo ti-anexo-iii
const OUTRA = "12345678000195"; // exemplo ti-fator-r
const PLATAFORMA = "11444777000161"; // o transmissor (CNPJ do certificado da plataforma)
const PERFIS = { ana: perfil("ana@a.com", "sub-ana"), beto: perfil("beto@b.com", "sub-beto") };
const CPF = "52998224725";
const CONFIG: DadosDaConfig = {
  cpf: "529.982.247-25",
  categoria: "723",
  matricula: "1",
  lotacao: "1",
  tabRubrica: "0001",
  rubricaProLabore: "100",
  rubricaInss: "843",
  qtdProLabore: "220.00",
  diaPagamento: 5,
  pagamentoNoMes: "seguinte",
};

// O e-CNPJ A1 da empresa (de teste, gerado na hora) e o de outra empresa.
const E_CNPJ = certificadoIcpDeTeste({ tipo: "PJ", numero: SUPORTE, nome: "SUPORTE TI LTDA", validoDe: new Date("2026-01-01") });
const DE_OUTRA = certificadoIcpDeTeste({ tipo: "PJ", numero: OUTRA, nome: "OUTRA LTDA", validoDe: new Date("2026-01-01") });

// O "navegador": "Usar só agora" (o .pfx e a senha abertos em memória, a chave importada no WebCrypto como não exportável).
const navegador = (certificado = E_CNPJ, numero = SUPORTE, agora = AGORA): Promise<Assinante> =>
  assinanteDoArquivo({ pfx: new Uint8Array(certificado.pfx), senha: certificado.senha, cnpjEmpresa: numero, agora, guardar: false, cofre: cofreDoNavegador(new IDBFactory()) });

async function empresa(quem: "ana" | "beto" = "ana", exemplo: "ti-anexo-iii" | "ti-fator-r" = "ti-anexo-iii") {
  const usuario = (await entrarComGoogle(depsLogin(t.banco, PERFIS), quem)).usuario;
  const numero = exemplo === "ti-anexo-iii" ? "98.765.432/0001-98" : "12.345.678/0001-95";
  const r = await consultarComDados(t.banco, usuario, numero, { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo(exemplo) });
  assert.equal(r.tipo, "previa");
  const empresaId = await cadastrarComprovada(t.banco, usuario, r.previa.token, { segredo: SEGREDO, agora: AGORA });
  return { usuario, empresaId, acesso: await exigirAcessoEmpresa(t.banco, usuario, empresaId) };
}

// O eSocial falso: cada chamada recebe a próxima resposta (ou função que monta a resposta na hora, ou erro de rede).
type Saida = RespostaEsocial | Error | (() => Promise<RespostaEsocial> | RespostaEsocial);
function esocialFalso(...saidas: Saida[]) {
  const chamadas: { servico: Servico; conteudo: string; finalidade: string }[] = [];
  const falso = {
    chamadas,
    restantes: 10,
    fila: saidas,
    async chamar(servico: Servico, _ambiente: string, conteudo: string, finalidade: string) {
      chamadas.push({ servico, conteudo, finalidade });
      const s = falso.fila.shift();
      if (!s) throw new Error("Chamada não esperada pelo teste.");
      if (s instanceof Error) throw s;
      return typeof s === "function" ? await s() : s;
    },
    async consultasRestantes() {
      return falso.restantes;
    },
  };
  return falso;
}

const PEM_DA_PLATAFORMA = lerPfx(certificadoDeTeste({ titular: `SUPORTE TI LTDA:${SUPORTE}` }));

function dependencias(cliente: DependenciasEsocial["cliente"], o: { agora?: Date; propria?: boolean; log?: string[] } = {}): DependenciasEsocial {
  return {
    banco: t.banco,
    cliente,
    transmissor: cliente ? PLATAFORMA : null,
    propria: o.propria,
    certificadoDaPlataforma: () => PEM_DA_PLATAFORMA,
    agora: () => o.agora ?? AGORA,
    log: (m) => void o.log?.push(m),
  };
}

// Os eventos do lote N do último envio (os Ids que o eSocial devolve na consulta).
async function idsDoLote(lote: number) {
  const eventos = await t.banco.select().from(esocialEventos).where(eq(esocialEventos.lote, lote));
  return eventos.filter((e) => !["descartado"].includes(e.estado)).sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime() || a.idEvento.localeCompare(b.idEvento));
}
const aceitos = (lote: number, extra: Partial<ResultadoFalso> = {}) => async () =>
  resposta(consultaProcessada((await idsDoLote(lote)).filter((e) => e.estado === "enviado").map((e) => ({ id: e.idEvento, ...extra }))));

const PROTOCOLO = (n: number) =>
  soap(`<retornoEnvioLoteEventos><status><cdResposta>201</cdResposta><descResposta>Lote Recebido com Sucesso.</descResposta></status><dadosRecepcaoLote><protocoloEnvio>1.2.202610.000000000000000${n}</protocoloEnvio></dadosRecepcaoLote></retornoEnvioLoteEventos>`);

// O cliente: o servidor prepara, o navegador assina cada evento e o servidor envia (com a confirmação).
async function assinarEEnviar(d: DependenciasEsocial, acesso: AcessoEmpresa, mes = "2026-09", o: { retificar?: boolean; assinante?: Assinante; proLabore?: number; dtPgto?: string } = {}) {
  const a = o.assinante ?? (await navegador(E_CNPJ, SUPORTE, d.agora?.()));
  const p = await prepararEnvioEsocial(d, acesso, mes, { certificado: a.info.certificadoBase64, retificar: o.retificar, dtPgto: o.dtPgto });
  assert.ok(p.ok, JSON.stringify(p));
  if (!p.ok) throw new Error();
  const assinaturas = await Promise.all(p.assinaturas.map(async (x) => ({ idEvento: x.idEvento, valor: await a.assinar(x.signedInfo) })));
  const r = await enviarEsocialAssinado(d, acesso, mes, { envioId: p.envioId, assinaturas, confirmado: true, confirmacao: { proLabore: o.proLabore ?? p.resumo.proLabore } });
  return { p, r, a };
}

// Os eventos de um lote enviado (o <eSocial> de cada <evento>).
const eventosDoLote = (lote: string) => [...lote.matchAll(/<evento Id="([^"]+)">(<eSocial[\s\S]*?<\/eSocial>)<\/evento>/g)].map((m) => ({ id: m[1], xml: m[2] }));
const tipoDo = (xml: string) => xml.match(/<(evt[A-Za-z]+) /)![1] as TipoEsquema;

async function prontaParaEnviar(proLabore = 1_621) {
  const e = await empresa();
  assert.ok((await salvarConfigEsocial({ banco: t.banco, agora: () => AGORA }, e.acesso, CONFIG)).ok);
  assert.ok((await informarProLabore({ banco: t.banco, agora: () => AGORA }, e.acesso, { mes: "2026-09", valor: proLabore })).ok);
  return e;
}

describe("cadastros do eSocial por empresa: importados do eSocial ou no formulário", () => {
  it("importa do eSocial com a assinatura do cliente: identificadores e download (respostas gravadas) viram os cadastros", async () => {
    const { acesso, usuario } = await empresa();
    const ws = esocialFalso(resposta(IDENTIFICADORES_DO_SOCIO), resposta(DOWNLOAD_DO_SOCIO));
    const d = dependencias(ws);
    const a = await navegador();
    const p1 = await prepararImportacao(d, acesso, { cpf: "529.982.247-25", mes: "2026-09", certificado: a.info.certificadoBase64 });
    assert.ok(p1.ok, JSON.stringify(p1));
    if (!p1.ok) return;
    const r1 = await importarIdentificadores(d, acesso, { pedidoId: p1.pedidoId, assinatura: await a.assinar(p1.signedInfo) });
    assert.ok(r1.ok && r1.achados === 2 && r1.download, JSON.stringify(r1));
    if (!r1.ok || !r1.download) return;
    // O pedido saiu assinado com o e-CNPJ do cliente, a janela de outubro (eventos de setembro) em hora de Brasília.
    const pem = pemDoCertificado(a.info.certificadoBase64);
    assert.equal(verificarAssinatura(ws.chamadas[0].conteudo, pem), true);
    assert.match(ws.chamadas[0].conteudo, /<nrInsc>98765432<\/nrInsc>.*<cpfTrab>52998224725<\/cpfTrab><dtIni>2026-10-01T00:00:00<\/dtIni><dtFim>2026-10-19T08:50:00<\/dtFim>/);
    const r2 = await importarEventos(d, acesso, { pedidoId: r1.download.pedidoId, assinatura: await a.assinar(r1.download.signedInfo), usuarioId: usuario.id });
    assert.ok(r2.ok, JSON.stringify(r2));
    assert.equal(verificarAssinatura(ws.chamadas[1].conteudo, pem), true);
    assert.match(ws.chamadas[1].conteudo, /<id>ID1112223330000002026100513275300001<\/id><id>ID1112223330000002026100513275500002<\/id>/);
    const [config] = await t.banco.select().from(esocialConfig);
    assert.deepEqual(
      [config.cpf, config.categoria, config.matricula, config.lotacao, config.tabRubrica, config.rubricaProLabore, config.rubricaInss, config.qtdProLabore, config.diaPagamento, config.pagamentoNoMes, config.origem, config.importadoDe],
      [CPF, "723", "1", "1", "0001", "100", "843", "220.00", 5, "seguinte", "importado", "2026-09"],
    );
    // Os eventos baixados ficam guardados: setembro já está no eSocial (enviado pelo contador), nada a enviar.
    const eventos = await t.banco.select().from(esocialEventos);
    assert.deepEqual(eventos.map((e) => [e.tipo, e.mes, e.estado, e.recibo]).sort(), [
      ["evtPgtos", "2026-09", "importado", "1.1.0000000000000000102"],
      ["evtRemun", "2026-09", "importado", "1.1.0000000000000000101"],
    ]);
    assert.ok((await informarProLabore(d, acesso, { mes: "2026-09", valor: 1_621 })).ok);
    const s = await situacaoEsocial(t.banco, acesso, "2026-09", AGORA);
    assert.deepEqual([s.concluido, s.remuneracao?.valores], [true, { proLabore: 1621, inss: 178.31, liquido: 1442.69 }]);
    assert.equal(motivoParaNaoEnviar(s, AGORA), MENSAGENS_DO_ESOCIAL.jaEnviado);
    // O mesmo pedido não serve duas vezes; nada mais foi chamado.
    assert.deepEqual(await importarEventos(d, acesso, { pedidoId: r1.download.pedidoId, assinatura: await a.assinar(r1.download.signedInfo) }), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.pedidoVencido });
    assert.equal(ws.chamadas.length, 2);
  });

  it("respeita os limites do eSocial e só aceita o e-CNPJ da própria empresa; nada achado = formulário", async () => {
    const { acesso } = await empresa();
    const ws = esocialFalso(resposta(soap("<status><cdResposta>406</cdResposta><descResposta>Não foram encontrados registros</descResposta></status>")));
    const a = await navegador();
    const pedido = (d: DependenciasEsocial, certificado = a.info.certificadoBase64, mes = "2026-09") => prepararImportacao(d, acesso, { cpf: CPF, mes, certificado });
    // Do dia 1 ao 7 o eSocial não aceita consultas; com menos de 2 consultas no dia, não começa.
    assert.deepEqual(await pedido(dependencias(ws, { agora: em("2026-10-07T10:00:00") })), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.diasUmASete });
    ws.restantes = 1;
    assert.deepEqual(await pedido(dependencias(ws)), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.limiteDoDia });
    ws.restantes = 10;
    const outra = await navegador(DE_OUTRA, OUTRA);
    const recusado = await pedido(dependencias(ws), outra.info.certificadoBase64);
    assert.equal(recusado.ok, false);
    assert.deepEqual(await prepararImportacao(dependencias(ws), acesso, { cpf: "111.111.111-11", mes: "2026-09", certificado: a.info.certificadoBase64 }), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.cpfInvalido });
    // Outubro ainda não venceu (prazo 15/11): não dá para procurar.
    assert.equal((await pedido(dependencias(ws), a.info.certificadoBase64, "2026-10")).ok, false);
    // Sem o certificado da plataforma: indisponível.
    assert.deepEqual(await pedido(dependencias(null)), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.indisponivel });
    const p = await pedido(dependencias(ws));
    assert.ok(p.ok);
    if (!p.ok) return;
    // Assinatura de outra chave não confere: nada é chamado.
    assert.deepEqual(await importarIdentificadores(dependencias(ws), acesso, { pedidoId: p.pedidoId, assinatura: await outra.assinar(p.signedInfo) }), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.assinaturaInvalida });
    assert.equal(ws.chamadas.length, 0);
    assert.deepEqual(await importarIdentificadores(dependencias(ws), acesso, { pedidoId: p.pedidoId, assinatura: await a.assinar(p.signedInfo) }), { ok: true, achados: 0, download: null });
    assert.equal((await t.banco.select().from(esocialConfig)).length, 0);
  });

  it("formulário: confere cada campo (com a mensagem) e grava; salvar de novo atualiza", async () => {
    const { acesso } = await empresa();
    const d = { banco: t.banco, agora: () => AGORA };
    const ruim = await salvarConfigEsocial(d, acesso, { ...CONFIG, cpf: "123", categoria: "72", rubricaInss: "100", diaPagamento: 32, qtdProLabore: "abc" });
    assert.equal(ruim.ok, false);
    assert.deepEqual(Object.keys(!ruim.ok && "erros" in ruim ? ruim.erros : {}).sort(), ["categoria", "cpf", "diaPagamento", "qtdProLabore", "rubricaInss"]);
    assert.ok((await salvarConfigEsocial(d, acesso, CONFIG)).ok);
    assert.ok((await salvarConfigEsocial(d, acesso, { ...CONFIG, diaPagamento: 10, qtdProLabore: null })).ok);
    const linhas = await t.banco.select().from(esocialConfig);
    assert.deepEqual(linhas.map((l) => [l.cpf, l.diaPagamento, l.qtdProLabore, l.origem]), [[CPF, 10, null, "formulario"]]);
  });
});

describe("envio do mês: o cliente assina no navegador, a plataforma transmite com o próprio certificado", () => {
  it("S-1200 assinado pelo cliente vai no lote com o transmissor = plataforma; aceito, o S-1299 vai sozinho e o mês fecha", async () => {
    const { acesso } = await prontaParaEnviar();
    const ws = esocialFalso(resposta(PROTOCOLO(1)), resposta(CONSULTA_AGUARDANDO), aceitos(1), resposta(PROTOCOLO(2)), aceitos(2));
    const d = dependencias(ws);
    const { p, r, a } = await assinarEEnviar(d, acesso);
    assert.deepEqual(r, { ok: true, estado: "aguardando" });
    if (!p.ok) return;
    // Sem o S-1200 de agosto no eSocial não há pagamento a informar: S-1200 e o fechamento (com a DCTFWeb).
    assert.deepEqual([p.resumo.eventos, p.resumo.proLabore, p.resumo.inss, p.resumo.pagamento], [["S-1200", "S-1299"], 1621, 178.31, null]);
    assert.deepEqual((await t.banco.select().from(esocialEnvios)).map((e) => e.transDctf), [true]);
    const lote1 = ws.chamadas[0];
    assert.equal(lote1.servico, "enviarLote");
    assert.match(lote1.conteudo, /<ideEmpregador><tpInsc>1<\/tpInsc><nrInsc>98765432<\/nrInsc><\/ideEmpregador><ideTransmissor><tpInsc>1<\/tpInsc><nrInsc>11444777000161<\/nrInsc><\/ideTransmissor>/);
    const pem = pemDoCertificado(a.info.certificadoBase64);
    for (const e of eventosDoLote(lote1.conteudo)) {
      assert.equal(verificarAssinatura(e.xml, pem), true, "assinado pelo e-CNPJ do cliente");
      await validarAssinado(e.xml, tipoDo(e.xml));
    }
    assert.deepEqual(eventosDoLote(lote1.conteudo).map((e) => tipoDo(e.xml)), ["evtRemun"]);
    // Ainda em processamento: consulta de novo depois; aceito: o lote 2 (S-1299) vai sem nova assinatura.
    assert.deepEqual(await acompanharEnvio(d, acesso, p.envioId), { ok: true, estado: "aguardando" });
    assert.deepEqual(await acompanharEnvio(d, acesso, p.envioId), { ok: true, estado: "aguardando" });
    const lote2 = eventosDoLote(ws.chamadas[3].conteudo);
    assert.deepEqual(lote2.map((e) => tipoDo(e.xml)), ["evtFechaEvPer"]);
    assert.match(lote2[0].xml, /<evtRemun>S<\/evtRemun><evtPgtos>N<\/evtPgtos>.*<transDCTFWeb>S<\/transDCTFWeb>/);
    assert.equal(verificarAssinatura(lote2[0].xml, pem), true);
    assert.deepEqual(await acompanharEnvio(d, acesso, p.envioId), { ok: true, estado: "concluido" });
    const s = await situacaoEsocial(t.banco, acesso, "2026-09", AGORA);
    assert.deepEqual([s.concluido, s.fechado, s.remuneracao?.recibo?.startsWith("1.1."), s.envio?.fechadoEm instanceof Date], [true, true, true, true]);
    assert.ok(ws.chamadas.slice(1).every((c, i) => [1, 2, 4].includes(i + 1) ? c.servico === "consultarLote" : true));
    // Concluído: nada mais é enviado.
    const a2 = await navegador();
    assert.deepEqual(await prepararEnvioEsocial(d, acesso, "2026-09", { certificado: a2.info.certificadoBase64 }), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.jaEnviado });
    assert.equal(ws.chamadas.length, 5);
  });

  it("com o S-1200 do mês anterior no eSocial, o S-1210 do pagamento vai no par com o S-1200 (líquido e dia do cadastro)", async () => {
    const { acesso } = await empresa();
    const ws = esocialFalso(resposta(IDENTIFICADORES_DO_SOCIO), resposta(DOWNLOAD_DO_SOCIO), resposta(PROTOCOLO(1)));
    const d = dependencias(ws, { agora: NOVEMBRO });
    const a = await navegador(E_CNPJ, SUPORTE, NOVEMBRO);
    const p1 = await prepararImportacao(d, acesso, { cpf: CPF, mes: "2026-09", certificado: a.info.certificadoBase64 });
    assert.ok(p1.ok);
    if (!p1.ok) return;
    const r1 = await importarIdentificadores(d, acesso, { pedidoId: p1.pedidoId, assinatura: await a.assinar(p1.signedInfo) });
    if (!r1.ok || !r1.download) return assert.fail(JSON.stringify(r1));
    assert.ok((await importarEventos(d, acesso, { pedidoId: r1.download.pedidoId, assinatura: await a.assinar(r1.download.signedInfo) })).ok);
    await informarProLabore(d, acesso, { mes: "2026-10", valor: 2_000 });
    const { p, r } = await assinarEEnviar(d, acesso, "2026-10", { assinante: a });
    assert.ok(r.ok);
    if (!p.ok) return;
    assert.deepEqual([p.resumo.eventos, p.resumo.pagamento], [["S-1200", "S-1210", "S-1299"], { perRef: "2026-09", dtPgto: "2026-10-05", liquido: 1442.69 }]);
    const lote1 = eventosDoLote(ws.chamadas[2].conteudo);
    assert.deepEqual(lote1.map((e) => tipoDo(e.xml)), ["evtRemun", "evtPgtos"]);
    assert.match(lote1[0].xml, /<vrRubr>2000\.00<\/vrRubr>.*<vrRubr>220\.00<\/vrRubr>/);
    assert.match(lote1[1].xml, /<dtPgto>2026-10-05<\/dtPgto><tpPgto>1<\/tpPgto><perRef>2026-09<\/perRef><ideDmDev>092026MENSAL05102026132358<\/ideDmDev><vrLiq>1442\.69<\/vrLiq>/);
  });

  it("confirmação obrigatória e conferida com o pró-labore; assinatura de outra chave e preparo vencido não enviam nada", async () => {
    const { acesso } = await prontaParaEnviar();
    const ws = esocialFalso();
    const d = dependencias(ws);
    const a = await navegador();
    const p = await prepararEnvioEsocial(d, acesso, "2026-09", { certificado: a.info.certificadoBase64 });
    if (!p.ok) return assert.fail(p.mensagem);
    const assinaturas = await Promise.all(p.assinaturas.map(async (x) => ({ idEvento: x.idEvento, valor: await a.assinar(x.signedInfo) })));
    const envio = (o: Partial<Parameters<typeof enviarEsocialAssinado>[3]> = {}, dd = d) =>
      enviarEsocialAssinado(dd, acesso, "2026-09", { envioId: p.envioId, assinaturas, confirmado: true, confirmacao: { proLabore: 1621 }, ...o });
    assert.deepEqual(await envio({ confirmado: false }), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.semConfirmacao });
    assert.deepEqual(await envio({ confirmacao: { proLabore: 1500 } }), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.confirmacaoMudou });
    const outra = await navegador(DE_OUTRA, OUTRA);
    const falsas = await Promise.all(p.assinaturas.map(async (x) => ({ idEvento: x.idEvento, valor: await outra.assinar(x.signedInfo) })));
    assert.deepEqual(await envio({ assinaturas: falsas }), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.assinaturaInvalida });
    // O pró-labore mudou depois de preparar: a confirmação não vale mais.
    await informarProLabore(d, acesso, { mes: "2026-09", valor: 1_700 });
    assert.deepEqual(await envio(), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.confirmacaoMudou });
    await informarProLabore(d, acesso, { mes: "2026-09", valor: 1_621 });
    assert.deepEqual(await envio({}, dependencias(ws, { agora: new Date(AGORA.getTime() + 31 * 60_000) })), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.preparoVencido });
    // Certificado de outra empresa nem chega a ser preparado.
    assert.equal((await prepararEnvioEsocial(d, acesso, "2026-09", { certificado: outra.info.certificadoBase64 })).ok, false);
    assert.equal(ws.chamadas.length, 0);
  });

  it("o mês só vai depois de terminar, com cadastros e pró-labore; sem o certificado da plataforma, fica indisponível", async () => {
    const { acesso } = await empresa();
    const a = await navegador();
    const d = dependencias(esocialFalso());
    const preparar = (mes = "2026-09", dd = d) => prepararEnvioEsocial(dd, acesso, mes, { certificado: a.info.certificadoBase64 });
    assert.deepEqual(await preparar("2026-10"), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.mesAberto });
    assert.deepEqual(await preparar(), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.semConfig });
    await salvarConfigEsocial(d, acesso, CONFIG);
    assert.deepEqual(await preparar(), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.semProLabore });
    await informarProLabore(d, acesso, { mes: "2026-09", valor: 0 });
    assert.deepEqual(await preparar(), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.proLaboreZero });
    await informarProLabore(d, acesso, { mes: "2026-09", valor: 1_621 });
    assert.deepEqual(await preparar("2026-09", dependencias(null)), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.indisponivel });
  });
});

describe("idempotência: duplo clique, um S-1200 original por sócio e mês, envio sem resposta, consultas ao mesmo tempo", () => {
  it("duplo clique (dois envios do mesmo preparo ao mesmo tempo): um lote só", async () => {
    const { acesso } = await prontaParaEnviar();
    const ws = esocialFalso(resposta(PROTOCOLO(1)));
    const d = dependencias(ws);
    const a = await navegador();
    const p = await prepararEnvioEsocial(d, acesso, "2026-09", { certificado: a.info.certificadoBase64 });
    if (!p.ok) return assert.fail(p.mensagem);
    const assinaturas = await Promise.all(p.assinaturas.map(async (x) => ({ idEvento: x.idEvento, valor: await a.assinar(x.signedInfo) })));
    const envio = () => enviarEsocialAssinado(d, acesso, "2026-09", { envioId: p.envioId, assinaturas, confirmado: true, confirmacao: { proLabore: 1621 } });
    const [r1, r2] = await Promise.all([envio(), envio()]);
    assert.deepEqual([r1.ok, r2.ok].sort(), [false, true]);
    assert.equal(ws.chamadas.length, 1);
    // Outra aba prepara enquanto o envio está em andamento: recusado.
    assert.deepEqual(await prepararEnvioEsocial(d, acesso, "2026-09", { certificado: a.info.certificadoBase64 }), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.emAndamento });
  });

  it("o banco barra um segundo S-1200 original do mesmo sócio e mês", async () => {
    const { acesso } = await empresa();
    const linha = { empresaId: acesso.empresaId, mes: "2026-09", tipo: "evtRemun" as const, cpf: CPF, indRetif: 1, xml: "<x/>", estado: "aceito" as const, criadoEm: AGORA };
    await t.banco.insert(esocialEventos).values({ ...linha, idEvento: "ID1" });
    await assert.rejects(t.banco.insert(esocialEventos).values({ ...linha, idEvento: "ID2", estado: "assinado" }), (e: { cause?: { code?: string } }) => e.cause?.code === "23505");
    // Recusado não conta; retificador também não.
    await t.banco.insert(esocialEventos).values({ ...linha, idEvento: "ID3", estado: "recusado" });
    await t.banco.insert(esocialEventos).values({ ...linha, idEvento: "ID4", indRetif: 2 });
  });

  it("envio sem resposta fica incerto; repetir manda o MESMO lote (mesmos eventos e Ids), sem nova assinatura", async () => {
    const { acesso } = await prontaParaEnviar();
    const log: string[] = [];
    const ws = esocialFalso(new Error("O servidor não respondeu em 90 segundos."), resposta(PROTOCOLO(1)));
    const d = dependencias(ws, { log });
    const { p, r } = await assinarEEnviar(d, acesso);
    assert.deepEqual(r, { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.incerto });
    if (!p.ok) return;
    assert.match(log.join(), /\[esocial\].*não respondeu/);
    // Incerto: nada novo é preparado (poderia duplicar).
    const a = await navegador();
    assert.deepEqual(await prepararEnvioEsocial(d, acesso, "2026-09", { certificado: a.info.certificadoBase64 }), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.incerto });
    assert.deepEqual(await repetirEnvioEsocial(d, acesso, "2026-09", p.envioId), { ok: true, estado: "aguardando" });
    assert.equal(ws.chamadas[1].conteudo, ws.chamadas[0].conteudo);
    // Repetir de novo (já aguardando): nada é enviado.
    assert.equal((await repetirEnvioEsocial(d, acesso, "2026-09", p.envioId)).ok, false);
    assert.equal(ws.chamadas.length, 2);
  });

  it("envio parado em \"enviando\" (o processo caiu) vira incerto depois de 15 minutos", async () => {
    const { acesso } = await prontaParaEnviar();
    await t.banco.insert(esocialEnvios).values({ empresaId: acesso.empresaId, mes: "2026-09", tipo: "mensal", estado: "enviando", criadoEm: new Date(AGORA.getTime() - 16 * 60_000) });
    const s = await situacaoEsocial(t.banco, acesso, "2026-09", AGORA);
    assert.equal(s.emAndamento?.estado, "incerto");
  });

  it("duas consultas ao mesmo tempo com o lote 1 aceito: o lote 2 sai uma vez só", async () => {
    const { acesso } = await prontaParaEnviar();
    const ws = esocialFalso(resposta(PROTOCOLO(1)), aceitos(1), resposta(PROTOCOLO(2)), aceitos(1));
    const d = dependencias(ws);
    const { p } = await assinarEEnviar(d, acesso);
    if (!p.ok) return;
    await Promise.all([acompanharEnvio(d, acesso, p.envioId), acompanharEnvio(d, acesso, p.envioId)]);
    assert.deepEqual(ws.chamadas.map((c) => c.servico), ["enviarLote", "consultarLote", "enviarLote"]);
  });
});

describe("recusa, mês parado no meio e retificação explícita", () => {
  it("evento recusado: o envio termina com as ocorrências do eSocial, o fechamento é descartado e dá para enviar de novo", async () => {
    const { acesso } = await prontaParaEnviar();
    const ws = esocialFalso(resposta(PROTOCOLO(1)), aceitos(1, { cd: "401", ocorrencias: [OCORRENCIA_GRAVADA] }));
    const d = dependencias(ws);
    const { p } = await assinarEEnviar(d, acesso);
    if (!p.ok) return;
    assert.deepEqual(await acompanharEnvio(d, acesso, p.envioId), { ok: true, estado: "recusado" });
    const [envio] = await t.banco.select().from(esocialEnvios).where(eq(esocialEnvios.id, p.envioId));
    assert.deepEqual([envio.mensagem, envio.ocorrencias], [MENSAGENS_DO_ESOCIAL.recusado, [{ evento: "S-1200", codigo: "1", descricao: OCORRENCIA_GRAVADA.descricao }]]);
    const eventos = await t.banco.select().from(esocialEventos).where(eq(esocialEventos.envioId, p.envioId));
    assert.deepEqual(eventos.map((e) => [e.tipo, e.estado]).sort(), [["evtFechaEvPer", "descartado"], ["evtRemun", "recusado"]]);
    // O S-1200 recusado não ocupa o lugar do original: o mês pode ser enviado de novo.
    const a = await navegador();
    assert.ok((await prepararEnvioEsocial(d, acesso, "2026-09", { certificado: a.info.certificadoBase64 })).ok);
  });

  it("lote inteiro recusado na entrada (ex.: esquema): recusado na hora, com a ocorrência", async () => {
    const { acesso } = await prontaParaEnviar();
    const ws = esocialFalso(resposta(ENVIO_RECUSADO));
    const { r } = await assinarEEnviar(dependencias(ws), acesso);
    assert.deepEqual(r, { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.recusado });
    const [envio] = await t.banco.select().from(esocialEnvios);
    assert.deepEqual([envio.estado, envio.ocorrencias], ["recusado", [{ evento: "lote", codigo: "402", descricao: "Schema inválido" }]]);
  });

  it("fechamento recusado depois do S-1200 aceito: o novo envio manda só o S-1299 (o S-1200 não vai de novo)", async () => {
    const { acesso } = await prontaParaEnviar();
    const ws = esocialFalso(resposta(PROTOCOLO(1)), aceitos(1), resposta(PROTOCOLO(2)), aceitos(2, { cd: "401", ocorrencias: [{ codigo: "1", descricao: "Há eventos em processamento." }] }), resposta(PROTOCOLO(3)));
    const d = dependencias(ws);
    const { p } = await assinarEEnviar(d, acesso);
    if (!p.ok) return;
    await acompanharEnvio(d, acesso, p.envioId);
    assert.deepEqual(await acompanharEnvio(d, acesso, p.envioId), { ok: true, estado: "recusado" });
    const s = await situacaoEsocial(t.banco, acesso, "2026-09", AGORA);
    assert.deepEqual([Boolean(s.remuneracao), s.fechado, s.concluido, motivoParaNaoEnviar(s, AGORA)], [true, false, false, null]);
    const { p: p2 } = await assinarEEnviar(d, acesso);
    assert.ok(p2.ok && p2.resumo.eventos.join() === "S-1299");
    assert.deepEqual(eventosDoLote(ws.chamadas[4].conteudo).map((e) => tipoDo(e.xml)), ["evtFechaEvPer"]);
  });

  it("retificação explícita: pró-labore mudado só vai pela retificação (S-1298, S-1200 retificador com o recibo, S-1299)", async () => {
    const { acesso } = await prontaParaEnviar();
    const ws = esocialFalso(resposta(PROTOCOLO(1)), aceitos(1), resposta(PROTOCOLO(2)), aceitos(2));
    const d = dependencias(ws);
    const { p } = await assinarEEnviar(d, acesso);
    if (!p.ok) return;
    await acompanharEnvio(d, acesso, p.envioId);
    await acompanharEnvio(d, acesso, p.envioId);
    const a = await navegador();
    // Mesmo valor: nada a retificar.
    assert.deepEqual(await prepararEnvioEsocial(d, acesso, "2026-09", { certificado: a.info.certificadoBase64, retificar: true }), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.mesmoValor });
    await informarProLabore(d, acesso, { mes: "2026-09", valor: 2_000 });
    // Sem pedir a retificação, o envio normal recusa.
    assert.deepEqual(await prepararEnvioEsocial(d, acesso, "2026-09", { certificado: a.info.certificadoBase64 }), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.jaEnviado });
    const [original] = await t.banco.select().from(esocialEventos).where(eq(esocialEventos.tipo, "evtRemun"));
    ws.fila.push(resposta(PROTOCOLO(3)), aceitos(1), resposta(PROTOCOLO(4)), aceitos(2), resposta(PROTOCOLO(5)), aceitos(3));
    const { p: r } = await assinarEEnviar(d, acesso, "2026-09", { retificar: true, assinante: a });
    assert.ok(r.ok);
    assert.deepEqual(r.resumo.eventos, ["S-1298", "S-1200", "S-1299"]);
    assert.deepEqual(eventosDoLote(ws.chamadas[4].conteudo).map((e) => tipoDo(e.xml)), ["evtReabreEvPer"]);
    await acompanharEnvio(d, acesso, r.envioId);
    const ret = eventosDoLote(ws.chamadas[6].conteudo);
    assert.match(ret[0].xml, new RegExp(`<indRetif>2</indRetif><nrRecibo>${original.recibo!.replace(/\./g, "\\.")}</nrRecibo>.*<ideDmDev>${original.ideDmDev}</ideDmDev>.*<vrRubr>2000\\.00</vrRubr>`));
    await acompanharEnvio(d, acesso, r.envioId);
    assert.deepEqual(await acompanharEnvio(d, acesso, r.envioId), { ok: true, estado: "concluido" });
    const s = await situacaoEsocial(t.banco, acesso, "2026-09", AGORA);
    assert.deepEqual([s.remuneracao?.indRetif, s.remuneracao?.valores?.proLabore, s.fechado, s.concluido], [2, 2000, true, true]);
  });

  it("lancei no portal: o mês conta como feito (sem aviso de prazo) e pode ser desfeito", async () => {
    // Sem os cadastros do eSocial nem envio, a empresa não usa o eSocial por aqui: sem aviso no sino.
    const sem = await empresa("beto", "ti-fator-r");
    await informarProLabore({ banco: t.banco, agora: () => AGORA }, sem.acesso, { mes: "2026-09", valor: 1_621 });
    assert.equal(await pendenciaDoMes(t.banco, sem.acesso, AGORA), null);
    const { acesso } = await prontaParaEnviar();
    assert.deepEqual(await pendenciaDoMes(t.banco, acesso, AGORA), { mes: "2026-09", hoje: "2026-10-19", feito: false });
    assert.ok((await marcarFeitoNoPortal({ banco: t.banco, agora: () => AGORA }, acesso, "2026-09", { feito: true })).ok);
    assert.equal((await pendenciaDoMes(t.banco, acesso, AGORA))?.feito, true);
    const a = await navegador();
    assert.deepEqual(await prepararEnvioEsocial(dependencias(esocialFalso()), acesso, "2026-09", { certificado: a.info.certificadoBase64 }), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.concluido });
    await marcarFeitoNoPortal({ banco: t.banco, agora: () => AGORA }, acesso, "2026-09", { feito: false });
    assert.equal((await pendenciaDoMes(t.banco, acesso, AGORA))?.feito, false);
    assert.equal((await marcarFeitoNoPortal({ banco: t.banco, agora: () => AGORA }, acesso, "2026-10", { feito: true })).ok, false);
  });
});

describe("rotina do mês com eSocial + DCTFWeb: uma assinatura por mês, sem transmitir duas vezes nem deixar de transmitir", () => {
  const TOKEN = "b06feea3-1ca8-49f4-bdb4-211ab006cb92";
  const ok = (dados: unknown): Resposta => ({ status: 200, dados, mensagens: [{ codigo: "Sucesso", texto: "ok" }] });
  const conferencia = (xml = xmlDctf()) => ok({ XMLStringBase64: Buffer.from(xml, "utf8").toString("base64") });
  const darf = ok({ PDFByteArrayBase64: pdfComTexto("Documento de Arrecadacao", "Valor Total do Documento", "178,31").toString("base64") });
  const rotina = (cliente: DependenciasRotina["cliente"], agora = AGORA): DependenciasRotina => ({
    banco: t.banco,
    cliente,
    contexto: async () => ({ contribuinte: cnpj(SUPORTE), autorPedidoDados: cnpj(SUPORTE), tokenProcurador: TOKEN }),
    agora: () => agora,
    log: () => {},
  });

  async function mesFechadoPeloEsocial() {
    const e = await prontaParaEnviar();
    const ws = esocialFalso(resposta(PROTOCOLO(1)), aceitos(1), resposta(PROTOCOLO(2)), aceitos(2));
    const d = dependencias(ws);
    const { p } = await assinarEEnviar(d, e.acesso);
    assert.ok(p.ok);
    await acompanharEnvio(d, e.acesso, p.envioId);
    assert.deepEqual(await acompanharEnvio(d, e.acesso, p.envioId), { ok: true, estado: "concluido" });
    return e;
  }

  it("fechamento com transDCTFWeb: a DCTFWeb não é transmitida daqui; a conferência mostra o recibo e o DARF sai", async () => {
    const { acesso } = await mesFechadoPeloEsocial();
    const serpro = clienteFalso(conferencia(xmlDctf({ recibo: "50000534643844" })), darf);
    const r = rotina(serpro);
    const antes = await situacaoDctf(t.banco, acesso, "2026-09", AGORA);
    assert.ok(antes.peloEsocial instanceof Date);
    assert.equal(motivoParaNaoTransmitirDctf(antes), MENSAGENS_DA_ROTINA.dctfPeloEsocial);
    assert.deepEqual(await transmitirDctfMes(r, acesso, "2026-09", { confirmado: true, confirmacao: { aPagar: 178.31 } }), { ok: false, mensagem: MENSAGENS_DA_ROTINA.dctfPeloEsocial });
    assert.equal(serpro.chamadas.length, 0);
    const c = await conferirDctfMes(r, acesso, "2026-09");
    assert.ok(c.ok && c.situacao.transmitida && c.situacao.recibo === "50000534643844");
    const g = await gerarGuia(r, acesso, "2026-09", "INSS");
    assert.ok(g.ok && g.guia.total === 178.31);
    assert.equal(serpro.chamadas.length, 2);
  });

  it("se a transmissão automática não aconteceu (conferida 1 hora depois ainda em andamento), a transmissão daqui é liberada", async () => {
    const { acesso } = await mesFechadoPeloEsocial();
    const cedo = rotina(clienteFalso(conferencia()), new Date(AGORA.getTime() + 10 * 60_000));
    assert.ok((await conferirDctfMes(cedo, acesso, "2026-09")).ok);
    assert.equal(motivoParaNaoTransmitirDctf(await situacaoDctf(t.banco, acesso, "2026-09", AGORA)), MENSAGENS_DA_ROTINA.dctfPeloEsocial);
    const depois = rotina(clienteFalso(conferencia()), new Date(AGORA.getTime() + 61 * 60_000));
    assert.ok((await conferirDctfMes(depois, acesso, "2026-09")).ok);
    assert.equal(motivoParaNaoTransmitirDctf(await situacaoDctf(t.banco, acesso, "2026-09", AGORA)), null);
  });

  it("DCTFWeb transmitida por aqui antes do fechamento: o S-1299 pede a transmissão mesmo assim (é a declaração nova) e a transmissão antiga deixa de contar", async () => {
    const { acesso } = await prontaParaEnviar();
    const antes = new Date(AGORA.getTime() - 60 * 60_000);
    await t.banco.insert(dctfwebEnvios).values({ empresaId: acesso.empresaId, pa: "2026-09", etapa: "transmissao", estado: "ok", situacao: "transmitida", recibo: "1", criadoEm: antes });
    const ws = esocialFalso(resposta(PROTOCOLO(1)), aceitos(1), resposta(PROTOCOLO(2)), aceitos(2));
    const d = dependencias(ws);
    const { p } = await assinarEEnviar(d, acesso);
    assert.ok(p.ok && p.resumo.eventos.includes("S-1299"));
    await acompanharEnvio(d, acesso, p.ok ? p.envioId : "");
    assert.match(ws.chamadas[2].conteudo, /<transDCTFWeb>S<\/transDCTFWeb>/);
    assert.deepEqual(await acompanharEnvio(d, acesso, p.ok ? p.envioId : ""), { ok: true, estado: "concluido" });
    // O fechamento gerou a declaração de novo: a transmissão de antes é da anterior; espera a do eSocial.
    const s = await situacaoDctf(t.banco, acesso, "2026-09", AGORA);
    assert.deepEqual([s.transmitida, s.recibo], [false, null]);
    assert.equal(motivoParaNaoTransmitirDctf(s), MENSAGENS_DA_ROTINA.dctfPeloEsocial);
  });

  it("transmissão da DCTFWeb por aqui em andamento ou sem resposta: o envio do eSocial espera (no preparo e, se ela começou depois do preparo, ao enviar)", async () => {
    const { acesso } = await prontaParaEnviar();
    const ws = esocialFalso();
    const d = dependencias(ws);
    const a = await navegador();
    // Começou entre o preparo e o envio: o envio é travado, vê a transmissão e não sai nada.
    const p = await prepararEnvioEsocial(d, acesso, "2026-09", { certificado: a.info.certificadoBase64 });
    assert.ok(p.ok);
    if (!p.ok) return;
    const [dctf] = await t.banco.insert(dctfwebEnvios).values({ empresaId: acesso.empresaId, pa: "2026-09", etapa: "transmissao", estado: "enviando", situacao: "em andamento", criadoEm: AGORA }).returning();
    const assinaturas = await Promise.all(p.assinaturas.map(async (x) => ({ idEvento: x.idEvento, valor: await a.assinar(x.signedInfo) })));
    assert.deepEqual(await enviarEsocialAssinado(d, acesso, "2026-09", { envioId: p.envioId, assinaturas, confirmado: true, confirmacao: { proLabore: 1621 } }), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.dctfTransmitindo });
    assert.equal(ws.chamadas.length, 0);
    assert.deepEqual((await t.banco.select().from(esocialEventos)).map((e) => e.estado), ["descartado", "descartado"]);
    // Sem resposta (incerta): o preparo também recusa.
    await t.banco.update(dctfwebEnvios).set({ estado: "incerto" }).where(eq(dctfwebEnvios.id, dctf.id));
    assert.deepEqual(await prepararEnvioEsocial(d, acesso, "2026-09", { certificado: a.info.certificadoBase64 }), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.dctfTransmitindo });
    // Resolvida (a Receita não recebeu): o envio volta a sair, com o pedido de transmissão.
    await t.banco.update(dctfwebEnvios).set({ estado: "erro" }).where(eq(dctfwebEnvios.id, dctf.id));
    ws.fila.push(resposta(PROTOCOLO(1)));
    const { p: depois } = await assinarEEnviar(d, acesso);
    assert.ok(depois.ok);
    assert.ok((await t.banco.select().from(esocialEnvios)).some((e) => e.id === (depois.ok ? depois.envioId : "") && e.transDctf));
  });

  it("envio do eSocial a caminho (preparado, enviando, aguardando o lote do fechamento, sem resposta): a DCTFWeb não é transmitida daqui", async () => {
    const { acesso } = await prontaParaEnviar();
    const conferida = rotina(clienteFalso(conferencia(), conferencia()));
    const motivo = async (agora = AGORA) => motivoParaNaoTransmitirDctf(await situacaoDctf(t.banco, acesso, "2026-09", agora));
    assert.ok((await conferirDctfMes(conferida, acesso, "2026-09")).ok);
    assert.equal(await motivo(), null); // sem nada do eSocial: livre
    const ws = esocialFalso(resposta(PROTOCOLO(1)), aceitos(1), new Error("sem resposta"));
    const d = dependencias(ws);
    const a = await navegador();
    const p = await prepararEnvioEsocial(d, acesso, "2026-09", { certificado: a.info.certificadoBase64 });
    if (!p.ok) return assert.fail();
    assert.equal(await motivo(), MENSAGENS_DA_ROTINA.dctfPeloEsocial); // preparado
    assert.equal(await motivo(new Date(AGORA.getTime() + 31 * 60_000)), null); // preparo abandonado não segura
    const assinaturas = await Promise.all(p.assinaturas.map(async (x) => ({ idEvento: x.idEvento, valor: await a.assinar(x.signedInfo) })));
    assert.deepEqual(await enviarEsocialAssinado(d, acesso, "2026-09", { envioId: p.envioId, assinaturas, confirmado: true, confirmacao: { proLabore: 1621 } }), { ok: true, estado: "aguardando" });
    assert.equal(await motivo(), MENSAGENS_DA_ROTINA.dctfPeloEsocial); // lote 1 aguardando
    assert.deepEqual(await acompanharEnvio(d, acesso, p.envioId), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.incerto }); // lote 2 sem resposta
    assert.equal(await motivo(), MENSAGENS_DA_ROTINA.dctfPeloEsocial);
    // A transmissão daqui recusa sem chamar a Receita, mesmo com a conferência em andamento.
    const serpro = clienteFalso();
    assert.deepEqual(await transmitirDctfMes(rotina(serpro), acesso, "2026-09", { confirmado: true, confirmacao: { aPagar: 178.31 } }), { ok: false, mensagem: MENSAGENS_DA_ROTINA.dctfPeloEsocial });
    assert.equal(serpro.chamadas.length, 0);
  });

  it("envio do eSocial que começa entre a checagem e a transmissão da DCTFWeb: a transmissão é travada, vê o envio e não sai", async () => {
    const { acesso } = await prontaParaEnviar();
    assert.ok((await conferirDctfMes(rotina(clienteFalso(conferencia())), acesso, "2026-09")).ok);
    const serpro = clienteFalso();
    const r: DependenciasRotina = {
      ...rotina(serpro),
      certificadoDaPlataforma: () => PEM_DA_PLATAFORMA, // a empresa da plataforma: assina no servidor
      // O contexto é pedido depois da checagem e antes de travar: é aí que o envio do eSocial começa.
      contexto: async () => {
        await t.banco.insert(esocialEnvios).values({ empresaId: acesso.empresaId, mes: "2026-09", tipo: "mensal", estado: "aguardando", loteAtual: 2, totalLotes: 2, transDctf: true, criadoEm: AGORA });
        return { contribuinte: cnpj(SUPORTE) };
      },
    };
    assert.deepEqual(await transmitirDctfMes(r, acesso, "2026-09", { confirmado: true, confirmacao: { aPagar: 178.31 } }), { ok: false, mensagem: MENSAGENS_DA_ROTINA.dctfPeloEsocial });
    assert.equal(serpro.chamadas.length, 0);
    const transmissoes = (await t.banco.select().from(dctfwebEnvios)).filter((l) => l.etapa === "transmissao");
    assert.deepEqual(transmissoes.map((l) => l.estado), ["erro"]);
  });

  it("retificação com a DCTFWeb já transmitida: o novo fechamento pede a transmissão da retificadora; a antiga não conta e o DARF sai do valor novo", async () => {
    const t0 = AGORA;
    const hora = (min: number) => new Date(t0.getTime() + min * 60_000);
    const { acesso } = await mesFechadoPeloEsocial();
    const c = await conferirDctfMes(rotina(clienteFalso(conferencia(xmlDctf({ recibo: "50000534643844" }))), hora(5)), acesso, "2026-09");
    assert.ok(c.ok && c.situacao.transmitida);
    await informarProLabore({ banco: t.banco, agora: () => hora(10) }, acesso, { mes: "2026-09", valor: 2_000 });
    const ws = esocialFalso(resposta(PROTOCOLO(3)), aceitos(1), resposta(PROTOCOLO(4)), aceitos(2), resposta(PROTOCOLO(5)), aceitos(3));
    const d = dependencias(ws, { agora: hora(20) });
    const { p } = await assinarEEnviar(d, acesso, "2026-09", { retificar: true });
    if (!p.ok) return assert.fail();
    assert.deepEqual(p.resumo.eventos, ["S-1298", "S-1200", "S-1299"]);
    // No meio da retificação (reaberto, S-1200 a caminho): nem a transmissão antiga vale, nem dá para transmitir daqui.
    await acompanharEnvio(d, acesso, p.envioId);
    let s = await situacaoDctf(t.banco, acesso, "2026-09", hora(20));
    assert.deepEqual([s.transmitida, motivoParaNaoTransmitirDctf(s)], [false, MENSAGENS_DA_ROTINA.dctfPeloEsocial]);
    await acompanharEnvio(d, acesso, p.envioId);
    const fechamento = eventosDoLote(ws.chamadas[4].conteudo);
    assert.equal(tipoDo(fechamento[0].xml), "evtFechaEvPer");
    assert.match(fechamento[0].xml, /<transDCTFWeb>S<\/transDCTFWeb>/);
    assert.deepEqual(await acompanharEnvio(d, acesso, p.envioId), { ok: true, estado: "concluido" });
    s = await situacaoDctf(t.banco, acesso, "2026-09", hora(25));
    assert.deepEqual([s.transmitida, s.recibo, motivoParaNaoTransmitirDctf(s)], [false, null, MENSAGENS_DA_ROTINA.dctfPeloEsocial]);
    // A conferência seguinte vê a retificadora transmitida pelo eSocial, com o valor novo, e o DARF sai dela.
    const darfNovo = ok({ PDFByteArrayBase64: pdfComTexto("Documento de Arrecadacao", "Valor Total do Documento", "220,00").toString("base64") });
    const serpro = clienteFalso(conferencia(xmlDctf({ recibo: "50000534649999", saldo: [220] })), darfNovo);
    const r = rotina(serpro, hora(30));
    const depois = await conferirDctfMes(r, acesso, "2026-09");
    assert.ok(depois.ok && depois.situacao.transmitida && depois.situacao.recibo === "50000534649999");
    const g = await gerarGuia(r, acesso, "2026-09", "INSS");
    assert.ok(g.ok && g.guia.total === 220, JSON.stringify(g));
  });
});

describe("pagamento feito no mês sem o envio do mês anterior", () => {
  it("pago no mês seguinte, com pró-labore no mês anterior e sem o envio dele aqui: recusa e pede a importação, ou fecha sem o pagamento por escolha explícita", async () => {
    const { acesso } = await prontaParaEnviar();
    await informarProLabore({ banco: t.banco, agora: () => AGORA }, acesso, { mes: "2026-08", valor: 1_621 });
    const s = await situacaoEsocial(t.banco, acesso, "2026-09", AGORA);
    assert.deepEqual([s.pagamento, s.semDemonstrativoAnterior], [null, "2026-08"]);
    const ws = esocialFalso(resposta(PROTOCOLO(1)));
    const d = dependencias(ws);
    const a = await navegador();
    assert.deepEqual(await prepararEnvioEsocial(d, acesso, "2026-09", { certificado: a.info.certificadoBase64 }), { ok: false, mensagem: mensagemSemDemonstrativo("2026-08") });
    assert.match(mensagemSemDemonstrativo("2026-08"), /Importe agosto de 2026 do eSocial/);
    const p = await prepararEnvioEsocial(d, acesso, "2026-09", { certificado: a.info.certificadoBase64, semPagamentoAnterior: true });
    assert.ok(p.ok);
    if (!p.ok) return;
    assert.deepEqual([p.resumo.eventos, p.resumo.pagamento, p.resumo.semPagamentoDe], [["S-1200", "S-1299"], null, "2026-08"]);
    // Empresa da plataforma: o mesmo pedido explícito.
    assert.deepEqual(await enviarEsocialPelaPlataforma(dependencias(ws, { propria: true }), acesso, "2026-09", { confirmado: true, confirmacao: { proLabore: 1621 } }), { ok: false, mensagem: mensagemSemDemonstrativo("2026-08") });
    assert.equal(ws.chamadas.length, 0);
  });

  it("mês anterior sem pró-labore (zero) ou não informado, pago no mesmo mês, ou com o envio do mês anterior aqui: nada a pedir", async () => {
    const { acesso } = await prontaParaEnviar();
    assert.equal((await situacaoEsocial(t.banco, acesso, "2026-09", AGORA)).semDemonstrativoAnterior, null); // não informado
    await informarProLabore({ banco: t.banco, agora: () => AGORA }, acesso, { mes: "2026-08", valor: 0 });
    assert.equal((await situacaoEsocial(t.banco, acesso, "2026-09", AGORA)).semDemonstrativoAnterior, null); // zero
    await informarProLabore({ banco: t.banco, agora: () => AGORA }, acesso, { mes: "2026-08", valor: 1_621 });
    assert.ok((await salvarConfigEsocial({ banco: t.banco, agora: () => AGORA }, acesso, { ...CONFIG, pagamentoNoMes: "mesmo" })).ok);
    assert.equal((await situacaoEsocial(t.banco, acesso, "2026-09", AGORA)).semDemonstrativoAnterior, null); // pago no mesmo mês
    assert.ok((await salvarConfigEsocial({ banco: t.banco, agora: () => AGORA }, acesso, CONFIG)).ok);
    await t.banco.insert(esocialEventos).values({
      empresaId: acesso.empresaId, mes: "2026-08", tipo: "evtRemun", idEvento: "ID1984304660000002026080512000000001", lote: 1, cpf: CPF, ideDmDev: "D08", xml: "", estado: "importado",
      valores: { proLabore: 1621, inss: 178.31, liquido: 1442.69 }, criadoEm: AGORA,
    });
    const s = await situacaoEsocial(t.banco, acesso, "2026-09", AGORA);
    assert.deepEqual([s.semDemonstrativoAnterior, s.pagamento?.ideDmDev, s.pagamento?.perRef], [null, "D08", "2026-08"]); // importado do contador
  });
});

describe("empresa da própria plataforma, registro das chamadas, isolamento e remoção", () => {
  it("empresa da própria plataforma: assinada no servidor com o certificado do contrato, com a mesma confirmação", async () => {
    const { acesso } = await prontaParaEnviar();
    const ws = esocialFalso(resposta(PROTOCOLO(1)));
    const d = dependencias(ws, { propria: true });
    assert.deepEqual(await enviarEsocialPelaPlataforma(d, acesso, "2026-09", { confirmado: false, confirmacao: { proLabore: 1621 } }), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.semConfirmacao });
    assert.deepEqual(await enviarEsocialPelaPlataforma(dependencias(ws), acesso, "2026-09", { confirmado: true, confirmacao: { proLabore: 1621 } }), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.indisponivel });
    assert.deepEqual(await enviarEsocialPelaPlataforma(d, acesso, "2026-09", { confirmado: true, confirmacao: { proLabore: 1621 } }), { ok: true, estado: "aguardando" });
    const pem = d.certificadoDaPlataforma!()!;
    for (const e of eventosDoLote(ws.chamadas[0].conteudo)) assert.equal(verificarAssinatura(e.xml, pem.certificado), true);
    // Importação da própria empresa: as duas consultas assinadas no servidor.
    const leitura = esocialFalso(resposta(IDENTIFICADORES_DO_SOCIO), resposta(DOWNLOAD_DO_SOCIO));
    const r = await importarPelaPlataforma(dependencias(leitura, { propria: true }), acesso, { cpf: CPF, mes: "2026-09" });
    assert.ok(r.ok && r.config?.origem === "importado");
    assert.equal(verificarAssinatura(leitura.chamadas[1].conteudo, pem.certificado), true);
  });

  it("cliente real do núcleo (transporte falso): chamadas registradas por empresa e o limite diário contado por empregador", async () => {
    const { acesso } = await prontaParaEnviar();
    const enviados: string[] = [];
    const respostas = [ENVIO_ACEITO, IDENTIFICADORES_DO_SOCIO];
    const transporte: Transporte = async (url, _h, corpo) => {
      enviados.push(url);
      assert.doesNotMatch(corpo, /AGUARDANDO-ASSINATURA/);
      return { status: 200, texto: respostas.shift()! };
    };
    const cliente = criarClienteEsocial({ certificado: { pfx: Buffer.from("pfx"), senha: "x" }, registro: registroEsocialNoBanco(t.banco, acesso.empresaId), transporte, agora: () => AGORA });
    const d = dependencias(cliente);
    const { r } = await assinarEEnviar(d, acesso);
    assert.ok(r.ok);
    assert.match(enviados[0], /webservices\.envio\.esocial\.gov\.br/);
    // Nove consultas limitadas já feitas hoje por esta empresa (de outra empresa não contam): sobra 1, a importação não começa.
    const outra = await empresa("beto", "ti-fator-r");
    const consulta = { ambiente: "producao", servico: "downloadPorId", finalidade: "x", status: 200, resumo: "" };
    await t.banco.insert(esocialChamadas).values(Array.from({ length: 9 }, () => ({ ...consulta, empresaId: acesso.empresaId, quando: AGORA })));
    await t.banco.insert(esocialChamadas).values({ ...consulta, empresaId: outra.empresaId, quando: AGORA });
    assert.equal(await cliente.consultasRestantes("producao"), 1);
    const a = await navegador();
    assert.deepEqual(await prepararImportacao(d, acesso, { cpf: CPF, mes: "2026-09", certificado: a.info.certificadoBase64 }), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.limiteDoDia });
    const registradas = await t.banco.select().from(esocialChamadas).where(eq(esocialChamadas.servico, "enviarLote"));
    assert.deepEqual(registradas.map((c) => [c.empresaId, c.status, c.resumo]), [[acesso.empresaId, 200, "201 Lote Recebido com Sucesso."]]);
  });

  it("outra empresa não vê nada do eSocial; a remoção da empresa apaga todas as tabelas novas (sem órfãs)", async () => {
    const { acesso, usuario, empresaId } = await prontaParaEnviar();
    const ws = esocialFalso(resposta(PROTOCOLO(1)));
    const d = dependencias(ws);
    const { p } = await assinarEEnviar(d, acesso);
    const a = await navegador();
    await prepararImportacao(dependencias(esocialFalso()), acesso, { cpf: CPF, mes: "2026-09", certificado: a.info.certificadoBase64 });
    await t.banco.insert(esocialChamadas).values({ empresaId, quando: AGORA, ambiente: "producao", servico: "enviarLote", finalidade: "x", status: 200, resumo: "" });

    const outra = await empresa("beto", "ti-fator-r");
    const s = await situacaoEsocial(t.banco, outra.acesso, "2026-09", AGORA);
    assert.deepEqual([s.config, s.envio, s.remuneracao], [null, null, null]);
    assert.deepEqual(await acompanharEnvio(dependencias(ws), outra.acesso, p.ok ? p.envioId : ""), { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.falhou });
    assert.equal((await repetirEnvioEsocial(dependencias(ws), outra.acesso, "2026-09", p.ok ? p.envioId : "")).ok, false);

    await removerEmpresa(t.banco, { sessaoId: "00000000-0000-0000-0000-000000000000", usuario }, empresaId, SUPORTE, { log: () => {} });
    for (const tabela of [esocialConfig, esocialEnvios, esocialEventos, esocialPedidos, esocialChamadas]) {
      const sobrou = (await t.banco.select().from(tabela)).filter((l: { empresaId: string }) => l.empresaId === empresaId);
      assert.equal(sobrou.length, 0);
    }
  });
});
