// Custo por cliente, custo mensal e custo total das chamadas ao Serpro (tela interna /admin/custos, só ADMIN). Lê só
// serpro_chamadas e empresas: nunca chama Serpro, BrasilAPI nem eSocial.
//
// Regra do preço (contrato, Anexo I): todas as chamadas de um tipo no período de cobrança (21 a 20, horário de Brasília)
// pagam o preço da faixa em que caiu o TOTAL daquele tipo no período, somando todos os clientes. Por isso o custo de um
// cliente é, por tipo, a quantidade dele × precoUnitario(tipo, total do tipo no período), e a soma dos clientes é o
// custoMensal do período. Em "Desde o início", o cálculo é feito período a período (cada um com a sua faixa) e somado.
// A coluna `custo` da tabela (o preço da faixa na hora da chamada, que ainda não sabia o total do mês) não entra aqui.
//
// Arredondamento: os preços da tabela são centavos inteiros (R$ 0,24 = 24 centavos), então todo custo é calculado em
// centavos inteiros (quantidade × preço em centavos), sem arredondar nada. A soma das linhas é exatamente o total; só a
// tela converte para reais.
import { and, asc, gte, inArray, lt, ne, sql, type SQL } from "drizzle-orm";
import { TIPO_DA_ACAO, type Acao } from "@contabilizadev/nucleo/serpro/cliente";
import { ehChaveDePeriodo, limitesDoPeriodo, periodoDe, precoUnitario, type TipoRequisicao } from "@contabilizadev/nucleo/serpro/precos";
import type { Banco } from "@/banco";
import { empresas, serproChamadas } from "@/banco/esquema";

export const TIPOS: TipoRequisicao[] = ["consulta", "emissao", "declaracao"];
export const DESDE_O_INICIO = "inicio";
export type Quantidades = Record<TipoRequisicao, number>;

// De quem é a chamada: uma empresa cadastrada, as empresas removidas (anonimizadas, todas juntas) ou a própria plataforma
// (chamada sem contribuinte).
export type Quem = { tipo: "empresa"; empresaId: string } | { tipo: "removidas" } | { tipo: "plataforma" };
export type Grupo = { periodo: string; quem: Quem; tipo: TipoRequisicao; quantidade: number };
export type LinhaDeCusto = { chave: string; quem: Quem; quantidades: Quantidades; centavos: number };
export type Custos = { linhas: LinhaDeCusto[]; total: { quantidades: Quantidades; centavos: number } };

const zerado = (): Quantidades => ({ consulta: 0, emissao: 0, declaracao: 0 });
const chaveDe = (q: Quem) => (q.tipo === "empresa" ? `empresa:${q.empresaId}` : q.tipo);
// O preço da faixa em centavos inteiros (Math.round só desfaz a imprecisão do número decimal, ex.: 0.29 * 100).
export const centavosDaFaixa = (tipo: TipoRequisicao, totalDoTipo: number) => Math.round(precoUnitario(tipo, totalDoTipo) * 100);

// O cálculo, sem banco: `grupos` são as chamadas cobradas contadas por período, quem e tipo. Linhas do maior custo para o
// menor (empate: mais chamadas primeiro, depois a chave, para a ordem não mudar entre aberturas).
export function calcularCustos(grupos: Grupo[]): Custos {
  const totalDoTipo = new Map<string, number>();
  for (const g of grupos) totalDoTipo.set(`${g.periodo}|${g.tipo}`, (totalDoTipo.get(`${g.periodo}|${g.tipo}`) ?? 0) + g.quantidade);

  const linhas = new Map<string, LinhaDeCusto>();
  const total = { quantidades: zerado(), centavos: 0 };
  for (const g of grupos) {
    if (g.quantidade <= 0) continue;
    const chave = chaveDe(g.quem);
    const linha = linhas.get(chave) ?? { chave, quem: g.quem, quantidades: zerado(), centavos: 0 };
    const centavos = g.quantidade * centavosDaFaixa(g.tipo, totalDoTipo.get(`${g.periodo}|${g.tipo}`)!);
    linha.quantidades[g.tipo] += g.quantidade;
    linha.centavos += centavos;
    total.quantidades[g.tipo] += g.quantidade;
    total.centavos += centavos;
    linhas.set(chave, linha);
  }
  const chamadas = (l: LinhaDeCusto) => TIPOS.reduce((s, t) => s + l.quantidades[t], 0);
  const ordem = [...linhas.values()].sort((a, b) => b.centavos - a.centavos || chamadas(b) - chamadas(a) || a.chave.localeCompare(b.chave));
  return { linhas: ordem, total };
}

