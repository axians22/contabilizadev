// O que as telas mostram do histórico importado (Histórico, Situação fiscal, Declaração anual, painel e sino). Só
// banco, sempre pela porta de acesso: nada aqui chama a Receita. A parte que monta os meses é pura (montarHistorico).
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { conferirAtividades, type Divergencia } from "@contabilizadev/nucleo/conferencia-anexo";
import type { Diagnostico } from "@contabilizadev/nucleo/diagnostico";
import { vencimentoDas } from "@contabilizadev/nucleo/meses";
import { dasDaDeclaracaoVigenteTodos, declaracaoVigente, type PeriodoDeclarado } from "@contabilizadev/nucleo/serpro/pgdasd-consultas";
import type { Banco } from "@/banco";
import { defis, historicoConsultas, importacoes, pagamentos, pgdasdDas, pgdasdDeclaracoes, pgdasdExtratos, situacoesFiscais } from "@/banco/esquema";
import { daEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { hojeNoBrasil, IMPORTACAO_PARADA_MINUTOS, mesesDoHistorico } from "./prazos";

type Declaracao = typeof pgdasdDeclaracoes.$inferSelect;
type Das = typeof pgdasdDas.$inferSelect;
type Extrato = Omit<typeof pgdasdExtratos.$inferSelect, "pdf" | "origem" | "receitasAnteriores" | "folhasAnteriores"> & { origem?: "extrato" | "declaracao" }; // origem: padrão do banco, "extrato"
type Pagamento = typeof pagamentos.$inferSelect;
export type Importacao = typeof importacoes.$inferSelect;

export type SituacaoDoMes = "pago" | "em-aberto" | "vencido" | "sem-valor" | "sem-guia" | "nao-declarado" | "no-prazo" | "nao-importado";

export type MesDoHistorico = {
  pa: string; // AAAA-MM
  situacao: SituacaoDoMes;
  declaracao: { numero: string; tipo: "original" | "retificadora"; transmitidaEm: string | null; malha: string | null } | null;
  receita: number | null;
  valorDas: number | null; // valor do DAS da declaração vigente; sem DAS, o débito declarado
  das: string | null; // DAS da declaração vigente: o que foi pago ou, sem pagamento, o último gerado
  vencimento: string; // AAAA-MM-DD do DAS (dia 20 do mês seguinte, ou o dia útil seguinte)
  pagoEm: string | null;
  extrato: { id: string; origem: "extrato" | "declaracao"; daDeclaracaoVigente: boolean; atividades: (number | null)[]; fatorR: number | null } | null;
  divergencia: Divergencia | null;
};

export type DadosDoHistorico = {
  declaracoes: Declaracao[];
  das: Das[];
  extratos: Extrato[];
  pagamentos: Pagamento[];
  anosConsultados: Set<number>; // anos cuja lista de declarações já veio da Receita
};

const maior = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : (a ?? b));
const centavos = (v: number) => Math.round(v * 100);

