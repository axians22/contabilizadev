// Os textos do limite de lucro isento sem contabilidade (aba Declaração anual), por ano. A partir de 2026 a Lei
// 15.270/2025 (reforma do Imposto de Renda) criou a retenção de 10% sobre lucros acima de R$ 50 mil no mês e a
// tributação mínima das rendas altas; a Receita Federal entende que valem também para o Simples Nacional (Perguntas e
// respostas sobre lucros e dividendos, dez/2025, questão 10). Por isso o "sem Imposto de Renda" só vale até 2025.
import { brl } from "@contabilizadev/nucleo/formato";
import { PRESUNCAO_SERVICOS } from "@contabilizadev/nucleo/serpro/defis";

// Primeiro ano em que a Lei 15.270/2025 alcança os lucros pagos (em vigor desde 01/01/2026).
export const ANO_DA_REFORMA_DO_IR = 2026;

const RETENCAO =
  "Desde 2026 o limite isento não afasta a retenção: se a empresa pagar ao mesmo sócio mais de R$ 50.000,00 de lucros no mesmo mês, retém 10% sobre o total pago naquele mês e recolhe em DARF (Lei 9.250/1995, art. 6º-A, incluído pela Lei 15.270/2025). Segundo a Receita Federal, vale também para o Simples Nacional. Lucros de resultados até 2025, com a distribuição aprovada até 31/12/2025, ficam fora.";
const ALTAS_RENDAS =
  "Se o sócio tiver mais de R$ 600.000,00 de rendimentos no ano, os lucros entram também na tributação mínima do Imposto de Renda das rendas altas (Lei 9.250/1995, art. 16-A); o imposto retido é abatido ali ou, abaixo desse valor, pode ser restituído na declaração.";

export function explicacaoDoLimiteIsento(ano: number, r: { receita: number; irpj: number; limiteLucroIsento: number }): string[] {
  const conta = `De onde vem (LC 123/2006, art. 14): a Receita presume que 32% do que uma empresa de serviços fatura é lucro; desse valor sai o IRPJ já pago dentro do DAS. Em ${ano}: 32% de ${brl(r.receita)} = ${brl(r.receita * PRESUNCAO_SERVICOS)}, menos ${brl(r.irpj)} de IRPJ = ${brl(r.limiteLucroIsento)}.`;
  const contabilidade = "Com contabilidade completa (balanço e livro diário, feitos por contador), o limite passa a ser o lucro que a contabilidade mostrar, que pode ser maior.";
  const acima = "Sem contabilidade, o que passar do limite entra como rendimento tributável no Imposto de Renda do sócio, com alíquota de até 27,5%.";
  if (ano < ANO_DA_REFORMA_DO_IR) {
    return [
      `É o máximo de lucro que o sócio pode tirar da empresa em ${ano} sem pagar Imposto de Renda, quando a empresa não tem contabilidade completa.`,
      conta,
      contabilidade,
      acima,
    ];
  }
  return [
    `É o máximo de lucro que o sócio pode tirar da empresa em ${ano} como rendimento isento, fora da tabela do Imposto de Renda, quando a empresa não tem contabilidade completa.`,
    conta,
    RETENCAO,
    ALTAS_RENDAS,
    contabilidade,
    acima,
  ];
}

// O que fazer quando o lucro retirado passa do limite (o aviso abaixo dos campos do cliente).
export function explicacaoDoLucroAcima(ano: number): string[] {
  return [
    ano < ANO_DA_REFORMA_DO_IR
      ? "Sem contabilidade completa, só o limite isento sai sem Imposto de Renda; o que passar entra como rendimento tributável do sócio."
      : "Sem contabilidade completa, só o limite isento sai como rendimento isento; o que passar entra como rendimento tributável do sócio. Se a empresa pagar ao mesmo sócio mais de R$ 50.000,00 de lucros no mês, ainda retém 10% sobre o total pago naquele mês (Lei 15.270/2025).",
    "Se um contador mantém a contabilidade da empresa, o limite é o lucro contábil: confirme com ele antes de declarar.",
  ];
}