// O período da chamada (a data do dia 21 em que começa), calculado no banco no horário de Brasília: o instante passa para
// a hora de Brasília, volta 20 dias, fica no dia 1º do mês e avança 20 dias (21/10 00:00 → 21/10; 20/10 23:59 → 21/09).
const periodoDaChamada = sql<string>`to_char(date_trunc('month', (${serproChamadas.quando} at time zone 'America/Sao_Paulo') - interval '20 days') + interval '20 days', 'YYYY-MM-DD')`;
const cobrada = ne(serproChamadas.acao, "Autenticar");

// Os períodos que aparecem no seletor: o atual (mesmo sem chamadas) e os anteriores que tiveram chamadas, do mais novo ao
// mais antigo.
export async function periodosComChamadas(banco: Banco, agora = new Date()): Promise<string[]> {
  const linhas = await banco.selectDistinct({ periodo: periodoDaChamada }).from(serproChamadas);
  const atual = periodoDe(agora);
  return [...new Set([atual, ...linhas.map((l) => l.periodo).filter((p) => p <= atual)])].sort().reverse();
}

export type Escolha = string; // a chave do período ("2026-10-21") ou DESDE_O_INICIO
// O que veio no endereço (?periodo=): um período válido, "inicio" ou, qualquer outra coisa, o período atual.
export const escolhaDoEndereco = (valor: unknown, agora = new Date()): Escolha =>
  valor === DESDE_O_INICIO ? DESDE_O_INICIO : typeof valor === "string" && ehChaveDePeriodo(valor) ? valor : periodoDe(agora);

export type LinhaComNome = LinhaDeCusto & { nome: string; cnpj: string | null };
export type CustosComNomes = { linhas: LinhaComNome[]; total: Custos["total"] };

// As chamadas cobradas (filtro já com `cobrada`) contadas no banco por período, quem e tipo.
async function gruposCobrados(banco: Banco, filtro: SQL | undefined): Promise<Grupo[]> {
  const contagem = await banco
    .select({
      periodo: periodoDaChamada,
      empresaId: serproChamadas.empresaId,
      semContribuinte: serproChamadas.semContribuinte,
      acao: serproChamadas.acao,
      n: sql<number>`count(*)::int`,
    })
    .from(serproChamadas)
    .where(filtro)
    .groupBy(periodoDaChamada, serproChamadas.empresaId, serproChamadas.semContribuinte, serproChamadas.acao);

  return contagem.flatMap((c) => {
    const tipo = TIPO_DA_ACAO[c.acao as Acao];
    if (!tipo) return [];
    // Empresa cadastrada pelo vínculo; sem vínculo, a plataforma (sem contribuinte) ou uma empresa removida (anonimizada).
    const quem: Quem = c.empresaId ? { tipo: "empresa", empresaId: c.empresaId } : c.semContribuinte ? { tipo: "plataforma" } : { tipo: "removidas" };
    return [{ periodo: c.periodo, quem, tipo, quantidade: c.n }];
  });
}

