"use server";

import { revalidatePath } from "next/cache";
import { banco } from "@/banco";
import { exigirSessao } from "@/lib/autenticacao/servidor";
import { ErroDosDados, salvarDadosDoCliente, valorDoCampo } from "@/lib/defis/resumo";
import { SemAcessoEmpresa } from "@/lib/empresas/acesso";
import { exigirAcessoAoConteudo } from "@/lib/empresas/portao";
import type { EstadoDaAcao } from "../roteiro/acoes";

const texto = (dados: FormData, nome: string) => String(dados.get(nome) ?? "");

// Guarda o que só o cliente sabe do ano (lucros retirados, saldos do banco, despesas), para a declaração anual. Sessão,
// vínculo e plano pela porta do portão; nada vai para a Receita.
export async function salvarDefisAcao(_anterior: EstadoDaAcao, dados: FormData): Promise<EstadoDaAcao> {
  const sessao = await exigirSessao();
  try {
    const acesso = await exigirAcessoAoConteudo(banco(), sessao.usuario, texto(dados, "empresaId").trim());
    await salvarDadosDoCliente(
      banco(),
      acesso,
      Number(texto(dados, "ano")),
      {
        lucros: valorDoCampo(texto(dados, "lucros")),
        saldoInicial: valorDoCampo(texto(dados, "saldoInicial")),
        saldoFinal: valorDoCampo(texto(dados, "saldoFinal")),
        despesas: valorDoCampo(texto(dados, "despesas")),
      },
      { agora: new Date(), usuarioId: sessao.usuario.id },
    );
    revalidatePath("/defis");
    return { ok: "Valores guardados." };
  } catch (erro) {
    if (erro instanceof SemAcessoEmpresa || erro instanceof ErroDosDados) return { erro: erro.message };
    console.error("Falha ao guardar os valores da declaração anual:", (erro as Error).message);
    return { erro: "Não deu para guardar agora. Tente de novo." };
  }
}
