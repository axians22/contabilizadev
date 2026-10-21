"use server";

import { revalidatePath } from "next/cache";
import { banco } from "@/banco";
import { exigirSessao } from "@/lib/autenticacao/servidor";
import { abrirMensagemDaCaixa, atualizarCaixaPostal } from "@/lib/caixa-postal/caixa-postal";
import { MENSAGENS_DA_CAIXA } from "@/lib/caixa-postal/mensagens";
import { caixaDoServidor } from "@/lib/caixa-postal/servidor";
import { SemAcessoEmpresa } from "@/lib/empresas/acesso";
import { exigirAcessoAoConteudo } from "@/lib/empresas/portao";
import type { EstadoDaAcao } from "../roteiro/acoes";

// Ações da aba Mensagens: sessão, vínculo e plano pela porta do portão (empresa do formulário conferida contra o vínculo)
// e a autorização em dia para falar com a Receita. Só mensagens próprias voltam à tela; o detalhe vai para o log.
const texto = (dados: FormData, nome: string) => String(dados.get(nome) ?? "").trim();

async function comCaixa(dados: FormData, fazer: (c: { deps: Awaited<ReturnType<typeof caixaDoServidor>>; acesso: Awaited<ReturnType<typeof exigirAcessoAoConteudo>>; usuarioId: string }) => Promise<EstadoDaAcao>): Promise<EstadoDaAcao> {
  const sessao = await exigirSessao();
  try {
    const acesso = await exigirAcessoAoConteudo(banco(), sessao.usuario, texto(dados, "empresaId"));
    const deps = await caixaDoServidor(acesso);
    if (!deps.autorizada) return { erro: MENSAGENS_DA_CAIXA.semAutorizacao };
    const r = await fazer({ deps, acesso, usuarioId: sessao.usuario.id });
    revalidatePath("/", "layout");
    return r;
  } catch (erro) {
    if (erro instanceof SemAcessoEmpresa) return { erro: erro.message };
    console.error("[serpro] Falha inesperada na Caixa Postal:", (erro as Error).message);
    return { erro: MENSAGENS_DA_CAIXA.falhou };
  }
}

// Atualizar: busca a lista agora (só os cabeçalhos; nada é aberto), respeitando o intervalo mínimo.
export async function atualizarMensagensAcao(_anterior: EstadoDaAcao, dados: FormData): Promise<EstadoDaAcao> {
  await exigirSessao();
  return comCaixa(dados, async ({ deps, acesso }) => {
    const r = await atualizarCaixaPostal(deps, acesso, { manual: true });
    switch (r.estado) {
      case "atualizada":
        return { ok: MENSAGENS_DA_CAIXA.atualizada(r.novas) };
      case "em-dia":
        return { ok: MENSAGENS_DA_CAIXA.emDia };
      case "espere":
        return { erro: MENSAGENS_DA_CAIXA.espere(r.minutos) };
      case "falhou":
        return { erro: r.mensagem };
    }
  });
}

// Abrir: busca o conteúdo de uma mensagem (registra a ciência na Receita). Ainda não lida, só com "confirmo" marcado.
export async function abrirMensagemAcao(_anterior: EstadoDaAcao, dados: FormData): Promise<EstadoDaAcao> {
  await exigirSessao();
  return comCaixa(dados, async ({ deps, acesso, usuarioId }) => {
    const r = await abrirMensagemDaCaixa(deps, acesso, texto(dados, "mensagemId"), { confirmado: texto(dados, "confirmo") === "sim", usuarioId });
    return r.ok ? { ok: MENSAGENS_DA_CAIXA.aberta } : { erro: r.mensagem };
  });
}
