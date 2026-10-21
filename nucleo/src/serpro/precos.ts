// Tabela de preços do Serpro Integra Contador (contrato de adesão, Anexo I).
// O preço de todas as requisições do mês é o da faixa em que o consumo total do tipo caiu.

export type TipoRequisicao = "consulta" | "emissao" | "declaracao";
export type FaixaPreco = { ate: number; preco: number };

export const PRECOS: Record<TipoRequisicao, FaixaPreco[]> = {
  consulta: [
    { ate: 300, preco: 0.24 },
    { ate: 1_000, preco: 0.21 },
    { ate: 3_000, preco: 0.18 },
    { ate: 7_000, preco: 0.16 },
    { ate: 15_000, preco: 0.14 },
    { ate: 23_000, preco: 0.11 },
    { ate: 30_000, preco: 0.09 },
    { ate: Infinity, preco: 0.06 },
  ],
  emissao: [
    { ate: 500, preco: 0.32 },
    { ate: 5_000, preco: 0.29 },
    { ate: 10_000, preco: 0.26 },
    { ate: 15_000, preco: 0.22 },
    { ate: 25_000, preco: 0.19 },
    { ate: 35_000, preco: 0.16 },
    { ate: 50_000, preco: 0.12 },
    { ate: Infinity, preco: 0.08 },
  ],
  declaracao: [
    { ate: 100, preco: 0.4 },
    { ate: 500, preco: 0.36 },
    { ate: 1_000, preco: 0.32 },
    { ate: 3_000, preco: 0.28 },
    { ate: 5_000, preco: 0.24 },
    { ate: 8_000, preco: 0.2 },
    { ate: 10_000, preco: 0.16 },
    { ate: Infinity, preco: 0.12 },
  ],
};

export const NOMES: Record<TipoRequisicao, string> = { consulta: "Consulta", emissao: "Emissão", declaracao: "Declaração" };

export function precoUnitario(tipo: TipoRequisicao, quantidade: number): number {
  return PRECOS[tipo].find((f) => quantidade <= f.ate)!.preco;
}

export function custoMensal(uso: Record<TipoRequisicao, number>): number {
  const total = (Object.keys(uso) as TipoRequisicao[]).reduce((s, tipo) => s + uso[tipo] * precoUnitario(tipo, uso[tipo]), 0);
  return Math.round(total * 100) / 100;
}

// O Serpro cobra do dia 21 de um mês ao dia 20 do seguinte (cláusula 7.3).
export function inicioDoPeriodo(agora = new Date()): Date {
  const inicio = new Date(agora.getFullYear(), agora.getMonth(), 21);
  if (agora.getDate() < 21) inicio.setMonth(inicio.getMonth() - 1);
  return inicio;
}
