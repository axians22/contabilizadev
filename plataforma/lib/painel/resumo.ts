// O resumo do mês do painel (página inicial, no desenho do painel do ../fiscal, app/page.tsx): o total a pagar (DAS + DARF
// do INSS) com as partes, a receita do mês (ou a previsão), a receita dos 12 meses e a faixa da alíquota. Função pura sobre
// a base da rotina (lib/rotina/base.ts): nada é consultado aqui.
// Sem receita do mês (nem lançada, nem declarada, nem marcada como zero), o painel mostra a previsão pela média das
// últimas receitas, como o ../fiscal (receitaPrevista): só para mostrar, nunca é declarada nem transmitida.
import { apurar, type Apuracao } from "@contabilizadev/nucleo/apuracao";
import { somarMeses } from "@contabilizadev/nucleo/meses";
import { centavos, inssProLaboreDoMes, tabelaVigente, tributosDoDas, type Tributo, type ValoresPorMes } from "@contabilizadev/nucleo/simples";
import type { BaseDoMes } from "@/lib/rotina/base";

export const NOMES_DOS_TRIBUTOS: Record<Tributo, string> = { irpj: "IRPJ", csll: "CSLL", cpp: "INSS patronal", cofins: "COFINS", pis: "PIS", iss: "ISS", cbs: "CBS", ibs: "IBS" };

// Média das até 3 receitas positivas mais recentes nos 12 meses antes do mês (a do ../fiscal); sem nenhuma, zero.
export function receitaPrevista(receitas: ValoresPorMes, pa: string): number {
  const valores: number[] = [];
  for (let n = 1; n <= 12 && valores.length < 3; n++) {
    const v = receitas[somarMeses(pa, -n)] ?? 0;
    if (v > 0) valores.push(v);
  }
  return valores.length ? centavos(valores.reduce((a, b) => a + b, 0) / valores.length) : 0;
}

export type ParteDoTotal = { nome: string; valor: number; tributo: Tributo | "inss" };

export type FaixaDoMes = {
  numero: number; // 1 a 6
  anexo: Apuracao["anexo"];
  limites: number[]; // o "até" de cada faixa da tabela do anexo
  teto: number; // o limite da faixa atual
  naFaixa: number; // 0 a 1: quanto da faixa atual a receita dos 12 meses já ocupa
};

export type ResumoDoMes = {
  receita: number | null; // a do mês (lançada, declarada ou zero marcado); null = pendente
  previsao: number | null; // só com a receita pendente
  apuracao: Apuracao | null; // com a receita do mês ou a prevista
  das: number | null;
  inss: number | null; // DARF do INSS do pró-labore informado (11%, até o teto); null = pró-labore não informado
  total: number;
  partes: ParteDoTotal[];
  faixa: FaixaDoMes | null;
  mesesSemReceita: string[];
  erro: string | null; // por que o mês não é calculado (empresa fora do escopo, 6ª faixa)
};

export function resumoDoMes(base: BaseDoMes): ResumoDoMes {
  const receita = base.receitaPendente ? null : base.receita;
  const previsao = receita === null ? receitaPrevista(base.receitas, base.pa) : null;
  let apuracao = base.apuracao;
  let erro = base.semRegra ?? base.erro;
  // A base apura a receita pendente como zero; o painel mostra a previsão.
  if (apuracao && previsao !== null && base.regra) {
    try {
      apuracao = apurar({ pa: base.pa, receita: previsao, receitas: base.receitas, folhas: base.folhas, regra: base.regra, inicioAtividade: base.inicioAtividade });
    } catch (e) {
      apuracao = null;
      erro = (e as Error).message;
    }
  }
  const das = apuracao ? apuracao.das.total : null;
  const inss = base.prolabore !== null ? inssProLaboreDoMes(base.pa, base.prolabore) : null;
  const partes: ParteDoTotal[] = apuracao ? tributosDoDas(apuracao.das).map((t) => ({ nome: NOMES_DOS_TRIBUTOS[t], valor: apuracao.das.tributos[t], tributo: t })) : [];
  if (inss !== null) partes.push({ nome: "DARF do INSS", valor: inss, tributo: "inss" });
  let faixa: FaixaDoMes | null = null;
  if (apuracao) {
    const limites = tabelaVigente(apuracao.anexo, base.pa).faixas.map((f) => f.ate);
    const numero = apuracao.das.faixa;
    const piso = numero > 1 ? limites[numero - 2] : 0;
    const teto = limites[numero - 1];
    faixa = { numero, anexo: apuracao.anexo, limites, teto, naFaixa: Math.min(1, Math.max(0, (apuracao.rbt12.valor - piso) / (teto - piso))) };
  }
  return {
    receita,
    previsao,
    apuracao,
    das,
    inss,
    total: centavos((das ?? 0) + (inss ?? 0)),
    partes,
    faixa,
    mesesSemReceita: apuracao?.mesesSemReceita ?? [],
    erro: apuracao ? null : erro,
  };
}
