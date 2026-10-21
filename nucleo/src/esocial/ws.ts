// Webservices do eSocial (SOAP 1.1 com TLS mútuo). Fonte: MOD v1.16.
// O certificado da conexão é o do transmissor (na plataforma, o e-CNPJ dela; não precisa de vínculo com o empregador,
// §7.5.7) e vem por parâmetro, só em memória; os eventos e os pedidos de leitura chegam já assinados por quem pode
// assinar (o empregador). O registro das chamadas e a contagem do limite diário ficam com a plataforma.
import { DOMParser } from "@xmldom/xmldom";
import { transporteHttps, type CertificadoTls, type RespostaHttp, type Transporte } from "../http.ts";

export type Ambiente = "producao" | "restrita";
export const TP_AMB: Record<Ambiente, 1 | 2> = { producao: 1, restrita: 2 };

const HOST: Record<Ambiente, { envio: string; consulta: string; download: string }> = {
  producao: {
    envio: "https://webservices.envio.esocial.gov.br",
    consulta: "https://webservices.consulta.esocial.gov.br",
    download: "https://webservices.download.esocial.gov.br",
  },
  restrita: {
    envio: "https://webservices.producaorestrita.esocial.gov.br",
    consulta: "https://webservices.producaorestrita.esocial.gov.br",
    download: "https://webservices.producaorestrita.esocial.gov.br",
  },
};

const NS_SERVICO = {
  envio: "http://www.esocial.gov.br/servicos/empregador/lote/eventos/envio/v1_1_0",
  consulta: "http://www.esocial.gov.br/servicos/empregador/lote/eventos/envio/consulta/retornoProcessamento/v1_1_0",
  identificadores: "http://www.esocial.gov.br/servicos/empregador/consulta/identificadores-eventos/v1_0_0",
  download: "http://www.esocial.gov.br/servicos/empregador/download/solicitacao/v1_0_0",
};

export const SERVICOS = {
  enviarLote: {
    url: (a: Ambiente) => `${HOST[a].envio}/servicos/empregador/enviarloteeventos/WsEnviarLoteEventos.svc`,
    ns: NS_SERVICO.envio,
    acao: `${NS_SERVICO.envio}/ServicoEnviarLoteEventos/EnviarLoteEventos`,
    metodo: "EnviarLoteEventos",
    wrapper: "loteEventos",
  },
  consultarLote: {
    url: (a: Ambiente) => `${HOST[a].consulta}/servicos/empregador/consultarloteeventos/WsConsultarLoteEventos.svc`,
    ns: NS_SERVICO.consulta,
    acao: `${NS_SERVICO.consulta}/ServicoConsultarLoteEventos/ConsultarLoteEventos`,
    metodo: "ConsultarLoteEventos",
    wrapper: "consulta",
  },
  identificadoresTabela: {
    url: (a: Ambiente) => `${HOST[a].download}/servicos/empregador/dwlcirurgico/WsConsultarIdentificadoresEventos.svc`,
    ns: NS_SERVICO.identificadores,
    acao: `${NS_SERVICO.identificadores}/ServicoConsultarIdentificadoresEventos/ConsultarIdentificadoresEventosTabela`,
    metodo: "ConsultarIdentificadoresEventosTabela",
    wrapper: "consultaEventosTabela",
  },
  identificadoresTrabalhador: {
    url: (a: Ambiente) => `${HOST[a].download}/servicos/empregador/dwlcirurgico/WsConsultarIdentificadoresEventos.svc`,
    ns: NS_SERVICO.identificadores,
    acao: `${NS_SERVICO.identificadores}/ServicoConsultarIdentificadoresEventos/ConsultarIdentificadoresEventosTrabalhador`,
    metodo: "ConsultarIdentificadoresEventosTrabalhador",
    wrapper: "consultaEventosTrabalhador",
  },
  downloadPorId: {
    url: (a: Ambiente) => `${HOST[a].download}/servicos/empregador/dwlcirurgico/WsSolicitarDownloadEventos.svc`,
    ns: NS_SERVICO.download,
    acao: `${NS_SERVICO.download}/ServicoSolicitarDownloadEventos/SolicitarDownloadEventosPorId`,
    metodo: "SolicitarDownloadEventosPorId",
    wrapper: "solicitacao",
  },
} as const;
export type Servico = keyof typeof SERVICOS;

