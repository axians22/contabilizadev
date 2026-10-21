// Lançamento da receita do mês e do pró-labore (Parte 6, passo 18), como no ../fiscal (app/lancamentos): a receita do
// mês é o valor em reais que caiu na conta pelo trabalho do mês, lançado depois que o mês termina. Recebida em moeda
// estrangeira, o cliente informa o valor na moeda e, se souber, o valor em reais creditado; sem ele, a conversão é pela
// PTAX de compra do Banco Central do dia do recebimento (ou do último dia útil antes), guardada com a data do boletim.
// Banco primeiro na cotação: o boletim de um dia passado não muda (cotacoes_ptax).
import { and, eq } from "drizzle-orm";
import { dataValida, somarMeses } from "@contabilizadev/nucleo/meses";
import { buscarPtax, emReais, ErroPtax, moedaValida, type Cotacao, type Moeda } from "@contabilizadev/nucleo/ptax";
import { centavos } from "@contabilizadev/nucleo/simples";
import type { Banco } from "@/banco";
import { cotacoesPtax, mesesSemReceita, prolabores, receitasLancadas } from "@/banco/esquema";
import { dadosDaEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { hojeNoBrasil, mesAtualNoBrasil } from "@/lib/historico/prazos";
import { recusa, log, relogio, type DependenciasRotina, type Resposta } from "./dependencias";
import { MENSAGENS_DA_ROTINA } from "./mensagens";

export const VALOR_MAXIMO = 4_800_000; // acima do limite anual do Simples não é receita de um mês
// Confere o valor já arredondado para centavos: 0,004 vira R$ 0,00 no banco e não pode passar como receita lançada.
const valorValido = (v: number) => Number.isFinite(v) && centavos(v) > 0 && v <= VALOR_MAXIMO;
// Maior valor que cabe na coluna numeric(14,2). O valor na moeda estrangeira só tem esse teto: VALOR_MAXIMO é em reais e
// vale para o valor em reais (convertido ou informado); ¥ 5 milhões são ~R$ 177 mil e têm de passar.
export const VALOR_MOEDA_MAXIMO = 999_999_999_999.99;
const valorMoedaValido = (v: number) => Number.isFinite(v) && centavos(v) > 0 && v <= VALOR_MOEDA_MAXIMO;
// Cotação implícita (reais ÷ moeda) na precisão da coluna (6 casas); zero não é cotação.
const cotacaoImplicita = (brl: number, moeda: number) => Math.round((brl / moeda) * 1_000_000) / 1_000_000;
// Maior cotação que cabe na coluna numeric(12,6): acima disso é erro de digitação e estouraria o INSERT.
export const COTACAO_MAXIMA = 999_999.999999;
const cotacaoValida = (c: number) => Number.isFinite(c) && c > 0 && c <= COTACAO_MAXIMA;

// Cotação PTAX de compra para a data: do banco ou do Banco Central (e guardada se não muda mais).
export async function cotacaoPtax(deps: Pick<DependenciasRotina, "banco" | "buscarPtax" | "agora">, moeda: Moeda, data: string): Promise<Cotacao> {
  const [guardada] = await deps.banco.select().from(cotacoesPtax).where(and(eq(cotacoesPtax.moeda, moeda), eq(cotacoesPtax.data, data)));
  if (guardada) return { moeda, data: guardada.boletim, compra: guardada.compra, venda: guardada.venda };
  const cotacao = await buscarPtax(moeda, data, deps.buscarPtax ?? fetch);
  // Data passada, ou o boletim do próprio dia: não muda mais. Hoje sem boletim ainda (antes da publicação): não guarda.
  if (data < hojeNoBrasil(relogio(deps)) || cotacao.data === data) {
    await deps.banco
      .insert(cotacoesPtax)
      .values({ moeda, data, boletim: cotacao.data, compra: cotacao.compra, venda: cotacao.venda, consultadaEm: relogio(deps) })
      .onConflictDoNothing();
  }
  return cotacao;
}

export type Lancamento = {
  pa: string;
  recebidaEm: string;
  moeda: string; // "BRL" ou o código da moeda
  valorMoeda: number;
  valorBrl?: number | null; // valor em reais que caiu na conta (opcional com moeda estrangeira)
  observacao?: string | null;
  usuarioId?: string;
};

// Meses em que dá para lançar: do mês trabalhado já encerrado para trás (o mês corrente ainda não terminou).
export const mesLancavel = (pa: string, agora: Date) => /^\d{4}-(0[1-9]|1[0-2])$/.test(pa) && pa <= somarMeses(mesAtualNoBrasil(agora), -1);

export async function lancarReceita(deps: DependenciasRotina, acesso: AcessoEmpresa, l: Lancamento): Promise<Resposta<{ id: string; valorBrl: number }>> {
  const agora = relogio(deps);
  const hoje = hojeNoBrasil(agora);
  if (!mesLancavel(l.pa, agora)) return recusa(MENSAGENS_DA_ROTINA.mesAberto);
  // O dinheiro pode cair depois do mês trabalhado (o normal) ou dentro dele, mas não no futuro.
  if (!dataValida(l.recebidaEm) || l.recebidaEm > hoje || l.recebidaEm < `${l.pa}-01`) return recusa(MENSAGENS_DA_ROTINA.receitaInvalida);
  // Em reais, o valor lançado já é a receita (teto VALOR_MAXIMO); em outra moeda, o teto em reais é conferido depois.
  if (!(l.moeda === "BRL" ? valorValido(l.valorMoeda) : valorMoedaValido(l.valorMoeda))) return recusa(MENSAGENS_DA_ROTINA.receitaInvalida);
  const observacao = l.observacao?.trim().slice(0, 200) || null;
  const base = { pa: l.pa, recebidaEm: l.recebidaEm, valorMoeda: centavos(l.valorMoeda), observacao, lancadaEm: agora, lancadaPorId: l.usuarioId ?? null };
  let linha: Omit<typeof receitasLancadas.$inferInsert, "empresaId">;
  if (l.moeda === "BRL") {
    linha = { ...base, moeda: "BRL", valorBrl: centavos(l.valorMoeda), origemValor: "reais", cotacao: null, cotacaoData: null };
  } else if (moedaValida(l.moeda)) {
    // Só null/undefined é "não informado". Qualquer número que chegue, inclusive NaN de um valor digitado errado, é o
    // valor que o cliente informou: passa por valorValido e, se inválido, é recusado (nunca cai na PTAX em silêncio).
    if (l.valorBrl !== null && l.valorBrl !== undefined) {
      if (!valorValido(l.valorBrl)) return recusa(MENSAGENS_DA_ROTINA.receitaInvalida);
      const cotacao = cotacaoImplicita(centavos(l.valorBrl), centavos(l.valorMoeda));
      if (!cotacaoValida(cotacao)) return recusa(MENSAGENS_DA_ROTINA.receitaInvalida);
      linha = { ...base, moeda: l.moeda, valorBrl: centavos(l.valorBrl), origemValor: "informado", cotacao, cotacaoData: null };
    } else {
      let cotacao: Cotacao;
      try {
        cotacao = await cotacaoPtax(deps, l.moeda, l.recebidaEm);
      } catch (erro) {
        if (!(erro instanceof ErroPtax)) log(deps, `[ptax] Falha ao buscar a cotação: ${(erro as Error).message}`);
        return recusa(erro instanceof ErroPtax ? erro.message : MENSAGENS_DA_ROTINA.ptax);
      }
      // Convertido pela PTAX, o valor em reais passa pelo mesmo teste do informado: não arredonda para zero
      // (ex.: 0,01 de uma moeda fraca) nem passa de VALOR_MAXIMO (o teto em reais vale para as duas formas de lançar).
      const valorBrl = emReais(centavos(l.valorMoeda), cotacao);
      if (!valorValido(valorBrl) || !cotacaoValida(cotacao.compra)) return recusa(MENSAGENS_DA_ROTINA.receitaInvalida);
      linha = { ...base, moeda: l.moeda, valorBrl, origemValor: "ptax", cotacao: cotacao.compra, cotacaoData: cotacao.data };
    }
  } else {
    return recusa(MENSAGENS_DA_ROTINA.receitaInvalida);
  }
  const porta = dadosDaEmpresa(deps.banco, acesso);
  const [salva] = await porta.inserir(receitasLancadas, linha);
  // Houve receita: a marcação de "sem receita no mês", se havia, deixa de valer.
  await porta.apagar(mesesSemReceita, eq(mesesSemReceita.pa, l.pa));
  return { ok: true, id: salva.id, valorBrl: salva.valorBrl };
}

export async function removerReceita(banco: Banco, acesso: AcessoEmpresa, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  return (await dadosDaEmpresa(banco, acesso).apagar(receitasLancadas, eq(receitasLancadas.id, id))).length > 0;
}

// Pró-labore do mês (zero = não houve). Vale para o Fator R e o INSS esperado da DCTFWeb.
export async function informarProLabore(
  deps: Pick<DependenciasRotina, "banco" | "agora">,
  acesso: AcessoEmpresa,
  p: { mes: string; valor: number; usuarioId?: string },
): Promise<Resposta> {
  const agora = relogio(deps);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p.mes) || p.mes > mesAtualNoBrasil(agora)) return recusa(MENSAGENS_DA_ROTINA.prolaboreInvalido);
  // Zero é "não houve pró-labore"; um valor positivo que arredonda para R$ 0,00 (ex.: 0,004) é engano de digitação, não zero.
  if (!Number.isFinite(p.valor) || p.valor < 0 || p.valor > VALOR_MAXIMO || (p.valor > 0 && centavos(p.valor) === 0)) return recusa(MENSAGENS_DA_ROTINA.prolaboreInvalido);
  await dadosDaEmpresa(deps.banco, acesso).inserirOuAtualizar(
    prolabores,
    [{ mes: p.mes, valor: centavos(p.valor), informadoEm: agora, informadoPorId: p.usuarioId ?? null }],
    [prolabores.empresaId, prolabores.mes],
    ["valor", "informadoEm", "informadoPorId"],
  );
  return { ok: true };
}

