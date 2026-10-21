// Só para testes: respostas do eSocial no formato do MOD v1.16, com dados fictícios, e um cliente que as devolve.
// As marcadas "gravada" vêm de respostas reais do ../fiscal (15/10/2026), anonimizadas: CNPJ 11.222.333/0001-81, CPF
// 529.982.247-25 (ambos de exemplo), sem a assinatura e o certificado originais.
import { DOMParser } from "@xmldom/xmldom";
import type { ParametrosFolha } from "./eventos.ts";
import type { Ambiente, RespostaEsocial, Servico } from "./ws.ts";

export const soap = (corpo: string) =>
  `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${corpo}</s:Body></s:Envelope>`;

export function resposta(xml: string, http = 200): RespostaEsocial {
  const doc = new DOMParser().parseFromString(xml, "text/xml") as unknown as Document;
  const texto = (nome: string) => doc.getElementsByTagNameNS("*", nome)[0]?.textContent?.trim() ?? "";
  return { http, doc, xml, cdResposta: texto("cdResposta"), descricao: texto("descResposta") };
}

export const ENVIO_ACEITO = soap(
  `<EnviarLoteEventosResponse><retornoEnvioLoteEventos><status><cdResposta>201</cdResposta><descResposta>Lote Recebido com Sucesso.</descResposta></status>` +
    `<dadosRecepcaoLote><protocoloEnvio>1.2.202610.0000000000000001</protocoloEnvio></dadosRecepcaoLote></retornoEnvioLoteEventos></EnviarLoteEventosResponse>`,
);

export const ENVIO_RECUSADO = soap(
  `<retornoEnvioLoteEventos><status><cdResposta>401</cdResposta><descResposta>Lote Incorreto</descResposta>` +
    `<ocorrencias><ocorrencia><codigo>402</codigo><descricao>Schema inválido</descricao></ocorrencia></ocorrencias></status></retornoEnvioLoteEventos>`,
);

export const CONSULTA_PROCESSADA = soap(
  `<retornoProcessamentoLoteEventos><status><cdResposta>201</cdResposta><descResposta>Lote processado</descResposta></status>` +
    `<retornoEventos><evento Id="ID1112223330000002026101612000000001"><retornoEvento><eSocial><retornoEvento>` +
    `<processamento><cdResposta>201</cdResposta><descResposta>Sucesso.</descResposta></processamento>` +
    `<recibo><nrRecibo>1.1.0000000000000000001</nrRecibo></recibo></retornoEvento></eSocial></retornoEvento></evento>` +
    `<evento Id="ID2"><retornoEvento><eSocial><retornoEvento><processamento><cdResposta>401</cdResposta><descResposta>Erro</descResposta>` +
    `<ocorrencias><ocorrencia><tipo>1</tipo><codigo>537</codigo><descricao>Duplicado</descricao><localizacao>/eSocial/evtRemun</localizacao></ocorrencia></ocorrencias>` +
    `</processamento></retornoEvento></eSocial></retornoEvento></evento></retornoEventos></retornoProcessamentoLoteEventos>`,
);

export const DOWNLOAD = soap(
  `<download><status><cdResposta>201</cdResposta></status><arquivos>` +
    `<arquivo><status><cdResposta>201</cdResposta></status><evt Id="ID1"><eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtRemun/v_S_01_03_00"><evtRemun Id="ID1"><ideEvento><perApur>2026-09</perApur></ideEvento></evtRemun></eSocial></evt><rec nrRec="1.1.1"/></arquivo>` +
    `<arquivo><status><cdResposta>404</cdResposta></status></arquivo>` +
    `</arquivos></download>`,
);

export function esocialFalso(...respostas: RespostaEsocial[]) {
  const chamadas: { servico: Servico; ambiente: Ambiente; conteudo: string; finalidade: string }[] = [];
  return {
    chamadas,
    async chamar(servico: Servico, ambiente: Ambiente, conteudo: string, finalidade: string) {
      chamadas.push({ servico, ambiente, conteudo, finalidade });
      const r = respostas.shift();
      if (!r) throw new Error("Chamada não esperada pelo teste.");
      return r;
    },
  };
}

