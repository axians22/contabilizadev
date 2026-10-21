// Mensagens próprias do histórico (o cliente nunca vê o texto da API nem o nome do fornecedor; a fonte é a Receita
// Federal). O detalhe técnico vai só para o log do servidor.
import type { EtapaImportacao } from "@/banco/esquema";

export const NOMES_DAS_ETAPAS: Record<EtapaImportacao["id"], string> = {
  declaracoes: "Declarações mensais",
  extratos: "Extratos das declarações",
  pagamentos: "Pagamentos",
  defis: "Declaração anual (DEFIS)",
  situacao: "Situação fiscal",
};

export const MENSAGENS_DO_HISTORICO = {
  falhou: "A Receita Federal não respondeu agora. Tente de novo mais tarde.",
  limite: "Muitas consultas à Receita Federal neste período. Tente de novo mais tarde.",
  indisponivel: "A consulta à Receita Federal ainda não está disponível.",
  interrompida: "A importação foi interrompida. Tente de novo.",
  semAutorizacao: "Disponível depois da autorização da empresa.",
  rodando: "Já estamos buscando os dados na Receita Federal. Acompanhe aqui.",
  nadaNovo: "Os dados já estão em dia.",
  espere: (minutos: number) => `Consultado há pouco. Tente de novo em ${minutos} ${minutos === 1 ? "minuto" : "minutos"}.`,
};

// Tradução da falha de uma etapa (texto técnico do núcleo) na mensagem da tela.
export function mensagemDaFalha(detalhe: string): string {
  if (/Limite de \d+ chamadas/i.test(detalhe)) return MENSAGENS_DO_HISTORICO.limite;
  return MENSAGENS_DO_HISTORICO.falhou;
}

// Situação de cada mês no Histórico: o rótulo curto e o que ele quer dizer (tooltip).
export const SITUACOES_DO_MES = {
  pago: { rotulo: "Pago", explicacao: "O DAS da declaração que vale para o mês foi pago (consulta de pagamentos ou extrato da Receita Federal). Se a declaração foi retificada e gerou uma guia com a diferença, é essa guia que conta." },
  "em-aberto": { rotulo: "Em aberto", explicacao: "O DAS ainda não aparece como pago, mas está no prazo (vence no dia 20 do mês seguinte)." },
  vencido: {
    rotulo: "Vencido",
    explicacao: "O imposto do mês passou do vencimento sem pagamento na Receita Federal (o DAS não foi pago, ou nem foi gerado). Gere a guia atualizada com multa e juros para pagar.",
  },
  "sem-valor": { rotulo: "Sem valor a pagar", explicacao: "A declaração do mês não tem imposto a pagar (por exemplo, mês sem receita)." },
  "sem-guia": {
    rotulo: "Sem guia",
    explicacao: "O mês foi declarado com imposto a pagar (ou ainda não sabemos o valor), mas nenhuma guia (DAS) foi gerada para a declaração. Gere o DAS no Portal do Simples Nacional e pague até o vencimento.",
  },
  "nao-declarado": { rotulo: "Sem declaração", explicacao: "A Receita Federal não tem declaração do PGDAS-D para este mês, e o prazo (dia 20 do mês seguinte) já passou." },
  "no-prazo": { rotulo: "A declarar", explicacao: "O mês ainda não foi declarado, mas está no prazo (dia 20 do mês seguinte)." },
  "nao-importado": { rotulo: "Não importado", explicacao: "As declarações deste ano ainda não vieram da Receita Federal." },
} as const;
