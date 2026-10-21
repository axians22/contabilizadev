// Histórico do PGDAS-D pelo Serpro (Parte 5): as declarações transmitidas e os DAS gerados de um ano, e o extrato de cada
// DAS (o PDF com a apuração do mês: receita, atividade, valores e pagamento).
// Documentação oficial (Integra SN, PGDASD):
// - CONSDECLARACAO13, versão 1.0, dados { anoCalendario: "AAAA" } ou { periodoApuracao: "AAAAMM" }: devolve
//   { anoCalendario, periodos: [{ periodoApuracao: AAAAMM, operacoes: [{ tipoOperacao, indiceDeclaracao, indiceDas }] }] }
//   (ou `periodo`, um só, na consulta por mês). indiceDeclaracao = { numeroDeclaracao, dataHoraTransmissao, malha };
//   indiceDas = { numeroDas, dataHoraEmissaoDas, dasPago }. O exemplo oficial escreve "anocalendario" e
//   "datahoraEmissaoDas": aceitamos as duas grafias.
//   https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/servicos/consultar_declaracao_por_ano_pa/
// - CONSEXTRATO16, versão 1.0, dados { numeroDas }: devolve { numeroDas, extrato: { nomeArquivo, pdf (base64) } }.
//   https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/servicos/consultar_extrato_do_das/
// - CONSDECREC15, versão 1.0, dados { numeroDeclaracao }: devolve { numeroDeclaracao, recibo: { nomeArquivo, pdf },
//   declaracao: { nomeArquivo, pdf }, maed? }. Serve para o mês declarado sem DAS gerado depois da declaração (mês sem
//   valor a pagar, ou declarado sem gerar a guia): sem DAS não há extrato, e o PDF da declaração traz o débito declarado.
//   https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/servicos/consultar_declaracao_recibo/
// As funções não gravam nada: devolvem o resultado para a plataforma guardar (banco primeiro).
import { falha, primeiro, respostaOk, textoMensagens, type ClienteSerpro, type Contexto, type Resultado } from "./cliente.ts";

export type DeclaracaoTransmitida = {
  numero: string; // numeroDeclaracao (17 posições)
  tipo: "original" | "retificadora";
  transmitidaEm: string | null; // ISO, horário de Brasília sem fuso ("AAAA-MM-DDTHH:MM:SS")
  malha: string | null;
};

export type DasGerado = {
  numero: string; // numeroDas (17 dígitos)
  emitidoEm: string | null; // ISO, como acima
  pago: boolean; // pago até o momento da consulta
};

export type PeriodoDeclarado = { pa: string; declaracoes: DeclaracaoTransmitida[]; das: DasGerado[] };

type Operacao = {
  tipoOperacao?: string | null;
  indiceDeclaracao?: { numeroDeclaracao?: string | null; dataHoraTransmissao?: string | number | null; malha?: string | null } | null;
  indiceDas?: { numeroDas?: string | null; dataHoraEmissaoDas?: string | number | null; datahoraEmissaoDas?: string | number | null; dasPago?: boolean | null } | null;
};
type Periodo = { periodoApuracao?: string | number | null; operacoes?: Operacao[] | null };
type DeclaracoesEntregues = { anoCalendario?: number | string; anocalendario?: number | string; periodos?: Periodo[] | null; periodo?: Periodo | null };

// "20220331032512" -> "2022-03-31T03:25:12"; vazio ou fora do formato -> null.
export function dataHoraDaReceita(v: string | number | null | undefined): string | null {
  const s = String(v ?? "").trim();
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
}

// 202609 -> "2026-09".
export function paDoPeriodo(v: string | number | null | undefined): string | null {
  const m = /^(\d{4})(0[1-9]|1[0-2])$/.exec(String(v ?? "").trim());
  return m ? `${m[1]}-${m[2]}` : null;
}

// Lê a resposta (já sem o texto escapado) em períodos, do mais antigo ao mais recente. Operações desconhecidas (DAS
// avulso, medida judicial, cobrança) entram como DAS quando trazem indiceDas; o resto é ignorado.
export function lerDeclaracoes(dados: unknown): PeriodoDeclarado[] {
  const d = (primeiro<DeclaracoesEntregues>(dados) ?? {}) as DeclaracoesEntregues;
  const periodos = [...(d.periodos ?? []), ...(d.periodo ? [d.periodo] : [])];
  const porPa = new Map<string, PeriodoDeclarado>();
  for (const p of periodos) {
    const pa = paDoPeriodo(p?.periodoApuracao);
    if (!pa) continue;
    const alvo = porPa.get(pa) ?? { pa, declaracoes: [], das: [] };
    porPa.set(pa, alvo);
    for (const op of p.operacoes ?? []) {
      const decl = op?.indiceDeclaracao;
      if (decl?.numeroDeclaracao) {
        alvo.declaracoes.push({
          numero: String(decl.numeroDeclaracao),
          tipo: /retifica/i.test(op.tipoOperacao ?? "") ? "retificadora" : "original",
          transmitidaEm: dataHoraDaReceita(decl.dataHoraTransmissao),
          malha: decl.malha?.trim() || null,
        });
      }
      const das = op?.indiceDas;
      if (das?.numeroDas) {
        alvo.das.push({ numero: String(das.numeroDas), emitidoEm: dataHoraDaReceita(das.dataHoraEmissaoDas ?? das.datahoraEmissaoDas), pago: das.dasPago === true });
      }
    }
  }
  return [...porPa.values()].sort((a, b) => a.pa.localeCompare(b.pa));
}

