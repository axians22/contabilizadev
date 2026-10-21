// Declaração anual (DEFIS) no modo guiado com os valores prontos (Parte 8, passo 22c). A plataforma não transmite a DEFIS
// (o site de referência também não): reúne o que já sabe do ano (receita, pró-labore e INSS, DAS, IRPJ dentro do DAS e o
// limite do lucro isento sem contabilidade, núcleo serpro/defis.ts, resumoDoAno) e guarda o que só o cliente sabe
// (lucros retirados, saldos do banco, despesas; tabela defis_dados), para ele lançar no Portal do Simples Nacional. Depois,
// a consulta da Receita (Parte 5) mostra a declaração entregue. Só banco, sempre pela porta de acesso.
import { eq, inArray } from "drizzle-orm";
import { apurar } from "@contabilizadev/nucleo/apuracao";
import { resumoDoAno, type MesDefis } from "@contabilizadev/nucleo/serpro/defis";
import { calcularDas, inssProLaboreDoMes } from "@contabilizadev/nucleo/simples";
import type { Banco } from "@/banco";
import { defisDados, pgdasdExtratos } from "@/banco/esquema";
import { dadosDaEmpresa, daEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { hojeNoBrasil } from "@/lib/historico/prazos";
import { empresaDaRotina, historicoDeValores } from "@/lib/rotina/base";

export type ResumoDoAno = ReturnType<typeof resumoDoAno>;
export type DadosDoCliente = { lucros: number | null; saldoInicial: number | null; saldoFinal: number | null; despesas: number | null };
export const CAMPOS_DO_CLIENTE = ["lucros", "saldoInicial", "saldoFinal", "despesas"] as const;

export const mesesDoAno = (ano: number) => Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}`);

// Os anos que a aba mostra: os três últimos anos fechados, do mais recente ao mais antigo.
export function anosDaDeclaracao(agora: Date): number[] {
  const ultimo = Number(hojeNoBrasil(agora).slice(0, 4)) - 1;
  return [ultimo, ultimo - 1, ultimo - 2];
}

// O resumo do ano com o que a plataforma sabe: receita declarada (ou lançada), DAS da declaração que vale (ou o calculado),
// pró-labore informado (ou o do extrato, ou o estimado pelo DARF do INSS pago).
export async function resumoDaDeclaracaoAnual(banco: Banco, acesso: AcessoEmpresa, ano: number): Promise<ResumoDoAno> {
  const meses = mesesDoAno(ano);
  const [empresa, historico, extratos] = await Promise.all([
    empresaDaRotina(banco, acesso),
    historicoDeValores(banco, acesso),
    banco
      .select({ pa: pgdasdExtratos.pa, numeroDeclaracao: pgdasdExtratos.numeroDeclaracao, valorDas: pgdasdExtratos.valorDas, consultadoEm: pgdasdExtratos.consultadoEm })
      .from(pgdasdExtratos)
      .where(daEmpresa(acesso, pgdasdExtratos, inArray(pgdasdExtratos.pa, meses))),
  ]);
  const linhas: MesDefis[] = meses.map((mes) => {
    const receita = historico.receitas[mes] ?? 0;
    const anteriores = Object.fromEntries(Object.entries(historico.receitas).filter(([m]) => m < mes));
    let dasCalculado = calcularDas({ pa: mes, receita: 0, rbt12: 0, anexo: "III", mercado: "externo" });
    if (empresa.regra) {
      try {
        dasCalculado = apurar({ pa: mes, receita, receitas: anteriores, folhas: historico.folhas, regra: empresa.regra, inicioAtividade: empresa.inicioAtividade }).das;
      } catch {
        // Mês antes do início de atividade (ou fora do que a plataforma apura): sem DAS calculado.
      }
    }
    const vigente = historico.vigentes.get(mes);
    const doMes = vigente ? extratos.filter((e) => e.numeroDeclaracao === vigente.numero && e.valorDas !== null).sort((a, b) => b.consultadoEm.getTime() - a.consultadoEm.getTime())[0] : undefined;
    const folha = historico.folhas[mes];
    const fonte = historico.fontesFolha[mes];
    return {
      mes,
      receita,
      dasCalculado,
      dasPago: doMes?.valorDas ?? null,
      proLabore: folha === undefined ? null : { bruto: folha, inss: inssProLaboreDoMes(mes, folha), previsto: fonte === "darf-teto" },
    };
  });
  return resumoDoAno(linhas);
}

export async function dadosDoCliente(banco: Banco, acesso: AcessoEmpresa, ano: number): Promise<DadosDoCliente> {
  const [linha] = await dadosDaEmpresa(banco, acesso).listar(defisDados, eq(defisDados.ano, ano));
  return { lucros: linha?.lucros ?? null, saldoInicial: linha?.saldoInicial ?? null, saldoFinal: linha?.saldoFinal ?? null, despesas: linha?.despesas ?? null };
}

export class ErroDosDados extends Error {}

// Guarda o que só o cliente sabe do ano (vazio = ainda não informado). Ano fora dos anos da aba ou valor negativo: recusa.
export async function salvarDadosDoCliente(banco: Banco, acesso: AcessoEmpresa, ano: number, dados: DadosDoCliente, opcoes: { agora: Date; usuarioId?: string }): Promise<void> {
  if (!anosDaDeclaracao(opcoes.agora).includes(ano)) throw new ErroDosDados("Escolha um dos anos da lista.");
  for (const campo of CAMPOS_DO_CLIENTE) {
    const v = dados[campo];
    if (v !== null && (!Number.isFinite(v) || v < 0 || v >= 1e12)) throw new ErroDosDados("Informe valores em reais, sem sinal de menos.");
  }
  await dadosDaEmpresa(banco, acesso).inserirOuAtualizar(
    defisDados,
    [{ ano, ...dados, atualizadoEm: opcoes.agora, usuarioId: opcoes.usuarioId ?? null }],
    [defisDados.empresaId, defisDados.ano],
    ["lucros", "saldoInicial", "saldoFinal", "despesas", "atualizadoEm", "usuarioId"],
  );
}

// O que ainda falta o cliente informar.
export const faltando = (d: DadosDoCliente) => CAMPOS_DO_CLIENTE.filter((c) => d[c] === null);

// Valor de um campo do formulário (input numérico do navegador: "1234.56"). Vazio = não informado (null); qualquer outra
// coisa que não seja um valor em reais com até dois decimais vira NaN (recusado ao salvar).
export function valorDoCampo(v: string): number | null {
  const limpo = v.trim();
  if (!limpo) return null;
  return /^\d{1,12}(\.\d{1,2})?$/.test(limpo) ? Number(limpo) : Number.NaN;
}
