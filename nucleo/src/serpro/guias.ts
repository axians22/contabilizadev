// Guias (DAS e DARF do INSS): vencidas e data de pagamento para gerar de novo com multa e juros.
// A geração em si fica em pgdasd.ts (emitirDas com pagarEm) e dctfweb.ts (gerarDarf com pagarEm).
import { diaUtil, diaUtilSeguinte } from "../feriados.ts";
import { dataValida, fimDoMes, somarMeses, vencimento } from "../meses.ts";

export type TipoGuia = "DAS" | "INSS";
export const TIPOS_GUIA: TipoGuia[] = ["DAS", "INSS"];

// Hoje, ou o próximo dia útil (sem fim de semana nem feriado bancário), sem passar do fim do mês.
// `extras` = feriados locais ("AAAA-MM-DD"), ver feriados.ts.
export function proximoDiaUtil(hoje: string, extras: string[] = []): string {
  const data = diaUtilSeguinte(hoje, extras);
  return data > fimDoMes(hoje) ? fimDoMes(hoje) : data;
}

// A Receita só aceita dia útil do mês corrente, de hoje em diante. Devolve o motivo da recusa ou null.
export function problemaNaDataDePagamento(pagarEm: string, hoje: string, extras: string[] = []): string | null {
  if (!dataValida(pagarEm)) return "Data inválida.";
  if (pagarEm < hoje || pagarEm > fimDoMes(hoje)) return "A data de pagamento precisa ser de hoje até o fim deste mês.";
  if (!diaUtil(pagarEm, extras)) return "A data de pagamento precisa ser um dia útil.";
  return null;
}

// Guia passou do vencimento (dia 20 do mês seguinte; sem expediente bancário, o DAS vai para o dia útil seguinte e o DARF
// do INSS para o anterior, ver meses.ts) sem pagamento. Só conta mês em que a guia existe. Sem tipo, regra do DARF.
export function vencida(s: { mes: string; hoje: string; pagoEm: string | null; existe: boolean; extras?: string[]; tipo?: TipoGuia }): boolean {
  if (s.pagoEm || s.hoje <= vencimento(s.mes, s.extras, s.tipo)) return false;
  return s.existe;
}

// Guias vencidas e não pagas nos 12 meses anteriores a `mesAtual`, do mais antigo para o mais recente.
// `situacao` diz, para cada mês e tipo, se a guia existe (valor registrado ou, no DAS, receita lançada) e quando foi paga.
export function guiasVencidas(
  mesAtual: string,
  hoje: string,
  situacao: (mes: string, tipo: TipoGuia) => { existe: boolean; pagoEm: string | null },
  extras: string[] = [],
): { mes: string; tipo: TipoGuia }[] {
  const lista: { mes: string; tipo: TipoGuia }[] = [];
  for (let i = 12; i >= 1; i--) {
    const mes = somarMeses(mesAtual, -i);
    for (const tipo of TIPOS_GUIA) if (vencida({ mes, hoje, extras, tipo, ...situacao(mes, tipo) })) lista.push({ mes, tipo });
  }
  return lista;
}