// "Não houve receita neste mês": só para mês encerrado e sem receita lançada (com lançamento, a receita é a lançada).
// `marcar = false` desfaz. É o que libera simular e declarar o mês com receita zero.
export async function marcarSemReceita(
  deps: Pick<DependenciasRotina, "banco" | "agora">,
  acesso: AcessoEmpresa,
  p: { pa: string; marcar: boolean; usuarioId?: string },
): Promise<Resposta> {
  const agora = relogio(deps);
  if (!mesLancavel(p.pa, agora)) return recusa(MENSAGENS_DA_ROTINA.mesAberto);
  const porta = dadosDaEmpresa(deps.banco, acesso);
  if (!p.marcar) {
    await porta.apagar(mesesSemReceita, eq(mesesSemReceita.pa, p.pa));
    return { ok: true };
  }
  if ((await porta.listar(receitasLancadas, eq(receitasLancadas.pa, p.pa))).length) return recusa(MENSAGENS_DA_ROTINA.semReceitaComLancamento);
  await porta.inserirOuAtualizar(
    mesesSemReceita,
    [{ pa: p.pa, marcadoEm: agora, marcadoPorId: p.usuarioId ?? null }],
    [mesesSemReceita.empresaId, mesesSemReceita.pa],
    ["marcadoEm", "marcadoPorId"],
  );
  return { ok: true };
}
