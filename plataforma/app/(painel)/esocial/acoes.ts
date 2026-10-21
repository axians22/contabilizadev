"use server";

import { revalidatePath } from "next/cache";
import { banco } from "@/banco";
import { exigirSessao } from "@/lib/autenticacao/servidor";
import { SemAcessoEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { exigirAcessoAoConteudo } from "@/lib/empresas/portao";
import { importarEventos, importarIdentificadores, importarPelaPlataforma, prepararImportacao, quantidadeDoFormulario, salvarConfigEsocial, type CampoDaConfig } from "@/lib/esocial/configuracao";
import { acompanharEnvio, enviarEsocialAssinado, enviarEsocialPelaPlataforma, marcarFeitoNoPortal, prepararEnvioEsocial, repetirEnvioEsocial, type DependenciasEsocial, type PreparoEsocial } from "@/lib/esocial/envio";
import { MENSAGENS_DO_ESOCIAL } from "@/lib/esocial/mensagens";
import { acompanharDepois, esocialDoServidor } from "@/lib/esocial/servidor";

// Ações do eSocial (aba eSocial e passo do eSocial na rotina do mês). Todas: sessão (exigirSessao), vínculo e plano pela
// porta do portão (exigirAcessoAoConteudo, com a empresa vinda do formulário e conferida contra o vínculo). O navegador
// manda só o certificado público e os valores assinados; o .pfx, a chave e a senha nunca chegam aqui. Só mensagens
// próprias voltam à tela; o detalhe técnico vai para o log com [esocial].
export type EstadoEsocial = { erro?: string; ok?: string; erros?: Partial<Record<CampoDaConfig, string>> } | undefined;

const texto = (dados: FormData, nome: string) => String(dados.get(nome) ?? "").trim();

type Contexto = { acesso: AcessoEmpresa; usuarioId: string; deps: DependenciasEsocial };

async function comEsocial<T>(empresaId: string, fazer: (c: Contexto) => Promise<T>): Promise<T | { erro: string }> {
  const sessao = await exigirSessao();
  try {
    const acesso = await exigirAcessoAoConteudo(banco(), sessao.usuario, String(empresaId));
    const r = await fazer({ acesso, usuarioId: sessao.usuario.id, deps: await esocialDoServidor(acesso) });
    revalidatePath("/", "layout");
    return r;
  } catch (erro) {
    if (erro instanceof SemAcessoEmpresa) return { erro: erro.message };
    console.error("[esocial] Falha inesperada:", (erro as Error).message);
    return { erro: MENSAGENS_DO_ESOCIAL.falhou };
  }
}

export async function salvarConfigAcao(_anterior: EstadoEsocial, dados: FormData): Promise<EstadoEsocial> {
  await exigirSessao();
  return comEsocial(texto(dados, "empresaId"), async ({ acesso, usuarioId, deps }) => {
    const r = await salvarConfigEsocial(
      deps,
      acesso,
      {
        cpf: texto(dados, "cpf"),
        categoria: texto(dados, "categoria"),
        matricula: texto(dados, "matricula"),
        lotacao: texto(dados, "lotacao"),
        tabRubrica: texto(dados, "tabRubrica"),
        rubricaProLabore: texto(dados, "rubricaProLabore"),
        rubricaInss: texto(dados, "rubricaInss"),
        qtdProLabore: quantidadeDoFormulario(texto(dados, "qtdProLabore")),
        diaPagamento: Number(texto(dados, "diaPagamento")),
        pagamentoNoMes: texto(dados, "pagamentoNoMes") === "mesmo" ? "mesmo" : "seguinte",
      },
      { usuarioId },
    );
    if (r.ok) return { ok: "Cadastros do eSocial salvos." };
    return { erro: r.mensagem, erros: "erros" in r ? r.erros : undefined };
  });
}

// Importação pelo navegador, em três idas: 1) o certificado público → a consulta a assinar; 2) a consulta assinada →
// o download a assinar; 3) o download assinado → os cadastros.
export type PassoDaImportacao = { erro: string } | { pedidoId: string; signedInfo: string } | { fim: string };

export async function prepararImportacaoAcao(empresaId: string, cpf: string, mes: string, certificado: string): Promise<PassoDaImportacao> {
  await exigirSessao();
  return comEsocial(empresaId, async ({ acesso, deps }) => {
    const r = await prepararImportacao(deps, acesso, { cpf: String(cpf), mes: String(mes), certificado: String(certificado) });
    return r.ok ? { pedidoId: r.pedidoId, signedInfo: r.signedInfo } : { erro: r.mensagem };
  });
}

export async function importarIdentificadoresAcao(empresaId: string, pedidoId: string, assinatura: string): Promise<PassoDaImportacao> {
  await exigirSessao();
  return comEsocial(empresaId, async ({ acesso, deps }) => {
    const r = await importarIdentificadores(deps, acesso, { pedidoId: String(pedidoId), assinatura: String(assinatura) });
    if (!r.ok) return { erro: r.mensagem };
    return r.download ?? { fim: MENSAGENS_DO_ESOCIAL.nadaAchado };
  });
}

export async function importarEventosAcao(empresaId: string, pedidoId: string, assinatura: string): Promise<PassoDaImportacao> {
  await exigirSessao();
  return comEsocial(empresaId, async ({ acesso, usuarioId, deps }) => {
    const r = await importarEventos(deps, acesso, { pedidoId: String(pedidoId), assinatura: String(assinatura), usuarioId });
    if (!r.ok) return { erro: r.mensagem };
    return r.mensagem ? { erro: r.mensagem } : { fim: "Cadastros importados do eSocial. Confira abaixo." };
  });
}

// Empresa da própria plataforma: as duas consultas assinadas no servidor.
export async function importarPelaPlataformaAcao(_anterior: EstadoEsocial, dados: FormData): Promise<EstadoEsocial> {
  await exigirSessao();
  return comEsocial(texto(dados, "empresaId"), async ({ acesso, usuarioId, deps }) => {
    const r = await importarPelaPlataforma(deps, acesso, { cpf: texto(dados, "cpf"), mes: texto(dados, "mes"), usuarioId });
    if (!r.ok) return { erro: r.mensagem };
    return r.mensagem ? { erro: r.mensagem } : { ok: "Cadastros importados do eSocial." };
  });
}

// Envio do mês pelo navegador: 1) o certificado público → os textos a assinar e o resumo; 2) os valores assinados, com a
// confirmação.
export type PreparoNaTela = { erro: string } | PreparoEsocial;

export async function prepararEsocialAcao(empresaId: string, mes: string, certificado: string, opcoes: { retificar?: boolean; dtPgto?: string | null; semPagamentoAnterior?: boolean }): Promise<PreparoNaTela> {
  await exigirSessao();
  return comEsocial(empresaId, async ({ acesso, usuarioId, deps }) => {
    const r = await prepararEnvioEsocial(deps, acesso, String(mes), {
      certificado: String(certificado),
      retificar: opcoes?.retificar === true,
      dtPgto: opcoes?.dtPgto ? String(opcoes.dtPgto) : null,
      semPagamentoAnterior: opcoes?.semPagamentoAnterior === true,
      usuarioId,
    });
    if (!r.ok) return { erro: r.mensagem };
    return { envioId: r.envioId, assinaturas: r.assinaturas, resumo: r.resumo };
  });
}

const mensagemDoEstado = (estado: string) =>
  estado === "concluido" ? "Pronto: o eSocial aceitou." : estado === "aguardando" || estado === "enviando" ? "Enviado. O eSocial está processando; o resultado aparece aqui." : "Envio terminado.";

export async function enviarEsocialAcao(
  empresaId: string,
  mes: string,
  envio: { envioId: string; assinaturas: { idEvento: string; valor: string }[]; proLabore: number; confirmado: boolean },
): Promise<EstadoEsocial> {
  await exigirSessao();
  return comEsocial(empresaId, async ({ acesso, usuarioId, deps }) => {
    const r = await enviarEsocialAssinado(deps, acesso, String(mes), {
      envioId: String(envio?.envioId ?? ""),
      assinaturas: Array.isArray(envio?.assinaturas) ? envio.assinaturas.map((a) => ({ idEvento: String(a?.idEvento ?? ""), valor: String(a?.valor ?? "") })) : [],
      confirmado: envio?.confirmado === true,
      confirmacao: { proLabore: Number(envio?.proLabore) },
      usuarioId,
    });
    if (!r.ok) return { erro: r.mensagem };
    if (r.estado === "aguardando") acompanharDepois(deps, acesso, String(envio.envioId));
    return { ok: mensagemDoEstado(r.estado) };
  });
}

// Empresa da própria plataforma: assinada no servidor, com a confirmação do resumo.
export async function enviarEsocialPelaPlataformaAcao(_anterior: EstadoEsocial, dados: FormData): Promise<EstadoEsocial> {
  await exigirSessao();
  return comEsocial(texto(dados, "empresaId"), async ({ acesso, usuarioId, deps }) => {
    const r = await enviarEsocialPelaPlataforma(deps, acesso, texto(dados, "mes"), {
      confirmado: texto(dados, "confirmo") === "sim",
      confirmacao: { proLabore: Number(texto(dados, "proLabore")) },
      retificar: texto(dados, "retificar") === "sim",
      dtPgto: texto(dados, "dtPgto") || null,
      semPagamentoAnterior: texto(dados, "semPagamentoAnterior") === "sim",
      usuarioId,
    });
    if (!r.ok) return { erro: r.mensagem };
    return { ok: mensagemDoEstado(r.estado) };
  });
}

// "Enviar de novo" (envio sem resposta): os mesmos eventos assinados.
export async function repetirEsocialAcao(_anterior: EstadoEsocial, dados: FormData): Promise<EstadoEsocial> {
  await exigirSessao();
  return comEsocial(texto(dados, "empresaId"), async ({ acesso, deps }) => {
    const envioId = texto(dados, "envioId");
    const r = await repetirEnvioEsocial(deps, acesso, texto(dados, "mes"), envioId);
    if (!r.ok) return { erro: r.mensagem };
    if (r.estado === "aguardando") acompanharDepois(deps, acesso, envioId);
    return { ok: mensagemDoEstado(r.estado) };
  });
}

// "Atualizar o resultado": consulta o lote agora.
export async function atualizarEsocialAcao(_anterior: EstadoEsocial, dados: FormData): Promise<EstadoEsocial> {
  await exigirSessao();
  return comEsocial(texto(dados, "empresaId"), async ({ acesso, deps }) => {
    const r = await acompanharEnvio(deps, acesso, texto(dados, "envioId"));
    if (!r.ok) return { erro: r.mensagem };
    return r.estado === "recusado" ? { erro: MENSAGENS_DO_ESOCIAL.recusado } : { ok: mensagemDoEstado(r.estado) };
  });
}

// "Já lancei no portal do eSocial" (passo 21) ou desfazer.
export async function marcarPortalAcao(_anterior: EstadoEsocial, dados: FormData): Promise<EstadoEsocial> {
  await exigirSessao();
  return comEsocial(texto(dados, "empresaId"), async ({ acesso, usuarioId, deps }) => {
    const feito = texto(dados, "feito") === "sim";
    const r = await marcarFeitoNoPortal(deps, acesso, texto(dados, "mes"), { feito, usuarioId });
    return r.ok ? { ok: feito ? "Marcado como lançado no portal." : "Marcação desfeita." } : { erro: r.mensagem };
  });
}
