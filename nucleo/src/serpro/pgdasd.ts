// Declaração mensal do PGDAS-D e emissão do DAS pelo Serpro, em três etapas:
// 1. simular: a Receita calcula os valores sem transmitir nada;
// 2. transmitir: só se a simulação bateu com o cálculo da plataforma, e com confirmação do cliente;
// 3. emitir o DAS da declaração transmitida (ou, vencido, atualizado com multa e juros para uma data).
// As funções não gravam nada: devolvem o resultado para a plataforma guardar.
import { soDigitos } from "../formato.ts";
import { hoje, mesValido } from "../meses.ts";
import { TRIBUTOS, centavos, mesesDoFatorR, type Das, type Tributo, type ValoresPorMes } from "../simples.ts";
import { sujeitaAoFatorR } from "./atividades-pgdasd.ts";
import { problemaNaDataDePagamento } from "./guias.ts";
import { falha, falhaDoErro, primeiro, respostaOk, textoMensagens, type ClienteSerpro, type Contexto, type Resultado } from "./cliente.ts";

// Códigos de tributo do PGDAS-D. CBS e IBS (a partir de 2027) ainda sem código cadastrado.
export const CODIGOS: Partial<Record<Tributo, number>> = { irpj: 1001, csll: 1002, cofins: 1004, pis: 1005, cpp: 1006, iss: 1010 };
const NOMES_TRIBUTO: Record<number, string> = {
  1001: "IRPJ", 1002: "CSLL", 1004: "COFINS", 1005: "PIS", 1006: "INSS/CPP", 1007: "ICMS", 1008: "IPI", 1010: "ISS",
};
export const nomeTributo = (codigo: number) => NOMES_TRIBUTO[codigo] ?? String(codigo);

export type Valores = Record<string, number>; // código do tributo -> valor

export const periodoApuracao = (pa: string) => {
  if (!mesValido(pa)) throw new Error(`Período de apuração inválido: "${pa}".`);
  return pa.replace("-", "");
};

// Valores calculados pela plataforma, no formato da Receita (só tributos com valor).
export function valoresDoDas(das: Das): Valores {
  const valores: Valores = {};
  for (const t of TRIBUTOS) {
    if (das.tributos[t] <= 0) continue;
    const codigo = CODIGOS[t];
    if (!codigo) throw new Error(`Tributo ${t.toUpperCase()} sem código do PGDAS-D cadastrado.`);
    valores[codigo] = das.tributos[t];
  }
  return valores;
}

export function valoresIguais(a: Valores, b: Valores) {
  const chaves = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...chaves].every((k) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 0.005);
}

export type DadosDeclaracao = {
  cnpj: string;
  pa: string;
  receitaExterna: number; // MVP: só receita de exportação
  idAtividade: number; // ver cnae.ts e atividades-pgdasd.ts
  // Folha de salários com encargos por mês ("AAAA-MM"), a mesma do Fator R. Obrigatória quando a atividade é sujeita
  // ao fator r (29 na exportação) e há receita: sem ela o PGDAS-D calcula fator r 0,01 e tributa pelo Anexo V.
  folhasSalario?: ValoresPorMes;
  // Início de atividade ("AAAA-MM"), o mesmo passado a fatorR: define os meses da folha (no mês de abertura, a do PA).
  inicioAtividade?: string;
  // Receitas brutas (mercado externo) dos meses anteriores ao PA. A Receita só as exige na primeira declaração
  // (períodos antes da opção ou não optantes) e ignora as de meses já declarados (TRANSDECLARACAO11, regra d).
  receitasBrutasAnteriores?: ValoresPorMes;
  transmitir: boolean;
  retificadora: boolean;
  comparar?: Valores;
};

const valorValido = (v: number, onde: string) => {
  if (!Number.isFinite(v) || v < 0) throw new Error(`Valor inválido em ${onde}.`);
  return centavos(v);
};