// Monta os 12 meses do histórico com o que está no banco. O que decide se o mês está pago são os DAS gerados depois da
// declaração que vale (dasDaDeclaracaoVigenteTodos): pago se algum deles está na consulta de pagamentos, marcado como pago
// na lista de DAS ou com a arrecadação no extrato (o DAS gerado de novo cobra o mesmo débito; pagar um basta). Valor e
// data do pagamento exibidos são os do DAS pago. DAS anteriores (de uma declaração que foi retificada) ficam só como histórico: uma
// retificadora que aumentou o imposto gera um DAS novo com a diferença, e é ele que precisa estar pago.
// Sem DAS depois da declaração vigente, vale o débito declarado (PDF da declaração): zero = sem valor a pagar; com valor,
// pago só se os pagamentos de DAS do mês cobrem o débito (retificadora sem guia nova); senão, sem guia (ou vencido).
// A conferência do CNAE usa só o documento da declaração que vale (uma retificadora pode já ter corrigido a atividade).
export function montarHistorico(dados: DadosDoHistorico, agora: Date, diagnostico: Pick<Diagnostico, "atividades" | "anexo"> | null): MesDoHistorico[] {
  const hoje = hojeNoBrasil(agora);
  return mesesDoHistorico(agora).map((pa) => {
    const periodo: PeriodoDeclarado = {
      pa,
      declaracoes: dados.declaracoes.filter((d) => d.pa === pa).map((d) => ({ numero: d.numero, tipo: d.tipo, transmitidaEm: d.transmitidaEm, malha: d.malha })),
      das: dados.das.filter((d) => d.pa === pa).map((d) => ({ numero: d.numero, emitidoEm: d.emitidoEm, pago: d.pago })),
    };
    const vigente = declaracaoVigente(periodo);
    const dasDepois = dasDaDeclaracaoVigenteTodos(periodo);
    const doMes = dados.extratos.filter((e) => e.pa === pa).sort((a, b) => b.consultadoEm.getTime() - a.consultadoEm.getTime());
    const daDeclaracao = (vigente && doMes.find((e) => e.numeroDeclaracao === vigente.numero)) || null;
    const extrato = daDeclaracao ?? doMes[0] ?? null;
    const pagosDoMes = dados.pagamentos.filter((p) => p.pa === pa && p.tipo === "DAS");
    // Qualquer DAS gerado depois da declaração vigente quita o mês (a guia gerada de novo cobra o mesmo débito); sem
    // nenhum pago, o que conta é o último gerado.
    const pagoPor = (numero: string, marcado: boolean) => pagosDoMes.some((p) => p.numero === numero) || marcado || doMes.some((e) => e.numeroDas === numero && e.pagoEm);
    const dasVigente = dasDepois.find((d) => pagoPor(d.numero, d.pago)) ?? dasDepois.at(-1) ?? null;
    const venceEm = vencimentoDas(pa); // DAS: dia útil seguinte quando o dia 20 não tem expediente

    let situacao: SituacaoDoMes;
    let valorDas: number | null = null;
    let pagoEm: string | null = null;
    if (!vigente) {
      situacao = !dados.anosConsultados.has(Number(pa.slice(0, 4))) ? "nao-importado" : hoje > venceEm ? "nao-declarado" : "no-prazo";
    } else if (dasVigente) {
      const pagamento = pagosDoMes.find((p) => p.numero === dasVigente.numero);
      const doDas = doMes.find((e) => e.numeroDas === dasVigente.numero);
      valorDas = doDas?.valorDas ?? pagamento?.valor ?? daDeclaracao?.valorDas ?? null; // o do DAS pago, se houver extrato ou pagamento dele
      pagoEm = pagamento?.pagoEm ?? doDas?.pagoEm ?? null;
      const pago = pagoPor(dasVigente.numero, dasVigente.pago);
      situacao = pago ? "pago" : valorDas === 0 ? "sem-valor" : hoje > venceEm ? "vencido" : "em-aberto";
    } else {
      // Sem DAS depois da declaração vigente: o débito declarado (lido do PDF da declaração; receita zero = nada a pagar).
      valorDas = daDeclaracao ? (daDeclaracao.valorDas ?? (daDeclaracao.receita === 0 ? 0 : null)) : null;
      const pagoAntes = pagosDoMes.length > 0 || periodo.das.some((d) => d.pago) || doMes.some((e) => e.pagoEm);
      const valoresPagos = pagosDoMes.length ? pagosDoMes.map((p) => p.valor) : doMes.filter((e) => e.pagoEm).map((e) => e.valorPago);
      const totalPago = valoresPagos.every((v) => v !== null) ? valoresPagos.reduce<number>((s, v) => s + v!, 0) : null;
      pagoEm = pagosDoMes.reduce<string | null>((m, p) => maior(m, p.pagoEm), null) ?? doMes.reduce<string | null>((m, e) => maior(m, e.pagoEm), null);
      if (valorDas === 0) situacao = "sem-valor";
      else if (valorDas === null) situacao = pagoAntes ? "pago" : "sem-guia"; // débito ainda não lido: a guia anterior paga vale
      else if (pagoAntes && totalPago !== null && centavos(totalPago) >= centavos(valorDas)) situacao = "pago";
      else situacao = hoje > venceEm ? "vencido" : "sem-guia";
    }

    const atividades = extrato?.atividades.map((a) => a.idAtividade) ?? [];
    return {
      pa,
      situacao,
      declaracao: vigente,
      receita: extrato?.receita ?? null,
      valorDas,
      das: dasVigente?.numero ?? null,
      vencimento: venceEm,
      pagoEm: situacao === "pago" ? pagoEm : null,
      extrato: extrato ? { id: extrato.id, origem: extrato.origem ?? "extrato", daDeclaracaoVigente: Boolean(daDeclaracao), atividades, fatorR: extrato.fatorR } : null,
      divergencia: daDeclaracao && diagnostico ? conferirAtividades(pa, atividades, diagnostico) : null,
    };
  });
}

