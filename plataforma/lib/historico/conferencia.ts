// A conferência do Histórico, no desenho da tabela do ../fiscal (app/historico/page.tsx): para cada mês importado, a
// receita declarada, a receita que a plataforma usa, a receita dos 12 meses anteriores, a alíquota paga, o DAS que a
// plataforma calcula e o DAS da Receita Federal, com a diferença entre os dois; e, ao abrir, o pró-labore e o INSS.
// Função pura sobre o que as telas já leem (lib/historico/leitura.ts e lib/rotina/base.ts): nada é consultado aqui, e nada
// é fixo de empresa (a regra do CNAE e o início de atividade vêm da empresa ativa).
import { apurar } from "@contabilizadev/nucleo/apuracao";
import { centavos, inssProLaboreDoMes } from "@contabilizadev/nucleo/simples";
import type { MesDoHistorico } from "./leitura";
import type { Empresa, FonteFolha, FonteReceita, Historico } from "@/lib/rotina/base";

export type LinhaDaConferencia = {
  mes: MesDoHistorico;
  receitaTotal: number | null; // a que a plataforma usa: a declarada ou, sem declaração, a lançada aqui
  fonteReceita: FonteReceita | null;
  rbt12: number | null;
  rbt12Incompleta: boolean; // há meses sem receita conhecida entre os 12 anteriores (a alíquota fica subestimada)
  aliquotaPaga: number | null;
  dasCalculado: number | null; // só com a receita do mês conhecida
  diferenca: number | null; // DAS calculado menos o DAS da Receita Federal
  prolabore: number | null;
  fonteProlabore: FonteFolha | null;
  inss: number | null;
};

export function conferenciaDoHistorico(meses: MesDoHistorico[], valores: Pick<Historico, "receitas" | "fontesReceita" | "folhas" | "fontesFolha">, empresa: Pick<Empresa, "regra" | "inicioAtividade">): LinhaDaConferencia[] {
  return meses.map((m) => {
    const receitaTotal = valores.receitas[m.pa] ?? null;
    const anteriores = Object.fromEntries(Object.entries(valores.receitas).filter(([mes]) => mes < m.pa));
    let apuracao = null;
    if (empresa.regra) {
      try {
        apuracao = apurar({ pa: m.pa, receita: receitaTotal ?? 0, receitas: anteriores, folhas: valores.folhas, regra: empresa.regra, inicioAtividade: empresa.inicioAtividade });
      } catch {
        // Mês antes do início de atividade ou além do limite do Simples: sem cálculo.
      }
    }
    const dasCalculado = apuracao && receitaTotal !== null ? apuracao.das.total : null;
    const prolabore = valores.folhas[m.pa] ?? null;
    return {
      mes: m,
      receitaTotal,
      fonteReceita: valores.fontesReceita[m.pa] ?? null,
      rbt12: apuracao?.rbt12.valor ?? null,
      rbt12Incompleta: Boolean(apuracao?.mesesSemReceita.length),
      aliquotaPaga: apuracao?.das.aliquotaPaga ?? null,
      dasCalculado,
      diferenca: dasCalculado !== null && m.valorDas !== null ? centavos(dasCalculado - m.valorDas) || 0 : null, // `|| 0` tira o -0 do meio centavo negativo
      prolabore,
      fonteProlabore: valores.fontesFolha[m.pa] ?? null,
      inss: prolabore !== null ? inssProLaboreDoMes(m.pa, prolabore) : null,
    };
  });
}
