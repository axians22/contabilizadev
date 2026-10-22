// QA da Parte 7, ciclo 2 (reconciliação eSocial x DCTFWeb, pagamento do mês). Nada sai da máquina (transporte falso).
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
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import { cnpj, type Resposta } from "@contabilizadev/nucleo/serpro/cliente";
import { xmlDctf } from "@contabilizadev/nucleo/serpro/dctf-exemplo";
import { esocialEventos } from "@/banco/esquema";
import { assinanteDoArquivo, type Assinante } from "@/lib/assinador/assinador";
import { cofreDoNavegador } from "@/lib/assinador/cofre";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
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


async function prontaParaEnviar(proLabore = 1_621) {
  const e = await empresa();
  assert.ok((await salvarConfigEsocial({ banco: t.banco, agora: () => AGORA }, e.acesso, CONFIG)).ok);
  assert.ok((await informarProLabore({ banco: t.banco, agora: () => AGORA }, e.acesso, { mes: "2026-09", valor: proLabore })).ok);
  return e;
}

import { dctfwebEnvios, esocialEnvios } from "@/banco/esquema";
import { enviarEsocialPelaPlataforma, situacaoEsocial } from "@/lib/esocial/envio";
import { transmitirDctfMes } from "@/lib/rotina/dctfweb";
import { cadastrarComprovada, consultarComDados } from "./apoio-empresa";

const TOKEN_C2 = "b06feea3-1ca8-49f4-bdb4-211ab006cb92";
const okC2 = (dados: unknown): Resposta => ({ status: 200, dados, mensagens: [{ codigo: "Sucesso", texto: "ok" }] });
const conferenciaC2 = (xml = xmlDctf()) => okC2({ XMLStringBase64: Buffer.from(xml, "utf8").toString("base64") });
const rotinaC2 = (cliente: DependenciasRotina["cliente"], agora = AGORA, propria = false): DependenciasRotina => ({
  banco: t.banco,
  cliente,
  contexto: async () => (propria ? { contribuinte: cnpj(SUPORTE) } : { contribuinte: cnpj(SUPORTE), autorPedidoDados: cnpj(SUPORTE), tokenProcurador: TOKEN_C2 }),
  certificadoDaPlataforma: () => PEM_DA_PLATAFORMA,
  agora: () => agora,
  log: () => {},
});

describe("QA Parte 7 ciclo 2: corrida de verdade entre a DCTFWeb e o eSocial (empresa da plataforma)", () => {
  for (let rodada = 0; rodada < 6; rodada++) {
    it(`rodada ${rodada}: as duas ao mesmo tempo nunca chamam com a outra em curso`, async () => {
      const { acesso } = await prontaParaEnviar();
      assert.ok((await conferirDctfMes(rotinaC2(clienteFalso(conferenciaC2())), acesso, "2026-09")).ok);
      const violacoes: string[] = [];
      // eSocial falso: no momento da chamada de envio, não pode haver transmissão da DCTFWeb daqui em curso.
      const ws = esocialFalso(async () => {
        const dctf = (await t.banco.select().from(dctfwebEnvios)).filter((l) => l.etapa === "transmissao" && ["enviando", "incerto"].includes(l.estado));
        if (dctf.length) violacoes.push("eSocial chamado com a DCTFWeb transmitindo");
        return resposta(PROTOCOLO(1));
      });
      const serpro = {
        chamadas: 0,
        async chamar() {
          serpro.chamadas++;
          const envios = (await t.banco.select().from(esocialEnvios)).filter((e) => e.transDctf && ["enviando", "aguardando", "incerto"].includes(e.estado));
          if (envios.length) violacoes.push("DCTFWeb transmitida com o envio do eSocial em curso");
          return okC2({ numeroRecibo: "77" });
        },
      };
      const atraso = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const [a, b] = await Promise.all([
        (async () => (await atraso(rodada % 3), transmitirDctfMes(rotinaC2(serpro as unknown as DependenciasRotina["cliente"], AGORA, true), acesso, "2026-09", { confirmado: true, confirmacao: { aPagar: 178.31 } })))(),
        (async () => (await atraso((rodada + 1) % 3), enviarEsocialPelaPlataforma(dependencias(ws, { propria: true }), acesso, "2026-09", { confirmado: true, confirmacao: { proLabore: 1621 } })))(),
      ]);
      assert.deepEqual(violacoes, [], JSON.stringify({ a, b }));
    });
  }
});

describe("QA Parte 7 ciclo 2: espera pela transmissão automática", () => {
  it("conferência 59 min depois do fechamento ainda segura; 60 min (o limite) libera", async () => {
    const { acesso } = await prontaParaEnviar();
    const ws = esocialFalso(resposta(PROTOCOLO(1)), aceitos(1), resposta(PROTOCOLO(2)), aceitos(2));
    const d = dependencias(ws);
    const { p } = await assinarEEnviar(d, acesso);
    if (!p.ok) return assert.fail();
    await acompanharEnvio(d, acesso, p.envioId);
    assert.deepEqual(await acompanharEnvio(d, acesso, p.envioId), { ok: true, estado: "concluido" });
    const min = (n: number) => new Date(AGORA.getTime() + n * 60_000);
    assert.ok((await conferirDctfMes(rotinaC2(clienteFalso(conferenciaC2()), min(59)), acesso, "2026-09")).ok);
    assert.equal(motivoParaNaoTransmitirDctf(await situacaoDctf(t.banco, acesso, "2026-09", min(59))), MENSAGENS_DA_ROTINA.dctfPeloEsocial);
    assert.ok((await conferirDctfMes(rotinaC2(clienteFalso(conferenciaC2()), min(60)), acesso, "2026-09")).ok);
    assert.equal(motivoParaNaoTransmitirDctf(await situacaoDctf(t.banco, acesso, "2026-09", min(60))), null);
  });
});

