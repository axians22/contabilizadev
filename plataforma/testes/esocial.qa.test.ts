// QA da Parte 7 (eSocial): casos que os testes do engenheiro não cobrem. Nada sai da máquina (transporte falso).
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { IDBFactory } from "fake-indexeddb";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { lerPfx } from "@contabilizadev/nucleo/certificado";
import { certificadoDeTeste, certificadoIcpDeTeste } from "@contabilizadev/nucleo/certificado-teste";
import {
  consultaProcessada,
  resposta,
  soap,
  type ResultadoFalso,
} from "@contabilizadev/nucleo/esocial/respostas-exemplo";
import { type RespostaEsocial, type Servico } from "@contabilizadev/nucleo/esocial/ws";
import type { TipoEsquema } from "@contabilizadev/nucleo/esocial/validar";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import { cnpj, type Resposta } from "@contabilizadev/nucleo/serpro/cliente";
import { xmlDctf } from "@contabilizadev/nucleo/serpro/dctf-exemplo";
import { esocialEventos } from "@/banco/esquema";
import { assinanteDoArquivo, type Assinante } from "@/lib/assinador/assinador";
import { cofreDoNavegador } from "@/lib/assinador/cofre";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro } from "@/lib/empresas/cadastro";
import { salvarConfigEsocial, type DadosDaConfig } from "@/lib/esocial/configuracao";
import {
  acompanharEnvio,
  enviarEsocialAssinado,
  prepararEnvioEsocial,
  type DependenciasEsocial,
} from "@/lib/esocial/envio";
import { conferirDctfMes, motivoParaNaoTransmitirDctf, situacaoDctf } from "@/lib/rotina/dctfweb";
import type { DependenciasRotina } from "@/lib/rotina/dependencias";
import { MENSAGENS_DA_ROTINA } from "@/lib/rotina/mensagens";
import { informarProLabore } from "@/lib/rotina/receitas";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const em = (iso: string) => new Date(`${iso}-03:00`);
const AGORA = em("2026-10-19T10:00:00"); // 09/2026 encerrado; prazo do eSocial de 09 foi 15/10
const SUPORTE = "98765432000198"; // exemplo ti-anexo-iii
const PLATAFORMA = "11444777000161"; // o transmissor (CNPJ do certificado da plataforma)
const PERFIS = { ana: perfil("ana@a.com", "sub-ana"), beto: perfil("beto@b.com", "sub-beto") };
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

// O e-CNPJ A1 da empresa (de teste, gerado na hora) (gerado na hora).
const E_CNPJ = certificadoIcpDeTeste({ tipo: "PJ", numero: SUPORTE, nome: "SUPORTE TI LTDA", validoDe: new Date("2026-01-01") });

// O "navegador": "Usar só agora" (o .pfx e a senha abertos em memória, a chave importada no WebCrypto como não exportável).
const navegador = (certificado = E_CNPJ, numero = SUPORTE, agora = AGORA): Promise<Assinante> =>
  assinanteDoArquivo({ pfx: new Uint8Array(certificado.pfx), senha: certificado.senha, cnpjEmpresa: numero, agora, guardar: false, cofre: cofreDoNavegador(new IDBFactory()) });

