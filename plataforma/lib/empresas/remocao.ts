// Remoção definitiva de uma empresa (tela Dados da empresa, só para o DONO). Numa transação só:
// 1. confere o vínculo de DONO pela porta de acesso (exigirAcessoEmpresa) e de novo dentro da transação, com a linha da
//    empresa travada (FOR NO KEY UPDATE): duas remoções ao mesmo tempo (ou uma remoção e um envio de termo) não passam
//    juntas, a segunda encontra a empresa já apagada. Não é FOR UPDATE de propósito: essa trava barraria a conferência
//    da chave estrangeira do registro de uma chamada ao Serpro em andamento, e a remoção ficaria esperando por ela;
// 2. confere o CNPJ digitado na confirmação (com ou sem pontuação);
// 3. apaga as linhas de TODA tabela do esquema com empresa_id (lista tirada do esquema, não escrita à mão: tabela nova
//    entra sozinha), menos serpro_chamadas (TABELAS_ANONIMIZADAS): o gasto interno da plataforma com o contrato do
//    Serpro (não é cobrança do cliente) fica só como número, sem nada que identifique a empresa: empresa_id e
//    contribuinte (CNPJ) nulos, mensagens vazias e o CNPJ tirado da finalidade; ficam data, ação, serviço, status e custo;
//    a anonimização roda depois de apagar a empresa, para pegar também a chamada registrada enquanto a remoção corria;
// 4. tira a empresa ativa das sessões que apontavam para ela e, se a sessão de quem removeu era uma delas, ativa outra
//    empresa dele, se houver (removida por uma aba antiga, com outra já ativa, a ativa continua);
// 5. apaga a empresa (o CNPJ fica livre para um novo cadastro). Chamada registrada depois disso já entra sem o CNPJ
//    (lib/serpro/registro.ts só guarda o contribuinte de empresa cadastrada).
// Nada é apagado na Receita Federal: a plataforma só deixa de guardar e usar os dados (e o termo assinado).
import { and, asc, eq, getTableColumns, or, sql } from "drizzle-orm";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import type { Banco } from "@/banco";
import * as esquema from "@/banco/esquema";
import { empresas, empresaUsuarios, serproChamadas, sessoes } from "@/banco/esquema";
import { exigirAcessoEmpresa, SemAcessoEmpresa } from "./acesso";
import { cnpjConfere, formatarCnpj } from "./cnpj";
import { ErroDeEmpresa } from "./servico";

// Registros da plataforma com empresa_id que sobrevivem à empresa, anonimizados: o gasto das chamadas ao Serpro é da
// plataforma (entra só na conta do preço do plano; o cliente paga o plano mensal ou anual, nunca por chamada).
export const TABELAS_ANONIMIZADAS = [getTableConfig(serproChamadas).name];

type TabelaComEmpresa = { nome: string; tabela: PgTable; coluna: PgColumn; campo: string };

function tabelasComEmpresaId(): TabelaComEmpresa[] {
  return (Object.values(esquema) as unknown[])
    .filter((v): v is PgTable => v instanceof PgTable)
    .flatMap((tabela) => {
      const config = getTableConfig(tabela);
      // O nome do campo no Drizzle (empresaId), que é o que o update aceita.
      const achado = Object.entries(getTableColumns(tabela)).find(([, c]) => c.name === "empresa_id");
      return achado ? [{ nome: config.name, tabela, coluna: achado[1], campo: achado[0] }] : [];
    });
}

const TABELAS = tabelasComEmpresaId();
// As tabelas cujas linhas são apagadas com a empresa (vínculos de usuários, consultas da Receita, termo e token cifrados…).
export const TABELAS_APAGADAS_COM_A_EMPRESA = TABELAS.filter((t) => !TABELAS_ANONIMIZADAS.includes(t.nome)).map((t) => t.nome);

export const CNPJ_NAO_CONFERE = "O CNPJ digitado não é o desta empresa. Nada foi removido.";

// novaAtiva: a empresa que passou a ser a ativa na sessão de quem removeu (null com ativaMudou = sem empresa ativa).
// ativaMudou false: a removida não era a ativa dessa sessão (aba antiga) e a ativa continua a mesma.
export type ResultadoRemocao = {
  removida: { id: string; razaoSocial: string };
  novaAtiva: { id: string; razaoSocial: string } | null;
  ativaMudou: boolean;
};
export type OpcoesRemocao = { agora?: Date; log?: (mensagem: string) => void };

