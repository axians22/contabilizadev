// Autentica Procurador (Integra Contador): envio do termo de autorização assinado (AUTENTICAPROCURADOR /
// ENVIOXMLASSINADO81), que devolve o token usado nas chamadas seguintes no header autenticar_procurador_token
// (cliente.ts, opção tokenProcurador). Roda só no servidor, depois de conferirTermo (conferir-termo.ts).
//
// Fontes oficiais (prefixo: https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-contador-gerenciador):
// - .../autenticaprocurador/servicos/envio_de_xml_assinado/: dados = {"xml": base64}; saída autenticar_procurador_token e
//   data_hora_expiracao "yyyy-MM-dd'T'HH:mm:ss" (horário de Brasília).
// - .../autenticaprocurador/cache/: termo repetido com token ainda válido = HTTP 304 sem corpo, token no header etag
//   "autenticar_procurador_token:<token>" e a expiração no header expires (RFC 7231, GMT). O token vale até a
//   meia-noite do dia seguinte, horário de Brasília.
// - .../autenticaprocurador/mensagens/: os códigos AUTENTICAPROCURADOR-0xx, classificados abaixo.
// As mensagens da API nunca vão para a tela: o erro leva o motivo, e a plataforma escolhe a mensagem própria.
import type { ClienteSerpro, Contribuinte, Mensagem } from "./cliente.ts";
import { textoMensagens } from "./cliente.ts";

export const PEDIDO_AUTENTICA_PROCURADOR = { idSistema: "AUTENTICAPROCURADOR", idServico: "ENVIOXMLASSINADO81", versaoSistema: "1.0" } as const;

export type TokenProcurador = {
  token: string;
  expiraEm: Date;
  reaproveitado: boolean; // HTTP 304: o termo já estava em cache e veio o mesmo token
};

// Por que o envio não deu certo (a tela traduz cada um para uma mensagem própria):
// - certificado-vencido: 010; certificado-revogado: 037;
// - certificado: o certificado não serve (009 tipo, 011 titular diferente, 021 sem ICP-Brasil, 023 não autorizado,
//   039/040 cadeia, 041 autoassinado, 008/014 erro ao ler o certificado);
// - vigencia: 017 (vigência vencida) ou 018 (data de assinatura no futuro);
// - termo: XML ou assinatura recusados (002, 013, 015, 016, 019, 020, 025 a 034, 038);
// - configuracao: problema do lado da plataforma (012 contratante diferente, 401/403 do gateway, limite do contrato);
// - indisponivel: falha temporária (rede, 5xx, 429, tempo esgotado; 003 erro ao efetuar login);
// - desconhecido: qualquer outra resposta.
export type MotivoRecusa = "certificado-vencido" | "certificado-revogado" | "certificado" | "vigencia" | "termo" | "configuracao" | "indisponivel" | "desconhecido";

const POR_CODIGO: Record<string, MotivoRecusa> = {
  "002": "termo",
  "003": "indisponivel",
  "008": "certificado",
  "009": "certificado",
  "010": "certificado-vencido",
  "011": "certificado",
  "012": "configuracao",
  "013": "termo",
  "014": "certificado",
  "015": "termo",
  "016": "termo",
  "017": "vigencia",
  "018": "vigencia",
  "019": "termo",
  "020": "termo",
  "021": "certificado",
  "023": "certificado",
  "025": "termo",
  "026": "termo",
  "027": "termo",
  "028": "termo",
  "029": "termo",
  "030": "termo",
  "031": "termo",
  "032": "termo",
  "033": "termo",
  "034": "termo",
  "037": "certificado-revogado",
  "038": "termo",
  "039": "certificado",
  "040": "certificado",
  "041": "certificado",
};

export class ErroAutenticaProcurador extends Error {
  readonly motivo: MotivoRecusa;
  readonly status: number | null;
  readonly codigo: string | null; // ex.: "010" (de AUTENTICAPROCURADOR-010)
  constructor(motivo: MotivoRecusa, detalhe: string, status: number | null, codigo: string | null = null) {
    super(detalhe);
    this.motivo = motivo;
    this.status = status;
    this.codigo = codigo;
  }
}

