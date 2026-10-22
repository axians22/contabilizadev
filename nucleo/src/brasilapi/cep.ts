// Consulta pública de CEP na BrasilAPI (gratuita, sem chave): GET https://brasilapi.com.br/api/cep/v1/{cep}.
// Devolve o endereço do CEP (logradouro, bairro, cidade e UF) para preencher o cadastro pessoal; não grava nada: quem
// guarda (banco primeiro) é a plataforma. O fetch entra por parâmetro, como na consulta de CNPJ (cnpj.ts): nos testes a
// BrasilAPI nunca é chamada.
// As mensagens de erro chegam à tela: nunca citam o fornecedor.
import type { Buscar } from "./cnpj.ts";

export const URL_BRASILAPI_CEP = "https://brasilapi.com.br/api/cep/v1/";
export const TEMPO_LIMITE_CEP_MS = 8_000;

export type EnderecoDoCep = { cep: string; logradouro: string | null; bairro: string | null; cidade: string; uf: string };

export type MotivoErroCep = "cep-invalido" | "nao-encontrado" | "indisponivel";

export class ErroConsultaCep extends Error {
  readonly motivo: MotivoErroCep;
  constructor(motivo: MotivoErroCep, mensagem: string) {
    super(mensagem);
    this.motivo = motivo;
  }
}

// CEP com 8 dígitos (com ou sem traço). null se não for.
export function normalizarCep(cep: string): string | null {
  const digitos = String(cep ?? "").replace(/[\s.-]/g, "");
  return /^\d{8}$/.test(digitos) && !/^0{8}$/.test(digitos) ? digitos : null;
}

export const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"] as const;

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

// Lê o JSON da BrasilAPI. Sem cidade ou UF válida, a resposta não serve (o cliente digita o endereço).
export function lerRespostaCep(json: unknown, cepPedido: string): EnderecoDoCep {
  const o = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  const cidade = texto(o?.city);
  const uf = texto(o?.state)?.toUpperCase() ?? null;
  if (!o || !cidade || !uf || !(UFS as readonly string[]).includes(uf)) throw new ErroConsultaCep("indisponivel", "Não conseguimos ler o endereço deste CEP. Preencha o endereço à mão.");
  return { cep: normalizarCep(texto(o.cep) ?? "") ?? cepPedido, logradouro: texto(o.street), bairro: texto(o.neighborhood), cidade, uf };
}

const CABECALHOS = { Accept: "application/json", "User-Agent": "ContabilizaDev/1.0" };

export async function consultarCep(cepDigitado: string, opcoes: { buscar?: Buscar; tempoLimiteMs?: number; base?: string } = {}): Promise<EnderecoDoCep> {
  const cep = normalizarCep(cepDigitado);
  if (!cep) throw new ErroConsultaCep("cep-invalido", "CEP inválido: são 8 números.");
  const buscar: Buscar = opcoes.buscar ?? ((url, init) => fetch(url, init));
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), opcoes.tempoLimiteMs ?? TEMPO_LIMITE_CEP_MS);
  const fora = () => new ErroConsultaCep("indisponivel", "Não foi possível buscar o CEP agora. Preencha o endereço à mão.");
  try {
    let resposta: Awaited<ReturnType<Buscar>>;
    try {
      resposta = await buscar(`${opcoes.base ?? URL_BRASILAPI_CEP}${cep}`, { signal: controle.signal, headers: CABECALHOS });
    } catch {
      throw fora();
    }
    if (resposta.status === 404 || resposta.status === 400) throw new ErroConsultaCep("nao-encontrado", "Não achamos este CEP. Confira o número ou preencha o endereço à mão.");
    if (resposta.status !== 200) throw fora();
    let json: unknown;
    try {
      json = await resposta.json();
    } catch {
      throw fora();
    }
    return lerRespostaCep(json, cep);
  } finally {
    clearTimeout(relogio);
  }
}
