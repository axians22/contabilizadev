// Registro das chamadas ao eSocial de uma empresa (esocial_chamadas): finalidade e resposta, nunca o XML. O cliente do
// núcleo também pergunta quantas consultas limitadas (identificadores e download) já foram feitas no dia, para respeitar o
// limite do eSocial (10 por dia e por empregador; nenhuma do dia 1 ao 7, MOD v1.16 §7.7.7).
import { and, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { SERVICOS_LIMITADOS, type RegistroEsocial } from "@contabilizadev/nucleo/esocial/ws";
import type { Banco } from "@/banco";
import { esocialChamadas } from "@/banco/esquema";

const inicioDoDiaNoBrasil = (quando: Date) => new Date(`${quando.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })}T00:00:00-03:00`);

export function registroEsocialNoBanco(banco: Banco, empresaId: string, log: (m: string) => void = console.error): RegistroEsocial {
  return {
    async registrar(c) {
      try {
        await banco.insert(esocialChamadas).values({ empresaId, quando: c.quando, ambiente: c.ambiente, servico: c.servico, finalidade: c.finalidade, status: c.status, resumo: c.resumo });
      } catch (erro) {
        // A empresa foi removida enquanto a chamada corria: não há onde registrar (a remoção apaga o registro dela).
        const codigo = (erro as { code?: string; cause?: { code?: string } }).code ?? (erro as { cause?: { code?: string } }).cause?.code;
        if (codigo !== "23503") throw erro;
        log(`[esocial] Chamada de empresa removida não registrada: ${c.servico}`);
      }
    },
    async consultasNoDia(ambiente, quando) {
      const inicio = inicioDoDiaNoBrasil(quando);
      const [linha] = await banco
        .select({ n: sql<number>`count(*)::int` })
        .from(esocialChamadas)
        .where(
          and(
            eq(esocialChamadas.empresaId, empresaId),
            eq(esocialChamadas.ambiente, ambiente),
            inArray(esocialChamadas.servico, SERVICOS_LIMITADOS),
            isNotNull(esocialChamadas.status), // a que não chegou ao eSocial não conta
            gte(esocialChamadas.quando, inicio),
            lt(esocialChamadas.quando, new Date(inicio.getTime() + 24 * 60 * 60 * 1000)),
          ),
        );
      return linha?.n ?? 0;
    },
  };
}
