// Só para testes: respostas da BrasilAPI (exemplos/*.json) e um fetch falso que as devolve. Nada sai da máquina.
// - banco-do-brasil.json: resposta real gravada em 16/10/2026 (00000000000191), com o quadro de sócios cortado em 3.
// - os outros: dados fictícios no mesmo formato (mesmos campos da resposta real), com CNPJs de dígito verificador
//   válido inventados para os testes.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Buscar } from "./cnpj.ts";

export const EXEMPLOS = ["banco-do-brasil", "ti-fator-r", "ti-anexo-iii", "mei", "fora-do-escopo", "baixada", "alfanumerico"] as const;
export type Exemplo = (typeof EXEMPLOS)[number];

// Cópia nova a cada chamada: o teste pode alterar à vontade.
export function respostaGravada(nome: Exemplo): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(import.meta.dirname, "exemplos", `${nome}.json`), "utf8"));
}

export type RespostaFalsa = { status: number; corpo?: unknown } | Error | "pendurar";
export type BuscarFalso = Buscar & { chamadas: string[] };

// Responde pela ordem da lista; "pendurar" fica sem responder até o sinal abortar (para testar o tempo limite).
export function buscarFalso(...respostas: RespostaFalsa[]): BuscarFalso {
  const chamadas: string[] = [];
  const buscar = (async (url, init) => {
    chamadas.push(url);
    const r = respostas.shift();
    if (!r) throw new Error("Chamada à BrasilAPI não esperada pelo teste.");
    if (r instanceof Error) throw r;
    if (r === "pendurar") {
      return new Promise((_, rejeitar) => init.signal.addEventListener("abort", () => rejeitar(new Error("This operation was aborted"))));
    }
    return {
      status: r.status,
      json: async () => {
        if (typeof r.corpo === "string") return JSON.parse(r.corpo);
        return r.corpo;
      },
    };
  }) as BuscarFalso;
  buscar.chamadas = chamadas;
  return buscar;
}

// Atalho: o fetch falso que devolve o exemplo pedido (200).
export const buscarExemplo = (nome: Exemplo) => buscarFalso({ status: 200, corpo: respostaGravada(nome) });