// Cadastros fictícios do sócio e da empresa (CNPJ e CPF válidos, mas de exemplo).
export const PARAMETROS: ParametrosFolha = {
  empregador: { cnpj: "11.222.333/0001-81" },
  cpf: "529.982.247-25",
  categoria: "723",
  matricula: "1",
  lotacao: "1",
  tabRubrica: "0001",
  rubricaProLabore: "100",
  rubricaInss: "843",
  qtdProLabore: "220.00",
  proLabore: 1621,
};

// Resposta da consulta de um lote processado, com o resultado de cada evento.
export type ResultadoFalso = { id: string; cd?: string; descricao?: string; recibo?: string; ocorrencias?: { codigo: string; descricao: string; localizacao?: string }[] };
export const consultaProcessada = (eventos: ResultadoFalso[]) =>
  soap(
    `<ConsultarLoteEventosResponse><retornoProcessamentoLoteEventos><status><cdResposta>201</cdResposta><descResposta>Lote processado com sucesso.</descResposta></status><retornoEventos>` +
      eventos
        .map((e) => {
          const cd = e.cd ?? "201";
          const ocorrencias = (e.ocorrencias ?? [])
            .map((o) => `<ocorrencia><tipo>1</tipo><codigo>${o.codigo}</codigo><descricao>${o.descricao}</descricao><localizacao>${o.localizacao ?? ""}</localizacao></ocorrencia>`)
            .join("");
          return (
            `<evento Id="${e.id}"><retornoEvento><eSocial><retornoEvento Id="${e.id}">` +
            `<processamento><cdResposta>${cd}</cdResposta><descResposta>${e.descricao ?? (cd === "201" ? "Sucesso." : "Conteudo do evento inválido.")}</descResposta>` +
            `${ocorrencias ? `<ocorrencias>${ocorrencias}</ocorrencias>` : ""}</processamento>` +
            `${cd === "201" || cd === "202" ? `<recibo><nrRecibo>${e.recibo ?? `1.1.${e.id.slice(-19)}`}</nrRecibo></recibo>` : ""}` +
            `</retornoEvento></eSocial></retornoEvento></evento>`
          );
        })
        .join("") +
      `</retornoEventos></retornoProcessamentoLoteEventos></ConsultarLoteEventosResponse>`,
  );

// Lote ainda em processamento (101), com o tempo estimado em segundos.
export const CONSULTA_AGUARDANDO = soap(
  `<retornoProcessamentoLoteEventos><status><cdResposta>101</cdResposta><descResposta>Lote Aguardando Processamento.</descResposta><tempoEstimadoConclusao>30</tempoEstimadoConclusao></status></retornoProcessamentoLoteEventos>`,
);

// Gravada (ambiente de testes, S-1000 sem indCoop): a ocorrência de um evento recusado.
export const OCORRENCIA_GRAVADA = {
  codigo: "1",
  descricao: "Campo de preenchimento obrigatório: Indicativo de cooperativa.",
  localizacao: "/eSocial/evtInfoEmpregador/infoEmpregador/inclusao/infoCadastro/indCoop",
};

// Gravada: consulta de identificadores do sócio com 5 eventos achados (só os 2 do mês interessam ao teste).
export const IDENTIFICADORES_DO_SOCIO = soap(
  `<ConsultarIdentificadoresEventosTrabalhadorResponse><eSocial><retornoConsultaIdentificadoresEvts><status><cdResposta>203</cdResposta>` +
    `<descResposta>Quantidade total de eventos encontrados de acordo com o filtro informado: 2. Data de envio do último evento retornado: 05/10/2026 13:29:01.</descResposta></status>` +
    `<retornoIdentificadoresEvts><qtdeTotEvtsConsulta>2</qtdeTotEvtsConsulta><dhUltimoEvtRetornado>2026-10-05T13:29:01</dhUltimoEvtRetornado><identificadoresEvts>` +
    `<identificadorEvt><id>ID1112223330000002026100513275300001</id><nrRec>1.1.0000000000000000101</nrRec></identificadorEvt>` +
    `<identificadorEvt><id>ID1112223330000002026100513275500002</id><nrRec>1.1.0000000000000000102</nrRec></identificadorEvt>` +
    `</identificadoresEvts></retornoIdentificadoresEvts></retornoConsultaIdentificadoresEvts></eSocial></ConsultarIdentificadoresEventosTrabalhadorResponse>`,
);

