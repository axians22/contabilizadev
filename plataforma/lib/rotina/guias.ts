// Guias do mês pela plataforma (Parte 6, passo 18): o DAS da declaração vigente e o DARF do INSS da DCTFWeb transmitida;
// vencida e sem pagamento, a guia atualizada com multa e juros para a data de pagamento escolhida (DAS: dataConsolidacao;
// DARF: DataAcolhimentoProposta), só dia útil de hoje até o fim do mês (regra da Receita).
// Banco primeiro: a mesma guia (mês, tipo, declaração de referência e data) não é pedida de novo; o PDF fica no banco e
// sai só pela rota de documentos. O DAS gerado entra também na lista de DAS do histórico.
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { proximoDiaUtil, problemaNaDataDePagamento } from "@contabilizadev/nucleo/serpro/guias";
import { vencimento, vencimentoDarf } from "@contabilizadev/nucleo/meses";
import type { Contexto } from "@contabilizadev/nucleo/serpro/cliente";
import { gerarDarf } from "@contabilizadev/nucleo/serpro/dctfweb";
import { emitirComprovante, valorPago } from "@contabilizadev/nucleo/serpro/pagamentos";
import { pdfDoBase64 } from "@contabilizadev/nucleo/pdf";
import { emitirDas } from "@contabilizadev/nucleo/serpro/pgdasd";
import type { Banco } from "@/banco";
import { dctfwebEnvios, guias, pagamentos, pgdasdDas } from "@/banco/esquema";
import { dadosDaEmpresa, daEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { historicoDaEmpresa, type MesDoHistorico } from "@/lib/historico/leitura";
import type { EntradaDosBotoes } from "./botoes-guia";
import { hojeNoBrasil, mesAtualNoBrasil, mesesDoHistorico } from "@/lib/historico/prazos";
import { ErroTermoAutorizacao } from "@/lib/termo/termo";
import { declaracoesVigentes } from "./base";
import { situacaoDctf } from "./dctfweb";
import { codigoPostgres, dataHoraNoBrasil, recusa, log, relogio, type DependenciasRotina, type Resposta } from "./dependencias";
import { MENSAGENS_DA_ROTINA, mensagemDaFalha } from "./mensagens";

export type TipoGuia = "DAS" | "INSS";
export type Guia = Omit<typeof guias.$inferSelect, "pdf">;

export type GuiaDoMes = {
  pa: string;
  tipo: TipoGuia;
  referencia: string | null; // null = ainda não dá para gerar (sem declaração ou DCTFWeb transmitida)
  vencimento: string;
  paga: boolean;
  pagaEm: string | null;
  vencida: boolean; // passou do vencimento sem pagamento
  original: Guia | null; // a guia do vencimento gerada aqui
  atualizada: Guia | null; // a guia atualizada ainda válida (para hoje ou depois), se houver
  pagarEmSugerido: string; // hoje ou o próximo dia útil (até o fim do mês)
  declarado?: number | null; // DAS: o valor da declaração vigente (extrato), quando importado
  // Pago: o documento pago (número da consulta de pagamentos, ou o DAS pago da lista de DAS) e o valor efetivamente pago
  // (valorTotal do PAGTOWEB, com multa e juros de quem pagou atrasado; não o principal), quando veio.
  pagamento?: { numero: string; valor: number | null } | null;
  comprovante?: Guia | null; // o comprovante de arrecadação do documento pago, já buscado na Receita e guardado
};

// O comprovante de arrecadação de um mês pago fora da plataforma fica na mesma tabela das guias (o PDF sai pela mesma
// rota protegida), com a referência "comprovante:<número do documento pago>": não se confunde com a guia emitida.
export const REFERENCIA_DO_COMPROVANTE = "comprovante:";
export const ehComprovante = (g: Pick<Guia, "referencia">) => g.referencia.startsWith(REFERENCIA_DO_COMPROVANTE);
const semZeros = (numero: string) => numero.replace(/^0+(?=\d)/, "");

const SEM_PDF = {
  id: guias.id,
  empresaId: guias.empresaId,
  pa: guias.pa,
  tipo: guias.tipo,
  referencia: guias.referencia,
  pagarEm: guias.pagarEm,
  numero: guias.numero,
  vencimento: guias.vencimento,
  principal: guias.principal,
  multa: guias.multa,
  juros: guias.juros,
  total: guias.total,
  geradaEm: guias.geradaEm,
  usuarioId: guias.usuarioId,
};

export async function guiasDaEmpresa(banco: Banco, acesso: AcessoEmpresa): Promise<Guia[]> {
  return banco.select(SEM_PDF).from(guias).where(daEmpresa(acesso, guias)).orderBy(desc(guias.pa), desc(guias.geradaEm));
}

// A referência da guia: DAS = a declaração vigente do mês; INSS = o recibo da DCTFWeb transmitida (ou o mês).
async function referenciaDa(banco: Banco, acesso: AcessoEmpresa, pa: string, tipo: TipoGuia, agora: Date): Promise<string | null> {
  if (tipo === "DAS") return (await declaracoesVigentes(banco, acesso, [pa])).get(pa)?.numero ?? null;
  const s = await situacaoDctf(banco, acesso, pa, agora);
  return s.transmitida ? (s.recibo ?? pa) : null;
}

export async function guiaDoMes(banco: Banco, acesso: AcessoEmpresa, pa: string, tipo: TipoGuia, agora: Date): Promise<GuiaDoMes> {
  const hoje = hojeNoBrasil(agora);
  const referencia = await referenciaDa(banco, acesso, pa, tipo, agora);
  const geradas = referencia
    ? await banco.select(SEM_PDF).from(guias).where(daEmpresa(acesso, guias, and(eq(guias.pa, pa), eq(guias.tipo, tipo), eq(guias.referencia, referencia)))).orderBy(desc(guias.geradaEm))
    : [];
  let paga = false;
  let pagaEm: string | null = null;
  let declarado: number | null = null;
  let pagamento: GuiaDoMes["pagamento"] = null;
  const pagos = await banco
    .select({ numero: pagamentos.numero, pagoEm: pagamentos.pagoEm, valor: pagamentos.valor, documento: pagamentos.documento })
    .from(pagamentos)
    .where(daEmpresa(acesso, pagamentos, and(eq(pagamentos.pa, pa), eq(pagamentos.tipo, tipo))))
    .orderBy(desc(pagamentos.pagoEm));
  if (tipo === "DAS") {
    const mes = (await historicoDaEmpresa(banco, acesso, agora, null)).find((m) => m.pa === pa);
    paga = mes?.situacao === "pago" || mes?.situacao === "sem-valor";
    pagaEm = mes?.pagoEm ?? null;
    declarado = mes?.declaracao ? (mes.valorDas ?? null) : null;
    // O DAS pago da declaração vigente: o da consulta de pagamentos (mesmo número, sem o zero à esquerda) ou o da lista de DAS.
    const p = mes?.das ? (pagos.find((x) => semZeros(x.numero) === semZeros(mes.das!)) ?? null) : (pagos[0] ?? null);
    if (mes?.situacao === "pago") pagamento = p ? { numero: p.numero, valor: valorPago(p.documento) ?? p.valor } : mes.das ? { numero: semZeros(mes.das), valor: null } : null;
  } else {
    const [p] = pagos;
    paga = Boolean(p);
    pagaEm = p?.pagoEm ?? null;
    pagamento = p ? { numero: p.numero, valor: valorPago(p.documento) ?? p.valor } : null;
  }
  const [comprovante] = pagamento
    ? await banco.select(SEM_PDF).from(guias).where(daEmpresa(acesso, guias, and(eq(guias.pa, pa), eq(guias.tipo, tipo), eq(guias.referencia, `${REFERENCIA_DO_COMPROVANTE}${pagamento.numero}`))))
    : [];
  // DAS: dia 20 ou o dia útil seguinte; DARF do INSS: dia 20 ou o dia útil anterior (meses.ts).
  const vence = vencimento(pa, [], tipo);
  return {
    pa,
    tipo,
    referencia,
    vencimento: vence,
    paga,
    pagaEm,
    vencida: !paga && referencia !== null && hoje > vence,
    original: geradas.find((g) => g.pagarEm === null) ?? null,
    atualizada: geradas.filter((g) => g.pagarEm !== null && g.pagarEm >= hoje).sort((a, b) => (a.pagarEm! < b.pagarEm! ? -1 : 1))[0] ?? null,
    pagarEmSugerido: proximoDiaUtil(hoje),
    declarado,
    pagamento,
    comprovante: comprovante ?? null,
  };
}

// Guias vencidas e sem pagamento dos últimos 12 meses (aba Guias): o DAS dos meses vencidos do histórico e o DARF do INSS
// dos meses com DCTFWeb transmitida. Só banco.
export async function guiasVencidas(banco: Banco, acesso: AcessoEmpresa, agora: Date): Promise<GuiaDoMes[]> {
  const meses = mesesDoHistorico(agora);
  const historico = await historicoDaEmpresa(banco, acesso, agora, null);
  const dasVencidos = historico.filter((m) => m.situacao === "vencido" && m.declaracao).map((m) => m.pa);
  const comDctf = [
    ...new Set((await banco.select({ pa: dctfwebEnvios.pa }).from(dctfwebEnvios).where(daEmpresa(acesso, dctfwebEnvios, inArray(dctfwebEnvios.pa, meses)))).map((l) => l.pa)),
  ];
  const lista: GuiaDoMes[] = [];
  for (const pa of dasVencidos) lista.push(await guiaDoMes(banco, acesso, pa, "DAS", agora));
  for (const pa of comDctf) lista.push(await guiaDoMes(banco, acesso, pa, "INSS", agora));
  return lista.filter((g) => g.vencida).sort((a, b) => (a.pa < b.pa ? -1 : a.pa > b.pa ? 1 : a.tipo < b.tipo ? -1 : 1));
}

async function contextoDa(deps: DependenciasRotina, acesso: AcessoEmpresa): Promise<Contexto | { mensagem: string }> {
  if (!deps.cliente) return { mensagem: MENSAGENS_DA_ROTINA.indisponivel };
  try {
    return await deps.contexto();
  } catch (erro) {
    if (erro instanceof ErroTermoAutorizacao) return { mensagem: erro.message };
    log(deps, `[serpro] Guia sem contexto da empresa ${acesso.empresaId}: ${(erro as Error).message}`);
    return { mensagem: MENSAGENS_DA_ROTINA.falhou };
  }
}

// Gera a guia do mês (pagarEm nulo) ou a atualizada para pagar em `pagarEm` (só guia vencida). Banco primeiro.
export async function gerarGuia(
  deps: DependenciasRotina,
  acesso: AcessoEmpresa,
  pa: string,
  tipo: TipoGuia,
  opcoes: { pagarEm?: string | null; usuarioId?: string } = {},
): Promise<Resposta<{ guia: Guia; nova: boolean }>> {
  const { banco } = deps;
  const agora = relogio(deps);
  const hoje = hojeNoBrasil(agora);
  if (pa >= mesAtualNoBrasil(agora)) return recusa(MENSAGENS_DA_ROTINA.mesAberto);
  const situacao = await guiaDoMes(banco, acesso, pa, tipo, agora);
  if (!situacao.referencia) return recusa(tipo === "DAS" ? MENSAGENS_DA_ROTINA.semDeclaracao : MENSAGENS_DA_ROTINA.dctfSemTransmissao);
  const pagarEm = opcoes.pagarEm || null;
  if (pagarEm) {
    if (!situacao.vencida) return recusa("A guia ainda está no prazo: gere a guia do mês, sem multa e juros.");
    if (problemaNaDataDePagamento(pagarEm, hoje)) return recusa(MENSAGENS_DA_ROTINA.dataDePagamento);
  }
  const condicao = and(eq(guias.pa, pa), eq(guias.tipo, tipo), eq(guias.referencia, situacao.referencia), pagarEm ? eq(guias.pagarEm, pagarEm) : isNull(guias.pagarEm));
  const [existente] = await banco.select(SEM_PDF).from(guias).where(daEmpresa(acesso, guias, condicao));
  if (existente) return { ok: true, guia: existente, nova: false };

  const ctx = await contextoDa(deps, acesso);
  if ("mensagem" in ctx) return recusa(ctx.mensagem);
  const porta = dadosDaEmpresa(banco, acesso);
  let linha: Omit<typeof guias.$inferInsert, "empresaId">;
  if (tipo === "DAS") {
    const r = await emitirDas(deps.cliente!, ctx, { pa, declarado: true, ...(pagarEm ? { pagarEm, hoje } : {}) });
    if (!r.ok) {
      log(deps, `[serpro] DAS de ${pa}${pagarEm ? ` para ${pagarEm}` : ""}, empresa ${acesso.empresaId}: ${r.detalhe}`);
      return recusa(mensagemDaFalha(r.detalhe));
    }
    if (!r.pdf) return recusa(MENSAGENS_DA_ROTINA.recusou);
    const pdf = pdfSeValido(deps, `DAS de ${pa}${pagarEm ? ` para ${pagarEm}` : ""}, empresa ${acesso.empresaId}`, r.pdf);
    if (!pdf) return recusa(MENSAGENS_DA_ROTINA.naoEPdf);
    const venc = r.vencimento && /^\d{8}$/.test(r.vencimento) ? `${r.vencimento.slice(0, 4)}-${r.vencimento.slice(4, 6)}-${r.vencimento.slice(6)}` : null;
    linha = {
      pa, tipo, referencia: situacao.referencia, pagarEm, numero: r.numero, vencimento: venc,
      principal: r.principal, multa: r.multa, juros: r.juros, total: r.total, pdf, geradaEm: relogio(deps), usuarioId: opcoes.usuarioId ?? null,
    };
    // O DAS novo entra na lista de DAS do histórico (o pagamento dele é conferido pela importação).
    if (/^\d{17}$/.test(r.numero)) {
      await porta.inserirOuAtualizar(pgdasdDas, [{ pa, numero: r.numero, emitidoEm: dataHoraNoBrasil(agora), pago: false, vistoEm: agora }], [pgdasdDas.empresaId, pgdasdDas.numero], ["vistoEm"]);
    }
  } else {
    const r = await gerarDarf(deps.cliente!, ctx, { pa, transmitida: true, ...(pagarEm ? { pagarEm, hoje } : {}) });
    if (!r.ok) {
      log(deps, `[serpro] DARF do INSS de ${pa}${pagarEm ? ` para ${pagarEm}` : ""}, empresa ${acesso.empresaId}: ${r.detalhe}`);
      return recusa(mensagemDaFalha(r.detalhe));
    }
    const pdf = pdfSeValido(deps, `DARF do INSS de ${pa}${pagarEm ? ` para ${pagarEm}` : ""}, empresa ${acesso.empresaId}`, r.pdf);
    if (!pdf) return recusa(MENSAGENS_DA_ROTINA.naoEPdf);
    linha = {
      pa, tipo, referencia: situacao.referencia, pagarEm, numero: null, vencimento: pagarEm ?? vencimentoDarf(pa),
      principal: null, multa: null, juros: null, total: r.total, pdf, geradaEm: relogio(deps), usuarioId: opcoes.usuarioId ?? null,
    };
  }
  try {
    const [guia] = await porta.inserir(guias, linha);
    const { pdf: _pdf, ...semPdf } = guia;
    void _pdf;
    return { ok: true, guia: semPdf, nova: true };
  } catch (erro) {
    // Duas requisições juntas: a outra guardou a mesma guia primeiro.
    if (codigoPostgres(erro) !== "23505") throw erro;
    const [outra] = await banco.select(SEM_PDF).from(guias).where(daEmpresa(acesso, guias, condicao));
    return { ok: true, guia: outra, nova: false };
  }
}

// O PDF da resposta, só se for mesmo um PDF: o banco vem primeiro, e um arquivo quebrado guardado como a guia do mês
// nunca mais seria buscado (a chamada já foi cobrada e fica em serpro_chamadas; o detalhe vai para o log).
function pdfSeValido(deps: DependenciasRotina, descricao: string, base64: string): Buffer | null {
  const pdf = pdfDoBase64(base64);
  if (!pdf) log(deps, `[serpro] ${descricao}: a resposta não é um PDF (${Buffer.from(base64, "base64").length} bytes); nada foi guardado.`);
  return pdf;
}

// Botões "Ver guia"/"Abrir guia" e "Baixar" quando o PDF ainda não está no banco (mês feito fora da plataforma): busca na
// Receita uma única vez e guarda (banco primeiro; os pedidos juntos da mesma guia esperam o primeiro).
// - pago: o comprovante de arrecadação do documento pago (PAGTOWEB/COMPARRECADACAO72). O DAS pago não é emitido de
//   novo: o GERARDAS12 geraria uma guia nova (com multa e juros, se já venceu), e não a que foi paga;
// - em aberto e no prazo: a guia do mês, pelo mesmo caminho do "Gerar guia" (DAS: PGDASD/GERARDAS12, que gera o DAS da
//   declaração já transmitida, também a feita fora daqui; DARF: DCTFWEB/GERARGUIA31, da DCTFWeb transmitida);
// - vencida: a guia original não vale mais e não há serviço que a devolva; o caminho é a guia com multa e juros.
// Cada chamada fica em serpro_chamadas com o custo (o cliente do contrato registra), como todas.
export type GuiaObtida = { guia: Guia; nova: boolean; comprovante: boolean };
const buscando = new Map<string, Promise<Resposta<GuiaObtida>>>();

export async function buscarGuiaDoMes(deps: DependenciasRotina, acesso: AcessoEmpresa, pa: string, tipo: TipoGuia, opcoes: { usuarioId?: string } = {}): Promise<Resposta<GuiaObtida>> {
  const chave = `${acesso.empresaId}:${pa}:${tipo}`;
  const andando = buscando.get(chave);
  if (andando) return andando;
  const promessa = buscarUmaVez(deps, acesso, pa, tipo, opcoes).finally(() => buscando.delete(chave));
  buscando.set(chave, promessa);
  return promessa;
}

async function buscarUmaVez(deps: DependenciasRotina, acesso: AcessoEmpresa, pa: string, tipo: TipoGuia, opcoes: { usuarioId?: string }): Promise<Resposta<GuiaObtida>> {
  const agora = relogio(deps);
  const g = await guiaDoMes(deps.banco, acesso, pa, tipo, agora);
  if (g.original) return { ok: true, guia: g.original, nova: false, comprovante: false };
  if (g.paga) {
    if (g.comprovante) return { ok: true, guia: g.comprovante, nova: false, comprovante: true };
    if (!g.pagamento) return recusa(MENSAGENS_DA_ROTINA.semComprovante);
    return guardarComprovante(deps, acesso, g, g.pagamento, opcoes.usuarioId);
  }
  if (g.vencida) return recusa(MENSAGENS_DA_ROTINA.originalVencida);
  const r = await gerarGuia(deps, acesso, pa, tipo, { usuarioId: opcoes.usuarioId });
  return r.ok ? { ok: true, guia: r.guia, nova: r.nova, comprovante: false } : r;
}

async function guardarComprovante(
  deps: DependenciasRotina,
  acesso: AcessoEmpresa,
  g: GuiaDoMes,
  pagamento: { numero: string; valor: number | null },
  usuarioId?: string,
): Promise<Resposta<GuiaObtida>> {
  const ctx = await contextoDa(deps, acesso);
  if ("mensagem" in ctx) return recusa(ctx.mensagem);
  const r = await emitirComprovante(deps.cliente!, ctx, pagamento.numero);
  if (!r.ok) {
    log(deps, `[serpro] Comprovante de arrecadação de ${g.tipo} ${g.pa} (documento ${pagamento.numero}), empresa ${acesso.empresaId}: ${r.detalhe}`);
    return recusa(mensagemDaFalha(r.detalhe));
  }
  const pdf = pdfSeValido(deps, `Comprovante de arrecadação de ${g.tipo} ${g.pa} (documento ${pagamento.numero}), empresa ${acesso.empresaId}`, r.pdf);
  if (!pdf) return recusa(MENSAGENS_DA_ROTINA.naoEPdf);
  const referencia = `${REFERENCIA_DO_COMPROVANTE}${pagamento.numero}`;
  const linha = {
    pa: g.pa, tipo: g.tipo, referencia, pagarEm: null, numero: pagamento.numero, vencimento: g.pagaEm,
    principal: null, multa: null, juros: null, total: pagamento.valor, pdf, geradaEm: relogio(deps), usuarioId: usuarioId ?? null,
  };
  try {
    const [guia] = await dadosDaEmpresa(deps.banco, acesso).inserir(guias, linha);
    const { pdf: _pdf, ...semPdf } = guia;
    void _pdf;
    return { ok: true, guia: semPdf, nova: true, comprovante: true };
  } catch (erro) {
    if (codigoPostgres(erro) !== "23505") throw erro;
    const [outra] = await deps.banco.select(SEM_PDF).from(guias).where(daEmpresa(acesso, guias, and(eq(guias.pa, g.pa), eq(guias.tipo, g.tipo), eq(guias.referencia, referencia))));
    return { ok: true, guia: outra, nova: false, comprovante: true };
  }
}

// As entradas dos botões do DAS de cada mês do Histórico (os mesmos botões do painel), com uma leitura só de guias e
// pagamentos para os 12 meses. Sem guia no mês (não declarado, sem valor a pagar, não importado): nada.
export async function entradasDoHistorico(banco: Banco, acesso: AcessoEmpresa, meses: MesDoHistorico[], autorizada: boolean): Promise<Map<string, EntradaDosBotoes>> {
  const salvas = await banco
    .select({ id: guias.id, pa: guias.pa, referencia: guias.referencia })
    .from(guias)
    .where(daEmpresa(acesso, guias, and(eq(guias.tipo, "DAS"), isNull(guias.pagarEm))))
    .orderBy(desc(guias.geradaEm));
  const pagos = await banco.select({ numero: pagamentos.numero, pa: pagamentos.pa }).from(pagamentos).where(daEmpresa(acesso, pagamentos, eq(pagamentos.tipo, "DAS")));
  const mapa = new Map<string, EntradaDosBotoes>();
  for (const m of meses) {
    const situacao = m.situacao === "pago" ? "pago" : m.situacao === "vencido" ? "vencido" : m.situacao === "em-aberto" || m.situacao === "sem-guia" ? "aberto" : null;
    if (!situacao) continue;
    const referencia = m.declaracao?.numero ?? null;
    const original = referencia ? salvas.find((g) => g.pa === m.pa && g.referencia === referencia) : undefined;
    let pagamento: string | null = null;
    if (situacao === "pago") {
      const p = m.das ? pagos.find((x) => x.pa === m.pa && semZeros(x.numero) === semZeros(m.das!)) : pagos.find((x) => x.pa === m.pa);
      pagamento = p?.numero ?? (m.das ? semZeros(m.das) : null);
    }
    const comprovante = pagamento ? salvas.find((g) => g.pa === m.pa && g.referencia === `${REFERENCIA_DO_COMPROVANTE}${pagamento}`) : undefined;
    mapa.set(m.pa, {
      pa: m.pa,
      tipo: "DAS",
      situacao,
      guardada: (original ?? (situacao === "pago" ? comprovante : undefined))?.id ?? null,
      referencia,
      pagamento,
      autorizada,
    });
  }
  return mapa;
}

export async function pdfDaGuia(banco: Banco, acesso: AcessoEmpresa, id: string) {
  const [l] = await banco.select({ pa: guias.pa, tipo: guias.tipo, referencia: guias.referencia, pagarEm: guias.pagarEm, pdf: guias.pdf }).from(guias).where(daEmpresa(acesso, guias, eq(guias.id, id)));
  if (!l) return null;
  const nome = `${ehComprovante(l) ? "comprovante-" : ""}${l.tipo === "DAS" ? "das" : "darf-inss"}-${l.pa}${l.pagarEm ? `-pagar-${l.pagarEm}` : ""}.pdf`;
  return { nome, pdf: l.pdf };
}
