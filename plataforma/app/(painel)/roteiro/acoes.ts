"use server";

import { revalidatePath } from "next/cache";
import { banco } from "@/banco";
import { exigirSessao } from "@/lib/autenticacao/servidor";
import { SemAcessoEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { exigirAcessoAoConteudo } from "@/lib/empresas/portao";
import { conferirDctfMes, prepararTransmissaoDctf, transmitirDctfMes } from "@/lib/rotina/dctfweb";
import type { DependenciasRotina } from "@/lib/rotina/dependencias";
import { gerarGuia } from "@/lib/rotina/guias";
import { MENSAGENS_DA_ROTINA } from "@/lib/rotina/mensagens";
import { simularMes, transmitirMes } from "@/lib/rotina/pgdasd";
import { informarProLabore, lancarReceita, marcarSemReceita, removerReceita } from "@/lib/rotina/receitas";
import { rotinaDoServidor } from "@/lib/rotina/servidor";

// Ações da rotina do mês. Todas: sessão (exigirSessao), vínculo e plano pela porta do portão (exigirAcessoAoConteudo,
// com a empresa vinda do formulário e conferida contra o vínculo) e, para o que fala com a Receita, a autorização em dia.
// Só mensagens próprias voltam à tela; o detalhe técnico vai para o log do servidor.
export type EstadoDaAcao = { erro?: string; ok?: string } | undefined;

const texto = (dados: FormData, nome: string) => String(dados.get(nome) ?? "").trim();
// Número digitado no formato brasileiro (23.000, 1.234,56, 1234,56) ou com ponto decimal (1234.56). O ponto seguido de
// grupos de 3 dígitos é separador de milhar ("23.000" é 23 mil, não 23); fora isso, o ponto é decimal.
function numero(v: string): number {
  const limpo = v.replace(/\s|R\$/g, "");
  if (!limpo) return Number.NaN;
  // Separador de milhar só depois de um primeiro grupo sem zero à esquerda: "0.004" é decimal (0,004), não 4.
  if (/^(0|[1-9]\d{0,2}(\.\d{3})*)(,\d+)?$/.test(limpo)) return Number(limpo.replace(/\./g, "").replace(",", "."));
  if (/^[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/.test(limpo)) return Number(limpo.replace(/,/g, ""));
  if (/^\d+,\d+$/.test(limpo)) return Number(limpo.replace(",", "."));
  // Só dígitos com ponto decimal opcional: recusa "1e5", "0x10", "0b11" e "Infinity", que Number() aceitaria.
  if (/^\d+(\.\d+)?$/.test(limpo)) return Number(limpo);
  return Number.NaN;
}

type Contexto = { acesso: AcessoEmpresa; usuarioId: string; deps: DependenciasRotina & { autorizada: boolean } };

async function comAcesso<T extends EstadoDaAcao>(empresaId: string, fazer: (c: Contexto) => Promise<T>, opcoes: { receita?: boolean } = {}): Promise<T | EstadoDaAcao> {
  const sessao = await exigirSessao();
  try {
    const acesso = await exigirAcessoAoConteudo(banco(), sessao.usuario, empresaId);
    const deps = await rotinaDoServidor(acesso);
    if (opcoes.receita && !deps.autorizada) return { erro: MENSAGENS_DA_ROTINA.semAutorizacao };
    const r = await fazer({ acesso, usuarioId: sessao.usuario.id, deps });
    revalidatePath("/", "layout");
    return r;
  } catch (erro) {
    if (erro instanceof SemAcessoEmpresa) return { erro: erro.message };
    console.error("[serpro] Falha inesperada na rotina do mês:", (erro as Error).message);
    return { erro: MENSAGENS_DA_ROTINA.falhou };
  }
}

export async function lancarReceitaAcao(_anterior: EstadoDaAcao, dados: FormData): Promise<EstadoDaAcao> {
  await exigirSessao();
  return comAcesso(texto(dados, "empresaId"), async ({ acesso, usuarioId, deps }) => {
    const moeda = texto(dados, "moeda") || "BRL";
    const reais = texto(dados, "valorBrl");
    const r = await lancarReceita(deps, acesso, {
      pa: texto(dados, "pa"),
      recebidaEm: texto(dados, "recebidaEm"),
      moeda,
      valorMoeda: numero(texto(dados, "valor")),
      valorBrl: moeda === "BRL" || !reais ? null : numero(reais),
      observacao: texto(dados, "observacao"),
      usuarioId,
    });
    return r.ok ? { ok: "Receita lançada." } : { erro: r.mensagem };
  });
}

export async function removerReceitaAcao(dados: FormData): Promise<void> {
  await exigirSessao();
  await comAcesso(texto(dados, "empresaId"), async ({ acesso, deps }) => {
    await removerReceita(deps.banco, acesso, texto(dados, "id"));
    return undefined;
  });
}

export async function informarProLaboreAcao(_anterior: EstadoDaAcao, dados: FormData): Promise<EstadoDaAcao> {
  await exigirSessao();
  return comAcesso(texto(dados, "empresaId"), async ({ acesso, usuarioId, deps }) => {
    const r = await informarProLabore(deps, acesso, { mes: texto(dados, "mes"), valor: numero(texto(dados, "valor")), usuarioId });
    return r.ok ? { ok: "Pró-labore salvo." } : { erro: r.mensagem };
  });
}

// "Não houve receita neste mês" (marcar = "sim") ou desfazer a marcação.
export async function marcarSemReceitaAcao(_anterior: EstadoDaAcao, dados: FormData): Promise<EstadoDaAcao> {
  await exigirSessao();
  return comAcesso(texto(dados, "empresaId"), async ({ acesso, usuarioId, deps }) => {
    const marcar = texto(dados, "marcar") === "sim";
    const r = await marcarSemReceita(deps, acesso, { pa: texto(dados, "pa"), marcar, usuarioId });
    return r.ok ? { ok: marcar ? "Marcado: sem receita neste mês." : "Marcação desfeita." } : { erro: r.mensagem };
  });
}

export async function simularAcao(_anterior: EstadoDaAcao, dados: FormData): Promise<EstadoDaAcao> {
  await exigirSessao();
  return comAcesso(
    texto(dados, "empresaId"),
    async ({ acesso, usuarioId, deps }) => {
      const r = await simularMes(deps, acesso, texto(dados, "pa"), { retificar: texto(dados, "retificar") === "sim", usuarioId });
      if (!r.ok) return { erro: r.mensagem };
      return r.bateu ? { ok: "A Receita Federal chegou nos mesmos valores." } : { erro: MENSAGENS_DA_ROTINA.simulacaoDiferente };
    },
    { receita: true },
  );
}

export async function transmitirAcao(_anterior: EstadoDaAcao, dados: FormData): Promise<EstadoDaAcao> {
  await exigirSessao();
  return comAcesso(
    texto(dados, "empresaId"),
    async ({ acesso, usuarioId, deps }) => {
      const r = await transmitirMes(deps, acesso, texto(dados, "pa"), {
        retificar: texto(dados, "retificar") === "sim",
        confirmado: texto(dados, "confirmo") === "sim",
        confirmacao: { receita: Number(texto(dados, "receita")), total: Number(texto(dados, "total")) },
        usuarioId,
      });
      return r.ok ? { ok: `Declaração transmitida (nº ${r.numeroDeclaracao}).` } : { erro: r.mensagem };
    },
    { receita: true },
  );
}

export async function gerarGuiaAcao(_anterior: EstadoDaAcao, dados: FormData): Promise<EstadoDaAcao> {
  await exigirSessao();
  return comAcesso(
    texto(dados, "empresaId"),
    async ({ acesso, usuarioId, deps }) => {
      const tipo = texto(dados, "tipo") === "INSS" ? "INSS" : "DAS";
      const r = await gerarGuia(deps, acesso, texto(dados, "pa"), tipo, { pagarEm: texto(dados, "pagarEm") || null, usuarioId });
      return r.ok ? { ok: r.nova ? "Guia gerada." : "Esta guia já tinha sido gerada." } : { erro: r.mensagem };
    },
    { receita: true },
  );
}

export async function conferirDctfAcao(_anterior: EstadoDaAcao, dados: FormData): Promise<EstadoDaAcao> {
  await exigirSessao();
  return comAcesso(
    texto(dados, "empresaId"),
    async ({ acesso, usuarioId, deps }) => {
      const r = await conferirDctfMes(deps, acesso, texto(dados, "pa"), { usuarioId });
      return r.ok ? { ok: "Declaração conferida." } : { erro: r.mensagem };
    },
    { receita: true },
  );
}

// DCTFWeb da empresa da plataforma: assinada no servidor, com a confirmação do cliente.
export async function transmitirDctfAcao(_anterior: EstadoDaAcao, dados: FormData): Promise<EstadoDaAcao> {
  await exigirSessao();
  return comAcesso(
    texto(dados, "empresaId"),
    async ({ acesso, usuarioId, deps }) => {
      const r = await transmitirDctfMes(deps, acesso, texto(dados, "pa"), {
        confirmado: texto(dados, "confirmo") === "sim",
        confirmacao: { aPagar: Number(texto(dados, "aPagar")) },
        usuarioId,
      });
      return r.ok ? { ok: "DCTFWeb transmitida." } : { erro: r.mensagem };
    },
    { receita: true },
  );
}

// DCTFWeb de cliente, assinada no navegador: 1) o navegador manda só o certificado (parte pública) e recebe o texto a
// assinar; 2) manda o valor assinado com a confirmação. O .pfx, a chave e a senha nunca chegam aqui.
export type PreparoDctf = { erro: string } | { preparoId: string; signedInfo: string; aPagar: number };

export async function prepararDctfAcao(empresaId: string, pa: string, certificado: string): Promise<PreparoDctf> {
  await exigirSessao();
  const r = await comAcesso<{ erro?: string; ok?: string; preparo?: PreparoDctf }>(
    String(empresaId),
    async ({ acesso, usuarioId, deps }) => {
      const p = await prepararTransmissaoDctf(deps, acesso, String(pa), { certificado: String(certificado), usuarioId });
      return p.ok ? { preparo: { preparoId: p.preparoId, signedInfo: p.signedInfo, aPagar: p.aPagar } } : { erro: p.mensagem };
    },
    { receita: true },
  );
  if (r && "preparo" in r && r.preparo) return r.preparo;
  return { erro: r?.erro ?? MENSAGENS_DA_ROTINA.falhou };
}

export async function transmitirDctfAssinadaAcao(
  empresaId: string,
  pa: string,
  envio: { preparoId: string; assinatura: string; aPagar: number; confirmado: boolean },
): Promise<EstadoDaAcao> {
  await exigirSessao();
  return comAcesso(
    String(empresaId),
    async ({ acesso, usuarioId, deps }) => {
      const r = await transmitirDctfMes(deps, acesso, String(pa), {
        confirmado: envio?.confirmado === true,
        confirmacao: { aPagar: Number(envio?.aPagar) },
        preparoId: String(envio?.preparoId ?? ""),
        assinatura: String(envio?.assinatura ?? ""),
        usuarioId,
      });
      return r.ok ? { ok: "DCTFWeb transmitida." } : { erro: r.mensagem };
    },
    { receita: true },
  );
}