// Gravada: o S-1200 e o S-1210 de 09/2026 enviados pelo contador e baixados do eSocial (cadastros 723, matrícula 1,
// lotação 1, tabela 0001, rubricas 100 e 843, pagamento no dia 5 do mês seguinte).
export const S1200_GRAVADO =
  `<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtRemun/v_S_01_03_00"><evtRemun Id="ID1112223330000002026100513275300001"><ideEvento><indRetif>1</indRetif><indApuracao>1</indApuracao><perApur>2026-09</perApur><tpAmb>1</tpAmb><procEmi>1</procEmi><verProc>v_S_01_03_00</verProc></ideEvento>` +
  `<ideEmpregador><tpInsc>1</tpInsc><nrInsc>11222333</nrInsc></ideEmpregador><ideTrabalhador><cpfTrab>52998224725</cpfTrab></ideTrabalhador>` +
  `<dmDev><ideDmDev>092026MENSAL05102026132358</ideDmDev><codCateg>723</codCateg><infoPerApur><ideEstabLot><tpInsc>1</tpInsc><nrInsc>11222333000181</nrInsc><codLotacao>1</codLotacao>` +
  `<remunPerApur><matricula>1</matricula><itensRemun><codRubr>100</codRubr><ideTabRubr>0001</ideTabRubr><qtdRubr>220.00</qtdRubr><vrRubr>1621.00</vrRubr><indApurIR>0</indApurIR></itensRemun>` +
  `<itensRemun><codRubr>843</codRubr><ideTabRubr>0001</ideTabRubr><vrRubr>178.31</vrRubr><indApurIR>0</indApurIR></itensRemun></remunPerApur></ideEstabLot></infoPerApur></dmDev></evtRemun></eSocial>`;

export const S1210_GRAVADO =
  `<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtPgtos/v_S_01_03_00"><evtPgtos Id="ID1112223330000002026100513275500002"><ideEvento><indRetif>1</indRetif><perApur>2026-09</perApur><tpAmb>1</tpAmb><procEmi>1</procEmi><verProc>v_S_01_03_00</verProc></ideEvento>` +
  `<ideEmpregador><tpInsc>1</tpInsc><nrInsc>11222333</nrInsc></ideEmpregador><ideBenef><cpfBenef>52998224725</cpfBenef><infoPgto><dtPgto>2026-09-05</dtPgto><tpPgto>1</tpPgto><perRef>2026-08</perRef>` +
  `<ideDmDev>082026MENSAL02092026160358</ideDmDev><vrLiq>1442.69</vrLiq></infoPgto></ideBenef></evtPgtos></eSocial>`;

export const DOWNLOAD_DO_SOCIO = soap(
  `<SolicitarDownloadEventosPorIdResponse><eSocial><download><status><cdResposta>201</cdResposta><descResposta>Evento encontrado.</descResposta></status><arquivos>` +
    `<arquivo><status><cdResposta>201</cdResposta></status><evt Id="ID1112223330000002026100513275300001">${S1200_GRAVADO}</evt><rec nrRec="1.1.0000000000000000101"/></arquivo>` +
    `<arquivo><status><cdResposta>201</cdResposta></status><evt Id="ID1112223330000002026100513275500002">${S1210_GRAVADO}</evt><rec nrRec="1.1.0000000000000000102"/></arquivo>` +
    `</arquivos></download></eSocial></SolicitarDownloadEventosPorIdResponse>`,
);

// Gravada: o eSocial fora do ar para o download (308) e o limite do dia (405).
export const ERRO_308 = soap(`<eSocial><download><status><cdResposta>308</cdResposta><descResposta>Erro ao processar solicitação. Tente novamente mais tarde.</descResposta></status></download></eSocial>`);
export const LIMITE_405 = soap(
  `<eSocial><retornoConsultaIdentificadoresEvts><status><cdResposta>405</cdResposta><descResposta>É possível enviar somente 10 solicitações por dia. Seu limite está esgotado. Tente novamente amanhã.</descResposta></status></retornoConsultaIdentificadoresEvts></eSocial>`,
);
