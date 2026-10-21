// Meses no formato "AAAA-MM".
import { diaUtilAnterior, diaUtilSeguinte } from "./feriados.ts";

export function somarMeses(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export const mesValido = (mes: unknown): mes is string =>
  typeof mes === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes);

export function rotuloMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

// DAS e DARF vencem no dia 20 do mês seguinte ao de apuração, mas a regra do dia sem expediente bancário é diferente:
// - DAS (Simples Nacional): prorrogado para o dia útil seguinte. LC 123/2006, art. 21, III, e Resolução CGSN 140/2018,
//   art. 40, caput e § 3º;
// - DARF das contribuições previdenciárias (INSS do pró-labore, DCTFWeb): antecipado para o dia útil anterior. Lei
//   8.212/1991, art. 30, I, b.
// `extras` = feriados locais ("AAAA-MM-DD").
export const vencimentoDas = (mes: string, extras: string[] = []) => diaUtilSeguinte(`${somarMeses(mes, 1)}-20`, extras);
export const vencimentoDarf = (mes: string, extras: string[] = []) => diaUtilAnterior(`${somarMeses(mes, 1)}-20`, extras);
// Vencimento da guia pelo tipo. Sem tipo, o do DARF do INSS (o mais cedo dos dois).
export const vencimento = (mes: string, extras: string[] = [], tipo: "DAS" | "INSS" = "INSS") =>
  tipo === "DAS" ? vencimentoDas(mes, extras) : vencimentoDarf(mes, extras);

// Datas no formato "AAAA-MM-DD", no fuso local.
export const dataIsoLocal = (d: Date) => d.toLocaleDateString("sv-SE");
export const hoje = () => dataIsoLocal(new Date());
export const dataValida = (data: unknown): data is string =>
  typeof data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data) && dataIsoLocal(paraData(data)) === data;

export function paraData(data: string): Date {
  const [a, m, d] = data.split("-").map(Number);
  return new Date(a, m - 1, d);
}

// Último dia do mês da data.
export function fimDoMes(data: string): string {
  const d = paraData(data);
  return dataIsoLocal(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}
