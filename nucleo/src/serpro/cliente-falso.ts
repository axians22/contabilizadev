// Só para testes: cliente do Serpro que devolve respostas gravadas e guarda as chamadas feitas. Nada sai da máquina.
import type { Acao, ClienteSerpro, OpcoesChamada, Pedido, Resposta } from "./cliente.ts";

export type ChamadaFeita = { acao: Acao; pedido: Pedido; finalidade: string; opcoes: OpcoesChamada };

export function clienteFalso(...respostas: (Resposta | Error)[]): ClienteSerpro & { chamadas: ChamadaFeita[] } {
  const chamadas: ChamadaFeita[] = [];
  return {
    chamadas,
    async chamar(acao, pedido, finalidade, opcoes) {
      chamadas.push({ acao, pedido, finalidade, opcoes });
      const r = respostas.shift();
      if (!r) throw new Error("Chamada não esperada pelo teste.");
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

export const CONTRIBUINTE = { contribuinte: { numero: "11222333000181", tipo: 2 as const } };
