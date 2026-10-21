// Mensagens próprias do eSocial na tela. Para o cliente a fonte é "eSocial" (o nome do portal do governo); nada de
// termos técnicos da ligação nem do contrato da plataforma. O detalhe técnico vai só para o log, com o prefixo [esocial].
// As ocorrências de um evento recusado são o texto do próprio eSocial (o mesmo que o portal mostra) e vão no tooltip.
import { ErroLoteRecusado } from "@contabilizadev/nucleo/esocial/lote";
import { ErroConsultaEsocial } from "@contabilizadev/nucleo/esocial/leitura";
import { rotuloMes } from "@contabilizadev/nucleo/meses";

export const MENSAGENS_DO_ESOCIAL = {
  indisponivel: "O envio ao eSocial por aqui ainda não está disponível. Lance no portal do eSocial com os valores deste passo.",
  importacaoIndisponivel: "A importação do eSocial por aqui ainda não está disponível. Preencha o formulário.",
  semConfig: "Configure os cadastros do eSocial da empresa antes de enviar (aba eSocial).",
  semProLabore: "Informe o pró-labore do mês (passo 2) antes de enviar ao eSocial.",
  proLaboreZero: "Sem pró-labore no mês: não há remuneração a enviar ao eSocial.",
  mesAberto: "O mês ainda não terminou. O pró-labore vai ao eSocial a partir do mês seguinte.",
  emAndamento: "O envio deste mês ao eSocial já está em andamento. Aguarde o resultado.",
  incerto: "O último envio ficou sem resposta do eSocial: ele pode ter chegado. Use \"Enviar de novo\" (os mesmos eventos, sem duplicar).",
  jaEnviado: "O pró-labore deste mês já está no eSocial. Para corrigir, use a retificação.",
  concluido: "O mês já está completo no eSocial.",
  nadaARetificar: "Não há remuneração deste mês no eSocial para retificar.",
  mesmoValor: "O pró-labore informado é o mesmo que está no eSocial: não há o que retificar.",
  semConfirmacao: "Para enviar, confirme o resumo marcando a caixa de confirmação.",
  confirmacaoMudou: "Os valores mudaram desde que você abriu a confirmação. Confira de novo antes de enviar.",
  preparoVencido: "A assinatura preparada não vale mais. Assine de novo.",
  assinaturaInvalida: "A assinatura não confere com o certificado. Abra o certificado e assine de novo.",
  certificadoDeOutraEmpresa: "O certificado precisa ser o e-CNPJ A1 da própria empresa.",
  eventoInvalido: "Os eventos não passaram na conferência do leiaute oficial do eSocial. Confira os cadastros na aba eSocial.",
  recusado: "O eSocial recusou o envio. Confira os cadastros na aba eSocial e o que o eSocial respondeu.",
  falhou: "O eSocial não respondeu agora. Nada foi alterado; tente de novo mais tarde.",
  dataDoPagamento: "A data do pagamento precisa estar dentro do mês.",
  diasUmASete: "O eSocial não aceita consultas do dia 1 ao dia 7 de cada mês. Importe a partir do dia 8 ou preencha o formulário.",
  limiteDoDia: "O eSocial permite 10 consultas por dia por empresa e o limite de hoje acabou. Tente amanhã ou preencha o formulário.",
  semPermissao: "O eSocial só deixa consultar com o certificado digital da própria empresa.",
  nadaAchado: "Nenhum evento do sócio foi achado no eSocial nesse mês. Escolha outro mês ou preencha o formulário.",
  semCadastroNosEventos: "Os eventos baixados não trazem as duas rubricas (pró-labore e INSS). Preencha o formulário.",
  cpfInvalido: "Confira o CPF do sócio.",
  configInvalida: "Confira os campos destacados.",
  pedidoVencido: "A consulta preparada não vale mais. Comece a importação de novo.",
  dctfTransmitindo: "A DCTFWeb deste mês está sendo transmitida por aqui (ou ficou sem resposta). Confira a DCTFWeb no passo seguinte antes de enviar ao eSocial.",
} as const;

// Pago no mês seguinte e sem o demonstrativo do mês anterior aqui (o pagamento feito neste mês não teria como ir).
export const mensagemSemDemonstrativo = (mes: string) =>
  `O pró-labore de ${rotuloMes(mes)} é pago neste mês, mas o envio dele ao eSocial não está aqui. Importe ${rotuloMes(mes)} do eSocial (aba eSocial) ou marque que o mês vai sem esse pagamento.`;

// A falha da chamada ao eSocial (texto técnico do núcleo) na mensagem da tela.
export function mensagemDaFalhaEsocial(erro: unknown): string {
  if (erro instanceof ErroLoteRecusado) return MENSAGENS_DO_ESOCIAL.recusado;
  if (erro instanceof ErroConsultaEsocial) {
    if (erro.cdResposta === "405") return MENSAGENS_DO_ESOCIAL.limiteDoDia;
    if (erro.cdResposta === "403") return MENSAGENS_DO_ESOCIAL.diasUmASete;
    if (["407", "411"].includes(erro.cdResposta)) return MENSAGENS_DO_ESOCIAL.semPermissao;
    return MENSAGENS_DO_ESOCIAL.falhou;
  }
  const texto = (erro as Error)?.message ?? "";
  if (/dias 1 a 7/.test(texto)) return MENSAGENS_DO_ESOCIAL.diasUmASete;
  if (/Limite de \d+ consultas/.test(texto)) return MENSAGENS_DO_ESOCIAL.limiteDoDia;
  return MENSAGENS_DO_ESOCIAL.falhou;
}
