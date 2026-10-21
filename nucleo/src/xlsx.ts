// Leitura de planilhas .xlsx (extratos de banco, corretora ou da própria Receita) com a biblioteca read-excel-file.
// Cada aba vira uma lista de linhas de texto; números e datas são convertidos depois, por coluna.
import readXlsxFile from "read-excel-file/node";

export type Aba = { nome: string; linhas: string[][] };

const texto = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? "" : String(v).trim());

export async function lerXlsx(arquivo: Buffer): Promise<Aba[]> {
  const abas = await readXlsxFile(arquivo);
  return abas.map((a) => ({ nome: a.sheet, linhas: a.data.map((linha) => linha.map(texto)) }));
}

// "1.234,56", "1234.56", "-" -> número ou null
export function numero(valor: string | undefined): number | null {
  const t = (valor ?? "").replace(/R\$\s?/, "").trim();
  if (!t || t === "-") return null;
  const n = Number(/,\d+$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : null;
}

// "17/09/2026" ou "2026-09-17" -> "2026-09-17"
export function dataIso(valor: string | undefined): string | null {
  const t = (valor ?? "").trim();
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
}
