// Leitura dos eventos já existentes no eSocial (identificadores + download, MOD v1.16 §7.7 e §7.8). O pedido é um XML
// assinado: pelo código 411 da consulta, só com e-CNPJ do mesmo CNPJ raiz do empregador (ou e-CPF do representante
// legal ou de procurador); a conexão pode ser de qualquer transmissor ("Não é necessário qualquer tipo de vínculo formal
// (ex: procuração) entre o transmissor e o empregador", §7.7.7). Por isso os pedidos são montados aqui sem assinatura:
// quem chama assina (no navegador, com o e-CNPJ do cliente, ou no servidor, com o da própria empresa).
// Não guarda nada: devolve os eventos baixados para a plataforma guardar.
import { XMLSerializer } from "@xmldom/xmldom";
import { soDigitos } from "../formato.ts";
import { fimDoMes, somarMeses } from "../meses.ts";
import { centavos } from "../simples.ts";
import { ideEmpregador, type Empregador } from "./eventos.ts";
import { elementos, texto, type Ambiente, type ClienteEsocial, type RespostaEsocial } from "./ws.ts";

const NS = {
  tabela: "http://www.esocial.gov.br/schema/consulta/identificadores-eventos/tabela/v1_0_0",
  trabalhador: "http://www.esocial.gov.br/schema/consulta/identificadores-eventos/trabalhador/v1_0_0",
  downloadId: "http://www.esocial.gov.br/schema/download/solicitacao/id/v1_0_0",
};

// Data e hora de Brasília no formato xs:dateTime, sem fuso (o eSocial compara com a hora oficial de Brasília, que não tem
// mais horário de verão; o servidor pode estar em outro fuso).
export const dataHora = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).replace(" ", "T");
const emBrasilia = (iso: string) => new Date(`${iso}-03:00`);

// O eSocial respondeu com um código de recusa (cdResposta): ex.: 402 pedido inválido, 405 limite, 407/411 sem permissão.
export class ErroConsultaEsocial extends Error {
  readonly cdResposta: string;
  constructor(cdResposta: string, descricao: string) {
    super(`eSocial respondeu ${cdResposta || "sem código"}: ${descricao || "sem descrição"}`);
    this.cdResposta = cdResposta;
  }
}

function erroSe(cd: string, descricao: string, aceitos: string[]) {
  if (!aceitos.includes(cd)) throw new ErroConsultaEsocial(cd, descricao);
}

// Pedidos (sem assinatura).
export const pedidoIdsTabela = (empregador: Empregador, tpEvt: string, chave: string) =>
  `<eSocial xmlns="${NS.tabela}"><consultaIdentificadoresEvts>${ideEmpregador(empregador)}` +
  `<consultaEvtsTabela><tpEvt>${tpEvt}</tpEvt><chEvt>${chave}</chEvt></consultaEvtsTabela></consultaIdentificadoresEvts></eSocial>`;

export const pedidoIdsTrabalhador = (empregador: Empregador, cpf: string, inicio: Date, fim: Date) =>
  `<eSocial xmlns="${NS.trabalhador}"><consultaIdentificadoresEvts>${ideEmpregador(empregador)}` +
  `<consultaEvtsTrabalhador><cpfTrab>${soDigitos(cpf)}</cpfTrab><dtIni>${dataHora(inicio)}</dtIni><dtFim>${dataHora(fim)}</dtFim>` +
  `</consultaEvtsTrabalhador></consultaIdentificadoresEvts></eSocial>`;

// Até 50 eventos por pedido.
export function pedidoDownload(empregador: Empregador, ids: string[]): string {
  if (ids.length === 0 || ids.length > 50) throw new Error("O download pede de 1 a 50 eventos.");
  return (
    `<eSocial xmlns="${NS.downloadId}"><download>${ideEmpregador(empregador)}<solicDownloadEvtsPorId>` +
    ids.map((id) => `<id>${id}</id>`).join("") +
    `</solicDownloadEvtsPorId></download></eSocial>`
  );
}

// Respostas.
export type Identificador = { id: string; recibo: string };

// Identificadores achados (406 = nenhum evento no filtro).
export function lerIdentificadores(r: Pick<RespostaEsocial, "doc" | "cdResposta" | "descricao">): Identificador[] {
  if (r.cdResposta === "406") return [];
  erroSe(r.cdResposta, r.descricao, ["201", "203"]);
  return elementos(r.doc, "identificadorEvt").map((e) => ({ id: texto(e, "id"), recibo: texto(e, "nrRec") }));
}

export type EventoBaixado = { id: string; tipo: string; recibo: string; xml: string };

