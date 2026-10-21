// Prazo dos eventos mensais do eSocial: dia 15 do mês seguinte ao da competência; caindo em dia não útil, passa para o
// dia útil seguinte (MOS S-1.x, S-1299 "Fechamento dos eventos periódicos", seção de prazos de 10/2023).
// Ex.: 10/2026 vence em 16/11/2026 (15/11 é domingo e feriado). O aviso aparece no painel e no sino a partir de 5 dias
// antes, enquanto o mês não foi enviado (ou marcado como feito no portal).
import { dataBr } from "@contabilizadev/nucleo/formato";
import { diaUtilSeguinte } from "@contabilizadev/nucleo/feriados";
import { rotuloMes, somarMeses } from "@contabilizadev/nucleo/meses";

export const AVISO_PRAZO_DIAS = 5;
const DIA = 24 * 60 * 60 * 1000;

export const prazoDoEsocial = (mes: string) => diaUtilSeguinte(`${somarMeses(mes, 1)}-15`);

export type AvisoDoPrazo = { nivel: "vence" | "vencida"; titulo: string; texto: string; prazo: string; dias: number };

// O aviso do mês (só quando ainda falta enviar): faltando AVISO_PRAZO_DIAS dias ou menos, ou já vencido.
export function avisoDoPrazo(mes: string, hoje: string, feito: boolean): AvisoDoPrazo | null {
  if (feito) return null;
  const prazo = prazoDoEsocial(mes);
  const dias = Math.round((new Date(`${prazo}T00:00:00Z`).getTime() - new Date(`${hoje}T00:00:00Z`).getTime()) / DIA);
  if (dias > AVISO_PRAZO_DIAS) return null;
  if (dias < 0) {
    return { nivel: "vencida", prazo, dias, titulo: `eSocial de ${rotuloMes(mes)} atrasado`, texto: `O pró-labore de ${rotuloMes(mes)} devia ter sido enviado ao eSocial até ${dataBr(prazo)}. Envie o quanto antes.` };
  }
  const quando = dias === 0 ? "hoje" : dias === 1 ? "amanhã" : `em ${dias} dias`;
  return { nivel: "vence", prazo, dias, titulo: `eSocial de ${rotuloMes(mes)} vence ${quando}`, texto: `Envie o pró-labore de ${rotuloMes(mes)} ao eSocial até ${dataBr(prazo)}.` };
}
