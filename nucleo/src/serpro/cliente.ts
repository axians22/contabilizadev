// Cliente do Serpro Integra Contador. Roda só no servidor.
// Regras do contrato (ver ../fiscal/docs/serpro.md): toda chamada é registrada com finalidade, há limite de chamadas
// por período de cobrança, nada é repetido automaticamente e declarações exigem confirmação.
// Nada é fixo: contratante (a plataforma), contribuinte (o cliente), chaves, certificado, registro e transporte vêm
// por parâmetro.
import { soDigitos } from "../formato.ts";
import { transporteHttps, type CertificadoTls, type RespostaHttp, type Transporte } from "../http.ts";
import { inicioDoPeriodo, precoUnitario, type TipoRequisicao } from "./precos.ts";

// A chamada saiu para o Serpro e a resposta não chegou (o transporte falhou depois de enviar).
export class ErroSemResposta extends Error {}

export const URL_AUTENTICACAO = "https://autenticacao.sapi.serpro.gov.br/authenticate";
export const URL_API = "https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/";

export type Acao = "Consultar" | "Emitir" | "Declarar" | "Apoiar";
// "Apoiar" (ex.: pedir protocolo do relatório de situação fiscal) é contado como consulta.
export const TIPO_DA_ACAO: Record<Acao, TipoRequisicao> = {
  Consultar: "consulta",
  Emitir: "emissao",
  Declarar: "declaracao",
  Apoiar: "consulta",
};

// tipo 1 = CPF, 2 = CNPJ (padrão do Integra Contador). O CNPJ pode ser alfanumérico (FAQ do Integra Contador: o campo
// numero aceita letras maiúsculas de A a Z, com os dígitos verificadores numéricos).
export type Contribuinte = { numero: string; tipo: 1 | 2 };
export const cnpj = (numero: string): Contribuinte => ({ numero: numero.toUpperCase().replace(/[^0-9A-Z]/g, ""), tipo: 2 });
export const cpf = (numero: string): Contribuinte => ({ numero: soDigitos(numero), tipo: 1 });

export type Pedido = { idSistema: string; idServico: string; versaoSistema: string; dados: Record<string, unknown> | string };
export type Mensagem = { codigo: string; texto: string };
export type Resposta = { status: number; dados: unknown; mensagens: Mensagem[]; cabecalhos?: Record<string, string> };

export type ChamadaRegistrada = {
  quando: Date;
  acao: Acao | "Autenticar";
  servico: string;
  finalidade: string;
  contribuinte: string | null;
  status: number | null; // null = não chegou ao Serpro
  mensagens: string;
  custo: number;
};

// Onde as chamadas ficam guardadas (no banco da plataforma). `consumo` conta as chamadas cobradas desde `desde`.
export type RegistroSerpro = {
  registrar(chamada: ChamadaRegistrada): void | Promise<void>;
  consumo(desde: Date): Record<TipoRequisicao, number> | Promise<Record<TipoRequisicao, number>>;
};

export type OpcoesClienteSerpro = {
  consumerKey: string;
  consumerSecret: string;
  certificado: CertificadoTls; // e-CNPJ da plataforma (contratante)
  contratante: string; // CNPJ da plataforma
  limitePorPeriodo: number; // chamadas cobradas por período de cobrança (21 a 20)
  registro: RegistroSerpro;
  transporte?: Transporte;
  agora?: () => Date;
};

export type OpcoesChamada = {
  contribuinte: Contribuinte;
  // Padrão: a plataforma (contratante). Para o cliente, é a própria empresa, que assinou o termo de autorização.
  autorPedidoDados?: Contribuinte;
  // Token do Autentica Procurador (autentica-procurador.ts): vai no header autenticar_procurador_token. Exigido quando
  // o autor do pedido não é o contratante (ICGERENCIADOR-019, Mensagens do Gerenciador).
  tokenProcurador?: string;
  confirmado?: boolean; // obrigatório para transmitir declaração
};

