// Regras dos dados pessoais ("Seus dados", 21/10/2026): o que vale como nome completo, CPF, data de nascimento, WhatsApp
// e endereço, e a forma em que cada um é guardado. Só regras, sem banco nem tela: a tela usa para avisar na hora e o
// servidor confere de novo antes de gravar (lib/usuarios/dados-pessoais.ts).
import { normalizarCep, UFS } from "@contabilizadev/nucleo/brasilapi/cep";
import { cpfValido } from "@contabilizadev/nucleo/formato";

// Versão do texto dos termos de uso e da política de privacidade (provisório até a Parte 9). Versão nova pede o aceite de
// novo no próximo acesso.
export const VERSAO_DOS_TERMOS = "provisorio-2026-10-21";

const soDigitos = (v: string) => String(v ?? "").replace(/\D/g, "");

// CPF com os dígitos verificadores certos (e não 111.111.111-11 e afins, que passam na conta). Devolve os 11 dígitos.
export function validarCpf(texto: string): string | null {
  const cpf = soDigitos(texto);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf) || !cpfValido(cpf)) return null;
  return cpf;
}

export const formatarCpf = (cpf: string) => cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");

// DDDs em uso no Brasil (Anatel, Plano de Numeração).
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65,
  66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

// WhatsApp brasileiro: DDD válido e número de celular (9 + 8 dígitos) ou fixo (8 dígitos começando de 2 a 5, que o
// WhatsApp Business aceita). Aceita com +55, 0 de longa distância, espaços, parênteses e traço. Guardado como +55DDNÚMERO.
export function normalizarWhatsapp(texto: string): string | null {
  let n = soDigitos(texto);
  if (String(texto ?? "").trim().startsWith("+")) {
    if (!n.startsWith("55")) return null; // outro país
    n = n.slice(2);
  } else if ((n.length === 12 || n.length === 13) && n.startsWith("55")) n = n.slice(2);
  else if (n.startsWith("0")) n = n.slice(1);
  if (n.length !== 10 && n.length !== 11) return null;
  if (!DDDS.has(Number(n.slice(0, 2)))) return null;
  const numero = n.slice(2);
  const celular = numero.length === 9 && numero.startsWith("9");
  const fixo = numero.length === 8 && /^[2-5]/.test(numero);
  return celular || fixo ? `+55${n}` : null;
}

