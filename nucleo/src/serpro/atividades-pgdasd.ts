// Atividades do PGDAS-D (campo idAtividade da declaração no TRANSDECLARACAO11), transcritas do catálogo oficial:
// Integra Contador, Integra SN, PGDASD, Dados de domínio, tabela "Atividades"
// https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/dados_de_dominio
// Conferido com o extrato real de 09/2026 da empresa de referência (../fiscal): atividade 30 = "Prestação de Serviços
// para o exterior - Não sujeitos ao fator r e tributados pelo Anexo III".

export const FONTE_ATIVIDADES_PGDASD =
  "https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/dados_de_dominio";

export type AtividadePgdasd = { id: number; grupo: string; descricao: string; fatorR?: boolean };

const REVENDA = "Revenda de mercadorias, exceto para o exterior";
const INDUSTRIA = "Venda de mercadorias industrializadas pelo contribuinte, exceto para o exterior";
const SERVICOS = "Prestação de serviços, exceto para o exterior";
const CONSTRUCAO = "Prestação de serviços dos subitens 7.02, 7.05 e 16.1 da lista anexa à LC 116/2003, exceto para o exterior";
const EXTERIOR = "Prestação de serviços para o exterior";
const CONSTRUCAO_EXTERIOR = "Prestação de serviços dos subitens 7.02 e 7.05 da lista anexa à LC 116/2003, para o exterior";
const COMUNICACAO = "Comunicação e transporte intermunicipal/interestadual (LC 123, art. 17, VI), exceto para o exterior";
const COMUNICACAO_EXTERIOR = "Comunicação e transporte intermunicipal/interestadual (LC 123, art. 17, VI), para o exterior";
const IPI_ISS = "Atividades com incidência simultânea de IPI e de ISS, exceto para o exterior";

const SEM_ST = "Sem substituição tributária/tributação monofásica/antecipação com encerramento de tributação";
const COM_ST = "Com substituição tributária/tributação monofásica/antecipação com encerramento de tributação";
const OUTRO_MUN = "sem retenção/substituição tributária de ISS, com ISS devido a outro(s) Município(s)";
const PROPRIO_MUN = "sem retenção/substituição tributária de ISS, com ISS devido ao próprio Município do estabelecimento";
const RETENCAO = "com retenção/substituição tributária de ISS";
const CONTABIL = "Escritórios de serviços contábeis autorizados pela legislação municipal a pagar o ISS em valor fixo em guia do Município";
const CC_III = "Construção civil (subitens 7.02 e 7.05 da LC 116/2003) tributada pelo Anexo III";
const CC_IV = "Construção civil (subitens 7.02 e 7.05 da LC 116/2003) tributada pelo Anexo IV";
const TRANSPORTE_COLETIVO = "Transporte coletivo municipal rodoviário, metroviário, ferroviário e aquaviário de passageiros";

const a = (id: number, grupo: string, descricao: string, fatorR = false): AtividadePgdasd =>
  fatorR ? { id, grupo, descricao, fatorR } : { id, grupo, descricao };

