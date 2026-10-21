"use server";

import { revalidatePath } from "next/cache";
import { banco } from "@/banco";
import { exigirSessao } from "@/lib/autenticacao/servidor";
import { SemAcessoEmpresa } from "@/lib/empresas/acesso";
import { exigirAcessoAoConteudo } from "@/lib/empresas/portao";
import { dadosDaReceita } from "@/lib/empresas/receita";
import { removerEmpresa } from "@/lib/empresas/remocao";
import { ErroDeEmpresa } from "@/lib/empresas/servico";

export type EstadoAtualizacao = { erro?: string; aviso?: string; ok?: boolean } | undefined;

// "Atualizar dados": consulta a BrasilAPI de novo para a empresa ativa (com o vínculo e o plano conferidos no servidor, pelo portão),
// mesmo com a consulta guardada em dia, e guarda o resultado.
export async function atualizarDadosAcao(_anterior: EstadoAtualizacao, dados: FormData): Promise<EstadoAtualizacao> {
  const sessao = await exigirSessao();
  let resultado;
  try {
    const acesso = await exigirAcessoAoConteudo(banco(), sessao.usuario, String(dados.get("empresaId") ?? ""));
    resultado = await dadosDaReceita(banco(), acesso, { forcar: true });
  } catch (erro) {
    if (erro instanceof SemAcessoEmpresa) return { erro: erro.message };
    throw erro;
  }
  // A razão social pode ter mudado: a barra de cima também é refeita.
  if (resultado.fonte === "receita") revalidatePath("/", "layout");
  return resultado.erro ? { erro: resultado.erro } : resultado.aviso ? { aviso: resultado.aviso } : { ok: true };
}

export type EstadoRemocao = { erro?: string; ok?: true } | undefined;

// "Remover definitivamente": só o DONO (conferido no servidor pela porta de acesso) e com o CNPJ digitado de novo.
// Devolve { ok } em vez de redirecionar: o navegador ainda precisa apagar o certificado guardado dele (só depois de a
// remoção dar certo) e então volta para Dados da empresa com a confirmação curta (?removida=1).
export async function removerEmpresaAcao(_anterior: EstadoRemocao, dados: FormData): Promise<EstadoRemocao> {
  const sessao = await exigirSessao();
  try {
    await removerEmpresa(banco(), sessao, String(dados.get("empresaId") ?? ""), String(dados.get("cnpj") ?? ""));
  } catch (erro) {
    if (erro instanceof SemAcessoEmpresa || erro instanceof ErroDeEmpresa) return { erro: erro.message };
    throw erro;
  }
  // A barra de cima (lista de empresas e a ativa) muda junto.
  revalidatePath("/", "layout");
  return { ok: true };
}
