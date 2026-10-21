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

// O Serpro cobra do dia 21 de um mês ao dia 20 do seguinte (cláusula 7.3), no horário de Brasília (sem horário de verão
// desde 2019, por isso o -03:00 fixo, como no resto do projeto). O período é identificado pela data do dia 21 em que começa
// ("2026-09-21": de 21/09 a 20/10), e os limites são instantes, para valer igual em qualquer fuso do servidor.
const FUSO = "America/Sao_Paulo";
const meiaNoiteEmBrasilia = (chave: string) => new Date(`${chave}T00:00:00-03:00`);
const CHAVE_DO_PERIODO = /^(\d{4})-(\d{2})-21$/;

// A chave do período que contém o instante `agora`.
export function periodoDe(agora = new Date()): string {
  const [ano, mes, dia] = agora.toLocaleDateString("sv-SE", { timeZone: FUSO }).split("-").map(Number);
  const inicio = new Date(Date.UTC(ano, mes - 1 - (dia < 21 ? 1 : 0), 21));
  return inicio.toISOString().slice(0, 10);
}

export const ehChaveDePeriodo = (chave: string) => CHAVE_DO_PERIODO.test(chave) && Number(chave.slice(5, 7)) >= 1 && Number(chave.slice(5, 7)) <= 12;

// Início (incluído) e fim (excluído) do período `chave`: de 21 às 00:00 até o dia 21 seguinte às 00:00, em Brasília.
export function limitesDoPeriodo(chave: string): { inicio: Date; fim: Date } {
  if (!ehChaveDePeriodo(chave)) throw new Error(`Período de cobrança inválido: ${chave}`);
  const [ano, mes] = chave.split("-").map(Number);
  const seguinte = new Date(Date.UTC(ano, mes, 21)).toISOString().slice(0, 10);
  return { inicio: meiaNoiteEmBrasilia(chave), fim: meiaNoiteEmBrasilia(seguinte) };
}

// O último dia do período (o dia 20 do mês seguinte), como "AAAA-MM-DD".
export function ultimoDiaDoPeriodo(chave: string): string {
  const [ano, mes] = chave.split("-").map(Number);
  return new Date(Date.UTC(ano, mes, 20)).toISOString().slice(0, 10);
}

export function inicioDoPeriodo(agora = new Date()): Date {
  return limitesDoPeriodo(periodoDe(agora)).inicio;
}
