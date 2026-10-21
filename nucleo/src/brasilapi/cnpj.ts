// Consulta pública de CNPJ na BrasilAPI (gratuita, sem chave): GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}.
// Devolve os dados da Receita já arrumados (razão social, CNAEs, Simples/MEI, sócios, situação cadastral); não grava
// nada: quem guarda no banco é a plataforma. O fetch entra por parâmetro: nos testes ele devolve respostas gravadas
// (brasilapi/exemplos), e a BrasilAPI nunca é chamada.
import { normalizarCnae } from "../cnae.ts";
import { cnpjValido } from "../formato.ts";

export const URL_BRASILAPI_CNPJ = "https://brasilapi.com.br/api/cnpj/v1/";
export const TEMPO_LIMITE_MS = 15_000;

// O pedaço do fetch que o cliente usa (o fetch global serve).
export type Buscar = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ status: number; json(): Promise<unknown> }>;

export type MotivoErroCnpj = "cnpj-invalido" | "nao-encontrado" | "limite" | "indisponivel" | "tempo-esgotado" | "resposta-invalida";

export class ErroConsultaCnpj extends Error {
  readonly motivo: MotivoErroCnpj;
  constructor(motivo: MotivoErroCnpj, mensagem: string) {
    super(mensagem);
    this.motivo = motivo;
  }
}

export type CnaeReceita = { codigo: string; descricao: string }; // código só com dígitos (7)
export type Socio = { nome: string; qualificacao: string; dataEntrada: string | null; faixaEtaria: string | null };
// optante: true/false como a Receita informa; null quando ela não informa.
export type Opcao = { optante: boolean | null; dataOpcao: string | null; dataExclusao: string | null };
// Endereço da sede como a Receita guarda (cep com 8 dígitos). Campo que a Receita não informa vem null.
export type Endereco = { logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; cep: string | null };

export type DadosCnpj = {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  situacaoCadastral: string; // ATIVA, BAIXADA, INAPTA, SUSPENSA, NULA
  dataSituacaoCadastral: string | null;
  naturezaJuridica: { codigo: string; descricao: string }; // código com 4 dígitos (2062 = Sociedade Empresária Limitada)
  dataInicioAtividade: string | null;
  porte: string | null;
  municipio: string | null;
  uf: string | null;
  // Opcional: consultas guardadas antes de 17/10/2026 não têm o endereço.
  endereco?: Endereco;
  cnaePrincipal: CnaeReceita;
  cnaesSecundarios: CnaeReceita[];
  simples: Opcao;
  mei: Opcao;
  socios: Socio[];
};

const objeto = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const data = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const simNao = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const numeroOuTexto = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) ? String(v) : texto(v));

function invalida(detalhe: string): ErroConsultaCnpj {
  return new ErroConsultaCnpj("resposta-invalida", `A consulta à Receita Federal voltou com dados que não deu para ler (${detalhe}). Tente de novo mais tarde.`);
}

// CNAE como a BrasilAPI manda (número, sem o zero da frente). Código 0 é "sem CNAE": versões da BrasilAPI mandam
// cnaes_secundarios = [{ codigo: 0, descricao: "" }] para quem não tem secundário.
function cnae(v: unknown): CnaeReceita | null {
  const o = objeto(v);
  const codigo = numeroOuTexto(o?.codigo);
  if (!codigo || /^0+$/.test(codigo.replace(/\D/g, ""))) return null;
  const normalizado = normalizarCnae(codigo);
  if (normalizado.length !== 7) return null;
  return { codigo: normalizado, descricao: texto(o?.descricao) ?? "" };
}

// CEP com 8 dígitos (a BrasilAPI pode mandar como número, perdendo o zero da frente).
function cep(v: unknown): string | null {
  const digitos = numeroOuTexto(v)?.replace(/\D/g, "") ?? "";
  return digitos && digitos.length <= 8 && !/^0+$/.test(digitos) ? digitos.padStart(8, "0") : null;
}

