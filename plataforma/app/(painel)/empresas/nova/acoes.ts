"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ErroConsultaCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { banco } from "@/banco";
import { configAutenticacao, exigirSessao } from "@/lib/autenticacao/servidor";
import { SemAcessoEmpresa } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro, PreviaInvalida, type Previa } from "@/lib/empresas/cadastro";
import { definirEmpresaAtiva, ErroDeEmpresa } from "@/lib/empresas/servico";
import { lerCnpjPlataforma } from "@/lib/serpro/config";

export type RespostaConsulta = { erro: string } | { previa: Previa };
// "expirou": a prévia não vale mais (prazo vencido); a tela pesquisa o CNPJ de novo.
export type RespostaCadastro = { erro: string; expirou?: boolean } | { empresaId: string };

const mensagem = (erro: unknown) => (erro instanceof ErroDeEmpresa || erro instanceof ErroConsultaCnpj || erro instanceof SemAcessoEmpresa ? erro.message : null);

// Etapa 1 do assistente: consulta o CNPJ (banco primeiro, depois a Receita Federal) e devolve os dados para as etapas
// de conferência. Empresa que o usuário já tem passa a ser a ativa e ele vai para a página dela, sem consultar nada.
export async function consultarCnpjAcao(cnpj: string): Promise<RespostaConsulta> {
  const sessao = await exigirSessao();
  let resultado;
  try {
    resultado = await consultarParaCadastro(banco(), sessao.usuario, typeof cnpj === "string" ? cnpj : "", { segredo: configAutenticacao().segredo, cnpjReservado: lerCnpjPlataforma().cnpj });
    if (resultado.tipo === "ja-cadastrada") await definirEmpresaAtiva(banco(), sessao, resultado.empresaId);
  } catch (erro) {
    const texto = mensagem(erro);
    if (texto) return { erro: texto };
    throw erro;
  }
  if (resultado.tipo === "ja-cadastrada") {
    revalidatePath("/", "layout");
    redirect("/empresa");
  }
  return { previa: resultado.previa };
}

// Etapa 5 (diagnóstico): o cliente confirmou. Cria a empresa (ele vira DONO), guarda a consulta e deixa a empresa como
// ativa. Empresa que ainda não atendemos é recusada em cadastrarPelaPrevia. O assistente segue para os próximos passos.
export async function cadastrarEmpresaAcao(previa: string): Promise<RespostaCadastro> {
  const sessao = await exigirSessao();
  let empresaId: string;
  try {
    empresaId = await cadastrarPelaPrevia(banco(), sessao.usuario, typeof previa === "string" ? previa : "", { segredo: configAutenticacao().segredo, cnpjReservado: lerCnpjPlataforma().cnpj });
    await definirEmpresaAtiva(banco(), sessao, empresaId);
  } catch (erro) {
    if (erro instanceof PreviaInvalida) return { erro: erro.message, expirou: true };
    const texto = mensagem(erro);
    if (texto) return { erro: texto };
    throw erro;
  }
  // A barra de cima (layout) passa a mostrar a empresa nova; o assistente continua na tela (o estado dele fica).
  revalidatePath("/", "layout");
  return { empresaId };
}
