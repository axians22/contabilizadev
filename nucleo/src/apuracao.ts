// Apuração do mês (rotina do mês): com a regra do CNAE, a receita do mês e as receitas e folhas dos meses anteriores,
// calcula a RBT12, o Fator R (quando a atividade depende dele), o anexo, o código da atividade no PGDAS-D e o DAS.
// E o aviso do Fator R perto de 28%: o pró-labore que faltaria para ficar no Anexo III e a economia estimada.
// Funções puras: nada é fixo de empresa (CNAE, receitas, folhas e início de atividade vêm por parâmetro).
import { anexoDaAtividade, idAtividadeExportacao, type RegraCnae } from "./cnae.ts";
import { somarMeses } from "./meses.ts";
import { calcularDas, centavos, fatorR as calcularFatorR, inssProLaboreDoMes, LIMITE_FATOR_R, mesesDoFatorR, rbt12 as calcularRbt12, type Anexo, type Das, type FatorR, type Rbt12, type ValoresPorMes } from "./simples.ts";

export type EntradaApuracao = {
  pa: string;
  receita: number; // receita de exportação do PA, em reais
  receitas: ValoresPorMes; // meses anteriores conhecidos (mês ausente = desconhecido)
  folhas: ValoresPorMes; // folha de salários com encargos por mês (mês ausente = zero)
  regra: RegraCnae;
  inicioAtividade?: string; // AAAA-MM
};

export type Apuracao = {
  pa: string;
  receita: number;
  rbt12: Rbt12;
  fatorR: FatorR | null; // null = a atividade não depende do Fator R
  anexo: Anexo;
  idAtividade: number;
  das: Das;
  mesesSemReceita: string[]; // meses da RBT12 sem receita conhecida (contados como zero)
  folhasDaDeclaracao: ValoresPorMes; // a folha que vai na declaração (só para atividade com Fator R)
};

// Início de atividade só importa quando cai dentro da janela; antes disso a empresa já tem 12 meses (ou mais).
export function inicioQueImporta(pa: string, inicio?: string): string | undefined {
  if (!inicio || inicio <= somarMeses(pa, -14)) return undefined;
  if (inicio > pa) throw new Error(`O mês ${pa} é anterior ao início de atividade da empresa.`);
  return inicio;
}

export function apurar(e: EntradaApuracao): Apuracao {
  const inicio = inicioQueImporta(e.pa, e.inicioAtividade);
  const receitas = { ...e.receitas, [e.pa]: e.receita };
  const bruta = calcularRbt12(e.pa, receitas, inicio);
  const rbt12 = { ...bruta, valor: centavos(bruta.valor) }; // a soma em ponto flutuante deixa resíduo (352.998,8499...)
  const fator = e.regra.tributacao === "fator-r" ? calcularFatorR(e.pa, e.folhas, receitas, inicio) : null;
  const anexo = anexoDaAtividade(e.regra, fator ?? undefined);
  const das = calcularDas({ pa: e.pa, receita: e.receita, rbt12: rbt12.valor, anexo, mercado: "externo" });
  const folhasDaDeclaracao = fator ? Object.fromEntries(mesesDoFatorR(e.pa, inicio).meses.map((m) => [m, e.folhas[m] ?? 0])) : {};
  return {
    pa: e.pa,
    receita: e.receita,
    rbt12,
    fatorR: fator,
    anexo,
    idAtividade: idAtividadeExportacao(e.regra),
    das,
    mesesSemReceita: rbt12.meses.filter((m) => m !== e.pa && e.receitas[m] === undefined),
    folhasDaDeclaracao,
  };
}

// Faixa de atenção do Fator R: de 25% (inclusive) até 30% (exclusive). Abaixo de 28% a empresa cai no Anexo V; até 30%
// ela está no III, mas com margem de menos de 2 pontos: um mês de receita acima da média ou um pró-labore menor já a
// derruba (com receita de R$ 25 mil por mês, 2 pontos são R$ 500 de folha por mês). Abaixo de 25% o salto até 28% exige
// aumentar o pró-labore em mais de 12% da receita média, e o aviso vira só a sugestão na rotina do mês.
export const FAIXA_ATENCAO_FATOR_R = { de: 0.25, ate: 0.3 } as const;
export const naFaixaDeAtencao = (valor: number) => valor >= FAIXA_ATENCAO_FATOR_R.de && valor < FAIXA_ATENCAO_FATOR_R.ate;