// Folha de salários dos meses do fator r, do mais antigo ao mais recente, no formato do campo folhasSalario
// ({ pa: AAAAMM, valor }). Mês sem folha vai com 0,00, como no exemplo oficial do TRANSDECLARACAO11
// (https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/servicos/entregar_declaracao_mensal_entrada).
// Os meses vêm de mesesDoFatorR, os mesmos do cálculo do Fator R em cada regra: no mês de abertura (até 2026) a folha
// do próprio PA (FSPA, manual do PGDAS-D 2018 v4, 8.2.1); nos demais, os 12 anteriores ao PA até 2026 e, a partir de
// 2027, os 12 antecedentes ao mês anterior (CGSN 190/2026), sem meses anteriores ao início; nenhum nos dois primeiros
// meses de atividade a partir de 2027 (fator r fixo em 0,28).
export function folhasDaDeclaracao(pa: string, folhas: ValoresPorMes, inicioAtividade?: string) {
  return mesesDoFatorR(pa, inicioAtividade).meses.map((mes) => ({
    pa: Number(periodoApuracao(mes)),
    valor: valorValido(folhas[mes] ?? 0, `folhasSalario (${mes})`),
  }));
}

export function receitasAnterioresDaDeclaracao(pa: string, receitas: ValoresPorMes) {
  return Object.keys(receitas)
    .sort()
    .map((mes) => {
      if (!mesValido(mes) || mes >= pa) throw new Error(`Receita anterior fora do período: "${mes}".`);
      return { pa: Number(periodoApuracao(mes)), valorInterno: 0, valorExterno: valorValido(receitas[mes], `receitasBrutasAnteriores (${mes})`) };
    });
}

export function dadosDeclaracao(d: DadosDeclaracao) {
  const cnpj = soDigitos(d.cnpj);
  if (cnpj.length !== 14) throw new Error("CNPJ da declaração inválido.");
  if (!Number.isFinite(d.receitaExterna) || d.receitaExterna < 0) throw new Error("Receita da declaração inválida.");
  const fatorR = d.receitaExterna > 0 && sujeitaAoFatorR(d.idAtividade);
  const folhas = fatorR ? folhasDaDeclaracao(d.pa, d.folhasSalario ?? {}, d.inicioAtividade) : [];
  if (folhas.length > 0 && !d.folhasSalario) {
    throw new Error(`A atividade ${d.idAtividade} é sujeita ao fator r: informe a folha de salários dos meses do fator r.`);
  }
  return {
    cnpjCompleto: cnpj,
    pa: Number(periodoApuracao(d.pa)),
    indicadorTransmissao: d.transmitir,
    indicadorComparacao: Boolean(d.comparar),
    declaracao: {
      tipoDeclaracao: d.retificadora ? 2 : 1,
      receitaPaCompetenciaInterno: 0,
      receitaPaCompetenciaExterno: d.receitaExterna,
      ...(d.receitasBrutasAnteriores ? { receitasBrutasAnteriores: receitasAnterioresDaDeclaracao(d.pa, d.receitasBrutasAnteriores) } : {}),
      ...(folhas.length > 0 ? { folhasSalario: folhas } : {}),
      estabelecimentos: [
        d.receitaExterna > 0
          ? {
              cnpjCompleto: cnpj,
              atividades: [{ idAtividade: d.idAtividade, valorAtividade: d.receitaExterna, receitasAtividade: [{ valor: d.receitaExterna }] }],
            }
          : { cnpjCompleto: cnpj },
      ],
    },
    ...(d.comparar
      ? {
          valoresParaComparacao: Object.entries(d.comparar)
            .filter(([, v]) => v > 0)
            .map(([codigo, valor]) => ({ codigoTributo: Number(codigo), valor })),
        }
      : {}),
  };
}

