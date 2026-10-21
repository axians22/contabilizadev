// Registro das chamadas ao Serpro no banco (serpro_chamadas, gasto interno da plataforma, não cobrança do cliente): o
// cliente do núcleo grava cada chamada e consulta o consumo do período antes de chamar, para respeitar o limite do contrato.
import { and, eq, gte, ne, sql } from "drizzle-orm";
import { TIPO_DA_ACAO, type Acao, type RegistroSerpro } from "@contabilizadev/nucleo/serpro/cliente";
import type { TipoRequisicao } from "@contabilizadev/nucleo/serpro/precos";
import type { Banco } from "@/banco";
import { empresas, serproChamadas } from "@/banco/esquema";
import { formatarCnpj } from "@/lib/empresas/cnpj";

export function registroNoBanco(banco: Banco): RegistroSerpro {
  return {
    async registrar(c) {
      // CNPJ, vínculo e mensagens só de empresa cadastrada (conferido na hora de gravar): a chamada que termina depois de a
      // empresa ser removida já entra anonimizada, como as que a remoção anonimizou (lib/empresas/remocao.ts).
      const cnpj = c.contribuinte;
      const daEmpresa = (coluna: typeof empresas.id | typeof empresas.cnpj) =>
        cnpj ? sql<string>`(${banco.select({ v: coluna }).from(empresas).where(eq(empresas.cnpj, cnpj))})` : null;
      const cadastrada = sql`exists (${banco.select({ v: empresas.id }).from(empresas).where(eq(empresas.cnpj, cnpj ?? ""))})`;
      const semCnpj = (texto: string) =>
        cnpj ? sql<string>`case when ${cadastrada} then ${texto} else replace(replace(${texto}, ${cnpj}, '[removido]'), ${formatarCnpj(cnpj)}, '[removido]') end` : texto;
      const gravar = () =>
        banco.insert(serproChamadas).values({
          quando: c.quando,
          acao: c.acao,
          servico: c.servico,
          finalidade: semCnpj(c.finalidade),
          contribuinte: daEmpresa(empresas.cnpj),
          empresaId: daEmpresa(empresas.id),
          status: c.status,
          mensagens: cnpj ? sql<string>`case when ${cadastrada} then ${c.mensagens} else '' end` : c.mensagens,
          custo: c.custo,
        });
      try {
        await gravar();
      } catch (erro) {
        // A empresa foi removida entre a subconsulta e a conferência da chave estrangeira: grava de novo, já sem ela.
        if (codigoPostgres(erro) !== "23503") throw erro;
        await gravar();
      }
    },
    async consumo(desde) {
      const linhas = await banco
        .select({ acao: serproChamadas.acao, n: sql<number>`count(*)::int` })
        .from(serproChamadas)
        .where(and(gte(serproChamadas.quando, desde), ne(serproChamadas.acao, "Autenticar")))
        .groupBy(serproChamadas.acao);
      const uso: Record<TipoRequisicao, number> = { consulta: 0, emissao: 0, declaracao: 0 };
      for (const l of linhas) {
        const tipo = TIPO_DA_ACAO[l.acao as Acao];
        if (tipo) uso[tipo] += l.n;
      }
      return uso;
    },
  };
}

function codigoPostgres(erro: unknown): string | undefined {
  const e = erro as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}