export async function dadosDoHistorico(banco: Banco, acesso: AcessoEmpresa, agora: Date): Promise<DadosDoHistorico> {
  const meses = mesesDoHistorico(agora);
  const [declaracoes, das, extratos, pagos, consultas] = await Promise.all([
    banco.select().from(pgdasdDeclaracoes).where(daEmpresa(acesso, pgdasdDeclaracoes, inArray(pgdasdDeclaracoes.pa, meses))),
    banco.select().from(pgdasdDas).where(daEmpresa(acesso, pgdasdDas, inArray(pgdasdDas.pa, meses))),
    banco
      .select({
        id: pgdasdExtratos.id,
        empresaId: pgdasdExtratos.empresaId,
        pa: pgdasdExtratos.pa,
        numeroDeclaracao: pgdasdExtratos.numeroDeclaracao,
        origem: pgdasdExtratos.origem,
        numeroDas: pgdasdExtratos.numeroDas,
        receita: pgdasdExtratos.receita,
        valorDas: pgdasdExtratos.valorDas,
        vencimento: pgdasdExtratos.vencimento,
        pagoEm: pgdasdExtratos.pagoEm,
        valorPago: pgdasdExtratos.valorPago,
        fatorR: pgdasdExtratos.fatorR,
        atividades: pgdasdExtratos.atividades,
        consultadoEm: pgdasdExtratos.consultadoEm,
      })
      .from(pgdasdExtratos)
      .where(daEmpresa(acesso, pgdasdExtratos, inArray(pgdasdExtratos.pa, meses))),
    banco.select().from(pagamentos).where(daEmpresa(acesso, pagamentos, inArray(pagamentos.pa, meses))),
    banco.select().from(historicoConsultas).where(daEmpresa(acesso, historicoConsultas)),
  ]);
  const anosConsultados = new Set(consultas.filter((c) => c.ok && c.tipo.startsWith("declaracoes:")).map((c) => Number(c.tipo.split(":")[1])));
  return { declaracoes, das, extratos, pagamentos: pagos, anosConsultados };
}

export async function historicoDaEmpresa(banco: Banco, acesso: AcessoEmpresa, agora: Date, diagnostico: Pick<Diagnostico, "atividades" | "anexo"> | null) {
  return montarHistorico(await dadosDoHistorico(banco, acesso, agora), agora, diagnostico);
}

// Quando cada consulta foi feita por último (só as que deram certo, para a tela dizer "consultado em").
export async function ultimasConsultas(banco: Banco, acesso: AcessoEmpresa): Promise<Map<string, { em: Date; ok: boolean }>> {
  const linhas = await banco.select().from(historicoConsultas).where(daEmpresa(acesso, historicoConsultas));
  return new Map(linhas.map((l) => [l.tipo, { em: l.consultadaEm, ok: l.ok }]));
}

// A importação que a tela acompanha: a que está rodando ou a última (para mostrar o resultado). Rodando sem sinal de
// vida há muito tempo conta como parada (servidor reiniciado no meio).
export async function importacaoDaEmpresa(banco: Banco, acesso: AcessoEmpresa, agora: Date): Promise<(Importacao & { rodando: boolean }) | null> {
  const [linha] = await banco.select().from(importacoes).where(daEmpresa(acesso, importacoes)).orderBy(desc(importacoes.iniciadaEm)).limit(1);
  if (!linha) return null;
  const parada = agora.getTime() - linha.atualizadaEm.getTime() > IMPORTACAO_PARADA_MINUTOS * 60_000;
  return { ...linha, rodando: !linha.terminadaEm && !parada };
}

export async function jaImportou(banco: Banco, acesso: AcessoEmpresa): Promise<boolean> {
  const [linha] = await banco.select({ id: importacoes.id }).from(importacoes).where(daEmpresa(acesso, importacoes)).limit(1);
  return Boolean(linha);
}

