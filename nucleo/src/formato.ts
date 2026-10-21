// Menos de meio centavo vira zero: sem isso, -0 ou -0,004 sairiam como "-R$ 0,00".
export const brl = (v: number) => (Math.abs(v) < 0.005 ? 0 : v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const usd = (v: number) =>
  "US$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const pct = (v: number) =>
  (v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";

export const dataBr = (iso: string) => iso.split("-").reverse().join("/");

// Data compacta (AAAAMMDD, como as datas do termo de autorização) para AAAA-MM-DD.
export const isoDeCompacta = (aaaammdd: string) => `${aaaammdd.slice(0, 4)}-${aaaammdd.slice(4, 6)}-${aaaammdd.slice(6)}`;

export const soDigitos = (v: string) => v.replace(/\D/g, "");

export const formatarCnpj = (cnpj: string) =>
  soDigitos(cnpj).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

export const formatarCpf = (cpf: string) => soDigitos(cpf).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");

// CNAE subclasse (7 dígitos) no padrão do IBGE: 6201501 -> 6201-5/01.
export const formatarCnae = (cnae: string) => soDigitos(cnae).replace(/^(\d{4})(\d)(\d{2})$/, "$1-$2/$3");

// Natureza jurídica (4 dígitos) no padrão da Receita: 2062 -> 206-2.
export const formatarNatureza = (codigo: string) => soDigitos(codigo).replace(/^(\d{3})(\d)$/, "$1-$2");

// Dígitos verificadores (módulo 11). Sequências repetidas (000..., 111...) são inválidas. Cada caractere vale
// o código ASCII menos 48: nos dígitos é o próprio dígito; nas letras do CNPJ alfanumérico, A = 17, B = 18... Z = 42
// (IN RFB 2.229/2024; os dois dígitos verificadores continuam numéricos).
function digitosConferem(numero: string, pesosIniciais: number[]): boolean {
  if (/^(.)\1+$/.test(numero)) return false;
  const corpo = numero.slice(0, pesosIniciais.length);
  const dv = (base: string, pesos: number[]) => {
    const resto = [...base].reduce((s, c, i) => s + (c.charCodeAt(0) - 48) * pesos[i], 0) % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = dv(corpo, pesosIniciais);
  // O segundo dígito usa os mesmos pesos com um a mais no começo (CPF: 11..2; CNPJ: 6,5,4,3,2,9..2).
  const d2 = dv(corpo + d1, [pesosIniciais[0] + 1, ...pesosIniciais]);
  return numero === `${corpo}${d1}${d2}`;
}

// CNPJ numérico ou alfanumérico (12 letras maiúsculas/dígitos + 2 dígitos verificadores), com ou sem pontuação.
export function cnpjValido(cnpj: string): boolean {
  const n = cnpj.replace(/[.\-/\s]/g, "").toUpperCase();
  return /^[0-9A-Z]{12}[0-9]{2}$/.test(n) && digitosConferem(n, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
}

export function cpfValido(cpf: string): boolean {
  const n = soDigitos(cpf);
  return n.length === 11 && digitosConferem(n, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
}
