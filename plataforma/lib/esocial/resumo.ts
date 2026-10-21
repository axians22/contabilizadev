// O resumo do que vai ao eSocial, em linhas para a caixa de confirmação (a do cliente, que assina no navegador, e a da
// empresa da plataforma, assinada no servidor). Sem nada de servidor: serve às duas telas.
import { brl, dataBr, formatarCpf } from "@contabilizadev/nucleo/formato";
import { rotuloMes } from "@contabilizadev/nucleo/meses";

export type ResumoParaTela = {
  mes: string;
  cpf: string;
  proLabore: number;
  inss: number;
  liquido: number;
  pagamento: { perRef: string; dtPgto: string; liquido: number } | null;
  eventos: string[];
  semPagamentoDe?: string | null;
};

const NOMES_DOS_EVENTOS: Record<string, string> = {
  "S-1200": "remuneração (S-1200)",
  "S-1210": "pagamento (S-1210)",
  "S-1299": "fechamento do mês (S-1299)",
  "S-1298": "reabertura do mês (S-1298)",
};

export function linhasDoResumo(r: ResumoParaTela): [string, string][] {
  return [
    ["Mês", rotuloMes(r.mes)],
    ["Sócio (CPF)", formatarCpf(r.cpf)],
    ["Pró-labore", brl(r.proLabore)],
    ["INSS descontado (11%)", brl(r.inss)],
    ["Líquido do mês", brl(r.liquido)],
    ...(r.pagamento ? ([["Pagamento informado", `${brl(r.pagamento.liquido)} em ${dataBr(r.pagamento.dtPgto)} (de ${rotuloMes(r.pagamento.perRef)})`]] as [string, string][]) : []),
    ...(r.semPagamentoDe ? ([["Pagamento", `o do pró-labore de ${rotuloMes(r.semPagamentoDe)} não vai`]] as [string, string][]) : []),
    ["Eventos", r.eventos.map((e) => NOMES_DOS_EVENTOS[e] ?? e).join(", ")],
    ...(r.eventos.includes("S-1299") ? ([["DCTFWeb", "transmitida pelo eSocial no fechamento"]] as [string, string][]) : []),
  ];
}

