// Remoção definitiva de uma empresa (tela Dados da empresa, só para o DONO). Numa transação só:
// 1. confere o vínculo de DONO pela porta de acesso (exigirAcessoEmpresa) e de novo dentro da transação, com a linha da
//    empresa travada (FOR NO KEY UPDATE): duas remoções ao mesmo tempo (ou uma remoção e um envio de termo) não passam
//    juntas, a segunda encontra a empresa já apagada. Não é FOR UPDATE de propósito: essa trava barraria a conferência
//    da chave estrangeira do registro de uma chamada ao Serpro em andamento, e a remoção ficaria esperando por ela;
// 2. confere o CNPJ digitado na confirmação (com ou sem pontuação);
// 3. (passos 3, 5 e 6 em apagar-empresa.ts, compartilhado com a desistência do último provisório) apaga as linhas de TODA tabela do esquema com empresa_id (lista tirada do esquema, não escrita à mão: tabela nova
//    entra sozinha), menos serpro_chamadas (TABELAS_ANONIMIZADAS): o gasto interno da plataforma com o contrato do
//    Serpro (não é cobrança do cliente) fica só como número, sem nada que identifique a empresa: empresa_id e
//    contribuinte (CNPJ) nulos, mensagens vazias e o CNPJ tirado da finalidade; ficam data, ação, serviço, status e custo;
//    a anonimização roda depois de apagar a empresa, para pegar também a chamada registrada enquanto a remoção corria;
// 4. tira a empresa ativa das sessões que apontavam para ela e, se a sessão de quem removeu era uma delas, ativa outra
//    empresa dele, se houver (removida por uma aba antiga, com outra já ativa, a ativa continua);
// 5. apaga a consulta pública guardada do CNPJ (cnpjs_consultados, do cadastro) e os avisos de cadastro provisório
//    encerrado com esse CNPJ (cadastros_encerrados), que não têm empresa_id mas guardam o CNPJ e a razão social;
// 6. apaga a empresa (o CNPJ fica livre para um novo cadastro). Chamada registrada depois disso já entra sem o CNPJ
//    (lib/serpro/registro.ts só guarda o contribuinte de empresa cadastrada).
// Nada é apagado na Receita Federal: a plataforma só deixa de guardar e usar os dados (e o termo assinado).
import { and, asc, eq } from "drizzle-orm";
import type { Banco } from "@/banco";
import { empresas, empresaUsuarios, sessoes } from "@/banco/esquema";
import { exigirAcessoEmpresa, SemAcessoEmpresa } from "./acesso";
import { apagarEmpresaETudo } from "./apagar-empresa";
import { cnpjConfere } from "./cnpj";
import { ErroDeEmpresa } from "./servico";

// A lista das tabelas e a anonimização do gasto ficam em apagar-empresa.ts (a desistência do último provisório usa a mesma).
export { TABELAS_ANONIMIZADAS, TABELAS_APAGADAS_COM_A_EMPRESA } from "./apagar-empresa";

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

    // Passos 3, 5 e 6 (e a anonimização do gasto), em apagar-empresa.ts.
    const semAtiva = await apagarEmpresaETudo(tx, empresa);
    // A sessão de quem removeu só troca de empresa se estava nesta (removida por uma aba antiga, a ativa continua).
    const eraAtiva = semAtiva.includes(sessao.sessaoId);

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
