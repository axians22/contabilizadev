"use server";

import { refresh } from "next/cache";
import { banco } from "@/banco";
import { configAutenticacao, exigirAreaDoAdmin } from "@/lib/autenticacao/servidor";
import { ErroDeGestao, mudarAtivo, mudarPapel } from "@/lib/usuarios/servico";

type Resultado = { erro: string } | undefined;

// Só quem vê a página Usuários da área do administrador chega aqui (exigirAreaDoAdmin). As regras (quem pode o quê) estão
// no serviço e valem mesmo que alguém monte o formulário à mão.
async function executar(acao: () => Promise<unknown>): Promise<Resultado> {
  try {
    await acao();
  } catch (erro) {
    if (erro instanceof ErroDeGestao) return { erro: erro.message };
    throw erro;
  }
  refresh();
}

export async function mudarPapelAcao(_anterior: Resultado, dados: FormData): Promise<Resultado> {
  const { usuario } = await exigirAreaDoAdmin("/admin/usuarios");
  return executar(() => mudarPapel(banco(), usuario, String(dados.get("usuarioId") ?? ""), String(dados.get("papel") ?? ""), configAutenticacao().adminEmails));
}

export async function mudarAtivoAcao(_anterior: Resultado, dados: FormData): Promise<Resultado> {
  const { usuario } = await exigirAreaDoAdmin("/admin/usuarios");
  return executar(() => mudarAtivo(banco(), usuario, String(dados.get("usuarioId") ?? ""), dados.get("ativo") === "true", configAutenticacao().adminEmails));
}