// "RUA" + "DOS EXEMPLOS" -> "RUA DOS EXEMPLOS"; sem repetir o tipo quando o logradouro já começa com ele.
function logradouro(tipo: string | null, nome: string | null): string | null {
  if (!nome) return tipo;
  return tipo && !nome.toUpperCase().startsWith(tipo.toUpperCase()) ? `${tipo} ${nome}` : nome;
}

// Endereço em uma linha: "RUA DOS EXEMPLOS, 100, SALA 1 - CENTRO - CEP 88010-000". null se não houver nada.
export function enderecoEmLinha(e: Endereco | undefined | null, municipio?: string | null, uf?: string | null): string | null {
  const rua = e ? [e.logradouro, e.numero, e.complemento].filter(Boolean).join(", ") : "";
  const cidade = municipio ? `${municipio}${uf ? `/${uf}` : ""}` : "";
  const cep = e?.cep ? `CEP ${e.cep.replace(/^(\d{5})(\d{3})$/, "$1-$2")}` : "";
  const partes = [rua, e?.bairro ?? "", cidade, cep].filter(Boolean);
  return partes.length ? partes.join(" - ") : null;
}

// Lê o JSON da BrasilAPI. Lança ErroConsultaCnpj("resposta-invalida") se faltar o essencial.
export function lerRespostaCnpj(json: unknown): DadosCnpj {
  const o = objeto(json);
  if (!o) throw invalida("não é um objeto");
  const cnpj = texto(o.cnpj)?.toUpperCase();
  const razaoSocial = texto(o.razao_social);
  const situacao = texto(o.descricao_situacao_cadastral)?.toUpperCase();
  if (!cnpj || !razaoSocial || !situacao) throw invalida("sem CNPJ, razão social ou situação cadastral");
  const principal = cnae({ codigo: o.cnae_fiscal, descricao: o.cnae_fiscal_descricao });
  if (!principal) throw invalida("sem CNAE principal");
  const codigoNatureza = numeroOuTexto(o.codigo_natureza_juridica)?.replace(/\D/g, "") ?? "";
  const secundarios = Array.isArray(o.cnaes_secundarios) ? o.cnaes_secundarios.map(cnae).filter((c): c is CnaeReceita => c !== null) : [];
  const socios = Array.isArray(o.qsa)
    ? o.qsa.map(objeto).flatMap((s) => {
        const nome = texto(s?.nome_socio);
        return nome
          ? [{ nome, qualificacao: texto(s?.qualificacao_socio) ?? "", dataEntrada: data(s?.data_entrada_sociedade), faixaEtaria: texto(s?.faixa_etaria) }]
          : [];
      })
    : [];
  return {
    cnpj,
    razaoSocial,
    nomeFantasia: texto(o.nome_fantasia),
    situacaoCadastral: situacao,
    dataSituacaoCadastral: data(o.data_situacao_cadastral),
    naturezaJuridica: { codigo: codigoNatureza ? codigoNatureza.padStart(4, "0") : "", descricao: texto(o.natureza_juridica) ?? "" },
    dataInicioAtividade: data(o.data_inicio_atividade),
    porte: texto(o.porte),
    municipio: texto(o.municipio),
    uf: texto(o.uf),
    endereco: {
      logradouro: logradouro(texto(o.descricao_tipo_de_logradouro), texto(o.logradouro)),
      numero: texto(o.numero),
      complemento: texto(o.complemento),
      bairro: texto(o.bairro),
      cep: cep(o.cep),
    },
    cnaePrincipal: principal,
    // Sem repetir o principal nem um secundário (a Receita às vezes repete).
    cnaesSecundarios: secundarios.filter((c, i) => c.codigo !== principal.codigo && secundarios.findIndex((d) => d.codigo === c.codigo) === i),
    simples: { optante: simNao(o.opcao_pelo_simples), dataOpcao: data(o.data_opcao_pelo_simples), dataExclusao: data(o.data_exclusao_do_simples) },
    mei: { optante: simNao(o.opcao_pelo_mei), dataOpcao: data(o.data_opcao_pelo_mei), dataExclusao: data(o.data_exclusao_do_mei) },
    socios,
  };
}

