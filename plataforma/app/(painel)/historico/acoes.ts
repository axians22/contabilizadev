"use server";

import { revalidatePath } from "next/cache";
import { banco } from "@/banco";
import { exigirSessao } from "@/lib/autenticacao/servidor";
import { SemAcessoEmpresa } from "@/lib/empresas/acesso";
import { exigirAcessoAoConteudo } from "@/lib/empresas/portao";
import { MENSAGENS_DO_HISTORICO } from "@/lib/historico/mensagens";
import type { Grupo } from "@/lib/historico/prazos";
import { atualizarEmSegundoPlano, type Disparo } from "@/lib/historico/servidor";

export type EstadoAtualizacaoHistorico = { erro?: string; aviso?: string; ok?: boolean } | undefined;

// A resposta da tela para cada desfecho do pedido (mensagens próprias, nunca o detalhe técnico).
function resposta(d: Disparo): EstadoAtualizacaoHistorico {
  switch (d.estado) {
    case "iniciada":
      return { ok: true };
    case "rodando":
      return { aviso: MENSAGENS_DO_HISTORICO.rodando };
    case "em-dia":
      return { aviso: MENSAGENS_DO_HISTORICO.nadaNovo };
    case "espere":
      return { aviso: MENSAGENS_DO_HISTORICO.espere(d.minutos) };
    case "indisponivel":
      return { erro: MENSAGENS_DO_HISTORICO.indisponivel };
    case "sem-autorizacao":
      return { erro: MENSAGENS_DO_HISTORICO.semAutorizacao };
  }
}

// Botão Atualizar das abas (Histórico, Situação fiscal, Declaração anual): vínculo e plano conferidos no servidor pelo
// portão; a consulta respeita o intervalo mínimo e roda em segundo plano (a tela acompanha o progresso).
async function atualizar(grupo: Grupo, dados: FormData): Promise<EstadoAtualizacaoHistorico> {
  const sessao = await exigirSessao();
  let disparo: Disparo;
  try {
    const acesso = await exigirAcessoAoConteudo(banco(), sessao.usuario, String(dados.get("empresaId") ?? ""));
    disparo = await atualizarEmSegundoPlano(acesso, { grupos: [grupo], manual: true });
  } catch (erro) {
    if (erro instanceof SemAcessoEmpresa) return { erro: erro.message };
    console.error("[serpro] Falha inesperada ao pedir a atualização do histórico:", (erro as Error).message);
    return { erro: MENSAGENS_DO_HISTORICO.falhou };
  }
  revalidatePath("/", "layout");
  return resposta(disparo);
}

export async function atualizarHistoricoAcao(_anterior: EstadoAtualizacaoHistorico, dados: FormData): Promise<EstadoAtualizacaoHistorico> {
  await exigirSessao();
  return atualizar("historico", dados);
}

export async function atualizarSituacaoAcao(_anterior: EstadoAtualizacaoHistorico, dados: FormData): Promise<EstadoAtualizacaoHistorico> {
  await exigirSessao();
  return atualizar("situacao", dados);
}

export async function atualizarDefisAcao(_anterior: EstadoAtualizacaoHistorico, dados: FormData): Promise<EstadoAtualizacaoHistorico> {
  await exigirSessao();
  return atualizar("defis", dados);
}