export function classificarRecusa(status: number, mensagens: Mensagem[]): { motivo: MotivoRecusa; codigo: string | null } {
  for (const m of mensagens) {
    const codigo = /AUTENTICAPROCURADOR-(\d{3})/.exec(`${m.codigo} ${m.texto}`)?.[1];
    if (codigo) return { motivo: POR_CODIGO[codigo] ?? "desconhecido", codigo };
  }
  if (status === 429 || status >= 500) return { motivo: "indisponivel", codigo: null };
  if (status === 401 || status === 403) return { motivo: "configuracao", codigo: null };
  return { motivo: "desconhecido", codigo: null };
}

// "2022-08-12T00:00:01" (sem fuso) é horário de Brasília (UTC-3, sem horário de verão desde 2019).
export function lerDataHoraBrasilia(valor: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(valor);
  if (!m) return null;
  const data = new Date(`${valor}-03:00`);
  if (Number.isNaN(data.getTime())) return null;
  // Date aceita 2022-02-30 (vira março): confere que o dia lido é o escrito.
  const volta = new Date(data.getTime() - 3 * 60 * 60 * 1000).toISOString();
  return volta.slice(0, 19) === valor ? data : null;
}

// Resposta 304: etag "autenticar_procurador_token:<token>" e expires no formato da RFC 7231 (GMT).
export function lerCache(cabecalhos: Record<string, string>): { token: string; expiraEm: Date } | null {
  const etag = cabecalhos.etag ?? "";
  const token = /autenticar_procurador_token:([^"\s]+)/.exec(etag)?.[1];
  const expiraEm = cabecalhos.expires ? new Date(cabecalhos.expires) : null;
  if (!token || !expiraEm || Number.isNaN(expiraEm.getTime())) return null;
  return { token, expiraEm };
}

// Envia o termo assinado. contribuinte = autor do pedido = a empresa que assinou (e-CNPJ). Erros de rede viram
// "indisponivel" (o detalhe técnico fica na mensagem do erro, para o log).
export async function enviarTermo(cliente: ClienteSerpro, xml: string, empresa: Contribuinte, finalidade: string): Promise<TokenProcurador> {
  let r;
  try {
    r = await cliente.chamar(
      "Apoiar",
      { ...PEDIDO_AUTENTICA_PROCURADOR, dados: { xml: Buffer.from(xml, "utf8").toString("base64") } },
      finalidade,
      { contribuinte: empresa, autorPedidoDados: empresa },
    );
  } catch (erro) {
    const texto = (erro as Error).message;
    // O limite do contrato (cliente.ts) é da plataforma, não do cliente.
    throw new ErroAutenticaProcurador(/Limite de \d+ chamadas/.test(texto) ? "configuracao" : "indisponivel", texto, null);
  }
  if (r.status === 304) {
    const cache = lerCache(r.cabecalhos ?? {});
    if (!cache) throw new ErroAutenticaProcurador("desconhecido", "Resposta 304 sem o token no etag ou sem o expires.", 304);
    return { ...cache, reaproveitado: true };
  }
  const dados = r.dados as { autenticar_procurador_token?: unknown; data_hora_expiracao?: unknown } | null | undefined;
  if (r.status >= 200 && r.status < 300 && typeof dados?.autenticar_procurador_token === "string" && dados.autenticar_procurador_token) {
    const expiraEm = typeof dados.data_hora_expiracao === "string" ? lerDataHoraBrasilia(dados.data_hora_expiracao) : null;
    if (!expiraEm) throw new ErroAutenticaProcurador("desconhecido", "Token devolvido sem data_hora_expiracao válida.", r.status);
    return { token: dados.autenticar_procurador_token, expiraEm, reaproveitado: false };
  }
  const { motivo, codigo } = classificarRecusa(r.status, r.mensagens);
  throw new ErroAutenticaProcurador(motivo, `HTTP ${r.status}: ${textoMensagens(r.mensagens) || "sem mensagens"}`, r.status, codigo);
}
