// Ligação do portão (lib/empresas/portao.ts) com a requisição: a sessão (exigirSessao) e a decisão do portão para a
// empresa ativa. Toda página de aba de empresa começa por aqui e só lê dado pelo `acesso` do caminho liberado.
import "server-only";
import { cache } from "react";
import { banco } from "@/banco";
import { exigirSessao, type SessaoAtual } from "@/lib/autenticacao/servidor";
import { abrirPortao, type Portao } from "./portao";

// Uma decisão por requisição (o layout, com o sino, e a página perguntam a mesma coisa).
const portaoDaRequisicao = cache(async (sessao: SessaoAtual): Promise<Portao> => abrirPortao(banco(), sessao.usuario, sessao.empresaAtiva));

export async function exigirConteudo(): Promise<SessaoAtual & { portao: Portao }> {
  const sessao = await exigirSessao();
  return { ...sessao, portao: await portaoDaRequisicao(sessao) };
}