export const ATIVIDADES_PGDASD: AtividadePgdasd[] = [
  a(1, REVENDA, SEM_ST),
  a(2, REVENDA, COM_ST),
  a(3, "Revenda de mercadorias para o exterior", "Revenda de mercadorias para o exterior"),
  a(4, INDUSTRIA, SEM_ST),
  a(5, INDUSTRIA, COM_ST),
  a(6, "Venda de mercadorias industrializadas pelo contribuinte para o exterior", "Venda de mercadorias industrializadas para o exterior"),
  a(7, "Locação de bens móveis, exceto para o exterior", "Locação de bens móveis, exceto para o exterior"),
  a(8, "Locação de bens móveis para o exterior", "Locação de bens móveis para o exterior"),
  a(9, SERVICOS, CONTABIL),
  a(10, SERVICOS, `Sujeitos ao fator "r", ${OUTRO_MUN}`, true),
  a(11, SERVICOS, `Sujeitos ao fator "r", ${PROPRIO_MUN}`, true),
  a(12, SERVICOS, `Sujeitos ao fator "r", ${RETENCAO}`, true),
  a(13, SERVICOS, `Não sujeitos ao fator "r" e tributados pelo Anexo III, ${OUTRO_MUN}`),
  a(14, SERVICOS, `Não sujeitos ao fator "r" e tributados pelo Anexo III, ${PROPRIO_MUN}`),
  a(15, SERVICOS, `Não sujeitos ao fator "r" e tributados pelo Anexo III, ${RETENCAO}`),
  a(16, SERVICOS, `Sujeitos ao Anexo IV, ${OUTRO_MUN}`),
  a(17, SERVICOS, `Sujeitos ao Anexo IV, ${PROPRIO_MUN}`),
  a(18, SERVICOS, `Sujeitos ao Anexo IV, ${RETENCAO}`),
  a(19, CONSTRUCAO, `${CC_III}, ${OUTRO_MUN}`),
  a(20, CONSTRUCAO, `${CC_III}, ${PROPRIO_MUN}`),
  a(21, CONSTRUCAO, `${CC_III}, ${RETENCAO}`),
  a(22, CONSTRUCAO, `${CC_IV}, ${OUTRO_MUN}`),
  a(23, CONSTRUCAO, `${CC_IV}, ${PROPRIO_MUN}`),
  a(24, CONSTRUCAO, `${CC_IV}, ${RETENCAO}`),
  a(25, CONSTRUCAO, `${TRANSPORTE_COLETIVO}, ${OUTRO_MUN}`),
  a(26, CONSTRUCAO, `${TRANSPORTE_COLETIVO}, ${PROPRIO_MUN}`),
  a(27, CONSTRUCAO, `${TRANSPORTE_COLETIVO}, ${RETENCAO}`),
  a(28, EXTERIOR, CONTABIL),
  a(29, EXTERIOR, `Sujeitos ao fator "r"`, true),
  a(30, EXTERIOR, `Não sujeitos ao fator "r" e tributados pelo Anexo III`),
  a(31, EXTERIOR, "Sujeitos ao Anexo IV"),
  a(32, CONSTRUCAO_EXTERIOR, CC_III),
  a(33, CONSTRUCAO_EXTERIOR, CC_IV),
  a(34, COMUNICACAO, "Transporte sem substituição tributária de ICMS"),
  a(35, COMUNICACAO, "Transporte com substituição tributária de ICMS"),
  a(36, COMUNICACAO, "Comunicação sem substituição tributária de ICMS"),
  a(37, COMUNICACAO, "Comunicação com substituição tributária de ICMS"),
  a(38, COMUNICACAO_EXTERIOR, "Transporte"),
  a(39, COMUNICACAO_EXTERIOR, "Comunicação"),
  a(40, IPI_ISS, `Sem retenção/substituição tributária de ISS, com ISS devido a outro(s) Município(s)`),
  a(41, IPI_ISS, `Sem retenção/substituição tributária de ISS, com ISS devido ao próprio Município do estabelecimento`),
  a(42, IPI_ISS, "Com retenção/substituição tributária de ISS"),
  a(43, "Atividades com incidência simultânea de IPI e de ISS para o exterior", "Atividades com incidência simultânea de IPI e de ISS para o exterior"),
];

export function atividadePgdasd(id: number): AtividadePgdasd {
  const atividade = ATIVIDADES_PGDASD.find((x) => x.id === id);
  if (!atividade) throw new Error(`Atividade ${id} não existe no catálogo do PGDAS-D.`);
  return atividade;
}

// Atividades sujeitas ao fator r: a declaração precisa da folha de salários dos meses do fator r (folhasSalario).
export const sujeitaAoFatorR = (id: number) => atividadePgdasd(id).fatorR === true;