// Sem User-Agent, o Cloudflare da BrasilAPI recusa o fetch do Node com 403.
const CABECALHOS = { Accept: "application/json", "User-Agent": "ContabilizaDev/1.0" };

export type OpcoesConsulta = { buscar?: Buscar; tempoLimiteMs?: number; base?: string };

// Consulta o CNPJ (numérico ou alfanumérico, com ou sem pontuação). Erros sempre como ErroConsultaCnpj, com uma
// mensagem que dá para mostrar ao cliente.
export async function consultarCnpj(cnpj: string, opcoes: OpcoesConsulta = {}): Promise<DadosCnpj> {
  const numero = cnpj.replace(/[.\-/\s]/g, "").toUpperCase();
  if (!cnpjValido(numero)) throw new ErroConsultaCnpj("cnpj-invalido", "CNPJ inválido: confira os números (os dígitos verificadores não batem).");
  const buscar: Buscar = opcoes.buscar ?? ((url, init) => fetch(url, init));
  const tempo = opcoes.tempoLimiteMs ?? TEMPO_LIMITE_MS;
  const alfanumerico = /[A-Z]/.test(numero);

  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), tempo);
  try {
    let resposta: Awaited<ReturnType<Buscar>>;
    try {
      resposta = await buscar(`${opcoes.base ?? URL_BRASILAPI_CNPJ}${numero}`, { signal: controle.signal, headers: CABECALHOS });
    } catch {
      if (controle.signal.aborted) throw new ErroConsultaCnpj("tempo-esgotado", `A Receita Federal não respondeu em ${tempo / 1000} segundos. Tente de novo.`);
      throw new ErroConsultaCnpj("indisponivel", "Não foi possível consultar a Receita Federal agora. Confira a conexão e tente de novo.");
    }
    const { status } = resposta;
    if (status === 404 || status === 400) {
      // 400 é o "CNPJ inválido" da BrasilAPI; o dígito verificador já foi conferido aqui, então é um número que a
      // Receita não conhece (ou alfanumérico novo que a base pública ainda não tem).
      throw new ErroConsultaCnpj(
        "nao-encontrado",
        alfanumerico
          ? "CNPJ não encontrado na base pública da Receita. CNPJs alfanuméricos são novos (desde julho de 2026) e podem demorar a aparecer; tente de novo mais tarde."
          : "CNPJ não encontrado na Receita Federal. Confira o número digitado.",
      );
    }
    if (status === 429) throw new ErroConsultaCnpj("limite", "Muitas consultas seguidas à Receita Federal. Espere um minuto e tente de novo.");
    if (status >= 500) throw new ErroConsultaCnpj("indisponivel", `A consulta à Receita Federal está fora do ar agora (erro ${status}). Tente de novo em alguns minutos.`);
    if (status !== 200) throw new ErroConsultaCnpj("indisponivel", `A consulta à Receita Federal deu um erro inesperado (${status}). Tente de novo mais tarde.`);
    let json: unknown;
    try {
      json = await resposta.json();
    } catch {
      if (controle.signal.aborted) throw new ErroConsultaCnpj("tempo-esgotado", `A Receita Federal não respondeu em ${tempo / 1000} segundos. Tente de novo.`);
      throw invalida("o corpo não é JSON");
    }
    const dados = lerRespostaCnpj(json);
    if (dados.cnpj !== numero) throw invalida(`veio o CNPJ ${dados.cnpj} no lugar de ${numero}`);
    return dados;
  } finally {
    clearTimeout(relogio);
  }
}
