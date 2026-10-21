// Fluxo mensal do pró-labore no eSocial, pela alternativa 2 do MOD v1.16 (§7.9.7): o par S-1200 + S-1210 num lote e,
// depois de processado, o S-1299 (fechamento) noutro. Retificação explícita: S-1298 (reabre o mês fechado), o S-1200
// retificador e um novo S-1299, um lote de cada vez (o seguinte só depois de o anterior ser aceito).
// Os eventos são montados aqui sem assinatura: quem chama assina (no navegador, com o e-CNPJ do cliente, pela assinatura
// em duas etapas; ou no servidor, com o certificado da própria empresa) e confere no esquema oficial (validarAssinado)
// antes de enviar. A plataforma só envia com a confirmação do cliente.
import { assinarEsocial } from "../assinatura.ts";
import type { Pem } from "../certificado.ts";
import { dataValida, fimDoMes, somarMeses } from "../meses.ts";
import { novoIdeDmDev, s1200, s1210, s1298, s1299, type ParametrosFolha } from "./eventos.ts";
import { idEvento } from "./lote.ts";
import { validar, type TipoEsquema } from "./validar.ts";
import type { Ambiente } from "./ws.ts";

export type TipoEvento = "evtRemun" | "evtPgtos" | "evtFechaEvPer" | "evtReabreEvPer";
export const CODIGO_DO_EVENTO: Record<TipoEvento, string> = { evtRemun: "S-1200", evtPgtos: "S-1210", evtFechaEvPer: "S-1299", evtReabreEvPer: "S-1298" };

// Um evento pronto para assinar: o lote (1, 2, 3…) diz a ordem de envio.
export type EventoMontado = { id: string; tipo: TipoEvento; xml: string; lote: number; ideDmDev?: string; indRetif?: 1 | 2 };

// Pagamento feito no mês: do pró-labore de perRef (normalmente o mês anterior). Sem ideDmDev, perRef precisa ser o
// próprio mês e o pagamento é do demonstrativo do S-1200 que vai no mesmo lote.
export type PagamentoDoMes = { dtPgto: string; perRef: string; ideDmDev?: string; liquido: number };

export type PedidoDoMes = {
  mes: string;
  ambiente: Ambiente;
  parametros: ParametrosFolha;
  pagamento: PagamentoDoMes | null;
  transDCTFWeb: boolean;
  // O que o mês já tem no eSocial (um envio anterior que parou no meio): o S-1200 aceito (o demonstrativo dele) e se já
  // há S-1210 no mês. Só vai o que falta.
  remuneracaoAceita?: { ideDmDev: string };
  pagamentoAceito?: boolean;
  quando?: Date;
  primeiroSequencial?: number; // os Ids já usados no mesmo segundo (o Id é único por empregador)
};

// Dia do pagamento no mês (o dia 31 vira o último dia de um mês mais curto).
export function dataPagamentoPadrao(mes: string, dia: number): string {
  const ultimo = Number(fimDoMes(`${mes}-01`).slice(8));
  return `${mes}-${String(Math.min(Math.max(1, dia), ultimo)).padStart(2, "0")}`;
}

// O que vai ser mandado em `mes`: a remuneração do mês e, se houver ideDmDev do mês anterior (enviado pela plataforma
// ou pelo contador), o pagamento dele feito neste mês.
export function previa(mes: string, ideDmDevAnterior: string | null) {
  return { perRef: somarMeses(mes, -1), ideDmDevAnterior, temPagamento: Boolean(ideDmDevAnterior) };
}

