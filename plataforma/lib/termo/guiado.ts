// Modo guiado: para cada função da plataforma que depende da Receita Federal, o caminho para o cliente fazer ele mesmo
// no portal enquanto a empresa não tem autorização em dia (sem termo de autorização, termo vencido ou recusado).
//
// Como usar nas próximas partes (5 em diante):
//   const situacao = await situacaoTermo(await termoDoServidor(), acesso);   // só banco, não chama nada
//   if (liberada(situacao)) { const ctx = await contextoSerpro(deps, acesso); ...faz pela plataforma com ctx... }
//   else <FacaNoPortal funcao="declaracaoMensal" situacao={situacao} />   (app/(painel)/faca-no-portal.tsx)
// ou, na tela, <SeAutomatico funcao=... situacao=...>{o botão que faz sozinho}</SeAutomatico>, que mostra o aviso no
// lugar enquanto não há autorização em dia. Os valores calculados pela plataforma (receita, DAS etc.) entram em
// `children` do aviso, para o cliente copiar no portal. contextoSerpro (termo.ts) devolve o contribuinte, o autor do
// pedido e o token (banco primeiro; renova sozinho com o termo guardado). Se mesmo assim a Receita recusar o termo
// guardado, ele fica marcado como recusado e a tela volta para o modo guiado.
import { dataBr } from "@contabilizadev/nucleo/formato";
import type { Situacao } from "./situacao";

// Funções da plataforma que dependem da Receita Federal. Com o termo, todas ficam liberadas juntas (o termo autoriza a
// plataforma a agir em nome da empresa, sem lista de serviços); a lista serve ao caminho de cada uma no modo guiado.
// O eSocial (Parte 7) não depende do termo: o modo guiado dele é para quem não quer ou não pode assinar os eventos aqui
// (esocial) e para a empresa que ainda não tem o cadastro inicial no eSocial (cadastroEsocial).
export const FUNCOES = ["declaracaoMensal", "guiaDoMes", "declaracaoAnual", "dctfweb", "caixaPostal", "situacaoFiscal", "pagamentos", "parcelamento", "esocial", "cadastroEsocial"] as const;
export type Funcao = (typeof FUNCOES)[number];

export const PORTAL_SIMPLES = { nome: "Portal do Simples Nacional", url: "https://www8.receita.fazenda.gov.br/SimplesNacional/Servicos/Grupo.aspx?grp=t&area=1" };
export const ECAC = { nome: "e-CAC", url: "https://cav.receita.fazenda.gov.br" };
export const PORTAL_ESOCIAL = { nome: "portal do eSocial", url: "https://login.esocial.gov.br/" };

export type CaminhoManual = { nome: string; portal: { nome: string; url: string }; passos: string[] };

