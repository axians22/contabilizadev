// Declaração mensal do PGDAS-D pela plataforma (Parte 6, passo 18), em duas etapas e com confirmação do cliente:
// 1. simular: a Receita calcula com os mesmos dados, sem transmitir (o resultado fica guardado e aparece na tela);
// 2. transmitir: só depois de uma simulação que bateu com o cálculo da plataforma, com os mesmos dados, e com a
//    confirmação explícita do cliente sobre o resumo (receita e valor do DAS) que ele viu.
// Idempotência (banco primeiro): uma transmissão "viva" por mês e declaração retificada (índice único em
// pgdasd_envios). Duplo clique ou duas abas: a segunda encontra a primeira. Sem resposta da Receita (a chamada caiu), a
// transmissão fica incerta e nada é transmitido de novo até o histórico mostrar se a declaração chegou.
// Retificação é pedido explícito (`retificar`): mês já declarado só recebe retificadora, e a retificadora fica presa à
// declaração que ela corrige (não retifica a mesma declaração duas vezes).
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { inicioQueImporta } from "@contabilizadev/nucleo/apuracao";
import { textoDoPdf } from "@contabilizadev/nucleo/pdf";
import type { Contexto } from "@contabilizadev/nucleo/serpro/cliente";
import { lerExtrato } from "@contabilizadev/nucleo/serpro/extrato";
import { bloqueioTransmissao, simular, transmitir, valoresDoDas, valoresIguais, type Valores } from "@contabilizadev/nucleo/serpro/pgdasd";
import type { Banco } from "@/banco";
import { historicoConsultas, pgdasdDeclaracoes, pgdasdEnvios, pgdasdExtratos } from "@/banco/esquema";
import { dadosDaEmpresa, daEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { hojeNoBrasil } from "@/lib/historico/prazos";
import { ErroTermoAutorizacao } from "@/lib/termo/termo";
import { baseDoMes, type BaseDoMes } from "./base";
import { codigoPostgres, dataHoraNoBrasil, recusa, log, relogio, type DependenciasRotina, type Resposta } from "./dependencias";
import { MENSAGENS_DA_ROTINA, mensagemDaFalha, mensagemDoBloqueio } from "./mensagens";

export type Envio = typeof pgdasdEnvios.$inferSelect;
// Envio sem os PDFs (para a tela; os PDFs saem pela rota de documentos).
export type EnvioResumido = Omit<Envio, "declaracaoPdf" | "reciboPdf"> & { temDeclaracao: boolean; temRecibo: boolean };

// Transmissão "enviando" sem sinal de vida por esse tempo: o servidor caiu no meio; vira incerta.
export const ENVIO_PARADO_MINUTOS = 15;

const iguaisFolhas = (a: Record<string, number>, b: Record<string, number>) => valoresIguais(a, b);

// Os dados da declaração do mês, a partir da base (os mesmos na simulação e na transmissão).
function dadosDoMes(base: BaseDoMes) {
  const a = base.apuracao!;
  return {
    cnpj: base.cnpj,
    pa: base.pa,
    receitaExterna: base.receita,
    idAtividade: a.idAtividade,
    folhasSalario: a.fatorR ? base.folhas : undefined,
    inicioAtividade: inicioQueImporta(base.pa, base.inicioAtividade),
  };
}

async function contextoDa(deps: DependenciasRotina, acesso: AcessoEmpresa): Promise<Contexto | { mensagem: string }> {
  if (!deps.cliente) return { mensagem: MENSAGENS_DA_ROTINA.indisponivel };
  try {
    return await deps.contexto();
  } catch (erro) {
    if (erro instanceof ErroTermoAutorizacao) return { mensagem: erro.message };
    log(deps, `[serpro] Rotina do mês sem contexto da empresa ${acesso.empresaId}: ${(erro as Error).message}`);
    return { mensagem: MENSAGENS_DA_ROTINA.falhou };
  }
}

// Envios do mês, do mais recente ao mais antigo (sem os PDFs).
export async function enviosDoMes(banco: Banco, acesso: AcessoEmpresa, pa: string): Promise<EnvioResumido[]> {
  const linhas = await banco
    .select()
    .from(pgdasdEnvios)
    .where(daEmpresa(acesso, pgdasdEnvios, eq(pgdasdEnvios.pa, pa)))
    .orderBy(desc(pgdasdEnvios.criadoEm));
  return linhas.map(({ declaracaoPdf, reciboPdf, ...resto }) => ({ ...resto, temDeclaracao: Boolean(declaracaoPdf), temRecibo: Boolean(reciboPdf) }));
}

// Resolve as transmissões que ficaram sem desfecho: "enviando" parada vira incerta; incerta vira ok se o histórico mostra
// uma declaração do mês transmitida depois dela, ou erro (liberada) se a lista de declarações do ano foi consultada
// depois dela e nada apareceu.
export async function resolverIncertas(banco: Banco, acesso: AcessoEmpresa, pa: string, agora: Date): Promise<void> {
  const porta = dadosDaEmpresa(banco, acesso);
  const limite = new Date(agora.getTime() - ENVIO_PARADO_MINUTOS * 60_000);
  await porta.alterar(
    pgdasdEnvios,
    { estado: "incerto", mensagem: MENSAGENS_DA_ROTINA.incerta, terminadoEm: agora },
    and(eq(pgdasdEnvios.pa, pa), eq(pgdasdEnvios.etapa, "transmissao"), eq(pgdasdEnvios.estado, "enviando"), lt(pgdasdEnvios.criadoEm, limite))!,
  );
  const incertas = await porta.listar(pgdasdEnvios, and(eq(pgdasdEnvios.pa, pa), eq(pgdasdEnvios.etapa, "transmissao"), eq(pgdasdEnvios.estado, "incerto")));
  if (incertas.length === 0) return;
  const declaracoes = await porta.listar(pgdasdDeclaracoes, eq(pgdasdDeclaracoes.pa, pa));
  const [consulta] = await porta.listar(historicoConsultas, eq(historicoConsultas.tipo, `declaracoes:${pa.slice(0, 4)}`));
  for (const envio of incertas) {
    const desde = dataHoraNoBrasil(new Date(envio.criadoEm.getTime() - 60_000));
    const chegou = declaracoes
      .filter((d) => d.transmitidaEm && d.transmitidaEm >= desde && d.tipo === envio.tipo)
      .sort((a, b) => (a.transmitidaEm! < b.transmitidaEm! ? -1 : 1))[0];
    if (chegou) {
      await porta.alterar(pgdasdEnvios, { estado: "ok", numeroDeclaracao: chegou.numero, mensagem: null }, eq(pgdasdEnvios.id, envio.id));
    } else if (consulta?.ok && consulta.consultadaEm > envio.criadoEm) {
      await porta.alterar(pgdasdEnvios, { estado: "erro", mensagem: "A Receita Federal não recebeu esta transmissão. Pode transmitir de novo." }, eq(pgdasdEnvios.id, envio.id));
    }
  }
}

export type ResultadoSimulacao = { valoresReceita: Valores; valores: Valores; bateu: boolean };

export async function simularMes(
  deps: DependenciasRotina,
  acesso: AcessoEmpresa,
  pa: string,
  opcoes: { retificar: boolean; usuarioId?: string },
): Promise<Resposta<ResultadoSimulacao>> {
  const { banco } = deps;
  const agora = relogio(deps);
  const base = await baseDoMes(banco, acesso, pa, agora);
  if (!base.apuracao) return recusa(base.semRegra ?? MENSAGENS_DA_ROTINA.semRegra);
  const bloqueio = bloqueioTransmissao({ pa, mesAtual: base.mesAtual, declarada: Boolean(base.vigente), transmitidaPelaPlataforma: false, retificar: opcoes.retificar });
  if (bloqueio) return recusa(mensagemDoBloqueio(bloqueio));
  // "Ainda não lancei" não é "não houve receita": sem lançamento nem a marcação, não declara zero por engano.
  if (base.receitaPendente) return recusa(MENSAGENS_DA_ROTINA.receitaPendente);
  const valores = valoresDoDas(base.apuracao.das);
  // Banco primeiro: a mesma simulação (mesmos dados) feita hoje e que bateu não é pedida de novo. A que não bateu pode
  // ser repetida (o cliente pode ter corrigido algo na Receita).
  const retifica = opcoes.retificar ? (base.vigente?.numero ?? null) : null;
  const [ultima] = (await enviosDoMes(banco, acesso, pa)).filter((e) => e.etapa === "simulacao");
  if (
    ultima?.estado === "ok" &&
    ultima.valoresReceita &&
    hojeNoBrasil(ultima.criadoEm) === base.hoje &&
    ultima.tipo === (opcoes.retificar ? "retificadora" : "original") &&
    (ultima.retifica ?? null) === retifica &&
    Math.abs(ultima.receita - base.receita) < 0.005 &&
    ultima.idAtividade === base.apuracao.idAtividade &&
    valoresIguais(ultima.valores, valores) &&
    iguaisFolhas(ultima.folhas, base.apuracao.folhasDaDeclaracao) &&
    valoresIguais(ultima.valoresReceita, valores)
  ) {
    return { ok: true, valoresReceita: ultima.valoresReceita, valores, bateu: true };
  }
  const ctx = await contextoDa(deps, acesso);
  if ("mensagem" in ctx) return recusa(ctx.mensagem);

  const r = await simular(deps.cliente!, ctx, { ...dadosDoMes(base), retificadora: opcoes.retificar, mesAtual: base.mesAtual });
  const bateu = r.ok && valoresIguais(r.valores, valores);
  if (!r.ok) log(deps, `[serpro] Simulação do PGDAS-D de ${pa}, empresa ${acesso.empresaId}: ${r.detalhe}`);
  await dadosDaEmpresa(banco, acesso).inserir(pgdasdEnvios, {
    pa,
    etapa: "simulacao",
    tipo: opcoes.retificar ? "retificadora" : "original",
    retifica,
    receita: base.receita,
    rbt12: base.apuracao.rbt12.valor,
    anexo: base.apuracao.anexo,
    idAtividade: base.apuracao.idAtividade,
    folhas: base.apuracao.folhasDaDeclaracao,
    valores,
    valoresReceita: r.ok ? r.valores : null,
    estado: r.ok ? "ok" : "erro",
    mensagem: r.ok ? (bateu ? null : MENSAGENS_DA_ROTINA.simulacaoDiferente) : mensagemDaFalha(r.detalhe),
    criadoEm: agora,
    terminadoEm: relogio(deps),
    usuarioId: opcoes.usuarioId ?? null,
  });
  if (!r.ok) return recusa(mensagemDaFalha(r.detalhe));
  return { ok: true, valoresReceita: r.valores, valores, bateu };
}

export type Confirmacao = { receita: number; total: number }; // o resumo que o cliente confirmou

// Por que não dá para transmitir agora (só banco), ou null. Serve à tela (botão liberado ou não) e à transmissão.
export async function motivoParaNaoTransmitirMes(banco: Banco, acesso: AcessoEmpresa, base: BaseDoMes, retificar: boolean): Promise<string | null> {
  if (!base.apuracao) return base.semRegra ?? MENSAGENS_DA_ROTINA.semRegra;
  const envios = await enviosDoMes(banco, acesso, base.pa);
  const retifica = retificar ? (base.vigente?.numero ?? null) : null;
  const vivas = envios.filter((e) => e.etapa === "transmissao" && ["enviando", "ok", "incerto"].includes(e.estado) && (e.retifica ?? null) === retifica);
  if (vivas.some((e) => e.estado === "incerto")) return MENSAGENS_DA_ROTINA.incerta;
  if (vivas.some((e) => e.estado === "enviando")) return MENSAGENS_DA_ROTINA.transmitindo;
  const transmitida = envios.some((e) => e.etapa === "transmissao" && e.estado === "ok");
  const bloqueio = bloqueioTransmissao({ pa: base.pa, mesAtual: base.mesAtual, declarada: Boolean(base.vigente), transmitidaPelaPlataforma: transmitida, retificar });
  if (bloqueio) return mensagemDoBloqueio(bloqueio);
  if (vivas.length) return MENSAGENS_DA_ROTINA.jaTransmitida;
  if (base.receitaPendente) return MENSAGENS_DA_ROTINA.receitaPendente;
  const simulacao = envios.find((e) => e.etapa === "simulacao" && e.tipo === (retificar ? "retificadora" : "original"));
  if (!simulacao || simulacao.estado !== "ok" || !simulacao.valoresReceita) return MENSAGENS_DA_ROTINA.simuleAntes;
  const valores = valoresDoDas(base.apuracao.das);
  if (
    Math.abs(simulacao.receita - base.receita) >= 0.005 ||
    !valoresIguais(simulacao.valores, valores) ||
    !iguaisFolhas(simulacao.folhas, base.apuracao.folhasDaDeclaracao) ||
    simulacao.idAtividade !== base.apuracao.idAtividade ||
    (simulacao.retifica ?? null) !== retifica
  ) {
    return MENSAGENS_DA_ROTINA.receitaMudou;
  }
  if (!valoresIguais(simulacao.valoresReceita, valores)) return MENSAGENS_DA_ROTINA.simulacaoDiferente;
  return null;
}

export async function transmitirMes(
  deps: DependenciasRotina,
  acesso: AcessoEmpresa,
  pa: string,
  opcoes: { retificar: boolean; confirmado: boolean; confirmacao: Confirmacao; usuarioId?: string },
): Promise<Resposta<{ numeroDeclaracao: string }>> {
  const { banco } = deps;
  if (!opcoes.confirmado) return recusa(MENSAGENS_DA_ROTINA.semConfirmacao);
  const agora = relogio(deps);
  await resolverIncertas(banco, acesso, pa, agora);
  const base = await baseDoMes(banco, acesso, pa, agora);
  if (!base.apuracao) return recusa(base.semRegra ?? MENSAGENS_DA_ROTINA.semRegra);
  // O cliente confirmou um resumo: se a receita ou o DAS mudaram desde então, ele confirma de novo.
  if (Math.abs(opcoes.confirmacao.receita - base.receita) >= 0.005 || Math.abs(opcoes.confirmacao.total - base.apuracao.das.total) >= 0.005) {
    return recusa(MENSAGENS_DA_ROTINA.confirmacaoMudou);
  }
  const motivo = await motivoParaNaoTransmitirMes(banco, acesso, base, opcoes.retificar);
  if (motivo) return recusa(motivo);
  const ctx = await contextoDa(deps, acesso);
  if ("mensagem" in ctx) return recusa(ctx.mensagem);

  const valores = valoresDoDas(base.apuracao.das);
  const porta = dadosDaEmpresa(banco, acesso);
  let envio: Envio;
  try {
    [envio] = await porta.inserir(pgdasdEnvios, {
      pa,
      etapa: "transmissao",
      tipo: opcoes.retificar ? "retificadora" : "original",
      retifica: opcoes.retificar ? base.vigente!.numero : null,
      receita: base.receita,
      rbt12: base.apuracao.rbt12.valor,
      anexo: base.apuracao.anexo,
      idAtividade: base.apuracao.idAtividade,
      folhas: base.apuracao.folhasDaDeclaracao,
      valores,
      estado: "enviando",
      criadoEm: agora,
      usuarioId: opcoes.usuarioId ?? null,
    });
  } catch (erro) {
    // Outra requisição (duplo clique, outra aba) começou a mesma transmissão primeiro.
    if (codigoPostgres(erro) === "23505") return recusa(MENSAGENS_DA_ROTINA.transmitindo);
    throw erro;
  }

  const [simulacao] = (await enviosDoMes(banco, acesso, pa)).filter((e) => e.etapa === "simulacao" && e.estado === "ok");
  const r = await transmitir(deps.cliente!, ctx, {
    ...dadosDoMes(base),
    retificadora: opcoes.retificar,
    valores,
    bloqueio: null, // conferido acima (motivoParaNaoTransmitirMes), já com o envio travado
    simulacao: { receita: simulacao.receita, valores: simulacao.valoresReceita! },
    confirmado: true,
  });
  const fim = relogio(deps);
  if (!r.ok) {
    log(deps, `[serpro] Transmissão do PGDAS-D de ${pa}, empresa ${acesso.empresaId}${r.semResposta ? " (sem resposta)" : ""}: ${r.detalhe}`);
    const mensagem = r.semResposta ? MENSAGENS_DA_ROTINA.incerta : mensagemDaFalha(r.detalhe);
    await porta.alterar(pgdasdEnvios, { estado: r.semResposta ? "incerto" : "erro", mensagem, terminadoEm: fim }, eq(pgdasdEnvios.id, envio.id));
    return recusa(mensagem);
  }
  const declaracaoPdf = r.declaracaoPdf ? Buffer.from(r.declaracaoPdf, "base64") : null;
  await porta.alterar(
    pgdasdEnvios,
    { estado: "ok", numeroDeclaracao: r.idDeclaracao, valoresReceita: r.valores, declaracaoPdf, reciboPdf: r.reciboPdf ? Buffer.from(r.reciboPdf, "base64") : null, terminadoEm: fim, mensagem: null },
    eq(pgdasdEnvios.id, envio.id),
  );
  // A declaração entra no histórico na hora (banco primeiro: o mês passa a constar como declarado sem esperar a importação).
  await porta.inserirOuAtualizar(
    pgdasdDeclaracoes,
    [{ pa, numero: r.idDeclaracao, tipo: opcoes.retificar ? "retificadora" : "original", transmitidaEm: dataHoraNoBrasil(fim), malha: null, vistaEm: fim }],
    [pgdasdDeclaracoes.empresaId, pgdasdDeclaracoes.numero],
    ["vistaEm"],
  );
  if (declaracaoPdf) {
    let lido: ReturnType<typeof lerExtrato> | null = null;
    try {
      lido = lerExtrato(textoDoPdf(declaracaoPdf));
    } catch {
      // PDF que o leitor não entende: guarda com os valores calculados.
    }
    await porta.inserirOuAtualizar(
      pgdasdExtratos,
      [
        {
          pa,
          numeroDeclaracao: r.idDeclaracao,
          origem: "declaracao",
          numeroDas: null,
          receita: base.receita,
          valorDas: base.apuracao.das.total,
          fatorR: base.apuracao.fatorR?.valor ?? null,
          atividades: lido?.atividades ?? [],
          receitasAnteriores: lido?.receitasAnteriores ?? [],
          folhasAnteriores: lido?.folhasAnteriores ?? [],
          pdf: declaracaoPdf,
          consultadoEm: fim,
        },
      ],
      [pgdasdExtratos.empresaId, pgdasdExtratos.numeroDeclaracao],
      ["receita", "valorDas", "pdf", "consultadoEm"],
    );
  }
  return { ok: true, numeroDeclaracao: r.idDeclaracao };
}

// PDFs da transmissão (declaração e recibo), pela porta de acesso, para a rota de documentos.
export async function pdfDoEnvio(banco: Banco, acesso: AcessoEmpresa, id: string, qual: "declaracao" | "recibo") {
  const [l] = await banco
    .select({ pa: pgdasdEnvios.pa, declaracao: pgdasdEnvios.declaracaoPdf, recibo: pgdasdEnvios.reciboPdf })
    .from(pgdasdEnvios)
    .where(daEmpresa(acesso, pgdasdEnvios, and(eq(pgdasdEnvios.id, id), inArray(pgdasdEnvios.estado, ["ok"]))));
  const pdf = qual === "declaracao" ? l?.declaracao : l?.recibo;
  return l && pdf ? { nome: `${qual === "declaracao" ? "declaracao" : "recibo"}-pgdasd-${l.pa}.pdf`, pdf } : null;
}
