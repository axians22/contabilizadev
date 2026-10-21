// Envio de lotes ao eSocial e consulta do resultado (MOD v1.16, §7.5 e §7.6).
// Quem transmite e quem assina são papéis diferentes (MOD v1.16, agosto de 2026):
// - §7.5.7: "Não é necessário qualquer tipo de vínculo formal (ex: procuração) entre o transmissor e o empregador";
// - §7.5.9: o ideEmpregador do lote é comparado ao dos eventos (diferente, o evento é rejeitado) e o ideTransmissor ao
//   certificado da conexão TLS (diferente, o lote é rejeitado);
// - §8.4 e o código 411 do retorno do evento: cada evento é assinado por e-CNPJ/e-CPF do empregador, do representante
//   legal ou de procurador com procuração eletrônica;
// - §7.6.13: só o transmissor consulta o resultado do lote (até 30 dias depois).
// Na plataforma: o cliente assina os eventos com o e-CNPJ dele e a plataforma transmite e consulta com o próprio.
import { soDigitos } from "../formato.ts";
import { elementos, texto, type Ambiente, type ClienteEsocial } from "./ws.ts";

const NS_LOTE = "http://www.esocial.gov.br/schema/lote/eventos/envio/v1_1_1";
const NS_CONSULTA = "http://www.esocial.gov.br/schema/lote/eventos/envio/consulta/retornoProcessamento/v1_0_0";

export const GRUPO = { tabela: 1, naoPeriodico: 2, periodico: 3 } as const;

// Id do evento: "ID" + tpInsc + CNPJ raiz completado com zeros até 14 + AAAAMMDDhhmmss + sequencial de 5 dígitos.
export function idEvento(cnpj: string, sequencial: number, quando = new Date()): string {
  const raiz = soDigitos(cnpj).slice(0, 8);
  if (raiz.length !== 8) throw new Error("CNPJ do empregador inválido.");
  const p = (n: number, t = 2) => String(n).padStart(t, "0");
  const hora = `${quando.getFullYear()}${p(quando.getMonth() + 1)}${p(quando.getDate())}${p(quando.getHours())}${p(quando.getMinutes())}${p(quando.getSeconds())}`;
  return `ID1${raiz.padEnd(14, "0")}${hora}${p(sequencial, 5)}`;
}

export type EventoAssinado = { id: string; tipo: string; xml: string };

export type ResultadoEvento = {
  id: string;
  cdResposta: string;
  descricao: string;
  recibo: string;
  ocorrencias: { codigo: string; descricao: string; tipo: string; localizacao: string }[];
};

// Empregador (CNPJ raiz, igual ao dos eventos) e transmissor (o CNPJ completo do certificado da conexão).
export type Partes = { empregador: string; transmissor: string };

export function montarLote(partes: Partes, grupo: number, eventos: EventoAssinado[]): string {
  if (eventos.length === 0 || eventos.length > 50) throw new Error("Um lote precisa ter de 1 a 50 eventos.");
  const empregador = soDigitos(partes.empregador);
  const transmissor = soDigitos(partes.transmissor);
  if (empregador.length !== 14 || transmissor.length !== 14) throw new Error("CNPJ do empregador ou do transmissor inválido.");
  return (
    `<eSocial xmlns="${NS_LOTE}"><envioLoteEventos grupo="${grupo}">` +
    `<ideEmpregador><tpInsc>1</tpInsc><nrInsc>${empregador.slice(0, 8)}</nrInsc></ideEmpregador>` +
    `<ideTransmissor><tpInsc>1</tpInsc><nrInsc>${transmissor}</nrInsc></ideTransmissor><eventos>` +
    eventos.map((e) => `<evento Id="${e.id}">${e.xml.replace(/^<\?xml[^>]*\?>/, "")}</evento>`).join("") +
    `</eventos></envioLoteEventos></eSocial>`
  );
}

// O eSocial respondeu e recusou o lote (nada foi recebido): diferente de uma falha de rede, em que o lote pode ter chegado.
export class ErroLoteRecusado extends Error {
  readonly cdResposta: string;
  readonly ocorrencias: { codigo: string; descricao: string }[];
  constructor(cdResposta: string, ocorrencias: { codigo: string; descricao: string }[], mensagem: string) {
    super(mensagem);
    this.cdResposta = cdResposta;
    this.ocorrencias = ocorrencias;
  }
}

// Lê o retorno do envio: o protocolo, ou erro com as ocorrências.
export function lerRetornoEnvio(r: { doc: Document; cdResposta: string; descricao: string }): string {
  const protocolo = texto(r.doc, "protocoloEnvio");
  const ocorrencias = elementos(r.doc, "ocorrencia").map((o) => ({ codigo: texto(o, "codigo"), descricao: texto(o, "descricao") }));
  if (!["201", "202"].includes(r.cdResposta) || !protocolo) {
    const lista = ocorrencias.map((o) => `${o.codigo}: ${o.descricao}`);
    throw new ErroLoteRecusado(r.cdResposta, ocorrencias, `Lote recusado (${r.cdResposta} ${r.descricao})${lista.length ? `: ${lista.join(" | ")}` : ""}`);
  }
  return protocolo;
}

export async function enviarLote(
  cliente: Pick<ClienteEsocial, "chamar">,
  ambiente: Ambiente,
  partes: Partes,
  grupo: number,
  eventos: EventoAssinado[],
  mes = "",
): Promise<string> {
  const r = await cliente.chamar(
    "enviarLote",
    ambiente,
    montarLote(partes, grupo, eventos),
    `Enviar lote com ${eventos.map((e) => e.tipo).join(", ")}${mes ? ` de ${mes}` : ""}`,
  );
  return lerRetornoEnvio(r);
}

export type RetornoLote = {
  situacao: "aguardando" | "processado" | "erro";
  cdResposta: string;
  descricao: string;
  espera: number;
  eventos: ResultadoEvento[];
};

export function lerRetornoConsulta(r: { doc: Document; cdResposta: string; descricao: string }): RetornoLote {
  const eventos: ResultadoEvento[] = elementos(r.doc, "evento").map((ev) => {
    const processamento = elementos(ev, "processamento")[0] ?? ev;
    return {
      id: ev.getAttribute("Id") ?? "",
      cdResposta: texto(processamento, "cdResposta"),
      descricao: texto(processamento, "descResposta"),
      recibo: texto(ev, "nrRecibo"),
      ocorrencias: elementos(ev, "ocorrencia").map((o) => ({
        codigo: texto(o, "codigo"),
        descricao: texto(o, "descricao"),
        tipo: texto(o, "tipo"),
        localizacao: texto(o, "localizacao"),
      })),
    };
  });
  const situacao = r.cdResposta === "101" ? "aguardando" : ["201", "202"].includes(r.cdResposta) ? "processado" : "erro";
  return { situacao, cdResposta: r.cdResposta, descricao: r.descricao, espera: Number(texto(r.doc, "tempoEstimadoConclusao") || 0), eventos };
}

export async function consultarLote(cliente: Pick<ClienteEsocial, "chamar">, ambiente: Ambiente, protocolo: string): Promise<RetornoLote> {
  const conteudo = `<eSocial xmlns="${NS_CONSULTA}"><consultaLoteEventos><protocoloEnvio>${protocolo}</protocoloEnvio></consultaLoteEventos></eSocial>`;
  return lerRetornoConsulta(await cliente.chamar("consultarLote", ambiente, conteudo, `Consultar o resultado do lote ${protocolo}`));
}

// Evento aceito pelo eSocial (201 = sucesso, 202 = sucesso com advertência).
export const aceito = (cd: string) => cd === "201" || cd === "202";
