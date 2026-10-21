// Regra de consulta do histórico, banco primeiro (Parte 5): quando o que está guardado ainda vale e quando dá para
// consultar a Receita de novo. Funções puras (recebem o que está no banco e o relógio).
// - Lista de declarações do ano e pagamentos: no máximo 1 vez por dia sozinho (ao abrir o Histórico), ou pelo botão
//   Atualizar, que respeita um intervalo mínimo. O ano anterior só muda com declaração atrasada ou retificadora: sozinho,
//   só até ele ser consultado depois de 1º de fevereiro (a declaração de dezembro vence em 20 de janeiro); depois,
//   só pelo botão. Pagamentos, sozinhos, só enquanto houver DAS gerado sem pagamento conhecido com o
//   vencimento já passado (mês sem DAS não tem pagamento para achar).
// - Extrato: o de uma declaração transmitida não muda; é buscado uma vez por declaração (retificadora = declaração nova).
//   Declaração sem DAS: o PDF da declaração, uma vez (trocado pelo extrato se um DAS for gerado para ela depois).
// - Situação fiscal: sozinha a cada 2 meses (depois do último relatório pronto), ou pelo botão.
// - DEFIS: sozinha uma vez por ano, depois do prazo de entrega (31 de março), ou pelo botão.
// Tentativa que falhou também conta: a automática espera 1 dia para tentar de novo (cada tentativa é cobrada).
import { somarMeses } from "@contabilizadev/nucleo/meses";
import { prazoDefis } from "@contabilizadev/nucleo/serpro/defis";
import { INTERVALO_MESES } from "@contabilizadev/nucleo/serpro/sitfis";

export const DIA_MS = 24 * 60 * 60 * 1000;
export const MESES_DO_HISTORICO = 12;
// Intervalo mínimo entre duas consultas pedidas pelo botão Atualizar.
export const INTERVALO_MANUAL_MINUTOS = 10;
export const INTERVALO_MANUAL_SITUACAO_MINUTOS = 30; // o relatório gasta duas chamadas ou mais
// Importação sem sinal de vida por esse tempo é dada como interrompida (servidor reiniciado no meio).
export const IMPORTACAO_PARADA_MINUTOS = 15;

// Data e mês de hoje no Brasil.
export const hojeNoBrasil = (agora: Date) => agora.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
export const mesAtualNoBrasil = (agora: Date) => hojeNoBrasil(agora).slice(0, 7);

// Os 12 meses antes do mês atual, do mais antigo ao mais recente.
export function mesesDoHistorico(agora: Date): string[] {
  const atual = mesAtualNoBrasil(agora);
  return Array.from({ length: MESES_DO_HISTORICO }, (_, i) => somarMeses(atual, i - MESES_DO_HISTORICO));
}

export function anosDoHistorico(agora: Date): number[] {
  return [...new Set(mesesDoHistorico(agora).map((m) => Number(m.slice(0, 4))))];
}

// A última DEFIS que já devia ter sido entregue: a do ano anterior depois de 31 de março; antes, a do ano retrasado.
export function anoDaDefis(agora: Date): number {
  const hoje = hojeNoBrasil(agora);
  const ano = Number(hoje.slice(0, 4));
  return hoje > prazoDefis(ano - 1) ? ano - 1 : ano - 2;
}

const passou = (de: Date, agora: Date, ms: number) => agora.getTime() - de.getTime() >= ms;
// Meia-noite do dia em Brasília (UTC-3, sem horário de verão desde 2019).
const inicioDoDia = (aaaaMmDd: string) => new Date(`${aaaaMmDd}T00:00:00-03:00`);

export function declaracoesVencidas(ano: number, ultima: Date | undefined, agora: Date): boolean {
  if (!ultima) return true;
  if (!passou(ultima, agora, DIA_MS)) return false;
  if (ano >= Number(hojeNoBrasil(agora).slice(0, 4))) return true;
  return ultima < inicioDoDia(`${ano + 1}-02-01`);
}

export function pagamentosVencidos(ultima: Date | undefined, agora: Date, dasSemPagamentoVencido: boolean): boolean {
  if (!ultima) return true;
  return passou(ultima, agora, DIA_MS) && dasSemPagamentoVencido;
}

// Próxima verificação automática: 2 meses depois do último relatório pronto (AAAA-MM-DD, Brasília).
export function proximaSituacao(prontoEm: Date): string {
  const dia = hojeNoBrasil(prontoEm);
  const [a, m, d] = dia.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + INTERVALO_MESES, 1));
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  return `${alvo.getUTCFullYear()}-${String(alvo.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, ultimoDia)).padStart(2, "0")}`;
}

