"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ErroConsultaCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { banco } from "@/banco";
import { configAutenticacao, exigirSessao } from "@/lib/autenticacao/servidor";
import { SemAcessoEmpresa } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro, ErroComExplicacao, FaltamDadosPessoais, PreviaInvalida, type Previa } from "@/lib/empresas/cadastro";
import { definirEmpresaAtiva, ErroDeEmpresa } from "@/lib/empresas/servico";
import { lerCnpjPlataforma } from "@/lib/serpro/config";

// explicacao: o porquê da recusa, para o tooltip (não está no quadro de sócios, faltam os dados pessoais); seusDados: a
// tela mostra o atalho para "Seus dados".
export type ErroDaTela = { erro: string; explicacao?: { titulo: string; texto: string }; seusDados?: boolean };
export type RespostaConsulta = ErroDaTela | { previa: Previa };
// "expirou": a prévia não vale mais (prazo vencido); a tela pesquisa o CNPJ de novo.
export type RespostaCadastro = (ErroDaTela & { expirou?: boolean }) | { empresaId: string };

function erroDaTela(erro: unknown): ErroDaTela | null {
  if (erro instanceof ErroComExplicacao) return { erro: erro.message, explicacao: erro.explicacao, ...(erro instanceof FaltamDadosPessoais ? { seusDados: true } : {}) };
  return erro instanceof ErroDeEmpresa || erro instanceof ErroConsultaCnpj || erro instanceof SemAcessoEmpresa ? { erro: erro.message } : null;
}

// Etapa 1 do assistente: consulta o CNPJ (banco primeiro, depois a Receita Federal) e devolve os dados para as etapas
// de conferência. Empresa que o usuário já tem passa a ser a ativa e ele vai para a página dela, sem consultar nada.
export async function consultarCnpjAcao(cnpj: string): Promise<RespostaConsulta> {
  const sessao = await exigirSessao();
  let resultado;
  try {
    resultado = await consultarParaCadastro(banco(), sessao.usuario, typeof cnpj === "string" ? cnpj : "", { segredo: configAutenticacao().segredo, cnpjReservado: lerCnpjPlataforma().cnpj });
    if (resultado.tipo === "ja-cadastrada") await definirEmpresaAtiva(banco(), sessao, resultado.empresaId);
  } catch (erro) {
    const tela = erroDaTela(erro);
    if (tela) return tela;
    throw erro;
  }
  if (resultado.tipo === "ja-cadastrada") {
    revalidatePath("/", "layout");
    redirect("/empresa");
  }
  return { previa: resultado.previa };
}

// Etapa 5 (diagnóstico): o cliente confirmou. Cria o cadastro provisório (aguardando comprovação pelo termo; a empresa da
// plataforma, para o ADMIN, já nasce comprovada) e deixa a empresa como ativa. Empresa que ainda não atendemos é recusada em cadastrarPelaPrevia. O assistente segue para os próximos passos.
export async function cadastrarEmpresaAcao(previa: string): Promise<RespostaCadastro> {
  const sessao = await exigirSessao();
  let empresaId: string;
  try {
    empresaId = await cadastrarPelaPrevia(banco(), sessao.usuario, typeof previa === "string" ? previa : "", { segredo: configAutenticacao().segredo, cnpjReservado: lerCnpjPlataforma().cnpj });
    await definirEmpresaAtiva(banco(), sessao, empresaId);
  } catch (erro) {
    if (erro instanceof PreviaInvalida) return { erro: erro.message, expirou: true };
    const tela = erroDaTela(erro);
    if (tela) return tela;
    throw erro;
  }
  // A barra de cima (layout) passa a mostrar a empresa nova; o assistente continua na tela (o estado dele fica).
  revalidatePath("/", "layout");
  return { empresaId };
}
