// Importação do histórico da Receita para a empresa ativa (Parte 5, passo 17): declarações e extratos do PGDAS-D dos
// últimos 12 meses, pagamentos, DEFIS e situação fiscal. Banco primeiro (prazos.ts decide o que está velho), cada
// resultado é guardado pela porta de acesso, e cada chamada fica em serpro_chamadas com o custo (o cliente do núcleo
// registra). Só para empresa autorizada: quem chama confere (servidor.ts); aqui o contexto da chamada (termo e token)
// vem de `contexto`, que recusa empresa sem autorização em dia.
// Em duas partes, para não travar a tela: iniciarImportacao planeja e grava a linha (o progresso), e
// executarImportacao roda as etapas (em segundo plano, depois da resposta). No máximo uma rodando por empresa.
// Nada depende do Next: banco, cliente, contexto e relógio entram por parâmetro.
import { and, eq, isNull, like, lt } from "drizzle-orm";
import { textoDoPdf } from "@contabilizadev/nucleo/pdf";
import type { ClienteSerpro, Contexto } from "@contabilizadev/nucleo/serpro/cliente";
import { buscarDefis } from "@contabilizadev/nucleo/serpro/defis";
import { lerExtrato } from "@contabilizadev/nucleo/serpro/extrato";
import { buscarPagamentos } from "@contabilizadev/nucleo/serpro/pagamentos";
import { consultarDeclaracaoRecibo, consultarDeclaracoes, consultarExtrato, dasDaDeclaracaoVigente, declaracaoVigente } from "@contabilizadev/nucleo/serpro/pgdasd-consultas";
import { gerarRelatorio } from "@contabilizadev/nucleo/serpro/sitfis";
import type { Banco } from "@/banco";
import {
  defis,
  historicoConsultas,
  importacoes,
  pagamentos,
  pgdasdDas,
  pgdasdDeclaracoes,
  pgdasdExtratos,
  situacoesFiscais,
  type EtapaImportacao,
} from "@/banco/esquema";
import { dadosDaEmpresa, daEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { ErroTermoAutorizacao } from "@/lib/termo/termo";
import { dadosDoHistorico, montarHistorico, ultimasConsultas } from "./leitura";
import { mensagemDaFalha, MENSAGENS_DO_HISTORICO } from "./mensagens";
import { DIA_MS, hojeNoBrasil, IMPORTACAO_PARADA_MINUTOS, mesesDoHistorico, planejar, type EstadoDoBanco, type Pedido } from "./prazos";

export type DependenciasImportacao = {
  banco: Banco;
  cliente: ClienteSerpro | null; // null = contrato não configurado (nada é chamado)
  contexto: () => Promise<Contexto>; // contribuinte, autor e token da empresa (lib/termo/termo.ts, contextoSerpro)
  agora?: () => Date;
  esperar?: (ms: number) => Promise<void>; // espera do relatório de situação fiscal (trocada nos testes)
  log?: (mensagem: string) => void;
};

export type Inicio =
  | { estado: "iniciada"; id: string }
  | { estado: "rodando"; id: string }
  | { estado: "em-dia" }
  | { estado: "espere"; minutos: number }
  | { estado: "indisponivel" };

const relogio = (deps: DependenciasImportacao) => (deps.agora ?? (() => new Date()))();
const log = (deps: DependenciasImportacao, mensagem: string) => (deps.log ?? console.error)(mensagem);
const codigoPostgres = (erro: unknown) => (erro as { code?: string; cause?: { code?: string } })?.code ?? (erro as { cause?: { code?: string } })?.cause?.code;

// Documentos que faltam, um por declaração vigente: o extrato do DAS gerado depois dela; sem DAS (mês sem valor a pagar,
// ou declarado sem gerar a guia), o PDF da própria declaração, que traz o débito declarado. A declaração guardada sem DAS
// é trocada pelo extrato quando aparece um DAS para ela (a arrecadação só vem no extrato).
async function extratosAFazer(banco: Banco, acesso: AcessoEmpresa, agora: Date, comFalhasRecentes: boolean) {
  const dados = await dadosDoHistorico(banco, acesso, agora);
  const guardados = new Map(dados.extratos.map((e) => [e.numeroDeclaracao, e.origem ?? "extrato"]));
  const falhas = comFalhasRecentes
    ? new Set<string>()
    : new Set(
        (await banco.select().from(historicoConsultas).where(daEmpresa(acesso, historicoConsultas, like(historicoConsultas.tipo, "extrato:%"))))
          .filter((c) => !c.ok && agora.getTime() - c.consultadaEm.getTime() < DIA_MS)
          .map((c) => c.tipo.slice("extrato:".length)),
      );
  const lista: { pa: string; numeroDeclaracao: string; numeroDas: string | null }[] = [];
  for (const pa of mesesDoHistorico(agora)) {
    const periodo = {
      pa,
      declaracoes: dados.declaracoes.filter((d) => d.pa === pa).map((d) => ({ numero: d.numero, tipo: d.tipo, transmitidaEm: d.transmitidaEm, malha: d.malha })),
      das: dados.das.filter((d) => d.pa === pa).map((d) => ({ numero: d.numero, emitidoEm: d.emitidoEm, pago: d.pago })),
    };
    const vigente = declaracaoVigente(periodo);
    const das = dasDaDeclaracaoVigente(periodo);
    if (!vigente || falhas.has(vigente.numero)) continue;
    const guardado = guardados.get(vigente.numero);
    if (!guardado || (guardado === "declaracao" && das)) lista.push({ pa, numeroDeclaracao: vigente.numero, numeroDas: das?.numero ?? null });
  }
  return lista;
}

export async function estadoDoBanco(banco: Banco, acesso: AcessoEmpresa, agora: Date): Promise<EstadoDoBanco> {
  const [consultas, prontos, processando, entregues, dados, faltando] = await Promise.all([
    ultimasConsultas(banco, acesso),
    banco
      .select({ prontoEm: situacoesFiscais.prontoEm })
      .from(situacoesFiscais)
      .where(daEmpresa(acesso, situacoesFiscais, eq(situacoesFiscais.situacao, "pronto"))),
    banco.select({ id: situacoesFiscais.id }).from(situacoesFiscais).where(daEmpresa(acesso, situacoesFiscais, eq(situacoesFiscais.situacao, "processando"))),
    banco.select({ ano: defis.ano }).from(defis).where(daEmpresa(acesso, defis, eq(defis.situacao, "entregue"))),
    dadosDoHistorico(banco, acesso, agora),
    extratosAFazer(banco, acesso, agora, false),
  ]);
  const meses = montarHistorico(dados, agora, null);
  const ultimo = prontos.reduce<Date | null>((m, p) => (p.prontoEm && (!m || p.prontoEm > m) ? p.prontoEm : m), null);
  return {
    consultas,
    ultimoProntoSituacao: ultimo,
    situacaoProcessando: processando.length > 0,
    defisEntregues: new Set(entregues.map((d) => d.ano)),
    // Só DAS gerado e vencido pede a consulta de pagamentos: sem DAS não há pagamento para achar.
    dasSemPagamentoVencido: meses.some((m) => m.situacao === "vencido" && m.das !== null),
    extratosFaltando: faltando.length,
  };
}

// Importação parada (servidor reiniciado no meio): encerra, com as etapas que não terminaram marcadas como erro.
async function encerrarParadas(banco: Banco, acesso: AcessoEmpresa, agora: Date) {
  const limite = new Date(agora.getTime() - IMPORTACAO_PARADA_MINUTOS * 60_000);
  const porta = dadosDaEmpresa(banco, acesso);
  const paradas = await porta.listar(importacoes, and(isNull(importacoes.terminadaEm), lt(importacoes.atualizadaEm, limite)));
  for (const p of paradas) {
    const etapas = p.etapas.map((e) => (e.estado === "pendente" || e.estado === "rodando" ? { ...e, estado: "erro" as const, mensagem: MENSAGENS_DO_HISTORICO.interrompida } : e));
    await porta.alterar(importacoes, { etapas, terminadaEm: agora, atualizadaEm: agora }, eq(importacoes.id, p.id));
  }
  // Pedido de situação fiscal que ficou "processando" com a importação parada não volta mais: vira erro.
  await porta.alterar(situacoesFiscais, { situacao: "erro" }, and(eq(situacoesFiscais.situacao, "processando"), lt(situacoesFiscais.pedidoEm, limite))!);
}

// Planeja e grava a importação (o que a tela acompanha). Não chama nada: as chamadas ficam para executarImportacao.
export async function iniciarImportacao(deps: DependenciasImportacao, acesso: AcessoEmpresa, pedido: Pedido): Promise<Inicio> {
  if (!deps.cliente) return { estado: "indisponivel" };
  const { banco } = deps;
  const agora = relogio(deps);
  await encerrarParadas(banco, acesso, agora);
  const porta = dadosDaEmpresa(banco, acesso);
  const [rodando] = await porta.listar(importacoes, isNull(importacoes.terminadaEm));
  if (rodando) return { estado: "rodando", id: rodando.id };

  const plano = planejar(await estadoDoBanco(banco, acesso, agora), pedido, agora);
  if (plano.etapas.length === 0) return plano.espera ? { estado: "espere", minutos: plano.espera } : { estado: "em-dia" };
  const [antes] = await porta.listar(importacoes);
  const etapas: EtapaImportacao[] = plano.etapas.map((e) => ({ ...e, estado: "pendente" }));
  try {
    const [linha] = await porta.inserir(importacoes, {
      motivo: !antes ? "inicial" : pedido.manual ? "manual" : "automatica",
      etapas,
      iniciadaEm: agora,
      atualizadaEm: agora,
    });
    return { estado: "iniciada", id: linha.id };
  } catch (erro) {
    // Duas requisições juntas: a outra gravou primeiro (índice único de importação rodando).
    if (codigoPostgres(erro) !== "23505") throw erro;
    const [outra] = await porta.listar(importacoes, isNull(importacoes.terminadaEm));
    return outra ? { estado: "rodando", id: outra.id } : { estado: "em-dia" };
  }
}

type Progresso = (parcial: Partial<EtapaImportacao>) => Promise<void>;

// Roda as etapas da importação, na ordem, guardando cada resultado. Falha de uma etapa não para as outras; a mensagem
// da tela é própria e o detalhe técnico vai para o log. Empresa removida no meio: para sem erro.
export async function executarImportacao(deps: DependenciasImportacao, acesso: AcessoEmpresa, id: string): Promise<void> {
  const { banco } = deps;
  const porta = dadosDaEmpresa(banco, acesso);
  const [linha] = await porta.listar(importacoes, eq(importacoes.id, id));
  if (!linha || linha.terminadaEm) return;
  const etapas = linha.etapas.map((e) => ({ ...e }));
  const salvar = () => porta.alterar(importacoes, { etapas, atualizadaEm: relogio(deps) }, eq(importacoes.id, id));

  try {
    let ctx: Contexto | null = null;
    let semContexto: string | null = null;
    if (!deps.cliente) semContexto = MENSAGENS_DO_HISTORICO.indisponivel;
    else {
      try {
        ctx = await deps.contexto();
      } catch (erro) {
        semContexto = erro instanceof ErroTermoAutorizacao ? erro.message : MENSAGENS_DO_HISTORICO.falhou;
        log(deps, `[serpro] Importação do histórico sem contexto da empresa ${acesso.empresaId}: ${(erro as Error).message}`);
      }
    }
    for (const etapa of etapas) {
      if (semContexto || !ctx || !deps.cliente) {
        Object.assign(etapa, { estado: "erro", mensagem: semContexto ?? MENSAGENS_DO_HISTORICO.falhou });
        continue;
      }
      Object.assign(etapa, { estado: "rodando" });
      await salvar();
      const progresso: Progresso = async (parcial) => {
        Object.assign(etapa, parcial);
        await salvar();
      };
      let falha: string | null;
      try {
        falha = await rodarEtapa(deps, deps.cliente, acesso, ctx, etapa, progresso);
      } catch (erro) {
        if (codigoPostgres(erro) === "23503") throw erro; // empresa removida: para tudo
        falha = (erro as Error).message;
      }
      if (falha) log(deps, `[serpro] Importação do histórico, etapa ${etapa.id}, empresa ${acesso.empresaId}: ${falha}`);
      Object.assign(etapa, falha ? { estado: "erro", mensagem: mensagemDaFalha(falha) } : { estado: "feito" });
      await salvar();
    }
    await porta.alterar(importacoes, { etapas, atualizadaEm: relogio(deps), terminadaEm: relogio(deps) }, eq(importacoes.id, id));
  } catch (erro) {
    if (codigoPostgres(erro) === "23503") {
      log(deps, `[historico] Empresa ${acesso.empresaId} removida durante a importação: nada mais foi gravado.`);
      return;
    }
    throw erro;
  }
}

// Planeja e roda na hora (testes e quem quiser esperar o resultado).
export async function importar(deps: DependenciasImportacao, acesso: AcessoEmpresa, pedido: Pedido): Promise<Inicio> {
  const inicio = await iniciarImportacao(deps, acesso, pedido);
  if (inicio.estado === "iniciada") await executarImportacao(deps, acesso, inicio.id);
  return inicio;
}

async function registrarConsulta(banco: Banco, acesso: AcessoEmpresa, tipo: string, ok: boolean, em: Date) {
  await dadosDaEmpresa(banco, acesso).inserirOuAtualizar(historicoConsultas, [{ tipo, consultadaEm: em, ok }], [historicoConsultas.empresaId, historicoConsultas.tipo], [
    "consultadaEm",
    "ok",
  ]);
}

// Uma etapa: devolve o detalhe da falha (para o log) ou null.
async function rodarEtapa(
  deps: DependenciasImportacao,
  cliente: ClienteSerpro,
  acesso: AcessoEmpresa,
  ctx: Contexto,
  etapa: EtapaImportacao,
  progresso: Progresso,
): Promise<string | null> {
  const { banco } = deps;
  const porta = dadosDaEmpresa(banco, acesso);
  const falhas: string[] = [];

  if (etapa.id === "declaracoes") {
    const anos = etapa.anos ?? [];
    await progresso({ feitos: 0, total: anos.length });
    for (const [i, ano] of anos.entries()) {
      const r = await consultarDeclaracoes(cliente, ctx, ano);
      const agora = relogio(deps);
      await registrarConsulta(banco, acesso, `declaracoes:${ano}`, r.ok, agora);
      if (!r.ok) {
        falhas.push(r.detalhe);
        continue;
      }
      const declaracoes = r.periodos.flatMap((p) => p.declaracoes.map((d) => ({ pa: p.pa, numero: d.numero, tipo: d.tipo, transmitidaEm: d.transmitidaEm, malha: d.malha, vistaEm: agora })));
      const das = r.periodos.flatMap((p) => p.das.map((d) => ({ pa: p.pa, numero: d.numero, emitidoEm: d.emitidoEm, pago: d.pago, vistoEm: agora })));
      await porta.inserirOuAtualizar(pgdasdDeclaracoes, declaracoes, [pgdasdDeclaracoes.empresaId, pgdasdDeclaracoes.numero], ["malha", "vistaEm"]);
      await porta.inserirOuAtualizar(pgdasdDas, das, [pgdasdDas.empresaId, pgdasdDas.numero], ["pago", "vistoEm"]);
      await progresso({ feitos: i + 1 });
    }
  }

  if (etapa.id === "extratos") {
    const lista = await extratosAFazer(banco, acesso, relogio(deps), true);
    await progresso({ feitos: 0, total: lista.length });
    for (const [i, item] of lista.entries()) {
      const r = item.numeroDas
        ? await consultarExtrato(cliente, ctx, item.numeroDas)
        : await consultarDeclaracaoRecibo(cliente, ctx, item.numeroDeclaracao);
      const agora = relogio(deps);
      await registrarConsulta(banco, acesso, `extrato:${item.numeroDeclaracao}`, r.ok, agora);
      if (!r.ok) {
        falhas.push(r.detalhe);
        continue;
      }
      const pdf = Buffer.from("pdf" in r ? r.pdf : r.declaracaoPdf, "base64");
      let lido: ReturnType<typeof lerExtrato> | null = null;
      try {
        lido = lerExtrato(textoDoPdf(pdf));
      } catch {
        // PDF que o leitor não entende: fica guardado para abrir, sem os valores.
      }
      // A declaração tem o mesmo modelo do extrato, sem o DAS: o valor é o débito declarado.
      const valorDas = item.numeroDas ? (lido?.das?.total ?? lido?.totalDebito ?? null) : (lido?.totalDebito ?? null);
      await porta.inserirOuAtualizar(
        pgdasdExtratos,
        [
          {
            pa: item.pa,
            numeroDeclaracao: item.numeroDeclaracao,
            origem: item.numeroDas ? "extrato" : "declaracao",
            numeroDas: item.numeroDas,
            receita: lido?.receita ?? null,
            valorDas,
            vencimento: item.numeroDas ? (lido?.das?.vencimento ?? null) : null,
            pagoEm: item.numeroDas ? (lido?.pagamento?.data ?? null) : null,
            valorPago: item.numeroDas ? (lido?.pagamento?.valor ?? null) : null,
            fatorR: lido?.fatorR ?? null,
            atividades: lido?.atividades ?? [],
            pdf,
            consultadoEm: agora,
          },
        ],
        [pgdasdExtratos.empresaId, pgdasdExtratos.numeroDeclaracao],
        ["origem", "numeroDas", "receita", "valorDas", "vencimento", "pagoEm", "valorPago", "fatorR", "atividades", "pdf", "consultadoEm"],
      );
      await progresso({ feitos: i + 1 });
    }
  }

  if (etapa.id === "pagamentos") {
    const agora = relogio(deps);
    const de = `${mesesDoHistorico(agora)[0]}-01`;
    let r: Awaited<ReturnType<typeof buscarPagamentos>>;
    try {
      r = await buscarPagamentos(cliente, ctx, de, hojeNoBrasil(agora));
    } catch (erro) {
      await registrarConsulta(banco, acesso, "pagamentos", false, relogio(deps));
      return (erro as Error).message;
    }
    const porNumero = new Map(r.documentos.map((d) => [d.numeroDocumento, d]));
    await porta.inserirOuAtualizar(
      pagamentos,
      r.pagamentos.map((p) => ({ numero: p.numero, tipo: p.tipo, pa: p.mes, pagoEm: p.pagoEm, valor: p.valor, documento: porNumero.get(p.numero) ?? {}, vistoEm: agora })),
      [pagamentos.empresaId, pagamentos.numero],
      ["pagoEm", "valor", "documento", "vistoEm"],
    );
    await registrarConsulta(banco, acesso, "pagamentos", true, relogio(deps));
  }

  if (etapa.id === "defis") {
    const anos = etapa.anos ?? [];
    await progresso({ feitos: 0, total: anos.length });
    for (const [i, ano] of anos.entries()) {
      const r = await buscarDefis(cliente, ctx, ano);
      const agora = relogio(deps);
      await registrarConsulta(banco, acesso, `defis:${ano}`, r.ok, agora);
      if (!r.ok) {
        falhas.push(r.detalhe);
        continue;
      }
      await porta.inserirOuAtualizar(
        defis,
        [
          {
            ano,
            situacao: r.situacao,
            idDefis: r.idDefis,
            declaracaoPdf: r.declaracaoPdf ? Buffer.from(r.declaracaoPdf, "base64") : null,
            reciboPdf: r.reciboPdf ? Buffer.from(r.reciboPdf, "base64") : null,
            consultadaEm: agora,
          },
        ],
        [defis.empresaId, defis.ano],
        ["situacao", "idDefis", "declaracaoPdf", "reciboPdf", "consultadaEm"],
      );
      await progresso({ feitos: i + 1 });
    }
  }

  if (etapa.id === "situacao") {
    const pedidoEm = relogio(deps);
    const [pedido] = await porta.inserir(situacoesFiscais, { pedidoEm, situacao: "processando" });
    const r = await gerarRelatorio(cliente, ctx, "da empresa", deps.esperar);
    const agora = relogio(deps);
    await registrarConsulta(banco, acesso, "situacao", r.ok, agora);
    if (r.ok) {
      await porta.alterar(
        situacoesFiscais,
        { situacao: "pronto", regular: r.regular, pendencias: r.diagnostico.slice(0, 4000) || null, pdf: Buffer.from(r.pdf, "base64"), prontoEm: agora },
        eq(situacoesFiscais.id, pedido.id),
      );
    } else {
      await porta.alterar(situacoesFiscais, { situacao: "erro" }, eq(situacoesFiscais.id, pedido.id));
      falhas.push(r.detalhe);
    }
  }

  return falhas.length ? falhas.join(" | ") : null;
}