// Busca as declarações e os DAS do ano. Ano sem declaração vem com a lista vazia (não é erro).
export async function consultarDeclaracoes(cliente: ClienteSerpro, ctx: Contexto, ano: number): Promise<Resultado<{ ano: number; periodos: PeriodoDeclarado[] }>> {
  if (!Number.isInteger(ano) || ano < 2018 || ano > 2100) return falha(`Ano inválido: ${ano}.`);
  try {
    const r = await cliente.chamar(
      "Consultar",
      { idSistema: "PGDASD", idServico: "CONSDECLARACAO13", versaoSistema: "1.0", dados: { anoCalendario: String(ano) } },
      `Importar a lista de declarações do PGDAS-D e de DAS gerados no ano ${ano}`,
      ctx,
    );
    if (!respostaOk(r)) return falha(textoMensagens(r.mensagens) || `HTTP ${r.status}`);
    return { ok: true, ano, periodos: lerDeclaracoes(r.dados), detalhe: textoMensagens(r.mensagens) };
  } catch (erro) {
    return falha((erro as Error).message);
  }
}

export async function consultarExtrato(cliente: ClienteSerpro, ctx: Contexto, numeroDas: string): Promise<Resultado<{ numeroDas: string; pdf: string }>> {
  if (!/^\d{17}$/.test(numeroDas)) return falha("Não enviado: o número do DAS precisa ter 17 dígitos.");
  try {
    const r = await cliente.chamar(
      "Consultar",
      { idSistema: "PGDASD", idServico: "CONSEXTRATO16", versaoSistema: "1.0", dados: { numeroDas } },
      `Importar o extrato do DAS ${numeroDas} (apuração do PGDAS-D) para o histórico da empresa`,
      ctx,
    );
    const dados = primeiro<{ extrato?: { pdf?: string } }>(r.dados);
    if (!respostaOk(r) || !dados?.extrato?.pdf) return falha(textoMensagens(r.mensagens) || `HTTP ${r.status}`);
    return { ok: true, numeroDas, pdf: dados.extrato.pdf, detalhe: textoMensagens(r.mensagens) };
  } catch (erro) {
    return falha((erro as Error).message);
  }
}

export async function consultarDeclaracaoRecibo(
  cliente: ClienteSerpro,
  ctx: Contexto,
  numeroDeclaracao: string,
): Promise<Resultado<{ numeroDeclaracao: string; declaracaoPdf: string; reciboPdf: string | null }>> {
  if (!/^\d{17}$/.test(numeroDeclaracao)) return falha("Não enviado: o número da declaração precisa ter 17 dígitos.");
  try {
    const r = await cliente.chamar(
      "Consultar",
      { idSistema: "PGDASD", idServico: "CONSDECREC15", versaoSistema: "1.0", dados: { numeroDeclaracao } },
      `Importar a declaração ${numeroDeclaracao} do PGDAS-D (mês sem DAS gerado) para o histórico da empresa`,
      ctx,
    );
    const dados = primeiro<{ declaracao?: { pdf?: string } | null; recibo?: { pdf?: string } | null }>(r.dados);
    if (!respostaOk(r) || !dados?.declaracao?.pdf) return falha(textoMensagens(r.mensagens) || `HTTP ${r.status}`);
    return { ok: true, numeroDeclaracao, declaracaoPdf: dados.declaracao.pdf, reciboPdf: dados.recibo?.pdf ?? null, detalhe: textoMensagens(r.mensagens) };
  } catch (erro) {
    return falha((erro as Error).message);
  }
}

// A declaração que vale no período: a última transmitida (a retificadora substitui a anterior).
export function declaracaoVigente(p: PeriodoDeclarado): DeclaracaoTransmitida | null {
  return [...p.declaracoes].sort((a, b) => (a.transmitidaEm ?? "").localeCompare(b.transmitidaEm ?? "") || a.numero.localeCompare(b.numero)).at(-1) ?? null;
}

// O DAS cujo extrato mostra a declaração vigente: o último gerado depois dela. Sem DAS depois da última declaração
// (retificadora sem guia nova, mês sem valor a pagar), não há extrato dela para buscar: null.
export function dasDaDeclaracaoVigente(p: PeriodoDeclarado): DasGerado | null {
  return dasDaDeclaracaoVigenteTodos(p).at(-1) ?? null;
}

// Todos os DAS gerados depois da declaração vigente, do mais antigo ao mais novo. Cada "Gerar DAS" no portal cria um
// número novo para o mesmo débito (reimpressão, guia perdida): pagar qualquer um deles quita a declaração vigente. Os
// DAS de antes dela (de uma declaração que foi retificada) não entram.
export function dasDaDeclaracaoVigenteTodos(p: PeriodoDeclarado): DasGerado[] {
  const vigente = declaracaoVigente(p);
  if (!vigente) return [];
  const depois = p.das.filter((d) => !vigente.transmitidaEm || !d.emitidoEm || d.emitidoEm >= vigente.transmitidaEm);
  return depois.sort((a, b) => (a.emitidoEm ?? "").localeCompare(b.emitidoEm ?? "") || a.numero.localeCompare(b.numero));
}