// Lê os eventos de uma resposta de download (cada <arquivo> com cdResposta 201 traz um <evt>).
export function lerDownload(doc: Document): EventoBaixado[] {
  const serializar = new XMLSerializer();
  const lista: EventoBaixado[] = [];
  for (const arquivo of elementos(doc, "arquivo")) {
    if (texto(arquivo, "cdResposta") && texto(arquivo, "cdResposta") !== "201") continue;
    const evt = elementos(arquivo, "evt")[0];
    if (!evt) continue;
    const xml = Array.from(evt.childNodes as unknown as Node[])
      .map((n) => serializar.serializeToString(n as never))
      .join("");
    lista.push({
      id: evt.getAttribute("Id") ?? "",
      tipo: xml.match(/<(evt[A-Za-z]+)[\s>]/)?.[1] ?? "desconhecido",
      recibo: elementos(arquivo, "rec")[0]?.getAttribute("nrRec") ?? "",
      xml,
    });
  }
  return lista;
}

export function lerRespostaDownload(r: Pick<RespostaEsocial, "doc" | "cdResposta" | "descricao">): EventoBaixado[] {
  erroSe(r.cdResposta, r.descricao, ["201", "203"]);
  return lerDownload(r.doc);
}

// Chamadas completas, com quem assina por parâmetro (servidor; no navegador a plataforma chama em duas etapas).
type Leitor = { cliente: Pick<ClienteEsocial, "chamar">; empregador: Empregador; assinar: (xml: string) => string | Promise<string>; ambiente?: Ambiente };

export async function idsTabela(l: Leitor, tpEvt: string, chave: string) {
  const xml = await l.assinar(pedidoIdsTabela(l.empregador, tpEvt, chave));
  return lerIdentificadores(await l.cliente.chamar("identificadoresTabela", l.ambiente ?? "producao", xml, `Listar eventos ${tpEvt} (${chave}) já enviados ao eSocial`));
}

export async function idsTrabalhador(l: Leitor, cpf: string, inicio: Date, fim: Date) {
  const xml = await l.assinar(pedidoIdsTrabalhador(l.empregador, cpf, inicio, fim));
  return lerIdentificadores(await l.cliente.chamar("identificadoresTrabalhador", l.ambiente ?? "producao", xml, "Listar eventos do sócio enviados ao eSocial"));
}

export async function baixar(l: Leitor, ids: string[]): Promise<EventoBaixado[]> {
  if (ids.length === 0) return [];
  const lote = ids.slice(0, 50);
  const xml = await l.assinar(pedidoDownload(l.empregador, lote));
  return lerRespostaDownload(await l.cliente.chamar("downloadPorId", l.ambiente ?? "producao", xml, `Baixar ${lote.length} evento(s) do eSocial`));
}

// Rubricas (codRubr + ideTabRubr) usadas num S-1200, sem repetir.
export function rubricasDoS1200(xml: string): { codRubr: string; ideTabRubr: string }[] {
  const todas = [...xml.matchAll(/<codRubr>([^<]+)<\/codRubr>\s*<ideTabRubr>([^<]+)<\/ideTabRubr>/g)].map((m) => ({ codRubr: m[1], ideTabRubr: m[2] }));
  return [...new Map(todas.map((r) => [`${r.codRubr}|${r.ideTabRubr}`, r])).values()];
}

const campo = (xml: string, nome: string) => xml.match(new RegExp(`<${nome}>([^<]*)</${nome}>`))?.[1] ?? null;

export type ItemRemuneracao = { codRubr: string; ideTabRubr: string; qtdRubr: string | null; vrRubr: number };
export type RemuneracaoLida = {
  perApur: string;
  cpf: string;
  ideDmDev: string;
  indRetif: 1 | 2;
  categoria: string;
  matricula: string;
  lotacao: string;
  itens: ItemRemuneracao[];
};

// O que um S-1200 baixado diz: o sócio, o demonstrativo, a categoria, a matrícula, a lotação e as rubricas com valores.
export function lerRemuneracao(xml: string): RemuneracaoLida | null {
  if (!/<evtRemun[\s>]/.test(xml)) return null;
  const itens = [...xml.matchAll(/<itensRemun>([\s\S]*?)<\/itensRemun>/g)].map((m) => ({
    codRubr: campo(m[1], "codRubr") ?? "",
    ideTabRubr: campo(m[1], "ideTabRubr") ?? "",
    qtdRubr: campo(m[1], "qtdRubr"),
    vrRubr: Number(campo(m[1], "vrRubr") ?? 0),
  }));
  return {
    perApur: campo(xml, "perApur") ?? "",
    cpf: campo(xml, "cpfTrab") ?? "",
    ideDmDev: campo(xml, "ideDmDev") ?? "",
    indRetif: campo(xml, "indRetif") === "2" ? 2 : 1,
    categoria: campo(xml, "codCateg") ?? "",
    matricula: campo(xml, "matricula") ?? "",
    lotacao: campo(xml, "codLotacao") ?? "",
    itens,
  };
}