// O custo por cliente de um período (ou desde o início), com a razão social e o CNPJ de cada empresa.
export async function custosPorCliente(banco: Banco, escolha: Escolha): Promise<CustosComNomes> {
  const filtro =
    escolha === DESDE_O_INICIO
      ? cobrada
      : (() => {
          const { inicio, fim } = limitesDoPeriodo(escolha);
          return and(cobrada, gte(serproChamadas.quando, inicio), lt(serproChamadas.quando, fim));
        })();
  const custos = calcularCustos(await gruposCobrados(banco, filtro));

  const ids = custos.linhas.flatMap((l) => (l.quem.tipo === "empresa" ? [l.quem.empresaId] : []));
  const cadastro = ids.length
    ? await banco.select({ id: empresas.id, razaoSocial: empresas.razaoSocial, cnpj: empresas.cnpj }).from(empresas).where(inArray(empresas.id, ids)).orderBy(asc(empresas.id))
    : [];
  const porId = new Map(cadastro.map((e) => [e.id, e]));
  return {
    total: custos.total,
    linhas: custos.linhas.map((l) => {
      if (l.quem.tipo === "removidas") return { ...l, nome: "Empresas removidas", cnpj: null };
      if (l.quem.tipo === "plataforma") return { ...l, nome: "Plataforma (sem empresa)", cnpj: null };
      // Removida entre as duas leituras: o vínculo caiu (SET NULL); o gasto ainda é da linha dela até a próxima abertura.
      const e = porId.get(l.quem.empresaId);
      return { ...l, nome: e?.razaoSocial ?? "Empresa removida", cnpj: e?.cnpj ?? null };
    }),
  };
}

// Custo mensal e total da plataforma: uma linha por período de cobrança, com a quantidade de cada tipo, o preço da faixa
// aplicado (centavos, pelo total do tipo no período, como em calcularCustos) e o custo do período. Mesmos grupos que o custo
// por cliente, então o custo de cada mês é a soma dos clientes nele e a soma dos meses é o "Desde o início".
export type CustoDoPeriodo = { periodo: string; quantidades: Quantidades; precos: Record<TipoRequisicao, number>; centavos: number };
export type CustosMensais = {
  periodos: CustoDoPeriodo[]; // do mais recente para o mais antigo
  atual: CustoDoPeriodo; // o período de agora (zerado se ainda não teve chamada cobrada)
  total: { quantidades: Quantidades; chamadas: number; centavos: number };
};

const precosDe = (q: Quantidades) => Object.fromEntries(TIPOS.map((t) => [t, centavosDaFaixa(t, q[t])])) as Record<TipoRequisicao, number>;

// O cálculo, sem banco: os períodos com chamadas cobradas e o atual (mesmo vazio).
export function calcularCustosMensais(grupos: Grupo[], atual: string): CustosMensais {
  const porPeriodo = new Map<string, Quantidades>([[atual, zerado()]]);
  for (const g of grupos) {
    if (g.quantidade <= 0) continue;
    const q = porPeriodo.get(g.periodo) ?? zerado();
    q[g.tipo] += g.quantidade;
    porPeriodo.set(g.periodo, q);
  }
  const periodos = [...porPeriodo.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([periodo, quantidades]) => {
      const precos = precosDe(quantidades);
      return { periodo, quantidades, precos, centavos: TIPOS.reduce((s, t) => s + quantidades[t] * precos[t], 0) };
    });
  const total = { quantidades: zerado(), chamadas: 0, centavos: 0 };
  for (const p of periodos) {
    for (const t of TIPOS) total.quantidades[t] += p.quantidades[t];
    total.centavos += p.centavos;
  }
  total.chamadas = TIPOS.reduce((s, t) => s + total.quantidades[t], 0);
  return { periodos, atual: periodos.find((p) => p.periodo === atual)!, total };
}

// O custo mensal e o total desde a primeira chamada, lidos só do banco (independe do período escolhido na tela).
export async function custosMensais(banco: Banco, agora = new Date()): Promise<CustosMensais> {
  return calcularCustosMensais(await gruposCobrados(banco, cobrada), periodoDe(agora));
}