export function formatarWhatsapp(guardado: string): string {
  const n = guardado.replace(/^\+55/, "");
  return n.length === 11 ? `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}` : `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
}

// Data de nascimento (AAAA-MM-DD, como o <input type="date"> manda): data que existe, depois de 1900 e antes de hoje
// (dia de Brasília, AAAA-MM-DD).
export function validarNascimento(texto: string, hoje: string): string | null {
  const v = String(texto ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [a, m, d] = v.split("-").map(Number);
  const data = new Date(Date.UTC(a, m - 1, d));
  if (data.getUTCFullYear() !== a || data.getUTCMonth() !== m - 1 || data.getUTCDate() !== d) return null;
  if (a < 1900 || v >= hoje) return null;
  return v;
}

// Nome completo: nome e sobrenome (duas palavras ou mais), só letras (com acento), espaço, apóstrofo, hífen e ponto.
export function normalizarNome(texto: string): string | null {
  const nome = String(texto ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  if (nome.length < 5 || nome.length > 120) return null;
  if (!/^[\p{L}][\p{L}'’. -]*$/u.test(nome)) return null;
  if (nome.split(" ").filter((p) => /\p{L}{2,}/u.test(p)).length < 2) return null;
  return nome;
}

// O nome como a Receita escreve no quadro de sócios, para comparar: sem acento, em maiúsculas e com um espaço entre as
// palavras ("José d’Ávila" -> "JOSE D AVILA").
export function nomeParaComparar(nome: string): string {
  return String(nome ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z]+/g, " ")
    .trim();
}

export const CAMPOS = ["nomeCompleto", "cpf", "dataNascimento", "whatsapp", "cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf"] as const;
export type Campo = (typeof CAMPOS)[number];

export type DadosPessoaisValidos = {
  nomeCompleto: string;
  cpf: string;
  dataNascimento: string;
  whatsapp: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  uf: string;
};

export type ResultadoValidacao = { ok: true; dados: DadosPessoaisValidos } | { ok: false; erros: Partial<Record<Campo | "aceite", string>> };

const texto = (v: unknown, max: number) => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  return t && t.length <= max ? t : null;
};

export const MENSAGENS = {
  nomeCompleto: "Escreva o nome completo, com sobrenome (só letras).",
  cpf: "CPF inválido: confira os números.",
  dataNascimento: "Data de nascimento inválida.",
  whatsapp: "WhatsApp inválido: DDD e número de celular (ex.: (48) 99999-9999).",
  cep: "CEP inválido: são 8 números.",
  logradouro: "Informe a rua (logradouro).",
  numero: "Informe o número (ou S/N).",
  complemento: "Complemento longo demais.",
  bairro: "Informe o bairro.",
  cidade: "Informe a cidade.",
  uf: "Escolha o estado (UF).",
  aceite: "Para continuar, aceite os termos de uso e a política de privacidade.",
} as const;

// Confere o formulário inteiro e devolve os dados na forma de guardar, ou um erro por campo.
export function validarDadosPessoais(f: Partial<Record<Campo | "aceite", string>>, hoje: string): ResultadoValidacao {
  const erros: Partial<Record<Campo | "aceite", string>> = {};
  const nomeCompleto = normalizarNome(f.nomeCompleto ?? "");
  const cpf = validarCpf(f.cpf ?? "");
  const dataNascimento = validarNascimento(f.dataNascimento ?? "", hoje);
  const whatsapp = normalizarWhatsapp(f.whatsapp ?? "");
  const cep = normalizarCep(f.cep ?? "");
  const logradouro = texto(f.logradouro, 150);
  const numeroDigitado = texto(f.numero, 20);
  const numero = numeroDigitado && /^s\/?n$/i.test(numeroDigitado) ? "S/N" : numeroDigitado;
  const complementoBruto = String(f.complemento ?? "").trim();
  const complemento = complementoBruto ? texto(complementoBruto, 80) : null;
  const bairro = texto(f.bairro, 80);
  const cidade = texto(f.cidade, 80);
  const uf = String(f.uf ?? "").trim().toUpperCase();
  if (!nomeCompleto) erros.nomeCompleto = MENSAGENS.nomeCompleto;
  if (!cpf) erros.cpf = MENSAGENS.cpf;
  if (!dataNascimento) erros.dataNascimento = MENSAGENS.dataNascimento;
  if (!whatsapp) erros.whatsapp = MENSAGENS.whatsapp;
  if (!cep) erros.cep = MENSAGENS.cep;
  if (!logradouro) erros.logradouro = MENSAGENS.logradouro;
  if (!numero) erros.numero = MENSAGENS.numero;
  if (complementoBruto && !complemento) erros.complemento = MENSAGENS.complemento;
  if (!bairro) erros.bairro = MENSAGENS.bairro;
  if (!cidade) erros.cidade = MENSAGENS.cidade;
  if (!(UFS as readonly string[]).includes(uf)) erros.uf = MENSAGENS.uf;
  if (f.aceite !== "on" && f.aceite !== "true") erros.aceite = MENSAGENS.aceite;
  if (Object.keys(erros).length) return { ok: false, erros };
  return { ok: true, dados: { nomeCompleto: nomeCompleto!, cpf: cpf!, dataNascimento: dataNascimento!, whatsapp: whatsapp!, cep: cep!, logradouro: logradouro!, numero: numero!, complemento, bairro: bairro!, cidade: cidade!, uf } };
}

// Máscaras da tela, enquanto o usuário digita (só formatação: quem decide é a validação acima).
export function mascararCpf(v: string): string {
  const d = soDigitos(v).slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
}

export function mascararCep(v: string): string {
  const d = soDigitos(v).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export function mascararTelefone(v: string): string {
  let d = soDigitos(v);
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  const resto = d.slice(2);
  const corte = d.length === 11 ? 5 : 4;
  return resto.length > corte ? `(${d.slice(0, 2)}) ${resto.slice(0, corte)}-${resto.slice(corte)}` : `(${d.slice(0, 2)}) ${resto}`;
}