export type SituacaoFiscal = {
  atual: { id: string; regular: boolean | null; pendencias: string | null; prontoEm: Date; temPdf: boolean } | null;
  processando: boolean; // há um pedido em andamento
};

export async function situacaoFiscalDaEmpresa(banco: Banco, acesso: AcessoEmpresa): Promise<SituacaoFiscal> {
  const [pronto] = await banco
    .select({ id: situacoesFiscais.id, regular: situacoesFiscais.regular, pendencias: situacoesFiscais.pendencias, prontoEm: situacoesFiscais.prontoEm, pdf: situacoesFiscais.pdf })
    .from(situacoesFiscais)
    .where(daEmpresa(acesso, situacoesFiscais, eq(situacoesFiscais.situacao, "pronto")))
    .orderBy(desc(situacoesFiscais.prontoEm))
    .limit(1);
  const [rodando] = await banco
    .select({ id: situacoesFiscais.id })
    .from(situacoesFiscais)
    .where(daEmpresa(acesso, situacoesFiscais, and(eq(situacoesFiscais.situacao, "processando"), isNull(situacoesFiscais.prontoEm))))
    .limit(1);
  return {
    atual: pronto ? { id: pronto.id, regular: pronto.regular, pendencias: pronto.pendencias, prontoEm: pronto.prontoEm!, temPdf: Boolean(pronto.pdf) } : null,
    processando: Boolean(rodando),
  };
}

export type DefisGuardada = { id: string; ano: number; situacao: "entregue" | "nao-encontrada"; idDefis: string | null; declaracao: boolean; recibo: boolean; consultadaEm: Date };

// DEFIS consultadas, do ano mais recente ao mais antigo. Os PDFs não saem do banco aqui (só se existem); eles saem
// pela rota de documentos.
export async function defisDaEmpresa(banco: Banco, acesso: AcessoEmpresa): Promise<DefisGuardada[]> {
  return banco
    .select({
      id: defis.id,
      ano: defis.ano,
      situacao: defis.situacao,
      idDefis: defis.idDefis,
      declaracao: sql<boolean>`${defis.declaracaoPdf} is not null`,
      recibo: sql<boolean>`${defis.reciboPdf} is not null`,
      consultadaEm: defis.consultadaEm,
    })
    .from(defis)
    .where(daEmpresa(acesso, defis))
    .orderBy(desc(defis.ano));
}

// A DEFIS de um ano, só o que o sino e o painel usam (situação e quando foi consultada): roda em toda página.
export async function defisDoAno(banco: Banco, acesso: AcessoEmpresa, ano: number): Promise<Pick<DefisGuardada, "situacao" | "consultadaEm"> | null> {
  const [linha] = await banco
    .select({ situacao: defis.situacao, consultadaEm: defis.consultadaEm })
    .from(defis)
    .where(daEmpresa(acesso, defis, eq(defis.ano, ano)))
    .limit(1);
  return linha ?? null;
}

// Avisos do histórico para o sino: atividade declarada que não bate com o CNAE e situação fiscal irregular.
export type AvisoDoHistorico = { chave: string; nivel: "vence" | "vencida"; titulo: string; texto: string; link: { href: string; texto: string } };

export function avisosDoHistorico(meses: MesDoHistorico[], situacao: SituacaoFiscal | null): AvisoDoHistorico[] {
  const avisos: AvisoDoHistorico[] = [];
  if (situacao?.atual?.regular === false) {
    avisos.push({
      chave: "situacao-fiscal",
      nivel: "vencida",
      titulo: "Situação fiscal irregular",
      texto: "A Receita Federal aponta pendências da empresa. Veja quais são e o que fazer.",
      link: { href: "/situacao", texto: "Ver a situação fiscal" },
    });
  }
  for (const m of meses) {
    if (!m.divergencia) continue;
    avisos.push({ chave: `cnae:${m.pa}`, nivel: "vence", titulo: m.divergencia.titulo, texto: `${m.divergencia.texto} Retifique a declaração no portal.`, link: { href: "/historico", texto: "Ver no Histórico" } });
  }
  return avisos;
}
