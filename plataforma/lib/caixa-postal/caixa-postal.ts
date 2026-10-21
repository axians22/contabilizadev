// Caixa Postal da Receita (Parte 8, passo 22): as mensagens da empresa, banco primeiro. Regra legal: abrir o conteúdo de
// uma mensagem registra a ciência na Receita e pode começar a contar prazos (núcleo, serpro/caixa-postal.ts, com a fonte).
// - A lista só traz o cabeçalho (assunto, data, remetente, leitura, relevância) e nunca abre nada. É buscada sozinha no
//   máximo uma vez por dia (ao abrir o painel ou a aba Mensagens) ou pelo botão Atualizar (intervalo mínimo); a tentativa
//   que falhou também conta. A vez de buscar é uma troca condicional em historico_consultas ("caixa-postal"): duas abas ou
//   dois cliques buscam uma vez só.
// - O conteúdo só é buscado quando o cliente pede para abrir uma mensagem; ainda não lida, só com a confirmação da
//   ciência. Aberto, fica guardado e não é pedido de novo. Trava por mensagem (abrindo_em): duplo clique chama uma vez.
// - "Nova" (acende o sino): não lida na Receita, não aberta aqui e ainda não vista na lista. Ver a lista apaga o sino sem
//   registrar ciência nenhuma. "Não lida" (contador do painel): não lida na Receita e não aberta aqui.
import { and, desc, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import { ErroSemResposta } from "@contabilizadev/nucleo/serpro/cliente";
import { abrirMensagem, INTERVALO_DIAS, listarMensagens, PAGINAS_NA_PRIMEIRA_BUSCA } from "@contabilizadev/nucleo/serpro/caixa-postal";
import type { Banco } from "@/banco";
import { caixaPostal, historicoConsultas } from "@/banco/esquema";
import { dadosDaEmpresa, daEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { DIA_MS, INTERVALO_MANUAL_MINUTOS, esperaManual } from "@/lib/historico/prazos";
import { log, recusa, relogio, type DependenciasRotina, type Resposta } from "@/lib/rotina/dependencias";
import { ErroTermoAutorizacao } from "@/lib/termo/termo";
import { MENSAGENS_DA_CAIXA, mensagemDaFalha } from "./mensagens";

export const TIPO_DA_CONSULTA = "caixa-postal";
// Pedido do conteúdo sem desfecho há esse tempo (servidor reiniciado no meio) libera a trava.
export const ABRINDO_MINUTOS = 2;

export type DependenciasCaixa = Pick<DependenciasRotina, "banco" | "cliente" | "contexto" | "agora" | "log">;
export type MensagemGuardada = Omit<typeof caixaPostal.$inferSelect, "abrindoEm">;

const SEM_TRAVA = {
  id: caixaPostal.id,
  empresaId: caixaPostal.empresaId,
  isn: caixaPostal.isn,
  assunto: caixaPostal.assunto,
  origem: caixaPostal.origem,
  enviadaEm: caixaPostal.enviadaEm,
  lidaNaReceita: caixaPostal.lidaNaReceita,
  cienciaEm: caixaPostal.cienciaEm,
  validaAte: caixaPostal.validaAte,
  relevante: caixaPostal.relevante,
  conteudo: caixaPostal.conteudo,
  abertaEm: caixaPostal.abertaEm,
  abertaPor: caixaPostal.abertaPor,
  vistaEm: caixaPostal.vistaEm,
  buscadaEm: caixaPostal.buscadaEm,
};

export const ehNova = (m: Pick<MensagemGuardada, "lidaNaReceita" | "abertaEm" | "vistaEm">) => !m.lidaNaReceita && !m.abertaEm && !m.vistaEm;
export const naoLida = (m: Pick<MensagemGuardada, "lidaNaReceita" | "abertaEm">) => !m.lidaNaReceita && !m.abertaEm;

// Da mais recente à mais antiga (sem data de envio, no fim).
export async function mensagensDaEmpresa(banco: Banco, acesso: AcessoEmpresa): Promise<MensagemGuardada[]> {
  return banco.select(SEM_TRAVA).from(caixaPostal).where(daEmpresa(acesso, caixaPostal)).orderBy(sql`${caixaPostal.enviadaEm} desc nulls last`, desc(caixaPostal.isn));
}

export type ResumoDaCaixa = {
  total: number;
  naoLidas: number;
  novas: number;
  novasImportantes: number; // novas marcadas pela Receita como relevantes (intimações e afins)
  importantesNaoLidas: number; // não lidas e relevantes, vistas na lista ou não (o sino só as tira quando abertas)
  atualizadaEm: Date | null; // a última busca da lista que deu certo
};

export async function resumoDaCaixa(banco: Banco, acesso: AcessoEmpresa): Promise<ResumoDaCaixa> {
  const [contas] = await banco
    .select({
      total: sql<number>`count(*)::int`,
      naoLidas: sql<number>`count(*) filter (where not ${caixaPostal.lidaNaReceita} and ${caixaPostal.abertaEm} is null)::int`,
      novas: sql<number>`count(*) filter (where not ${caixaPostal.lidaNaReceita} and ${caixaPostal.abertaEm} is null and ${caixaPostal.vistaEm} is null)::int`,
      novasImportantes: sql<number>`count(*) filter (where not ${caixaPostal.lidaNaReceita} and ${caixaPostal.abertaEm} is null and ${caixaPostal.vistaEm} is null and ${caixaPostal.relevante})::int`,
      importantesNaoLidas: sql<number>`count(*) filter (where not ${caixaPostal.lidaNaReceita} and ${caixaPostal.abertaEm} is null and ${caixaPostal.relevante})::int`,
    })
    .from(caixaPostal)
    .where(daEmpresa(acesso, caixaPostal));
  const [consulta] = await banco.select().from(historicoConsultas).where(daEmpresa(acesso, historicoConsultas, eq(historicoConsultas.tipo, TIPO_DA_CONSULTA)));
  return { ...contas, atualizadaEm: consulta?.ok ? consulta.consultadaEm : null };
}

// Ver a lista tira o destaque de "nova" (nada é registrado na Receita); o sino continua contando as não lidas.
export async function marcarComoVistas(banco: Banco, acesso: AcessoEmpresa, agora: Date): Promise<void> {
  await dadosDaEmpresa(banco, acesso).alterar(caixaPostal, { vistaEm: agora }, isNull(caixaPostal.vistaEm));
}

// A lista ainda vale (só banco)? A automática espera um dia desde a última tentativa, que deu certo ou não.
export async function listaEmDia(banco: Banco, acesso: AcessoEmpresa, agora: Date): Promise<boolean> {
  const [consulta] = await banco.select().from(historicoConsultas).where(daEmpresa(acesso, historicoConsultas, eq(historicoConsultas.tipo, TIPO_DA_CONSULTA)));
  return Boolean(consulta) && agora.getTime() - consulta.consultadaEm.getTime() < INTERVALO_DIAS * DIA_MS;
}

export type Atualizacao =
  | { estado: "atualizada"; novas: number }
  | { estado: "em-dia" }
  | { estado: "espere"; minutos: number }
  | { estado: "falhou"; mensagem: string };

// Busca a lista (só os cabeçalhos) se for a vez: a automática uma vez por dia, a do botão com o intervalo mínimo. A vez é
// tomada antes de chamar (troca condicional): quem não a pegou não chama nada.
export async function atualizarCaixaPostal(deps: DependenciasCaixa, acesso: AcessoEmpresa, opcoes: { manual: boolean }): Promise<Atualizacao> {
  const { banco } = deps;
  if (!deps.cliente) return { estado: "falhou", mensagem: MENSAGENS_DA_CAIXA.indisponivel };
  const agora = relogio(deps);
  const porta = dadosDaEmpresa(banco, acesso);
  const limite = new Date(agora.getTime() - (opcoes.manual ? INTERVALO_MANUAL_MINUTOS * 60_000 : INTERVALO_DIAS * DIA_MS));
  const [vez] = await porta.inserirOuAtualizar(
    historicoConsultas,
    [{ tipo: TIPO_DA_CONSULTA, consultadaEm: agora, ok: false }],
    [historicoConsultas.empresaId, historicoConsultas.tipo],
    ["consultadaEm", "ok"],
    lte(historicoConsultas.consultadaEm, limite),
  );
  if (!vez) {
    if (!opcoes.manual) return { estado: "em-dia" };
    const [ultima] = await porta.listar(historicoConsultas, eq(historicoConsultas.tipo, TIPO_DA_CONSULTA));
    return { estado: "espere", minutos: Math.max(1, esperaManual(ultima?.consultadaEm, agora, INTERVALO_MANUAL_MINUTOS)) };
  }

  let ctx;
  try {
    ctx = await deps.contexto();
  } catch (erro) {
    if (erro instanceof ErroTermoAutorizacao) return { estado: "falhou", mensagem: erro.message };
    log(deps, `[serpro] Caixa Postal sem contexto da empresa ${acesso.empresaId}: ${(erro as Error).message}`);
    return { estado: "falhou", mensagem: MENSAGENS_DA_CAIXA.falhou };
  }
  const [jaTem] = await banco.select({ id: caixaPostal.id }).from(caixaPostal).where(daEmpresa(acesso, caixaPostal)).limit(1);
  let lista;
  try {
    lista = await listarMensagens(deps.cliente, ctx, { paginas: jaTem ? 1 : PAGINAS_NA_PRIMEIRA_BUSCA });
  } catch (erro) {
    log(deps, `[serpro] Lista da Caixa Postal da empresa ${acesso.empresaId}: ${(erro as Error).message}`);
    return { estado: "falhou", mensagem: mensagemDaFalha((erro as Error).message) };
  }
  const antes = new Set((await porta.listar(caixaPostal)).map((m) => m.isn));
  const buscadaEm = relogio(deps);
  await porta.inserirOuAtualizar(
    caixaPostal,
    lista.map((m) => ({ ...m, buscadaEm })),
    [caixaPostal.empresaId, caixaPostal.isn],
    ["assunto", "origem", "enviadaEm", "lidaNaReceita", "cienciaEm", "validaAte", "relevante", "buscadaEm"],
  );
  await porta.alterar(historicoConsultas, { ok: true }, and(eq(historicoConsultas.tipo, TIPO_DA_CONSULTA), eq(historicoConsultas.consultadaEm, agora))!);
  return { estado: "atualizada", novas: lista.filter((m) => !antes.has(m.isn) && !m.lidaNaReceita).length };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Abre o conteúdo de uma mensagem a pedido do cliente. Banco primeiro: aberta antes, devolve o guardado sem chamar nada.
// Ainda não lida na Receita, só com a confirmação (`confirmado`): abrir registra a ciência.
export async function abrirMensagemDaCaixa(
  deps: DependenciasCaixa,
  acesso: AcessoEmpresa,
  id: string,
  opcoes: { confirmado: boolean; usuarioId?: string },
): Promise<Resposta<{ mensagem: MensagemGuardada; nova: boolean }>> {
  const { banco } = deps;
  const porta = dadosDaEmpresa(banco, acesso);
  if (!UUID.test(id)) return recusa(MENSAGENS_DA_CAIXA.naoEncontrada);
  const buscar = async () => (await banco.select(SEM_TRAVA).from(caixaPostal).where(daEmpresa(acesso, caixaPostal, eq(caixaPostal.id, id))))[0];
  const guardada = await buscar();
  if (!guardada) return recusa(MENSAGENS_DA_CAIXA.naoEncontrada);
  if (guardada.conteudo !== null) return { ok: true, mensagem: guardada, nova: false };
  if (!guardada.lidaNaReceita && !opcoes.confirmado) return recusa(MENSAGENS_DA_CAIXA.confirme);
  if (!deps.cliente) return recusa(MENSAGENS_DA_CAIXA.indisponivel);

  let ctx;
  try {
    ctx = await deps.contexto();
  } catch (erro) {
    if (erro instanceof ErroTermoAutorizacao) return recusa(erro.message);
    log(deps, `[serpro] Caixa Postal sem contexto da empresa ${acesso.empresaId}: ${(erro as Error).message}`);
    return recusa(MENSAGENS_DA_CAIXA.falhou);
  }
  const agora = relogio(deps);
  const parada = new Date(agora.getTime() - ABRINDO_MINUTOS * 60_000);
  const [travada] = await porta.alterar(
    caixaPostal,
    { abrindoEm: agora },
    and(eq(caixaPostal.id, id), isNull(caixaPostal.conteudo), or(isNull(caixaPostal.abrindoEm), lt(caixaPostal.abrindoEm, parada)))!,
  );
  if (!travada) {
    const outra = await buscar();
    return outra?.conteudo != null ? { ok: true, mensagem: outra, nova: false } : recusa(MENSAGENS_DA_CAIXA.abrindo);
  }

  let conteudo: string;
  try {
    conteudo = await abrirMensagem(deps.cliente, ctx, { isn: guardada.isn, lidaNaReceita: guardada.lidaNaReceita }, opcoes.confirmado || guardada.lidaNaReceita);
  } catch (erro) {
    log(deps, `[serpro] Conteúdo da mensagem ${guardada.isn} da empresa ${acesso.empresaId}: ${(erro as Error).message}`);
    await porta.alterar(caixaPostal, { abrindoEm: null }, eq(caixaPostal.id, id));
    return recusa(erro instanceof ErroSemResposta ? MENSAGENS_DA_CAIXA.semResposta : mensagemDaFalha((erro as Error).message));
  }
  const fim = relogio(deps);
  await porta.alterar(
    caixaPostal,
    { conteudo, abertaEm: fim, abertaPor: opcoes.usuarioId ?? null, lidaNaReceita: true, abrindoEm: null, vistaEm: guardada.vistaEm ?? fim },
    eq(caixaPostal.id, id),
  );
  return { ok: true, mensagem: (await buscar())!, nova: true };
}