// Identificadores + download: no máximo 10 chamadas por dia e nenhuma nos dias 1 a 7 (MOD §7.7.7).
export const LIMITE_DIARIO_CONSULTAS = 10;
export const SERVICOS_LIMITADOS: Servico[] = ["identificadoresTabela", "identificadoresTrabalhador", "downloadPorId"];

export type ChamadaEsocial = {
  quando: Date;
  ambiente: Ambiente;
  servico: Servico;
  finalidade: string;
  status: number | null;
  resumo: string;
};

export type RegistroEsocial = {
  registrar(c: ChamadaEsocial): void | Promise<void>;
  // Consultas limitadas (SERVICOS_LIMITADOS) já feitas no dia de `quando`, no ambiente, que chegaram ao eSocial.
  consultasNoDia(ambiente: Ambiente, quando: Date): number | Promise<number>;
};

export type RespostaEsocial = { http: number; doc: Document; xml: string; cdResposta: string; descricao: string };

export const envelopeSoap = (servico: Servico, conteudo: string) => {
  const s = SERVICOS[servico];
  return (
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v1="${s.ns}">` +
    `<soapenv:Header/><soapenv:Body><v1:${s.metodo}><v1:${s.wrapper}>${conteudo}</v1:${s.wrapper}></v1:${s.metodo}>` +
    `</soapenv:Body></soapenv:Envelope>`
  );
};

export function criarClienteEsocial(o: { certificado: CertificadoTls; registro: RegistroEsocial; transporte?: Transporte; agora?: () => Date }) {
  const transporte = o.transporte ?? transporteHttps(90_000);
  const agora = o.agora ?? (() => new Date());

  async function consultasRestantes(ambiente: Ambiente): Promise<number> {
    return Math.max(0, LIMITE_DIARIO_CONSULTAS - (await o.registro.consultasNoDia(ambiente, agora())));
  }

  // Envia `conteudo` (o <eSocial> interno, sem declaração <?xml?>) e devolve o documento de resposta.
  async function chamar(servico: Servico, ambiente: Ambiente, conteudo: string, finalidade: string): Promise<RespostaEsocial> {
    if (!finalidade.trim()) throw new Error("Toda chamada ao eSocial precisa de uma finalidade registrada.");
    if (SERVICOS_LIMITADOS.includes(servico)) {
      if (agora().getDate() <= 7) throw new Error("O eSocial não aceita consultas de identificadores e downloads nos dias 1 a 7 do mês.");
      if ((await consultasRestantes(ambiente)) === 0) throw new Error(`Limite de ${LIMITE_DIARIO_CONSULTAS} consultas por dia ao eSocial atingido.`);
    }
    const s = SERVICOS[servico];
    const registrar = (status: number | null, resumo: string) =>
      o.registro.registrar({ quando: agora(), ambiente, servico, finalidade, status, resumo: resumo.slice(0, 2000) });
    let resposta: RespostaHttp;
    try {
      resposta = await transporte(
        s.url(ambiente),
        { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${s.acao}"` },
        envelopeSoap(servico, conteudo),
        o.certificado,
      );
    } catch (erro) {
      await registrar(null, (erro as Error).message);
      throw erro;
    }
    const doc = new DOMParser().parseFromString(resposta.texto, "text/xml") as unknown as Document;
    const cdResposta = texto(doc, "cdResposta");
    const descricao = texto(doc, "descResposta");
    await registrar(
      resposta.status,
      [cdResposta && `${cdResposta} ${descricao}`, resposta.status >= 400 ? resposta.texto.slice(0, 500) : ""].filter(Boolean).join(" | "),
    );
    return { http: resposta.status, doc, xml: resposta.texto, cdResposta, descricao };
  }

  return { chamar, consultasRestantes };
}

export type ClienteEsocial = ReturnType<typeof criarClienteEsocial>;

// Utilitários de leitura do XML de resposta (ignora prefixos de namespace).
export function elementos(no: Document | Element, nome: string): Element[] {
  return Array.from((no as Element).getElementsByTagNameNS("*", nome) as unknown as Element[]);
}
export function texto(no: Document | Element, nome: string): string {
  return elementos(no, nome)[0]?.textContent?.trim() ?? "";
}
