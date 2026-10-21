// Cotação PTAX do Banco Central (API pública Olinda, sem chave), para converter em reais a receita de exportação
// recebida em moeda estrangeira. A PTAX é a taxa oficial de fechamento do dia (boletim "Fechamento"), publicada nos
// dias úteis; num dia sem boletim (fim de semana, feriado ou antes da publicação) vale a do último dia útil anterior.
// Taxa de compra: é a que o banco aplica para comprar a moeda que a empresa recebe (a mesma do ../fiscal, lib/ptax.ts).
// O fetch vem por parâmetro (nos testes, respostas gravadas): nada aqui é fixo de empresa.
import { centavos } from "./simples.ts";
import { dataValida } from "./meses.ts";

export const URL_PTAX = "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/";

// Moedas com boletim PTAX (lista "Moedas" da mesma API), as mais comuns em contratos de serviço com o exterior.
export const MOEDAS = {
  USD: "Dólar dos Estados Unidos",
  EUR: "Euro",
  GBP: "Libra esterlina",
  CAD: "Dólar canadense",
  AUD: "Dólar australiano",
  CHF: "Franco suíço",
  JPY: "Iene",
} as const;
export type Moeda = keyof typeof MOEDAS;
export const moedaValida = (m: unknown): m is Moeda => typeof m === "string" && Object.hasOwn(MOEDAS, m);

export type Cotacao = { moeda: Moeda; data: string; compra: number; venda: number }; // data = dia do boletim (AAAA-MM-DD)

export class ErroPtax extends Error {}

// Até quantos dias antes da data procurar o último boletim (cobre feriados emendados com fim de semana).
const DIAS_PARA_TRAS = 10;

const mdY = (iso: string) => `${iso.slice(5, 7)}-${iso.slice(8, 10)}-${iso.slice(0, 4)}`;
const menosDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

export function urlDaCotacao(moeda: Moeda, data: string): string {
  return (
    URL_PTAX +
    "CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)" +
    `?@moeda='${moeda}'&@dataInicial='${mdY(menosDias(data, DIAS_PARA_TRAS))}'&@dataFinalCotacao='${mdY(data)}'` +
    "&$format=json&$select=cotacaoCompra,cotacaoVenda,dataHoraCotacao,tipoBoletim"
  );
}

type Item = { cotacaoCompra?: number; cotacaoVenda?: number; dataHoraCotacao?: string; tipoBoletim?: string };

// O boletim de fechamento mais recente até a data (inclusive), da resposta da API.
export function fechamentoAte(moeda: Moeda, data: string, corpo: unknown): Cotacao | null {
  const itens = ((corpo as { value?: Item[] })?.value ?? []).filter(
    (i) => i.tipoBoletim === "Fechamento" && typeof i.cotacaoCompra === "number" && i.cotacaoCompra > 0 && typeof i.dataHoraCotacao === "string",
  );
  const doDia = itens.map((i) => ({ moeda, data: i.dataHoraCotacao!.slice(0, 10), compra: i.cotacaoCompra!, venda: i.cotacaoVenda ?? i.cotacaoCompra! }));
  return doDia.filter((c) => c.data <= data).sort((a, b) => b.data.localeCompare(a.data))[0] ?? null;
}

export async function buscarPtax(moeda: Moeda, data: string, buscar: typeof fetch = fetch, timeoutMs = 8000): Promise<Cotacao> {
  if (!moedaValida(moeda)) throw new ErroPtax("Moeda sem cotação PTAX.");
  if (!dataValida(data)) throw new ErroPtax("Data inválida.");
  let resposta: Response;
  try {
    resposta = await buscar(urlDaCotacao(moeda, data), { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/json" } });
  } catch {
    throw new ErroPtax("O Banco Central não respondeu agora. Informe o valor em reais que caiu na conta ou tente de novo.");
  }
  if (!resposta.ok) throw new ErroPtax("O Banco Central não respondeu agora. Informe o valor em reais que caiu na conta ou tente de novo.");
  let corpo: unknown;
  try {
    corpo = await resposta.json();
  } catch {
    throw new ErroPtax("A cotação do Banco Central veio ilegível. Informe o valor em reais que caiu na conta.");
  }
  const cotacao = fechamentoAte(moeda, data, corpo);
  if (!cotacao) throw new ErroPtax("Não há cotação PTAX para essa data. Informe o valor em reais que caiu na conta.");
  return cotacao;
}

// Valor em reais pela cotação de compra, ao centavo.
export const emReais = (valor: number, cotacao: Pick<Cotacao, "compra">) => centavos(valor * cotacao.compra);