async function empresa(quem: "ana" | "beto" = "ana", exemplo: "ti-anexo-iii" | "ti-fator-r" = "ti-anexo-iii") {
  const usuario = (await entrarComGoogle(depsLogin(t.banco, PERFIS), quem)).usuario;
  const numero = exemplo === "ti-anexo-iii" ? "98.765.432/0001-98" : "12.345.678/0001-95";
  const r = await consultarParaCadastro(t.banco, usuario, numero, { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo(exemplo) });
  assert.equal(r.tipo, "previa");
  const empresaId = await cadastrarPelaPrevia(t.banco, usuario, r.previa.token, { segredo: SEGREDO, agora: AGORA });
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


import { prazoDoEsocial, avisoDoPrazo } from "@/lib/esocial/prazo";
import { dataPagamentoPadrao } from "@contabilizadev/nucleo/esocial/folha";

const TOKEN_QA = "b06feea3-1ca8-49f4-bdb4-211ab006cb92";
const okQa = (dados: unknown): Resposta => ({ status: 200, dados, mensagens: [{ codigo: "Sucesso", texto: "ok" }] });
const conferenciaQa = (xml = xmlDctf()) => okQa({ XMLStringBase64: Buffer.from(xml, "utf8").toString("base64") });
const rotinaQa = (cliente: DependenciasRotina["cliente"], agora = AGORA): DependenciasRotina => ({
  banco: t.banco,
  cliente,
  contexto: async () => ({ contribuinte: cnpj(SUPORTE), autorPedidoDados: cnpj(SUPORTE), tokenProcurador: TOKEN_QA }),
  agora: () => agora,
  log: () => {},
});

describe("QA Parte 7: reconciliação eSocial x DCTFWeb", () => {
  it("retificação depois de a DCTFWeb ter sido transmitida: o novo fechamento precisa pedir a DCTFWeb (senão a retificadora não é transmitida por ninguém)", async () => {
    const { acesso } = await prontaParaEnviar();
    const ws = esocialFalso(resposta(PROTOCOLO(1)), aceitos(1), resposta(PROTOCOLO(2)), aceitos(2));
    const d = dependencias(ws);
    const { p } = await assinarEEnviar(d, acesso);
    if (!p.ok) return assert.fail();
    await acompanharEnvio(d, acesso, p.envioId);
    assert.deepEqual(await acompanharEnvio(d, acesso, p.envioId), { ok: true, estado: "concluido" });
    // A DCTFWeb foi transmitida pelo eSocial; a conferência (para o DARF) a vê transmitida.
    const c = await conferirDctfMes(rotinaQa(clienteFalso(conferenciaQa(xmlDctf({ recibo: "50000534643844" })))), acesso, "2026-09");
    assert.ok(c.ok && c.situacao.transmitida);
    // O cliente corrige o pró-labore e retifica no eSocial.
    await informarProLabore(d, acesso, { mes: "2026-09", valor: 2_000 });
    ws.fila.push(resposta(PROTOCOLO(3)), aceitos(1), resposta(PROTOCOLO(4)), aceitos(2), resposta(PROTOCOLO(5)), aceitos(3));
    const { p: r } = await assinarEEnviar(d, acesso, "2026-09", { retificar: true });
    if (!r.ok) return assert.fail(JSON.stringify(r));
    await acompanharEnvio(d, acesso, r.envioId);
    await acompanharEnvio(d, acesso, r.envioId);
    const fechamento = eventosDoLote(ws.chamadas[8].conteudo);
    assert.equal(tipoDo(fechamento[0].xml), "evtFechaEvPer");
    // A DCTFWeb muda (INSS de 178,31 para 220,00): ou o S-1299 pede a transmissão, ou a plataforma libera a transmissão.
    const pedeDctf = /<transDCTFWeb>S<\/transDCTFWeb>/.test(fechamento[0].xml);
    await acompanharEnvio(d, acesso, r.envioId);
    const motivo = motivoParaNaoTransmitirDctf(await situacaoDctf(t.banco, acesso, "2026-09", AGORA));
    assert.ok(pedeDctf || motivo !== MENSAGENS_DA_ROTINA.dctfRetificar, `S-1299 da retificação sem transDCTFWeb e DCTFWeb bloqueada com: ${motivo}`);
  });

  it("S-1299 com transDCTFWeb já enviado (lote 2 aguardando o eSocial): a transmissão da DCTFWeb pela plataforma tem de ficar bloqueada", async () => {
    const { acesso } = await prontaParaEnviar();
    const ws = esocialFalso(resposta(PROTOCOLO(1)), aceitos(1), resposta(PROTOCOLO(2)));
    const d = dependencias(ws);
    const { p } = await assinarEEnviar(d, acesso);
    if (!p.ok) return assert.fail();
    await acompanharEnvio(d, acesso, p.envioId); // lote 1 aceito, lote 2 (S-1299 com transDCTFWeb) enviado
    assert.match(ws.chamadas[2].conteudo, /<transDCTFWeb>S<\/transDCTFWeb>/);
    // O eSocial já processou o fechamento, mas a plataforma ainda não consultou; a declaração aparece em andamento.
    const r = rotinaQa(clienteFalso(conferenciaQa()));
    assert.ok((await conferirDctfMes(r, acesso, "2026-09")).ok);
    const motivo = motivoParaNaoTransmitirDctf(await situacaoDctf(t.banco, acesso, "2026-09", AGORA));
    assert.equal(motivo, MENSAGENS_DA_ROTINA.dctfPeloEsocial, "a plataforma liberou a transmissão da DCTFWeb com o S-1299 (transDCTFWeb=S) a caminho: transmissão em dobro");
  });
});

describe("QA Parte 7: pagamento do mês (S-1210)", () => {
  it("pago no mês seguinte e sem o S-1200 do mês anterior na plataforma: não pode fechar o mês com evtPgtos=N em silêncio", async () => {
    const { acesso } = await prontaParaEnviar();
    // O pró-labore de agosto existiu (lançado na rotina; enviado pelo contador) e foi pago em setembro.
    await informarProLabore({ banco: t.banco, agora: () => AGORA }, acesso, { mes: "2026-08", valor: 1_621 });
    const ws = esocialFalso(resposta(PROTOCOLO(1)));
    const a = await navegador();
    const p = await prepararEnvioEsocial(dependencias(ws), acesso, "2026-09", { certificado: a.info.certificadoBase64 });
    // Esperado: pedir o demonstrativo de agosto (importar) ou avisar; obtido: S-1200 + S-1299 com evtPgtos=N, sem aviso.
    assert.ok(!p.ok || p.resumo.pagamento !== null, `resumo sem pagamento: ${p.ok ? p.resumo.eventos.join(",") : ""}`);
  });
});

describe("QA Parte 7: datas", () => {
  it("prazo na virada de ano e dia do pagamento em mês curto", () => {
    assert.equal(prazoDoEsocial("2026-12"), "2027-01-15");
    assert.equal(prazoDoEsocial("2026-10"), "2026-11-16");
    assert.equal(dataPagamentoPadrao("2027-02", 31), "2027-02-28");
    assert.equal(dataPagamentoPadrao("2028-02", 30), "2028-02-29");
    assert.equal(dataPagamentoPadrao("2026-09", 0), "2026-09-01");
  });
  it("aviso: 6 dias antes não avisa, 5 avisa, no dia 'hoje', depois 'atrasado'; feito não avisa", () => {
    assert.equal(avisoDoPrazo("2026-10", "2026-11-10", false), null);
    assert.equal(avisoDoPrazo("2026-10", "2026-11-11", false)?.dias, 5);
    assert.match(avisoDoPrazo("2026-10", "2026-11-16", false)!.titulo, /hoje/);
    assert.equal(avisoDoPrazo("2026-10", "2026-11-17", false)?.nivel, "vencida");
    assert.equal(avisoDoPrazo("2026-10", "2026-11-17", true), null);
  });
});
