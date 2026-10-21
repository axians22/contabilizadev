// DEFIS: declaração anual do Simples Nacional (ano-calendário anterior, entrega até 31 de março).
// - A última DEFIS entregue do ano vem do Serpro (DEFIS/CONSULTIMADECREC143), com os PDFs da declaração e do recibo.
// - O resumo do ano junta o que a plataforma já sabe: receita, pró-labore, INSS, DAS e o lucro isento sem contabilidade.
import type { Das } from "../simples.ts";
import { falha, textoMensagens, type ClienteSerpro, type Contexto, type Resultado } from "./cliente.ts";

export const prazoDefis = (ano: number) => `${ano + 1}-03-31`;

export type DefisEncontrada = {
  situacao: "entregue" | "nao-encontrada";
  idDefis: string | null;
  declaracaoPdf: string | null; // base64
  reciboPdf: string | null; // base64
};

export async function buscarDefis(cliente: ClienteSerpro, ctx: Contexto, ano: number): Promise<Resultado<DefisEncontrada>> {
  if (!Number.isInteger(ano) || ano < 2000) return falha(`Ano inválido: ${ano}.`);
  try {
    const r = await cliente.chamar(
      "Consultar",
      { idSistema: "DEFIS", idServico: "CONSULTIMADECREC143", versaoSistema: "1.0", dados: { ano } },
      `Buscar a última DEFIS entregue do ano ${ano}`,
      ctx,
    );
    const lista = ([] as unknown[]).concat(r.dados ?? []) as { idDefis?: string | number; recibo?: string; declaracao?: string }[];
    const item = lista.find((d) => d?.declaracao || d?.recibo);
    const mensagens = textoMensagens(r.mensagens);
    if (item) {
      return {
        ok: true,
        situacao: "entregue",
        idDefis: item.idDefis != null ? String(item.idDefis) : null,
        declaracaoPdf: item.declaracao ?? null,
        reciboPdf: item.recibo ?? null,
        detalhe: mensagens,
      };
    }
    if ((r.status >= 200 && r.status < 300) || r.status === 404) {
      return {
        ok: true,
        situacao: "nao-encontrada",
        idDefis: null,
        declaracaoPdf: null,
        reciboPdf: null,
        detalhe: mensagens || "O Serpro não encontrou DEFIS entregue para esse ano.",
      };
    }
    return falha(mensagens || `HTTP ${r.status}`);
  } catch (erro) {
    return falha((erro as Error).message);
  }
}

export type MesDefis = {
  mes: string;
  receita: number;
  dasCalculado: Das;
  dasPago: number | null; // valor da guia registrada, quando houver
  proLabore: { bruto: number; inss: number; previsto: boolean } | null;
};

// Presunção de lucro para serviços (Lei 9.249/1995, art. 15, § 1º, III): base do lucro isento sem contabilidade completa.
export const PRESUNCAO_SERVICOS = 0.32;

export function resumoDoAno(meses: MesDefis[]) {
  let receita = 0, proLabore = 0, inss = 0, das = 0, irpj = 0;
  const semReceita: string[] = [];
  const semProLabore: string[] = [];
  for (const m of meses) {
    if (m.receita === 0) semReceita.push(m.mes);
    receita += m.receita;
    const calculado = m.dasCalculado;
    das += m.dasPago ?? calculado.total;
    // IRPJ dentro do DAS pago, na mesma proporção do cálculo do mês.
    irpj += m.dasPago != null ? (calculado.total > 0 ? (m.dasPago * calculado.tributos.irpj) / calculado.total : 0) : calculado.tributos.irpj;
    if (!m.proLabore || m.proLabore.previsto) semProLabore.push(m.mes);
    proLabore += m.proLabore?.bruto ?? 0;
    inss += m.proLabore?.inss ?? 0;
  }
  // Sem contabilidade completa, o lucro isento para o sócio é limitado à presunção menos o IRPJ pago.
  const limiteLucroIsento = Math.max(0, receita * PRESUNCAO_SERVICOS - irpj);
  return { receita, proLabore, inss, das, irpj, limiteLucroIsento, semReceita, semProLabore };
}

// Aviso anual: em fevereiro sempre; em março, enquanto a DEFIS do ano anterior não aparecer como entregue.
export function avisoDefis(hoje: Date, entregue: boolean): { ano: number; prazo: string } | null {
  const mes = hoje.getMonth() + 1;
  const ano = hoje.getFullYear() - 1;
  if (mes !== 2 && mes !== 3) return null;
  if (mes === 3 && entregue) return null;
  return { ano, prazo: prazoDefis(ano) };
}
