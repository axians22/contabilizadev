// Textos da Caixa Postal (aba Mensagens). O cliente nunca vê o texto da API nem o nome do fornecedor: a fonte é sempre a
// Receita Federal. O detalhe técnico vai só para o log do servidor, com o prefixo [serpro].

export const MENSAGENS_DA_CAIXA = {
  indisponivel: "A consulta à Receita Federal ainda não está disponível.",
  semAutorizacao: "Disponível depois da autorização da empresa.",
  falhou: "A Receita Federal não respondeu agora. Tente de novo mais tarde.",
  limite: "Muitas consultas à Receita Federal neste período. Tente de novo mais tarde.",
  emDia: "As mensagens já estão em dia.",
  espere: (minutos: number) => `Consultado há pouco. Tente de novo em ${minutos} ${minutos === 1 ? "minuto" : "minutos"}.`,
  atualizada: (novas: number) => (novas === 0 ? "Nenhuma mensagem nova." : novas === 1 ? "1 mensagem nova." : `${novas} mensagens novas.`),
  naoEncontrada: "Mensagem não encontrada.",
  confirme: "Para abrir, confirme que sabe que a Receita Federal vai registrar a ciência.",
  abrindo: "Esta mensagem já está sendo aberta. Aguarde um instante e recarregue a página.",
  semResposta: "A Receita Federal não respondeu. A ciência pode ter sido registrada: tente abrir de novo.",
  aberta: "Mensagem aberta.",
} as const;

// A confirmação antes de abrir uma mensagem ainda não lida: o que ela faz na Receita, em uma frase clara.
export const AVISO_DE_CIENCIA = "Ao abrir, a Receita registra que você tomou ciência desta mensagem.";

// O que a ciência significa (tooltip da confirmação e da aba). Decreto 70.235/1972, art. 23, § 2º, III: por meio
// eletrônico, a intimação vale 15 dias depois da entrega na Caixa Postal, ou na data em que o contribuinte abre a
// mensagem, se isso acontecer antes. A documentação oficial do serviço que traz o conteúdo diz que chamá-lo "caracteriza
// ciência da intimação", como abrir no e-CAC.
export const EXPLICACAO_DA_CIENCIA = [
  "Abrir uma mensagem aqui é o mesmo que abrir na Caixa Postal do e-CAC: a Receita Federal registra a data da ciência (Decreto 70.235/1972, art. 23, § 2º, III).",
  "Se for uma intimação, o prazo para responder começa a contar dessa data.",
  "Sem abrir, a Receita considera a ciência 15 dias depois da entrega na Caixa Postal. Por isso a lista mostra só o assunto: o conteúdo é buscado só quando você pede.",
];

// Tradução da falha da chamada (texto técnico do núcleo) na mensagem da tela.
export function mensagemDaFalha(detalhe: string): string {
  if (/Limite de \d+ chamadas/i.test(detalhe)) return MENSAGENS_DA_CAIXA.limite;
  return MENSAGENS_DA_CAIXA.falhou;
}
