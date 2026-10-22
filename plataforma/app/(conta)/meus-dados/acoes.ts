"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { banco } from "@/banco";
import { exigirSessaoSemDados } from "@/lib/autenticacao/servidor";
import { hojeNoBrasil } from "@/lib/empresas/receita";
import { buscarCep } from "@/lib/usuarios/cep";
import { ErroDadosPessoais, salvarDadosPessoais } from "@/lib/usuarios/dados-pessoais";
import { CAMPOS, type Campo } from "@/lib/usuarios/validacao";

export type EstadoDosDados = { erros?: Partial<Record<Campo | "aceite", string>>; mensagem?: string; salvo?: boolean } | undefined;

// "Seus dados": grava os dados do próprio usuário (o id vem da sessão). Fica fora do portão do primeiro login (é a tela
// dele). Na primeira vez, segue para o painel; depois, só confirma. Nada do que foi digitado vai para o log.
export async function salvarDadosAcao(_anterior: EstadoDosDados, formulario: FormData): Promise<EstadoDosDados> {
  const { usuario } = await exigirSessaoSemDados();
  const campos = Object.fromEntries([...CAMPOS, "aceite"].map((c) => [c, String(formulario.get(c) ?? "")]));
  const agora = new Date();
  try {
    await salvarDadosPessoais(banco(), usuario.id, campos, agora, hojeNoBrasil(agora));
  } catch (erro) {
    if (erro instanceof ErroDadosPessoais) return { erros: erro.erros, mensagem: erro.message };
    throw erro;
  }
  revalidatePath("/", "layout");
  if (usuario.dadosPendentes) redirect("/");
  return { salvo: true, mensagem: "Dados salvos." };
}

export type RespostaCep = { endereco: { logradouro: string | null; bairro: string | null; cidade: string; uf: string } } | { erro: string };

// Busca do endereço pelo CEP (banco primeiro; lib/usuarios/cep.ts). Falhou, o usuário digita.
export async function buscarCepAcao(cep: string): Promise<RespostaCep> {
  await exigirSessaoSemDados();
  const r = await buscarCep(banco(), typeof cep === "string" ? cep : "");
  if (r.tipo !== "achado") return { erro: r.mensagem };
  const { logradouro, bairro, cidade, uf } = r.endereco;
  return { endereco: { logradouro, bairro, cidade, uf } };
}