type Tokens = { accessToken: string; jwtToken: string; expira: number };

export const textoMensagens = (m: Mensagem[]) => m.map((x) => `${x.codigo}: ${x.texto}`).join(" | ");

function validarContribuinte(c: Contribuinte, nome: string) {
  const formato = c.tipo === 1 ? /^\d{11}$/ : /^[0-9A-Z]{12}\d{2}$/;
  if (!formato.test(c.numero)) throw new Error(`${nome} inválido: ${c.tipo === 1 ? "CPF com 11 dígitos" : "CNPJ com 14 caracteres"}.`);
}

export function criarClienteSerpro(o: OpcoesClienteSerpro) {
  if (!o.consumerKey || !o.consumerSecret) throw new Error("Faltam as chaves de acesso do Serpro (consumer key e secret).");
  const contratante = cnpj(o.contratante);
  validarContribuinte(contratante, "Contratante");
  const transporte = o.transporte ?? transporteHttps(60_000);
  const agora = o.agora ?? (() => new Date());
  let tokens: Tokens | undefined;

  const registrar = (c: Omit<ChamadaRegistrada, "quando">) =>
    o.registro.registrar({ ...c, quando: agora(), mensagens: c.mensagens.slice(0, 1000) });

  async function autenticar(finalidade: string): Promise<Tokens> {
    if (tokens && tokens.expira > agora().getTime()) return tokens;
    const base = { acao: "Autenticar" as const, servico: "SAPI", finalidade, contribuinte: null, custo: 0 };
    let resposta: RespostaHttp;
    try {
      resposta = await transporte(
        URL_AUTENTICACAO,
        {
          Authorization: "Basic " + Buffer.from(`${o.consumerKey}:${o.consumerSecret}`).toString("base64"),
          "Role-Type": "TERCEIROS",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        "grant_type=client_credentials",
        o.certificado,
      );
    } catch (erro) {
      await registrar({ ...base, status: null, mensagens: (erro as Error).message });
      throw erro;
    }
    if (resposta.status !== 200) {
      await registrar({ ...base, status: resposta.status, mensagens: resposta.texto });
      throw new Error(`Autenticação recusada pelo Serpro (HTTP ${resposta.status}).`);
    }
    const corpo = JSON.parse(resposta.texto) as { access_token: string; jwt_token: string; expires_in: number };
    await registrar({ ...base, status: 200, mensagens: "" });
    tokens = {
      accessToken: corpo.access_token,
      jwtToken: corpo.jwt_token,
      expira: agora().getTime() + (corpo.expires_in - 60) * 1000,
    };
    return tokens;
  }

  async function chamar(acao: Acao, pedido: Pedido, finalidade: string, opcoes: OpcoesChamada): Promise<Resposta> {
    if (!finalidade.trim()) throw new Error("Toda chamada ao Serpro precisa de uma finalidade registrada.");
    validarContribuinte(opcoes.contribuinte, "Contribuinte");
    if (opcoes.autorPedidoDados) validarContribuinte(opcoes.autorPedidoDados, "Autor do pedido");
    if (opcoes.tokenProcurador !== undefined && !/^[\w.-]+$/.test(opcoes.tokenProcurador)) throw new Error("Token de procurador inválido.");
    // Simular (indicadorTransmissao = false) não envia nada; transmitir exige confirmação explícita.
    const transmite =
      acao === "Declarar" && (typeof pedido.dados === "string" || pedido.dados.indicadorTransmissao !== false);
    if (transmite && !opcoes.confirmado) throw new Error("Declarações exigem confirmação explícita.");
    const uso = await o.registro.consumo(inicioDoPeriodo(agora()));
    const total = uso.consulta + uso.emissao + uso.declaracao;
    if (total >= o.limitePorPeriodo) {
      throw new Error(`Limite de ${o.limitePorPeriodo} chamadas no período de cobrança atingido. Nada foi enviado.`);
    }

    const t = await autenticar(finalidade);
    const servico = `${pedido.idSistema}/${pedido.idServico}`;
    const corpo = JSON.stringify({
      contratante,
      autorPedidoDados: opcoes.autorPedidoDados ?? contratante,
      contribuinte: opcoes.contribuinte,
      pedidoDados: { ...pedido, dados: typeof pedido.dados === "string" ? pedido.dados : JSON.stringify(pedido.dados) },
    });
    const tipo = TIPO_DA_ACAO[acao];
    const custo = precoUnitario(tipo, uso[tipo] + 1);
    const base = { acao, servico, finalidade, contribuinte: opcoes.contribuinte.numero };

    let resposta: RespostaHttp;
    try {
      resposta = await transporte(URL_API + acao, {
        Authorization: `Bearer ${t.accessToken}`,
        jwt_token: t.jwtToken,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(opcoes.tokenProcurador ? { autenticar_procurador_token: opcoes.tokenProcurador } : {}),
      }, corpo);
    } catch (erro) {
      await registrar({ ...base, status: null, mensagens: (erro as Error).message, custo: 0 });
      // O pedido saiu e a resposta não veio (tempo esgotado, conexão caída): não dá para saber se a Receita recebeu.
      throw new ErroSemResposta((erro as Error).message);
    }
    if (resposta.status === 401) tokens = undefined;

    let json: { status?: number; dados?: unknown; mensagens?: Mensagem[] };
    try {
      json = JSON.parse(resposta.texto);
    } catch {
      json = { mensagens: [{ codigo: String(resposta.status), texto: resposta.texto.slice(0, 500) }] };
    }
    const mensagens = json.mensagens ?? [];
    // Requisições que chegam ao serviço são cobradas; recusas do gateway não, mas registramos o custo máximo possível.
    await registrar({ ...base, status: resposta.status, mensagens: textoMensagens(mensagens), custo });

    let dados = json.dados;
    if (typeof dados === "string" && dados.trim()) {
      try {
        dados = JSON.parse(dados);
      } catch {
        // mantém como texto
      }
    }
    return { status: json.status ?? resposta.status, dados, mensagens, cabecalhos: resposta.cabecalhos ?? {} };
  }

  return {
    chamar,
    autenticar,
    esquecerTokens: () => {
      tokens = undefined;
    },
  };
}

export type ClienteSerpro = Pick<ReturnType<typeof criarClienteSerpro>, "chamar">;

// Utilitários para ler respostas.
export const respostaOk = (r: Resposta) => r.status >= 200 && r.status < 300;
export const primeiro = <T>(dados: unknown): T | undefined => (Array.isArray(dados) ? dados[0] : dados) as T | undefined;

// Resultado das etapas (declarar, emitir, consultar): a plataforma guarda o que vier, inclusive as recusas.
// semResposta: o pedido saiu e a resposta não veio. Numa transmissão, a Receita pode ter recebido a declaração: quem
// chama não transmite de novo sem conferir antes (a plataforma marca a transmissão como incerta).
export type Resultado<T = object> = ({ ok: true; detalhe: string } & T) | { ok: false; detalhe: string; semResposta?: boolean };
export const falha = (detalhe: string): { ok: false; detalhe: string } => ({ ok: false, detalhe });
export const falhaDoErro = (erro: unknown): { ok: false; detalhe: string; semResposta?: boolean } =>
  erro instanceof ErroSemResposta ? { ok: false, detalhe: erro.message, semResposta: true } : falha((erro as Error).message);

// Quem é o cliente em cada chamada (vai direto como OpcoesChamada). Para o cliente com o termo de autorização, o autor
// do pedido de dados é a própria empresa e o token vem do Autentica Procurador (plataforma: lib/termo/termo.ts,
// contextoSerpro). Para a empresa da própria plataforma, o autor é o contratante e não há token.
export type Contexto = { contribuinte: Contribuinte; autorPedidoDados?: Contribuinte; tokenProcurador?: string };
