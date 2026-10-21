// Ligação da Caixa Postal com o servidor do Next: o banco, o cliente real do contrato e o contexto da empresa (termo de
// autorização e token). A busca da lista ao abrir uma página roda em segundo plano com after() (a tela não espera) e só
// para empresa com a autorização em dia; o banco decide se já é hora (uma vez por dia).
import "server-only";
import { after } from "next/server";
import { banco } from "@/banco";
import type { AcessoEmpresa } from "@/lib/empresas/acesso";
import { serproDoServidor } from "@/lib/serpro/servidor";
import { termoDoServidor } from "@/lib/termo/servidor";
import { liberada } from "@/lib/termo/situacao";
import { contextoSerpro, situacaoTermo } from "@/lib/termo/termo";
import { atualizarCaixaPostal, listaEmDia, type DependenciasCaixa } from "./caixa-postal";

export async function caixaDoServidor(acesso: AcessoEmpresa): Promise<DependenciasCaixa & { autorizada: boolean }> {
  const termo = await termoDoServidor();
  return {
    banco: banco(),
    cliente: (await serproDoServidor()).cliente,
    contexto: () => contextoSerpro(termo, acesso),
    autorizada: liberada(await situacaoTermo(termo, acesso)),
  };
}

// Ao abrir o painel ou a aba Mensagens: com a autorização em dia e a lista com mais de um dia, busca em segundo plano.
// Uma falha aqui nunca derruba a página (fica no log; a tela mostra o que está guardado).
export async function atualizarCaixaAoAbrir(acesso: AcessoEmpresa): Promise<void> {
  try {
    const deps = await caixaDoServidor(acesso);
    if (!deps.autorizada || !deps.cliente || (await listaEmDia(deps.banco, acesso, new Date()))) return;
    after(() =>
      atualizarCaixaPostal(deps, acesso, { manual: false }).catch((erro) => console.error("[serpro] Falha inesperada na Caixa Postal:", (erro as Error).message)),
    );
  } catch (erro) {
    console.error("[serpro] Falha ao planejar a busca da Caixa Postal:", (erro as Error).message);
  }
}