export type PagamentoLido = { perApur: string; cpf: string; dtPgto: string; perRef: string; ideDmDev: string; vrLiq: number };

// Os pagamentos de um S-1210 baixado (um por demonstrativo pago).
export function lerPagamentos(xml: string): PagamentoLido[] {
  if (!/<evtPgtos[\s>]/.test(xml)) return [];
  const perApur = campo(xml, "perApur") ?? "";
  const cpf = campo(xml, "cpfBenef") ?? "";
  return [...xml.matchAll(/<infoPgto>([\s\S]*?)<\/infoPgto>/g)].map((m) => ({
    perApur,
    cpf,
    dtPgto: campo(m[1], "dtPgto") ?? "",
    perRef: campo(m[1], "perRef") ?? "",
    ideDmDev: campo(m[1], "ideDmDev") ?? "",
    vrLiq: Number(campo(m[1], "vrLiq") ?? 0),
  }));
}

export type CadastroSugerido = {
  cpf: string;
  categoria: string;
  matricula: string;
  lotacao: string;
  tabRubrica: string;
  rubricaProLabore: string;
  rubricaInss: string;
  qtdProLabore: string | null;
  diaPagamento: number | null;
  pagamentoNoMes: "seguinte" | "mesmo" | null;
};

// Os cadastros da empresa tirados do S-1200 (e, se houver, do S-1210) que o contador já enviou. Pró-labore = a rubrica
// de maior valor; INSS = a outra, se for perto de 11% dela (até o teto). Sem duas rubricas assim, devolve null: o
// cliente preenche o formulário.
export function cadastroDosEventos(remuneracao: RemuneracaoLida, pagamentos: PagamentoLido[] = []): CadastroSugerido | null {
  const itens = [...remuneracao.itens].sort((a, b) => b.vrRubr - a.vrRubr);
  if (itens.length < 2 || !remuneracao.categoria || !remuneracao.matricula || !remuneracao.lotacao) return null;
  const [proLabore, ...resto] = itens;
  const inss = resto.find((i) => i.ideTabRubr === proLabore.ideTabRubr && i.vrRubr > 0 && i.vrRubr <= centavos(proLabore.vrRubr * 0.11) + 0.01);
  if (!inss) return null;
  // O pagamento do demonstrativo deste S-1200: no mesmo mês (perApur = perRef) ou no seguinte.
  const pagamento = pagamentos.find((p) => p.ideDmDev === remuneracao.ideDmDev) ?? pagamentos.find((p) => p.cpf === remuneracao.cpf);
  return {
    cpf: soDigitos(remuneracao.cpf),
    categoria: remuneracao.categoria,
    matricula: remuneracao.matricula,
    lotacao: remuneracao.lotacao,
    tabRubrica: proLabore.ideTabRubr,
    rubricaProLabore: proLabore.codRubr,
    rubricaInss: inss.codRubr,
    qtdProLabore: proLabore.qtdRubr,
    diaPagamento: pagamento?.dtPgto ? Number(pagamento.dtPgto.slice(8, 10)) : null,
    pagamentoNoMes: pagamento ? (pagamento.perApur === pagamento.perRef ? "mesmo" : "seguinte") : null,
  };
}

// Meses (dos 12 anteriores a `mesAtual`) cujos eventos do sócio ainda precisam ser procurados. Os eventos de M vencem
// no dia 15 de M+1: só procura depois do dia 16. Na busca automática, cada mês é procurado no máximo uma vez.
export function mesesPendentes(s: {
  mesAtual: string;
  hoje: string;
  manual: boolean;
  temRemuneracao: (mes: string) => boolean;
  procurado: (mes: string) => boolean;
}): string[] {
  const lista: string[] = [];
  for (let i = 12; i >= 1; i--) {
    const mes = somarMeses(s.mesAtual, -i);
    if (s.temRemuneracao(mes)) continue;
    if (`${somarMeses(mes, 1)}-16` > s.hoje) continue;
    if (!s.manual && s.procurado(mes)) continue;
    lista.push(mes);
  }
  return lista;
}

// Janela de recepção dos eventos de `mes`: o mês seguinte inteiro, terminando pelo menos 70 minutos antes de agora (a
// consulta só vê o que chegou até uma hora antes, MOD §7.7.7; e o intervalo máximo é de 31 dias, código 410).
export function janelaDeRecepcao(mes: string, agora = new Date()): { inicio: Date; fim: Date } {
  const seguinte = somarMeses(mes, 1);
  const inicio = emBrasilia(`${seguinte}-01T00:00:00`);
  const ultimo = emBrasilia(`${fimDoMes(`${seguinte}-01`)}T23:59:59`);
  const limite = new Date(agora.getTime() - 70 * 60_000);
  return { inicio, fim: ultimo < limite ? ultimo : limite };
}