// Lote 1: S-1200 do mês e, se houver, o S-1210 do pagamento feito no mês; lote 2: S-1299. O que o mês já tem não vai de
// novo (sem nada antes do fechamento, o S-1299 vai sozinho no lote 1).
export function montarEventosDoMes(p: PedidoDoMes): EventoMontado[] {
  const quando = p.quando ?? new Date();
  const cnpj = p.parametros.empregador.cnpj;
  const eventos: EventoMontado[] = [];
  const proximo = () => idEvento(cnpj, eventos.length + (p.primeiroSequencial ?? 1), quando);
  let ideDmDev = p.remuneracaoAceita?.ideDmDev;
  if (!ideDmDev) {
    ideDmDev = novoIdeDmDev(p.mes, quando);
    const id = proximo();
    eventos.push({ id, tipo: "evtRemun", lote: 1, ideDmDev, indRetif: 1, xml: s1200(id, p.mes, p.ambiente, ideDmDev, p.parametros) });
  }
  if (p.pagamento && !p.pagamentoAceito) {
    const pg = p.pagamento;
    if (!dataValida(pg.dtPgto) || !pg.dtPgto.startsWith(p.mes)) throw new Error("A data do pagamento precisa estar dentro do mês.");
    if (pg.perRef > p.mes) throw new Error("O pagamento não pode ser de um mês posterior.");
    if (!pg.ideDmDev && pg.perRef !== p.mes) throw new Error("Pagamento de outro mês sem o demonstrativo que ele paga.");
    const id = proximo();
    const pagamento = { dtPgto: pg.dtPgto, perRef: pg.perRef, ideDmDev: pg.ideDmDev ?? ideDmDev, liquido: pg.liquido };
    eventos.push({ id, tipo: "evtPgtos", lote: 1, indRetif: 1, xml: s1210(id, p.mes, p.ambiente, pagamento, p.parametros) });
  }
  const fecha = proximo();
  const temPagamento = Boolean(p.pagamento) || Boolean(p.pagamentoAceito);
  eventos.push({ id: fecha, tipo: "evtFechaEvPer", lote: eventos.length ? 2 : 1, xml: s1299(fecha, p.mes, p.ambiente, temPagamento, p.parametros.empregador, p.transDCTFWeb) });
  return eventos;
}

export type PedidoDeRetificacao = {
  mes: string;
  ambiente: Ambiente;
  parametros: ParametrosFolha;
  original: { nrRecibo: string; ideDmDev: string };
  reabrir: boolean; // o mês já foi fechado: S-1298 antes
  temPagamento: boolean; // o mês tem S-1210 (vai no infoFech do novo S-1299)
  transDCTFWeb: boolean;
  quando?: Date;
  primeiroSequencial?: number;
};

// Retificação do pró-labore do mês: [S-1298], o S-1200 retificador (o mesmo demonstrativo, que o S-1210 já aponta) e
// um novo S-1299.
export function montarRetificacao(p: PedidoDeRetificacao): EventoMontado[] {
  if (!p.original.nrRecibo || !p.original.ideDmDev) throw new Error("A retificação precisa do recibo e do demonstrativo do evento original.");
  const quando = p.quando ?? new Date();
  const cnpj = p.parametros.empregador.cnpj;
  const eventos: EventoMontado[] = [];
  const proximo = () => idEvento(cnpj, eventos.length + (p.primeiroSequencial ?? 1), quando);
  if (p.reabrir) {
    const id = proximo();
    eventos.push({ id, tipo: "evtReabreEvPer", lote: 1, xml: s1298(id, p.mes, p.ambiente, p.parametros.empregador) });
  }
  const lote = eventos.length + 1;
  const id = proximo();
  const retificacao = { nrRecibo: p.original.nrRecibo };
  eventos.push({ id, tipo: "evtRemun", lote, ideDmDev: p.original.ideDmDev, indRetif: 2, xml: s1200(id, p.mes, p.ambiente, p.original.ideDmDev, p.parametros, retificacao) });
  const fecha = proximo();
  eventos.push({ id: fecha, tipo: "evtFechaEvPer", lote: lote + 1, xml: s1299(fecha, p.mes, p.ambiente, p.temPagamento, p.parametros.empregador, p.transDCTFWeb) });
  return eventos;
}

export class ErroEventoInvalido extends Error {}

// Confere o evento assinado contra o esquema oficial antes de qualquer envio.
export async function validarAssinado(xml: string, tipo: TipoEsquema): Promise<void> {
  const erros = await validar(xml, tipo);
  if (erros.length) throw new ErroEventoInvalido(`O evento ${tipo} não passou na validação do esquema oficial: ${erros.slice(0, 3).join(" | ")}`);
}

// Assinatura no servidor (a empresa da própria plataforma, cujo e-CNPJ é o certificado do contrato).
export async function assinarEValidar(xml: string, tipo: TipoEsquema, pem: Pem): Promise<string> {
  const assinado = assinarEsocial(xml, pem);
  await validarAssinado(assinado, tipo);
  return assinado;
}

// ideDmDev de um S-1200 (para o S-1210 do mês seguinte).
export const ideDmDevDoXml = (xml: string) => xml.match(/<ideDmDev>([^<]+)<\/ideDmDev>/)?.[1] ?? null;
