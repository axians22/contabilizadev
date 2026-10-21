// A base da rotina do mês (Parte 6, passo 18): o que a plataforma sabe da empresa para apurar um mês. Só banco, sempre
// pela porta de acesso: nada aqui chama a Receita.
// - Receitas dos meses anteriores (RBT12): primeiro o que a Receita tem (item 2.2 do extrato mais recente e a receita
//   declarada de cada mês), depois a receita lançada aqui para os meses sem receita declarada guardada.
// - Folha de cada mês (Fator R): o pró-labore informado aqui vale sobre o do extrato (item 2.3), que vale sobre o
//   estimado pelo DARF do INSS pago (11% do pró-labore).
// - Receita do mês apurado: a lançada aqui; sem lançamento, zero se o cliente marcou que não houve receita; senão, a
//   declarada (mês já declarado). Sem nenhuma das três, a receita está pendente: nada é simulado nem transmitido.
// A regra do CNAE vem do CNAE principal da última consulta à Receita (MVP: uma atividade por empresa).
import { asc, eq, inArray, isNull } from "drizzle-orm";
import { apurar, type Apuracao } from "@contabilizadev/nucleo/apuracao";
import { regraDoCnae, type RegraCnae } from "@contabilizadev/nucleo/cnae";
import { somarMeses } from "@contabilizadev/nucleo/meses";
import { textoDoPdf } from "@contabilizadev/nucleo/pdf";
import { proLaboreDoDarf } from "@contabilizadev/nucleo/prolabore";
import { lerExtrato } from "@contabilizadev/nucleo/serpro/extrato";
import { declaracaoVigente, type DeclaracaoTransmitida } from "@contabilizadev/nucleo/serpro/pgdasd-consultas";
import { centavos, type ValoresPorMes } from "@contabilizadev/nucleo/simples";
import type { Banco } from "@/banco";
import { empresas, mesesSemReceita, pagamentos, pgdasdDas, pgdasdDeclaracoes, pgdasdExtratos, prolabores, receitasLancadas } from "@/banco/esquema";
import { dadosDaEmpresa, daEmpresa, SemAcessoEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { ultimaConsulta, type ConsultaCnpj } from "@/lib/empresas/receita";
import { hojeNoBrasil, mesAtualNoBrasil } from "@/lib/historico/prazos";
import { MENSAGENS_DA_ROTINA } from "./mensagens";

export type ReceitaLancada = typeof receitasLancadas.$inferSelect;
export type FonteReceita = "declarada" | "receita-federal" | "lancada";
export type FonteFolha = "informada" | "receita-federal" | "darf" | "darf-teto";

export type BaseDoMes = {
  pa: string;
  mesAtual: string;
  hoje: string; // AAAA-MM-DD, Brasília
  cnpj: string;
  regra: RegraCnae | null;
  semRegra: string | null; // por que a empresa não é apurada aqui
  inicioAtividade: string | undefined; // AAAA-MM
  lancamentos: ReceitaLancada[]; // do mês apurado
  receitaLancada: number | null; // soma dos lançamentos (null = nenhum)
  vigente: DeclaracaoTransmitida | null; // a declaração que vale para o mês, se já declarado
  receitaDeclarada: number | null;
  semReceita: boolean; // o cliente marcou que não houve receita no mês
  receitaPendente: boolean; // sem receita lançada, sem a marcação de "sem receita" e sem declaração: nada a simular
  receita: number; // a usada na apuração (zero enquanto pendente, só para mostrar o cálculo)
  prolabore: number | null; // informado para o mês apurado
  prolaboreDoMesAtual: number | null; // informado para o mês corrente (o que a sugestão do Fator R pede)
  receitas: ValoresPorMes; // meses anteriores conhecidos
  fontesReceita: Record<string, FonteReceita>;
  folhas: ValoresPorMes;
  fontesFolha: Record<string, FonteFolha>;
  apuracao: Apuracao | null;
  erro: string | null; // a apuração não fecha (ex.: 6ª faixa)
};

// Extratos guardados antes da Parte 6 não têm os itens 2.2 e 2.3 separados: lê de novo do PDF guardado (uma vez).
export async function completarExtratos(banco: Banco, acesso: AcessoEmpresa): Promise<void> {
  const faltando = await banco
    .select({ id: pgdasdExtratos.id, pdf: pgdasdExtratos.pdf })
    .from(pgdasdExtratos)
    .where(daEmpresa(acesso, pgdasdExtratos, isNull(pgdasdExtratos.receitasAnteriores)));
  for (const linha of faltando) {
    let receitasAnteriores: { mes: string; interno: number; externo: number }[] = [];
    let folhasAnteriores: { mes: string; valor: number }[] = [];
    try {
      const lido = lerExtrato(textoDoPdf(linha.pdf));
      receitasAnteriores = lido.receitasAnteriores;
      folhasAnteriores = lido.folhasAnteriores;
    } catch {
      // PDF que o leitor não entende: fica sem os meses anteriores (a base usa o resto).
    }
    await dadosDaEmpresa(banco, acesso).alterar(pgdasdExtratos, { receitasAnteriores, folhasAnteriores }, eq(pgdasdExtratos.id, linha.id));
  }
}

export async function cnpjDaEmpresa(banco: Banco, acesso: AcessoEmpresa): Promise<string> {
  dadosDaEmpresa(banco, acesso); // confere o acesso
  const [empresa] = await banco.select({ cnpj: empresas.cnpj }).from(empresas).where(eq(empresas.id, acesso.empresaId));
  if (!empresa) throw new SemAcessoEmpresa();
  return empresa.cnpj;
}

// As declarações vigentes de cada mês (só banco).
export async function declaracoesVigentes(banco: Banco, acesso: AcessoEmpresa, meses?: string[]): Promise<Map<string, DeclaracaoTransmitida>> {
  const filtro = meses ? inArray(pgdasdDeclaracoes.pa, meses) : undefined;
  const [declaracoes, das] = await Promise.all([
    banco.select().from(pgdasdDeclaracoes).where(daEmpresa(acesso, pgdasdDeclaracoes, filtro)),
    banco.select().from(pgdasdDas).where(daEmpresa(acesso, pgdasdDas, meses ? inArray(pgdasdDas.pa, meses) : undefined)),
  ]);
  const vigentes = new Map<string, DeclaracaoTransmitida>();
  for (const pa of new Set(declaracoes.map((d) => d.pa))) {
    const v = declaracaoVigente({
      pa,
      declaracoes: declaracoes.filter((d) => d.pa === pa).map((d) => ({ numero: d.numero, tipo: d.tipo, transmitidaEm: d.transmitidaEm, malha: d.malha })),
      das: das.filter((d) => d.pa === pa).map((d) => ({ numero: d.numero, emitidoEm: d.emitidoEm, pago: d.pago })),
    });
    if (v) vigentes.set(pa, v);
  }
  return vigentes;
}

export type Historico = {
  receitas: ValoresPorMes;
  fontesReceita: Record<string, FonteReceita>;
  folhas: ValoresPorMes;
  fontesFolha: Record<string, FonteFolha>;
  vigentes: Map<string, DeclaracaoTransmitida>;
  receitaDeclarada: Map<string, number>;
  lancadas: Map<string, number>;
  prolabores: Map<string, number>;
};

// Receitas e folhas mês a mês, com a fonte de cada uma (regras no topo do arquivo).
export async function historicoDeValores(banco: Banco, acesso: AcessoEmpresa): Promise<Historico> {
  await completarExtratos(banco, acesso);
  const [extratos, vigentes, lancamentos, informados, inss] = await Promise.all([
    banco
      .select({
        pa: pgdasdExtratos.pa,
        numeroDeclaracao: pgdasdExtratos.numeroDeclaracao,
        receita: pgdasdExtratos.receita,
        receitasAnteriores: pgdasdExtratos.receitasAnteriores,
        folhasAnteriores: pgdasdExtratos.folhasAnteriores,
        consultadoEm: pgdasdExtratos.consultadoEm,
      })
      .from(pgdasdExtratos)
      .where(daEmpresa(acesso, pgdasdExtratos))
      .orderBy(asc(pgdasdExtratos.pa), asc(pgdasdExtratos.consultadoEm)),
    declaracoesVigentes(banco, acesso),
    banco.select({ pa: receitasLancadas.pa, valor: receitasLancadas.valorBrl }).from(receitasLancadas).where(daEmpresa(acesso, receitasLancadas)),
    banco.select({ mes: prolabores.mes, valor: prolabores.valor }).from(prolabores).where(daEmpresa(acesso, prolabores)),
    banco.select({ pa: pagamentos.pa, valor: pagamentos.valor }).from(pagamentos).where(daEmpresa(acesso, pagamentos, eq(pagamentos.tipo, "INSS"))),
  ]);
  const receitas: ValoresPorMes = {};
  const fontesReceita: Record<string, FonteReceita> = {};
  const folhas: ValoresPorMes = {};
  const fontesFolha: Record<string, FonteFolha> = {};

  // DARF do INSS pago: estimativa do pró-labore (11%), a mais fraca das fontes. INSS no teto: o pró-labore é pelo menos o
  // teto, mas pode ser maior; fica o teto (o mínimo garantido) e a tela pede o valor real ("darf-teto").
  const inssPorMes = new Map<string, number>();
  for (const p of inss) if (p.valor !== null) inssPorMes.set(p.pa, centavos((inssPorMes.get(p.pa) ?? 0) + p.valor));
  for (const [mes, valor] of inssPorMes) {
    const estimado = proLaboreDoDarf(mes, valor);
    folhas[mes] = estimado.bruto;
    fontesFolha[mes] = estimado.noTeto ? "darf-teto" : "darf";
  }
  // Itens 2.2 e 2.3 dos extratos, do mais antigo ao mais recente (o mais recente vale).
  for (const e of extratos) {
    for (const r of e.receitasAnteriores ?? []) {
      receitas[r.mes] = centavos(r.interno + r.externo);
      fontesReceita[r.mes] = "receita-federal";
    }
    for (const f of e.folhasAnteriores ?? []) {
      folhas[f.mes] = f.valor;
      fontesFolha[f.mes] = "receita-federal";
    }
  }
  // A receita declarada de cada mês (extrato da declaração que vale).
  const receitaDeclarada = new Map<string, number>();
  for (const [pa, v] of vigentes) {
    const doMes = extratos.filter((e) => e.pa === pa && e.numeroDeclaracao === v.numero).at(-1);
    if (doMes?.receita === null || doMes?.receita === undefined) continue;
    receitaDeclarada.set(pa, doMes.receita);
    receitas[pa] = doMes.receita;
    fontesReceita[pa] = "declarada";
  }
  // Lançada aqui: só nos meses sem declaração (o que vale para a Receita é o declarado).
  const lancadas = new Map<string, number>();
  for (const l of lancamentos) lancadas.set(l.pa, centavos((lancadas.get(l.pa) ?? 0) + l.valor));
  for (const [pa, valor] of lancadas) {
    if (receitaDeclarada.has(pa)) continue;
    receitas[pa] = valor;
    fontesReceita[pa] = "lancada";
  }
  const prolaboresInformados = new Map(informados.map((p) => [p.mes, p.valor]));
  for (const [mes, valor] of prolaboresInformados) {
    folhas[mes] = valor;
    fontesFolha[mes] = "informada";
  }
  return { receitas, fontesReceita, folhas, fontesFolha, vigentes, receitaDeclarada, lancadas, prolabores: prolaboresInformados };
}

export type Empresa = { cnpj: string; regra: RegraCnae | null; semRegra: string | null; inicioAtividade: string | undefined };

// consultaLida: a consulta do CNPJ já lida por quem chama (a central de avisos lê uma vez para todas as fontes).
export async function empresaDaRotina(banco: Banco, acesso: AcessoEmpresa, consultaLida?: Promise<ConsultaCnpj | null>): Promise<Empresa> {
  const cnpj = await cnpjDaEmpresa(banco, acesso);
  const consulta = await (consultaLida ?? ultimaConsulta(banco, acesso));
  const inicioAtividade = consulta?.dados.dataInicioAtividade?.slice(0, 7) || undefined;
  if (!consulta || !consulta.diagnostico.atendido) return { cnpj, regra: null, semRegra: MENSAGENS_DA_ROTINA.semRegra, inicioAtividade };
  const regra = regraDoCnae(consulta.cnaePrincipal);
  if (regra.tributacao === "nao-atendido") return { cnpj, regra: null, semRegra: MENSAGENS_DA_ROTINA.semRegra, inicioAtividade };
  return { cnpj, regra, semRegra: null, inicioAtividade };
}

// O último mês que dá para apurar (o anterior ao atual) é o padrão da rotina.
export const ultimoMesApuravel = (agora: Date) => somarMeses(mesAtualNoBrasil(agora), -1);

// consultaLida: como em empresaDaRotina (o painel já leu a consulta do CNPJ e repassa).
export async function baseDoMes(banco: Banco, acesso: AcessoEmpresa, pa: string, agora: Date, consultaLida?: Promise<ConsultaCnpj | null>): Promise<BaseDoMes> {
  const [empresa, historico, lancamentos, marcado] = await Promise.all([
    empresaDaRotina(banco, acesso, consultaLida),
    historicoDeValores(banco, acesso),
    banco.select().from(receitasLancadas).where(daEmpresa(acesso, receitasLancadas, eq(receitasLancadas.pa, pa))).orderBy(asc(receitasLancadas.recebidaEm), asc(receitasLancadas.lancadaEm)),
    banco.select({ pa: mesesSemReceita.pa }).from(mesesSemReceita).where(daEmpresa(acesso, mesesSemReceita, eq(mesesSemReceita.pa, pa))),
  ]);
  const vigente = historico.vigentes.get(pa) ?? null;
  const receitaLancada = historico.lancadas.get(pa) ?? null;
  const receitaDeclarada = historico.receitaDeclarada.get(pa) ?? null;
  const semReceita = receitaLancada === null && marcado.length > 0;
  const receitaPendente = receitaLancada === null && !semReceita && receitaDeclarada === null;
  const receita = receitaLancada ?? (semReceita ? 0 : (receitaDeclarada ?? 0));
  const receitas = Object.fromEntries(Object.entries(historico.receitas).filter(([m]) => m < pa));
  let apuracao: Apuracao | null = null;
  let erro: string | null = null;
  if (empresa.regra) {
    try {
      apuracao = apurar({ pa, receita, receitas, folhas: historico.folhas, regra: empresa.regra, inicioAtividade: empresa.inicioAtividade });
    } catch (e) {
      erro = (e as Error).message;
    }
  }
  return {
    pa,
    mesAtual: mesAtualNoBrasil(agora),
    hoje: hojeNoBrasil(agora),
    cnpj: empresa.cnpj,
    regra: empresa.regra,
    semRegra: empresa.semRegra,
    inicioAtividade: empresa.inicioAtividade,
    lancamentos,
    receitaLancada,
    vigente,
    receitaDeclarada,
    semReceita,
    receitaPendente,
    receita,
    prolabore: historico.prolabores.get(pa) ?? null,
    prolaboreDoMesAtual: historico.prolabores.get(mesAtualNoBrasil(agora)) ?? null,
    receitas,
    fontesReceita: historico.fontesReceita,
    folhas: historico.folhas,
    fontesFolha: historico.fontesFolha,
    apuracao,
    erro,
  };
}

// O pró-labore do mês informado aqui, ou o último informado antes dele (o pró-labore costuma se repetir).
export function proLaboreVigente(prolaboresInformados: Map<string, number>, mes: string): number | null {
  if (prolaboresInformados.has(mes)) return prolaboresInformados.get(mes)!;
  const anteriores = [...prolaboresInformados.keys()].filter((m) => m < mes).sort();
  return anteriores.length ? prolaboresInformados.get(anteriores.at(-1)!)! : null;
}