// Por que o mês não pode ser transmitido, ou null se pode. Retificar é pedido explícito (`retificar`): mês já declarado
// só recebe retificadora, e mês sem declaração não tem o que retificar.
export function bloqueioTransmissao(s: { pa: string; mesAtual: string; declarada: boolean; transmitidaPelaPlataforma: boolean; retificar?: boolean }): string | null {
  if (s.pa >= s.mesAtual) return "O mês ainda não terminou. A declaração só pode ser feita a partir do mês seguinte.";
  if (s.retificar) return s.declarada ? null : "Este mês ainda não foi declarado: não há declaração para retificar.";
  if (s.declarada) return "Este mês já foi declarado. Para corrigir, faça uma retificação.";
  if (s.transmitidaPelaPlataforma) return "A declaração deste mês já foi transmitida pela plataforma.";
  return null;
}

export type Simulacao = { receita: number; valores: Valores };

// Motivo para não transmitir com base na última simulação bem-sucedida, ou null se pode.
export function motivoParaNaoTransmitir(bloqueio: string | null, simulacao: Simulacao | null, receita: number, valores: Valores) {
  if (bloqueio) return bloqueio;
  if (!simulacao) return "Faça a simulação antes de transmitir.";
  if (Math.abs(simulacao.receita - receita) >= 0.005) return "A receita mudou desde a simulação. Simule de novo.";
  if (!valoresIguais(simulacao.valores, valores)) return "A simulação da Receita não bateu com o cálculo da plataforma.";
  return null;
}

type DeclaracaoTransmitida = {
  idDeclaracao?: string;
  valoresDevidos?: { codigoTributo: number; valor: number }[];
  declaracao?: string; // PDF em base64
  recibo?: string; // PDF em base64
};

export const valoresDaResposta = (d: DeclaracaoTransmitida | undefined): Valores =>
  Object.fromEntries((d?.valoresDevidos ?? []).map((v) => [String(v.codigoTributo), v.valor]));

export async function simular(
  cliente: ClienteSerpro,
  ctx: Contexto,
  d: Omit<DadosDeclaracao, "transmitir" | "comparar"> & { mesAtual: string },
): Promise<Resultado<{ valores: Valores }>> {
  if (d.pa >= d.mesAtual) return falha("Não enviado: o mês ainda não terminou.");
  try {
    const r = await cliente.chamar(
      "Declarar",
      { idSistema: "PGDASD", idServico: "TRANSDECLARACAO11", versaoSistema: "1.0", dados: dadosDeclaracao({ ...d, transmitir: false }) },
      `Simular a declaração do PGDAS-D de ${d.pa} sem transmitir, para comparar com o cálculo da plataforma`,
      ctx,
    );
    const dados = primeiro<DeclaracaoTransmitida>(r.dados);
    if (!respostaOk(r) || !dados?.valoresDevidos) return falha(textoMensagens(r.mensagens) || `HTTP ${r.status}`);
    return { ok: true, valores: valoresDaResposta(dados), detalhe: textoMensagens(r.mensagens) };
  } catch (erro) {
    return falha((erro as Error).message);
  }
}