export const CAMINHOS: Record<Funcao, CaminhoManual> = {
  declaracaoMensal: {
    nome: "Declaração mensal do Simples (PGDAS-D)",
    portal: PORTAL_SIMPLES,
    passos: [
      "Abra o PGDAS-D no Portal do Simples Nacional e entre com o certificado digital da empresa ou com o código de acesso.",
      "Escolha \"Declarar/Retificar\" e o mês de apuração.",
      "Lance a receita de exportação com os valores que a plataforma calculou e confira o valor do DAS.",
      "Transmita a declaração e guarde o recibo.",
    ],
  },
  guiaDoMes: {
    nome: "Guia do mês (DAS)",
    portal: PORTAL_SIMPLES,
    passos: [
      "Abra o PGDAS-D no Portal do Simples Nacional e entre com o certificado digital ou o código de acesso.",
      "Escolha \"Emitir Guia de Pagamento (DAS)\", marque o mês e gere a guia.",
      "Pague até o vencimento (dia 20, ou o dia útil seguinte se o dia 20 não for dia útil).",
    ],
  },
  declaracaoAnual: {
    nome: "Declaração anual do Simples (DEFIS)",
    portal: PORTAL_SIMPLES,
    passos: [
      "Abra a DEFIS no Portal do Simples Nacional e entre com o certificado digital ou o código de acesso.",
      "Escolha o ano-calendário e preencha com os dados que a plataforma mostra.",
      "Transmita até 31 de março e guarde o recibo.",
    ],
  },
  dctfweb: {
    nome: "DCTFWeb e guia do INSS do pró-labore",
    portal: ECAC,
    passos: [
      "Entre no e-CAC com a conta gov.br ou o certificado digital da empresa.",
      "Abra \"Declarações e Demonstrativos\" → \"DCTFWeb\" e escolha o mês.",
      "Confira a declaração gerada a partir do eSocial, transmita e emita a guia (DARF).",
    ],
  },
  caixaPostal: {
    nome: "Mensagens da Receita Federal (Caixa Postal)",
    portal: ECAC,
    passos: ["Entre no e-CAC com a conta gov.br ou o certificado digital da empresa.", "Abra \"Caixa Postal\" e leia as mensagens novas."],
  },
  situacaoFiscal: {
    nome: "Situação fiscal (pendências)",
    portal: ECAC,
    passos: [
      "Entre no e-CAC com a conta gov.br ou o certificado digital da empresa.",
      "Abra \"Certidões e Situação Fiscal\" → \"Consulta Pendências - Situação Fiscal\" e gere o relatório.",
    ],
  },
  pagamentos: {
    nome: "Pagamentos e comprovantes",
    portal: ECAC,
    passos: [
      "Entre no e-CAC com a conta gov.br ou o certificado digital da empresa.",
      "Abra \"Pagamentos e Parcelamentos\" → \"Consulta Comprovante de Pagamento - DARF, DAS, DAE e DJE\".",
    ],
  },
  esocial: {
    nome: "Pró-labore no eSocial",
    portal: PORTAL_ESOCIAL,
    passos: [
      "Entre no portal do eSocial com o certificado digital da empresa (ou a conta gov.br do responsável) e escolha o eSocial Web Geral.",
      "Abra \"Folha de Pagamento\" → \"Gestão da Folha\" e escolha o mês (mensal).",
      "Na remuneração do sócio (CPF abaixo), lance as duas rubricas com os valores abaixo.",
      "Em pagamentos, informe a data e o valor líquido do pró-labore pago no mês, se houver.",
      "Feche a folha do mês (é o fechamento que manda a DCTFWeb do INSS) e confira os recibos.",
      "Volte aqui e marque \"Já lancei no portal\".",
    ],
  },
  cadastroEsocial: {
    nome: "Cadastro inicial da empresa no eSocial",
    portal: PORTAL_ESOCIAL,
    passos: [
      "Entre no portal do eSocial com o certificado digital da empresa e escolha o eSocial Web Geral (ou peça ao contador, que costuma fazer este cadastro).",
      "Empregador: as informações do empregador, com a classificação tributária do Simples Nacional.",
      "Tabelas: a tabela de rubricas, com a rubrica do pró-labore e a do INSS descontado do sócio, e a lotação tributária.",
      "Trabalhador sem vínculo: o cadastro do sócio (categoria 721, 722 ou 723) com a matrícula.",
      "Volte aqui e importe os cadastros do eSocial, ou preencha o formulário.",
    ],
  },
  parcelamento: {
    nome: "Parcelamento do Simples Nacional",
    portal: PORTAL_SIMPLES,
    passos: [
      "Abra \"Parcelamento - Simples Nacional\" no Portal do Simples Nacional e entre com o certificado digital ou o código de acesso.",
      "Consulte o pedido ou emita a guia da parcela do mês.",
    ],
  },
};

// Por que as funções estão no modo guiado (uma frase; o mesmo motivo vale para todas, porque o termo é um só).
export function motivoGuiado(situacao: Situacao): string {
  switch (situacao.estado) {
    case "ausente":
      return "Autorização pendente: a empresa ainda não assinou o termo de autorização.";
    case "vencida":
      return `A autorização venceu em ${dataBr(situacao.validaAte)}: até assinar de novo, faça no portal.`;
    case "recusada":
      return "A Receita Federal recusou a autorização guardada: até assinar de novo, faça no portal.";
    default:
      return "Disponível depois da autorização: até lá, faça no portal.";
  }
}
