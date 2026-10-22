// Apagar uma empresa e tudo o que é dela, dentro de uma transação já aberta (e com a linha da empresa travada por quem
// chama). Usado pela remoção definitiva (remocao.ts, pelo DONO) e pela desistência do último cadastro provisório
// (servico.ts, desistirDoCadastro): nos dois casos a regra é a mesma.
// 1. apaga as linhas de TODA tabela do esquema com empresa_id (lista tirada do esquema, não escrita à mão: tabela nova
//    entra sozinha), menos serpro_chamadas (TABELAS_ANONIMIZADAS): o gasto interno da plataforma com o contrato do
//    Serpro (não é cobrança do cliente) fica só como número, sem nada que identifique a empresa: empresa_id e
//    contribuinte (CNPJ) nulos, mensagens vazias e o CNPJ tirado da finalidade; ficam data, ação, serviço, status e custo;
// 2. tira a empresa ativa das sessões que apontavam para ela (devolve os ids dessas sessões);
// 3. apaga a consulta pública guardada do CNPJ (cnpjs_consultados) e os avisos de cadastro provisório encerrado com esse
//    CNPJ (cadastros_encerrados), que não têm empresa_id mas guardam o CNPJ e a razão social;
// 4. apaga a empresa (o CNPJ fica livre para um novo cadastro);
// 5. anonimiza o gasto depois de apagar a empresa, para pegar também a chamada registrada enquanto isto corria
//    (o vínculo pode já ter caído com o ON DELETE SET NULL; por isso a busca também é pelo CNPJ).
import { eq, getTableColumns, or, sql } from "drizzle-orm";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import type { Banco } from "@/banco";
import * as esquema from "@/banco/esquema";
import { cadastrosEncerrados, cnpjsConsultados, empresas, serproChamadas, sessoes } from "@/banco/esquema";
import { formatarCnpj } from "./cnpj";

export type Transacao = Parameters<Parameters<Banco["transaction"]>[0]>[0];

// Registros da plataforma com empresa_id que sobrevivem à empresa, anonimizados: o gasto das chamadas ao Serpro é da
// plataforma (entra só na conta do preço do plano; o cliente paga o plano mensal ou anual, nunca por chamada).
export const TABELAS_ANONIMIZADAS = [getTableConfig(serproChamadas).name];

type TabelaComEmpresa = { nome: string; tabela: PgTable; coluna: PgColumn };

function tabelasComEmpresaId(): TabelaComEmpresa[] {
  return (Object.values(esquema) as unknown[])
    .filter((v): v is PgTable => v instanceof PgTable)
    .flatMap((tabela) => {
      const config = getTableConfig(tabela);
      const achado = Object.values(getTableColumns(tabela)).find((c) => c.name === "empresa_id");
      return achado ? [{ nome: config.name, tabela, coluna: achado }] : [];
    });
}

const TABELAS = tabelasComEmpresaId();
// As tabelas cujas linhas são apagadas com a empresa (vínculos de usuários, consultas da Receita, termo e token cifrados…).
export const TABELAS_APAGADAS_COM_A_EMPRESA = TABELAS.filter((t) => !TABELAS_ANONIMIZADAS.includes(t.nome)).map((t) => t.nome);

// Devolve os ids das sessões que tinham esta empresa como ativa (agora sem empresa ativa).
export async function apagarEmpresaETudo(tx: Transacao, empresa: { id: string; cnpj: string }): Promise<string[]> {
  for (const { nome, tabela, coluna } of TABELAS) {
    if (!TABELAS_ANONIMIZADAS.includes(nome)) await tx.delete(tabela).where(eq(coluna, empresa.id));
  }
  const semAtiva = await tx.update(sessoes).set({ empresaAtivaId: null }).where(eq(sessoes.empresaAtivaId, empresa.id)).returning({ id: sessoes.id });
  await tx.delete(cnpjsConsultados).where(eq(cnpjsConsultados.cnpj, empresa.cnpj));
  await tx.delete(cadastrosEncerrados).where(eq(cadastrosEncerrados.cnpj, empresa.cnpj));
  // Espera o registro de chamada em andamento (a conferência da chave estrangeira) e tira o vínculo (ON DELETE SET NULL).
  await tx.delete(empresas).where(eq(empresas.id, empresa.id));
  const formatado = formatarCnpj(empresa.cnpj);
  await tx
    .update(serproChamadas)
    .set({
      empresaId: null,
      contribuinte: null,
      mensagens: "",
      finalidade: sql`replace(replace(${serproChamadas.finalidade}, ${empresa.cnpj}, '[removido]'), ${formatado}, '[removido]')`,
    })
    .where(or(eq(serproChamadas.empresaId, empresa.id), eq(serproChamadas.contribuinte, empresa.cnpj)));
  return semAtiva.map((s) => s.id);
}
