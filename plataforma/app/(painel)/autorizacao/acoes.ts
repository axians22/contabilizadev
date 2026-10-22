"use server";

import { revalidatePath } from "next/cache";
import { banco } from "@/banco";
import { exigirSessao } from "@/lib/autenticacao/servidor";
import { ehProvisorio, SemAcessoEmpresa } from "@/lib/empresas/acesso";
import { autorizacaoDoPreparo, type Autorizacao } from "@/lib/empresas/assistente";
import { exigirAcessoParaOTermo } from "@/lib/empresas/portao";
import { importarSeNuncaImportou } from "@/lib/historico/servidor";
import { liberada } from "@/lib/termo/situacao";
import { AUTORIZAR_DEPOIS, MENSAGEM_GENERICA, mensagemDoEnvio } from "@/lib/termo/mensagens";
import { termoDoServidor } from "@/lib/termo/servidor";
import { ErroAutenticaProcurador, ErroTermo, ErroTermoAutorizacao, prepararAutorizacao, registrarTermo } from "@/lib/termo/termo";

export type EstadoEnvio = { erro: string } | { ok: true; validaAte: string } | undefined;

// Recebe do navegador só o termo assinado (o certificado e a senha ficam lá). Confere o vínculo (dono, ou o cadastro
// provisório que o termo vai comprovar) e o plano pelo portão e o papel em registrarTermo, confere o termo e envia. Só mensagens próprias voltam ao navegador: o detalhe
// técnico (resposta da API) vai para o log do servidor, e o XML nunca vai para o log.
export async function enviarTermoAcao(empresaId: string, xml: string): Promise<EstadoEnvio> {
  const sessao = await exigirSessao();
  try {
    const acesso = await exigirAcessoParaOTermo(banco(), sessao.usuario, empresaId);
    const r = await registrarTermo(await termoDoServidor(), acesso, typeof xml === "string" ? xml : "");
    revalidatePath("/", "layout"); // o sino e o painel acompanham (e a empresa comprovada abre o conteúdo)
    if (r.situacao.estado !== "vigente" && r.situacao.estado !== "vencendo") return { erro: MENSAGEM_GENERICA };
    // Autorizada: a importação do histórico começa em segundo plano (a tela não espera), com o acesso de dono.
    await importarSeNuncaImportou(r.acesso);
    return { ok: true, validaAte: r.situacao.validaAte };
  } catch (erro) {
    if (erro instanceof SemAcessoEmpresa || erro instanceof ErroTermo || erro instanceof ErroTermoAutorizacao) return { erro: erro.message };
    if (erro instanceof ErroAutenticaProcurador) {
      console.error(`[serpro] Termo de autorização recusado (${erro.motivo}): ${erro.message}`);
      return { erro: mensagemDoEnvio(erro.motivo) };
    }
    console.error("[serpro] Falha inesperada ao enviar o termo de autorização:", (erro as Error).message);
    return { erro: MENSAGEM_GENERICA };
  }
}

// Passo 7 do cadastro (empresas/nova), logo depois de cadastrar: o mesmo preparo da página Autorização (situação e
// parâmetros do termo, só banco), no formato do assistente. Se algo falhar, a empresa já está cadastrada: o passo 7
// diz que dá para autorizar depois e o assistente segue.
export async function prepararAutorizacaoAcao(empresaId: string): Promise<Autorizacao> {
  const sessao = await exigirSessao();
  try {
    const acesso = await exigirAcessoParaOTermo(banco(), sessao.usuario, typeof empresaId === "string" ? empresaId : "");
    const preparo = await prepararAutorizacao(await termoDoServidor(), acesso);
    // A empresa da própria plataforma já chega autorizada ao passo 7: a importação do histórico começa aqui.
    if (liberada(preparo.situacao) && !ehProvisorio(acesso)) await importarSeNuncaImportou(acesso);
    return autorizacaoDoPreparo(preparo);
  } catch (erro) {
    if (erro instanceof SemAcessoEmpresa) return { tipo: "indisponivel", mensagem: erro.message };
    console.error("[serpro] Falha inesperada ao preparar a autorização:", (erro as Error).message);
    return { tipo: "indisponivel", mensagem: AUTORIZAR_DEPOIS };
  }
}
