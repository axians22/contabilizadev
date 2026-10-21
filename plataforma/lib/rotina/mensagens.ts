// Mensagens próprias da rotina do mês (o cliente nunca vê o texto da API nem o nome do fornecedor; a fonte é sempre a
// Receita Federal). O detalhe técnico vai só para o log do servidor, com o prefixo [serpro].
import { RESPOSTA_SEM_PDF } from "@contabilizadev/nucleo/pdf";

export const MENSAGENS_DA_ROTINA = {
  semAutorizacao: "Disponível depois da autorização da empresa. Até lá, faça no portal com os valores abaixo.",
  indisponivel: "A ligação com a Receita Federal ainda não está disponível. Faça no portal com os valores abaixo.",
  falhou: "A Receita Federal não respondeu agora. Nada foi alterado; tente de novo mais tarde.",
  limite: "Muitas chamadas à Receita Federal neste período. Tente de novo mais tarde.",
  recusou: "A Receita Federal recusou o pedido. Confira os valores e tente de novo; se continuar, faça no portal.",
  semRegra: "Esta empresa ainda não é atendida pela rotina do mês (confira o diagnóstico em Dados da empresa).",
  semConfirmacao: "Para enviar, confirme o resumo marcando a caixa de confirmação.",
  confirmacaoMudou: "Os valores mudaram desde que você abriu a confirmação. Confira de novo antes de enviar.",
  simuleAntes: "Simule na Receita Federal antes de transmitir.",
  simulacaoDiferente: "A simulação da Receita Federal não bateu com o cálculo da plataforma. Nada foi transmitido.",
  receitaMudou: "A receita ou a folha mudou desde a simulação. Simule de novo.",
  transmitindo: "Esta declaração já está sendo transmitida. Aguarde um instante e recarregue a página.",
  jaTransmitida: "A declaração deste mês já foi transmitida pela plataforma.",
  incerta:
    "A última transmissão ficou sem resposta da Receita Federal: ela pode ter sido recebida. Atualize o Histórico para conferir antes de transmitir de novo.",
  mesAberto: "O mês ainda não terminou. A declaração só pode ser feita a partir do mês seguinte.",
  jaDeclarado: "Este mês já foi declarado. Para corrigir, faça uma retificação.",
  nadaARetificar: "Este mês ainda não foi declarado: não há declaração para retificar.",
  semDeclaracao: "A guia só pode ser gerada depois da declaração do mês.",
  dctfConfiraAntes: "Confira a declaração antes de transmitir.",
  dctfRetificar: "A DCTFWeb deste mês já foi transmitida. Para corrigir o pró-labore, retifique no eSocial (o novo fechamento manda a DCTFWeb de novo).",
  dctfValorDiferente: "O valor da DCTFWeb não bate com o INSS do pró-labore informado. Confira o pró-labore e o eSocial do mês.",
  dctfSemProLabore: "Informe o pró-labore do mês antes de conferir a DCTFWeb.",
  dctfSemTransmissao: "O DARF só pode ser gerado com a DCTFWeb transmitida.",
  dctfPeloEsocial: "A DCTFWeb deste mês é transmitida pelo eSocial, no fechamento do pró-labore. Confira a declaração para ver o recibo e gerar o DARF.",
  certificadoDeOutraEmpresa: "O certificado precisa ser o e-CNPJ A1 da própria empresa.",
  assinaturaInvalida: "A assinatura não confere com o certificado. Abra o certificado e assine de novo.",
  preparoVencido: "A assinatura preparada não vale mais. Abra o certificado e assine de novo.",
  ptax: "Não deu para buscar a cotação agora. Informe o valor em reais que caiu na conta.",
  receitaPendente: "Lance a receita do mês (ou marque que não houve receita) antes de simular ou declarar.",
  semReceitaComLancamento: "Há receita lançada neste mês. Remova os lançamentos antes de marcar que não houve receita.",
  receitaInvalida: "Confira a data, a moeda e o valor recebido.",
  prolaboreInvalido: "Informe o pró-labore do mês em reais (zero se não houve).",
  dataDePagamento: "Escolha um dia útil de hoje até o fim deste mês.",
  guiaSemAutorizacao: "Disponível depois da autorização da empresa. Até lá, pegue a guia no portal.",
  semComprovante: "A Receita Federal ainda não mostrou o pagamento desta guia. Atualize o Histórico ou veja o comprovante no portal.",
  naoEPdf: "A Receita Federal devolveu um arquivo que não abre. Nada foi guardado; tente de novo mais tarde.",
  originalVencida: "A guia original venceu e não vale mais. Gere a guia com multa e juros para o dia em que vai pagar.",
} as const;

// Tradução do bloqueio do núcleo (pgdasd.ts, bloqueioTransmissao) na mensagem da tela.
export function mensagemDoBloqueio(bloqueio: string): string {
  if (/não terminou/.test(bloqueio)) return MENSAGENS_DA_ROTINA.mesAberto;
  if (/não há declaração para retificar/.test(bloqueio)) return MENSAGENS_DA_ROTINA.nadaARetificar;
  if (/já foi declarado/.test(bloqueio)) return MENSAGENS_DA_ROTINA.jaDeclarado;
  return MENSAGENS_DA_ROTINA.jaTransmitida;
}

// Tradução da falha da chamada (texto técnico do núcleo) na mensagem da tela.
export function mensagemDaFalha(detalhe: string): string {
  if (detalhe.startsWith(RESPOSTA_SEM_PDF)) return MENSAGENS_DA_ROTINA.naoEPdf;
  if (/Limite de \d+ chamadas/i.test(detalhe)) return MENSAGENS_DA_ROTINA.limite;
  if (/data de pagamento|dia útil/i.test(detalhe)) return MENSAGENS_DA_ROTINA.dataDePagamento;
  if (/^HTTP \d|^\[?(Erro|Aviso|EntradaIncorreta|AcessoNegado)/i.test(detalhe) || /: /.test(detalhe)) return MENSAGENS_DA_ROTINA.recusou;
  return MENSAGENS_DA_ROTINA.falhou;
}