describe("QA Parte 7 ciclo 2: retificação que para no meio", () => {
  it("S-1298 aceito e S-1200 retificador recusado: o mês fica reaberto, a DCTFWeb não sai daqui e a nova retificação (sem S-1298) fecha com transDCTFWeb=S", async () => {
    const { acesso } = await prontaParaEnviar();
    const ws = esocialFalso(resposta(PROTOCOLO(1)), aceitos(1), resposta(PROTOCOLO(2)), aceitos(2));
    const d = dependencias(ws);
    const { p } = await assinarEEnviar(d, acesso);
    if (!p.ok) return assert.fail();
    await acompanharEnvio(d, acesso, p.envioId);
    await acompanharEnvio(d, acesso, p.envioId);
    assert.ok((await conferirDctfMes(rotinaC2(clienteFalso(conferenciaC2(xmlDctf({ recibo: "5000" })))), acesso, "2026-09")).ok);
    await informarProLabore(d, acesso, { mes: "2026-09", valor: 2_000 });
    const recusaLote2 = async () =>
      resposta(consultaProcessada((await idsDoLote(2)).filter((e) => e.estado === "enviado").map((e) => ({ id: e.idEvento, cd: "401", ocorrencias: [{ codigo: "1", descricao: "x" }] }))));
    ws.fila.push(resposta(PROTOCOLO(3)), aceitos(1), resposta(PROTOCOLO(4)), recusaLote2);
    const { p: r } = await assinarEEnviar(d, acesso, "2026-09", { retificar: true });
    if (!r.ok) return assert.fail(JSON.stringify(r));
    assert.deepEqual(r.resumo.eventos, ["S-1298", "S-1200", "S-1299"]);
    await acompanharEnvio(d, acesso, r.envioId);
    assert.deepEqual(await acompanharEnvio(d, acesso, r.envioId), { ok: true, estado: "recusado" });
    const s = await situacaoEsocial(t.banco, acesso, "2026-09", AGORA);
    assert.equal(s.fechado, false);
    // Enquanto reaberto, a DCTFWeb daqui não transmite (nem a retificadora, que só nasce com o novo fechamento).
    assert.notEqual(motivoParaNaoTransmitirDctf(await situacaoDctf(t.banco, acesso, "2026-09", AGORA)), null);
    // Nova retificação: só S-1200 retificador e S-1299 (o mês já está aberto), com o pedido da DCTFWeb.
    ws.fila.push(resposta(PROTOCOLO(5)), aceitos(1), resposta(PROTOCOLO(6)), aceitos(2));
    const { p: r2 } = await assinarEEnviar(d, acesso, "2026-09", { retificar: true });
    if (!r2.ok) return assert.fail(JSON.stringify(r2));
    assert.deepEqual(r2.resumo.eventos, ["S-1200", "S-1299"]);
    await acompanharEnvio(d, acesso, r2.envioId);
    assert.deepEqual(await acompanharEnvio(d, acesso, r2.envioId), { ok: true, estado: "concluido" });
    const ultimo = ws.chamadas.at(-2)!.conteudo;
    assert.match(ultimo, /<transDCTFWeb>S<\/transDCTFWeb>/);
  });
});

describe("QA Parte 7 ciclo 2: pagamento do mês na virada de ano", () => {
  it("janeiro pago no mês seguinte, com pró-labore de dezembro e sem o envio dele: pede a importação de dezembro do ano anterior", async () => {
    const JAN = em("2027-02-10T10:00:00");
    const { acesso } = await empresa();
    assert.ok((await salvarConfigEsocial({ banco: t.banco, agora: () => JAN }, acesso, CONFIG)).ok);
    assert.ok((await informarProLabore({ banco: t.banco, agora: () => JAN }, acesso, { mes: "2026-12", valor: 1_621 })).ok);
    assert.ok((await informarProLabore({ banco: t.banco, agora: () => JAN }, acesso, { mes: "2027-01", valor: 1_621 })).ok);
    const s = await situacaoEsocial(t.banco, acesso, "2027-01", JAN);
    assert.equal(s.semDemonstrativoAnterior, "2026-12");
    const a = await navegador(E_CNPJ, SUPORTE, JAN);
    const p = await prepararEnvioEsocial(dependencias(esocialFalso(), { agora: JAN }), acesso, "2027-01", { certificado: a.info.certificadoBase64 });
    assert.equal(p.ok, false);
    if (!p.ok) assert.match(p.mensagem, /dezembro de 2026/);
    // Escolha explícita: vai sem o pagamento, e o resumo diz isso.
    const p2 = await prepararEnvioEsocial(dependencias(esocialFalso(), { agora: JAN }), acesso, "2027-01", { certificado: a.info.certificadoBase64, semPagamentoAnterior: true });
    assert.ok(p2.ok && p2.resumo.semPagamentoDe === "2026-12" && !p2.resumo.eventos.includes("S-1210"));
  });

  it("a escolha 'sem o pagamento anterior' não pode ser usada quando o pagamento existe (o S-1210 continua indo)", async () => {
    const { acesso } = await prontaParaEnviar();
    const a = await navegador();
    const p = await prepararEnvioEsocial(dependencias(esocialFalso()), acesso, "2026-09", { certificado: a.info.certificadoBase64, semPagamentoAnterior: true });
    assert.ok(p.ok);
    if (p.ok) assert.equal(p.resumo.semPagamentoDe, null);
  });
});
