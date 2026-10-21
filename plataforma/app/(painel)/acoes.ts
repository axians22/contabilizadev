"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { banco } from "@/banco";
import { encerrarSessao } from "@/lib/autenticacao/servico";
import { destinoAoSair } from "@/lib/autenticacao/rotas";
import { apagarCookieDeSessao, configAutenticacao, dependenciasDeLogin, exigirSessao, lerCookieDeSessao } from "@/lib/autenticacao/servidor";
import { SemAcessoEmpresa } from "@/lib/empresas/acesso";
import { definirEmpresaAtiva } from "@/lib/empresas/servico";

// Sair: apaga a sessão no banco (o mesmo cookie não serve mais, nem copiado) e o cookie. Com o login desligado
// não há tela de login: volta ao painel, que abre uma sessão nova da conta de desenvolvimento.
export async function sairAcao() {
  await encerrarSessao(dependenciasDeLogin(), await lerCookieDeSessao());
  await apagarCookieDeSessao();
  redirect(destinoAoSair(configAutenticacao().loginDesligado));
}

// Troca a empresa ativa. O vínculo é conferido no servidor: um id de empresa de outro é recusado.
export async function escolherEmpresaAcao(dados: FormData): Promise<{ erro: string } | void> {
  const sessao = await exigirSessao();
  try {
    await definirEmpresaAtiva(banco(), sessao, String(dados.get("empresaId") ?? ""));
  } catch (erro) {
    if (erro instanceof SemAcessoEmpresa) return { erro: erro.message };
    throw erro;
  }
  refresh();
}