export async function transmitir(
  cliente: ClienteSerpro,
  ctx: Contexto,
  d: Omit<DadosDeclaracao, "transmitir" | "comparar"> & {
    valores: Valores; // calculados pela plataforma
    bloqueio: string | null; // de bloqueioTransmissao
    simulacao: Simulacao | null;
    confirmado: boolean;
  },
): Promise<Resultado<{ idDeclaracao: string; valores: Valores; declaracaoPdf: string | null; reciboPdf: string | null }>> {
  const motivo = motivoParaNaoTransmitir(d.bloqueio, d.simulacao, d.receitaExterna, d.valores);
  if (motivo) return falha(`Não enviado: ${motivo}`);
  if (!d.confirmado) return falha("Não enviado: a transmissão precisa da confirmação do cliente.");
  try {
    const r = await cliente.chamar(
      "Declarar",
      {
        idSistema: "PGDASD",
        idServico: "TRANSDECLARACAO11",
        versaoSistema: "1.0",
        dados: dadosDeclaracao({ ...d, transmitir: true, comparar: d.valores }),
      },
      `Transmitir a declaração ${d.retificadora ? "retificadora " : ""}do PGDAS-D de ${d.pa}, confirmada pelo cliente`,
      { ...ctx, confirmado: true },
    );
    const dados = primeiro<DeclaracaoTransmitida>(r.dados);
    if (!respostaOk(r) || !dados?.idDeclaracao) return falha(textoMensagens(r.mensagens) || `HTTP ${r.status}`);
    return {
      ok: true,
      idDeclaracao: dados.idDeclaracao,
      valores: valoresDaResposta(dados),
      declaracaoPdf: dados.declaracao ?? null,
      reciboPdf: dados.recibo ?? null,
      detalhe: [`Declaração ${dados.idDeclaracao}`, textoMensagens(r.mensagens)].filter(Boolean).join(" | "),
    };
  } catch (erro) {
    return falhaDoErro(erro);
  }
}

type DasEmitido = {
  pdf?: string;
  detalhamento?: {
    numeroDocumento?: string;
    dataVencimento?: string;
    valores?: { principal?: number; multa?: number; juros?: number; total?: number };
  };
};

export type GuiaDas = {
  numero: string;
  vencimento: string | null;
  principal: number | null;
  multa: number | null;
  juros: number | null;
  total: number;
  pdf: string | null; // base64
};

// Emite o DAS do PA. Com `pagarEm` ("AAAA-MM-DD"), gera o DAS vencido atualizado com multa e juros para essa data
// (dataConsolidacao), que precisa ser dia útil deste mês, de `hoje` em diante.
export async function emitirDas(
  cliente: ClienteSerpro,
  ctx: Contexto,
  d: { pa: string; declarado: boolean; pagarEm?: string; hoje?: string; feriadosExtras?: string[] },
): Promise<Resultado<GuiaDas>> {
  if (!d.declarado) return falha("Não enviado: o DAS só pode ser emitido depois da declaração.");
  const problema = d.pagarEm !== undefined ? problemaNaDataDePagamento(d.pagarEm, d.hoje ?? hoje(), d.feriadosExtras) : null;
  if (problema) return falha(`Não enviado: ${problema}`);
  const pa = periodoApuracao(d.pa);
  try {
    const r = await cliente.chamar(
      "Emitir",
      {
        idSistema: "PGDASD",
        idServico: "GERARDAS12",
        versaoSistema: "1.0",
        dados: { periodoApuracao: pa, ...(d.pagarEm ? { dataConsolidacao: d.pagarEm.replace(/-/g, "") } : {}) },
      },
      d.pagarEm ? `Gerar o DAS de ${d.pa} atualizado (multa e juros) para pagar em ${d.pagarEm}` : `Emitir o DAS do PGDAS-D de ${d.pa}`,
      ctx,
    );
    const das = primeiro<DasEmitido>(r.dados);
    const v = das?.detalhamento?.valores;
    if (!respostaOk(r) || typeof v?.total !== "number") return falha(textoMensagens(r.mensagens) || `HTTP ${r.status}`);
    const numero = das?.detalhamento?.numeroDocumento ?? pa;
    const vencimento = das?.detalhamento?.dataVencimento ?? null;
    return {
      ok: true,
      numero,
      vencimento,
      principal: v.principal ?? null,
      multa: v.multa ?? null,
      juros: v.juros ?? null,
      total: v.total,
      pdf: das?.pdf ?? null,
      detalhe: [`DAS ${numero}, vencimento ${vencimento ?? "?"}`, textoMensagens(r.mensagens)].filter(Boolean).join(" | "),
    };
  } catch (erro) {
    return falha((erro as Error).message);
  }
}