export type SugestaoFatorR = {
  mes: string; // o mês cujo pró-labore ainda dá para ajustar (o atual)
  paAfetado: string; // o primeiro PA cujo Fator R usa a folha desse mês
  fatorR: number; // Fator R do PA afetado com o pró-labore atual
  anexo: Anexo; // com o pró-labore atual
  emAtencao: boolean;
  proLaboreAtual: number;
  proLaboreSugerido: number; // o menor pró-labore deste mês que deixa o Fator R em 28% (nunca menor que o atual)
  aumento: number; // sugerido - atual
  receitaPrevista: number; // receita usada para o PA afetado e para o mês atual (a do último mês conhecido)
  dasAnexoIII: number;
  dasAnexoV: number;
  custoInss: number; // INSS (11%, até o teto do ano) a mais sobre o aumento do pró-labore
  economia: number; // (DAS no V - DAS no III) - custo do INSS; negativa quando aumentar o pró-labore não compensa
};

// Sugestão de pró-labore para o Fator R do próximo PA que ainda dá para mudar: o primeiro PA cuja janela da folha inclui
// o mês atual (até 2026, o mês seguinte; a partir de 2027, com a janela nova da CGSN 190/2026, o PA de dois meses à
// frente). A receita do mês atual e a do PA afetado são previstas pela última receita conhecida. Devolve null quando a
// atividade não depende do Fator R, quando a janela ainda está no começo de atividade ou sem receita para prever.
export function sugestaoFatorR(p: {
  mesAtual: string;
  receitas: ValoresPorMes;
  folhas: ValoresPorMes;
  regra: RegraCnae;
  proLaboreAtual: number;
  receitaPrevista?: number;
  inicioAtividade?: string;
}): SugestaoFatorR | null {
  if (p.regra.tributacao !== "fator-r") return null;
  const paAfetado = [1, 2, 3].map((n) => somarMeses(p.mesAtual, n)).find((pa) => mesesDoFatorR(pa).meses.includes(p.mesAtual));
  if (!paAfetado) return null;
  const inicio = inicioQueImporta(paAfetado, p.inicioAtividade);
  const { regra, meses } = mesesDoFatorR(paAfetado, inicio);
  if (regra !== "doze-meses" || !meses.includes(p.mesAtual)) return null;
  const conhecidos = Object.keys(p.receitas).filter((m) => m < p.mesAtual).sort();
  const receitaPrevista = p.receitaPrevista ?? (conhecidos.length ? p.receitas[conhecidos.at(-1)!] : 0);
  if (!(receitaPrevista > 0)) return null;

  const receitas: ValoresPorMes = { ...p.receitas, [p.mesAtual]: receitaPrevista };
  for (let m = somarMeses(p.mesAtual, 1); m <= paAfetado; m = somarMeses(m, 1)) receitas[m] = receitaPrevista;
  const folhas: ValoresPorMes = { ...p.folhas, [p.mesAtual]: p.proLaboreAtual };
  const atual = calcularFatorR(paAfetado, folhas, receitas, inicio);
  // Pró-labore necessário, em centavos inteiros: folha × 100 ≥ receita × 28 (a mesma comparação de fatorR).
  const folhaSemAtual = Math.round(atual.folha * 100) - Math.round(p.proLaboreAtual * 100);
  const necessario = Math.max(0, Math.ceil((Math.round(atual.receita * 100) * 28 - folhaSemAtual * 100) / 100)) / 100;
  const sugerido = Math.max(necessario, p.proLaboreAtual);

  let dasIII: number;
  let dasV: number;
  try {
    const base = calcularRbt12(paAfetado, receitas, inicio).valor;
    dasIII = calcularDas({ pa: paAfetado, receita: receitaPrevista, rbt12: base, anexo: "III", mercado: "externo" }).total;
    dasV = calcularDas({ pa: paAfetado, receita: receitaPrevista, rbt12: base, anexo: "V", mercado: "externo" }).total;
  } catch {
    return null; // 6ª faixa (fora do atendimento)
  }
  const custoInss = centavos(inssProLaboreDoMes(p.mesAtual, sugerido) - inssProLaboreDoMes(p.mesAtual, p.proLaboreAtual));
  return {
    mes: p.mesAtual,
    paAfetado,
    fatorR: atual.valor,
    anexo: atual.anexo,
    emAtencao: naFaixaDeAtencao(atual.valor),
    proLaboreAtual: p.proLaboreAtual,
    proLaboreSugerido: sugerido,
    aumento: centavos(sugerido - p.proLaboreAtual),
    receitaPrevista,
    dasAnexoIII: dasIII,
    dasAnexoV: dasV,
    custoInss,
    economia: atual.anexo === "III" ? 0 : centavos(dasV - dasIII - custoInss),
  };
}

export { LIMITE_FATOR_R };
