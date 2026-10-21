// CNPJ como a plataforma guarda e mostra. Já aceita o alfanumérico (IN RFB 2.229/2024, a partir de 07/2026):
// 12 letras/dígitos + 2 dígitos verificadores. O formatador do núcleo (formatarCnpj) só conhece o numérico; a
// conferência dos dígitos verificadores (numérico e alfanumérico) é a do núcleo (cnpjValido).
import { cnpjValido } from "@contabilizadev/nucleo/formato";

// Sem pontuação, em maiúsculas; null se não tiver o formato (não confere os dígitos verificadores).
export function normalizarCnpj(cnpj: string): string | null {
  const limpo = cnpj.replace(/[.\-/\s]/g, "").toUpperCase();
  return /^[0-9A-Z]{12}[0-9]{2}$/.test(limpo) ? limpo : null;
}

// Normalizado e com os dígitos verificadores conferidos; null se não for um CNPJ válido.
export function validarCnpj(cnpj: string): string | null {
  const limpo = normalizarCnpj(cnpj);
  return limpo && cnpjValido(limpo) ? limpo : null;
}

// 12ABC34501DE35 -> 12.ABC.345/01DE-35 (o que não tem o formato volta como veio).
export function formatarCnpj(cnpj: string): string {
  return cnpj.replace(/^([0-9A-Z]{2})([0-9A-Z]{3})([0-9A-Z]{3})([0-9A-Z]{4})([0-9]{2})$/, "$1.$2.$3/$4-$5");
}

// Máscara enquanto digita: aceita letras e números, põe a pontuação conforme o tamanho e corta em 14.
export function mascararCnpj(digitado: string): string {
  const v = digitado.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 14);
  const partes = [v.slice(0, 2), v.slice(2, 5), v.slice(5, 8), v.slice(8, 12), v.slice(12, 14)];
  let saida = partes[0];
  if (partes[1]) saida += `.${partes[1]}`;
  if (partes[2]) saida += `.${partes[2]}`;
  if (partes[3]) saida += `/${partes[3]}`;
  if (partes[4]) saida += `-${partes[4]}`;
  return saida;
}

// Confirmação de remoção: o CNPJ digitado (com ou sem pontuação, letras em qualquer caixa) é o da empresa.
export function cnpjConfere(digitado: string, cnpj: string): boolean {
  const limpo = normalizarCnpj(digitado ?? "");
  return limpo !== null && limpo === normalizarCnpj(cnpj);
}