export function situacaoVencida(ultimoPronto: Date | null, ultimaTentativa: Date | undefined, agora: Date): boolean {
  if (ultimaTentativa && !passou(ultimaTentativa, agora, DIA_MS)) return false;
  if (!ultimoPronto) return true;
  return hojeNoBrasil(agora) >= proximaSituacao(ultimoPronto);
}

// DEFIS do ano: entregue não muda (só pelo botão); sem ela, uma consulta depois do prazo de entrega.
export function defisVencida(ano: number, ultima: Date | undefined, entregue: boolean, agora: Date): boolean {
  if (entregue) return false;
  if (!ultima) return true;
  if (!passou(ultima, agora, DIA_MS)) return false;
  return hojeNoBrasil(ultima) <= prazoDefis(ano) && hojeNoBrasil(agora) > prazoDefis(ano);
}

// Botão Atualizar: liberado se a última consulta foi há mais do que o intervalo mínimo. Devolve os minutos que faltam.
export function esperaManual(ultima: Date | undefined, agora: Date, minutos: number): number {
  if (!ultima) return 0;
  const falta = minutos * 60_000 - (agora.getTime() - ultima.getTime());
  return falta > 0 ? Math.ceil(falta / 60_000) : 0;
}

// O que o banco diz para decidir o que consultar (montado em importacao.ts).
export type EstadoDoBanco = {
  consultas: Map<string, { em: Date; ok: boolean }>; // tipo ("declaracoes:2026", "pagamentos"…) -> última tentativa
  ultimoProntoSituacao: Date | null;
  situacaoProcessando: boolean;
  defisEntregues: Set<number>;
  dasSemPagamentoVencido: boolean;
  extratosFaltando: number; // extratos (ou declarações sem DAS) de declaração vigente que faltam (sem falha nas últimas 24 h)
};

export type Grupo = "historico" | "defis" | "situacao";
export type Pedido = { grupos: Grupo[]; manual: boolean };
export type EtapaPlanejada = { id: "declaracoes" | "extratos" | "pagamentos" | "defis" | "situacao"; anos?: number[] };

const maisRecente = (datas: (Date | undefined)[]) =>
  datas.reduce<Date | undefined>((m, d) => (d && (!m || d > m) ? d : m), undefined);

// As etapas a rodar para o pedido (automático pelas regras de prazo; manual pelo intervalo mínimo) e, se o botão foi
// apertado cedo demais, quantos minutos faltam.
export function planejar(e: EstadoDoBanco, pedido: Pedido, agora: Date): { etapas: EtapaPlanejada[]; espera: number } {
  const etapas: EtapaPlanejada[] = [];
  let espera = 0;
  const ultima = (tipo: string) => e.consultas.get(tipo)?.em;
  const anoAtual = Number(hojeNoBrasil(agora).slice(0, 4));

  if (pedido.grupos.includes("historico")) {
    const anos = anosDoHistorico(agora);
    if (pedido.manual) {
      const falta = esperaManual(maisRecente([...anos.map((a) => ultima(`declaracoes:${a}`)), ultima("pagamentos")]), agora, INTERVALO_MANUAL_MINUTOS);
      if (falta) espera = Math.max(espera, falta);
      else etapas.push({ id: "declaracoes", anos }, { id: "extratos" }, { id: "pagamentos" });
    } else {
      const vencidos = anos.filter((a) => declaracoesVencidas(a, ultima(`declaracoes:${a}`), agora));
      if (vencidos.length) etapas.push({ id: "declaracoes", anos: vencidos });
      if (vencidos.length || e.extratosFaltando > 0) etapas.push({ id: "extratos" });
      if (pagamentosVencidos(ultima("pagamentos"), agora, e.dasSemPagamentoVencido)) etapas.push({ id: "pagamentos" });
    }
  }

  if (pedido.grupos.includes("defis")) {
    const alvo = anoDaDefis(agora);
    if (pedido.manual) {
      const anos = [...new Set([anoAtual - 1, alvo])];
      const falta = esperaManual(maisRecente(anos.map((a) => ultima(`defis:${a}`))), agora, INTERVALO_MANUAL_MINUTOS);
      if (falta) espera = Math.max(espera, falta);
      else etapas.push({ id: "defis", anos });
    } else if (defisVencida(alvo, ultima(`defis:${alvo}`), e.defisEntregues.has(alvo), agora)) {
      etapas.push({ id: "defis", anos: [alvo] });
    }
  }

  if (pedido.grupos.includes("situacao") && !e.situacaoProcessando) {
    if (pedido.manual) {
      const falta = esperaManual(ultima("situacao"), agora, INTERVALO_MANUAL_SITUACAO_MINUTOS);
      if (falta) espera = Math.max(espera, falta);
      else etapas.push({ id: "situacao" });
    } else if (situacaoVencida(e.ultimoProntoSituacao, ultima("situacao"), agora)) {
      etapas.push({ id: "situacao" });
    }
  }
  return { etapas, espera };
}