export async function removerEmpresa(
  banco: Banco,
  sessao: { sessaoId: string; usuario: { id: string } },
  empresaId: string,
  cnpjDigitado: string,
  opcoes: OpcoesRemocao = {},
): Promise<ResultadoRemocao> {
  const { usuario } = sessao;
  // Porta de acesso: sem vínculo (ou empresa que não existe) é "não encontrada"; MEMBRO é recusado.
  const acesso = await exigirAcessoEmpresa(banco, usuario, empresaId, { papel: "DONO" });

  const resultado = await banco.transaction(async (tx) => {
    const [empresa] = await tx
      .select({ id: empresas.id, cnpj: empresas.cnpj, razaoSocial: empresas.razaoSocial })
      .from(empresas)
      .where(eq(empresas.id, acesso.empresaId))
      .for("no key update");
    // Removida por outra requisição enquanto esta esperava a trava.
    if (!empresa) throw new SemAcessoEmpresa();
    // O vínculo de DONO de novo, já com a empresa travada (pode ter mudado entre a porta de acesso e a trava).
    const [vinculo] = await tx
      .select({ papel: empresaUsuarios.papel })
      .from(empresaUsuarios)
      .where(and(eq(empresaUsuarios.empresaId, empresa.id), eq(empresaUsuarios.usuarioId, usuario.id)));
    if (!vinculo) throw new SemAcessoEmpresa();
    if (vinculo.papel !== "DONO") throw new SemAcessoEmpresa("Só o dono da empresa pode fazer isso.");
    if (!cnpjConfere(cnpjDigitado, empresa.cnpj)) throw new ErroDeEmpresa(CNPJ_NAO_CONFERE);

    for (const { nome, tabela, coluna } of TABELAS) {
      if (!TABELAS_ANONIMIZADAS.includes(nome)) await tx.delete(tabela).where(eq(coluna, empresa.id));
    }
    const semAtiva = await tx.update(sessoes).set({ empresaAtivaId: null }).where(eq(sessoes.empresaAtivaId, empresa.id)).returning({ id: sessoes.id });
    // A sessão de quem removeu só troca de empresa se estava nesta (removida por uma aba antiga, a ativa continua).
    const eraAtiva = semAtiva.some((s) => s.id === sessao.sessaoId);
    // Espera o registro de chamada em andamento (a conferência da chave estrangeira) e tira o vínculo (ON DELETE SET NULL).
    await tx.delete(empresas).where(eq(empresas.id, empresa.id));
    // Gasto das chamadas: anonimizado pelo vínculo e pelo CNPJ (o vínculo pode já ter caído com o SET NULL acima).
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

    if (!eraAtiva) return { removida: { id: empresa.id, razaoSocial: empresa.razaoSocial }, novaAtiva: null, ativaMudou: false };
    // Outra empresa de quem removeu vira a ativa na sessão dele (a mesma ordem da lista da barra de cima).
    const [novaAtiva] = await tx
      .select({ id: empresas.id, razaoSocial: empresas.razaoSocial })
      .from(empresaUsuarios)
      .innerJoin(empresas, eq(empresas.id, empresaUsuarios.empresaId))
      .where(eq(empresaUsuarios.usuarioId, usuario.id))
      .orderBy(asc(empresas.razaoSocial), asc(empresas.id))
      .limit(1);
    await tx
      .update(sessoes)
      .set({ empresaAtivaId: novaAtiva?.id ?? null })
      .where(and(eq(sessoes.id, sessao.sessaoId), eq(sessoes.usuarioId, usuario.id)));

    return { removida: { id: empresa.id, razaoSocial: empresa.razaoSocial }, novaAtiva: novaAtiva ?? null, ativaMudou: true };
  });

  // Só ids e a hora (nada de CNPJ, razão social ou dado fiscal no log).
  const quando = (opcoes.agora ?? new Date()).toISOString();
  (opcoes.log ?? console.info)(`Empresa removida: empresa ${resultado.removida.id} por usuário ${usuario.id} em ${quando}.`);
  return resultado;
}
