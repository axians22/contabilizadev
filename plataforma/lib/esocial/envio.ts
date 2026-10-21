// Pró-labore do mês no eSocial (Parte 7, passo 20): S-1200 (remuneração) e S-1210 (pagamento) num lote e, aceitos, o
// S-1299 (fechamento) noutro; a retificação explícita manda S-1298 (reabre), o S-1200 retificador e um novo S-1299.
//
// Quem assina e quem transmite (MOD v1.16, agosto de 2026, a versão vigente; ver nucleo/src/esocial/lote.ts): o cliente
// assina cada evento no navegador com o e-CNPJ A1 da empresa (o empregador; código 411 do retorno: o assinante tem de ser
// o empregador, o representante legal ou um procurador) e a plataforma transmite o lote com o próprio certificado ("Não é
// necessário qualquer tipo de vínculo formal (ex: procuração) entre o transmissor e o empregador", §7.5.7). Só o
// transmissor consulta o resultado (§7.6.13): enviar e consultar usam sempre o certificado da plataforma.
// Assinatura em duas etapas: o servidor prepara cada evento (prepararAssinaturaEsocialRemota) e devolve o SignedInfo; o
// navegador assina com a chave não exportável do WebCrypto (lib/assinador) e devolve só o valor; o servidor completa,
// confere a assinatura e o esquema oficial e só então envia. A chave nunca chega aqui; a senha nunca é guardada.
// A empresa da própria plataforma assina no servidor (o certificado do contrato é o e-CNPJ dela).
//
// Uma assinatura por mês: o cliente assina, de uma vez, todos os eventos do mês (o fechamento inclusive); a plataforma
// manda o lote seguinte sozinha quando o anterior é aceito. TODO S-1299 pede a transmissão imediata da DCTFWeb
// (transDCTFWeb = S; leiaute S-1.3 do S-1299: "Solicitação de transmissão imediata da DCTFWeb"; ADE Corat 14/2021). A
// cada fechamento a Receita monta a declaração do mês de novo: se a anterior já tinha sido transmitida, nasce uma
// retificadora "em andamento", mesmo sem mudança de valor, que precisa ser transmitida. Fonte: Manual de Orientação da
// DCTFWeb (Receita Federal, atualização de janeiro/2025, manual-dctfweb-atualizacao-janeiro2025_versao_final.pdf em
// gov.br/receitafederal): §14.5 (p. 83), o novo fechamento com transmissão imediata gera e transmite a retificadora (mas
// não transmite se houver débito com exigibilidade suspensa: por isso a espera ESPERA_DCTF_PELO_ESOCIAL_MINUTOS em
// lib/rotina/dctfweb.ts antes de liberar a transmissão daqui); §17.1.1 (p. 99), a retificadora "Em andamento" deve ser
// transmitida mesmo sem mudança de valores. Então pedir a transmissão em todo fechamento transmite a declaração NOVA (não é transmitir em dobro) e
// nunca deixa a retificadora sem transmitir. Em dobro seria a plataforma transmitir a mesma declaração que o eSocial vai
// transmitir; isso é barrado dos dois lados: lib/rotina/dctfweb.ts não transmite enquanto houver envio do eSocial do mês
// em curso (esocialDaDctf) nem depois do fechamento aceito (até a conferência mostrar que a transmissão automática não
// aconteceu), e o envio do eSocial não sai enquanto uma transmissão da DCTFWeb por aqui estiver em andamento ou sem
// resposta (dctfTransmitindo, conferido de novo depois de travar o envio).
//
// Idempotência: um envio em andamento por empresa e mês (índice único); um S-1200 original por sócio e mês (índice
// único); envio sem resposta fica "incerto" e só é repetido com os MESMOS eventos assinados (o eSocial reconhece o evento
// já recebido e devolve o recibo original, MOD §7.6.13); duas consultas ao mesmo tempo não mandam o lote seguinte duas
// vezes (troca condicional no banco).
import { and, eq, inArray, like, lt } from "drizzle-orm";
import { completarAssinaturaRemota, prepararAssinaturaEsocialRemota, verificarAssinatura } from "@contabilizadev/nucleo/assinatura";
import type { Pem } from "@contabilizadev/nucleo/certificado";
import { valoresDoProLabore, type ParametrosFolha } from "@contabilizadev/nucleo/esocial/eventos";
import { assinarEValidar, CODIGO_DO_EVENTO, dataPagamentoPadrao, montarEventosDoMes, montarRetificacao, validarAssinado, type EventoMontado, type PagamentoDoMes } from "@contabilizadev/nucleo/esocial/folha";
import { aceito, consultarLote, enviarLote, ErroLoteRecusado, GRUPO, idEvento } from "@contabilizadev/nucleo/esocial/lote";
import type { Ambiente, ClienteEsocial } from "@contabilizadev/nucleo/esocial/ws";
import { centavos } from "@contabilizadev/nucleo/simples";
import { dataValida, somarMeses } from "@contabilizadev/nucleo/meses";
import { conferirAntesDeAssinar, ErroCertificado, lerCertificado, pemDoCertificado } from "@contabilizadev/nucleo/serpro/termo-autorizacao";
import type { Banco } from "@/banco";
import { dctfwebEnvios, esocialConfig, esocialEnvios, esocialEventos, prolabores, type OcorrenciaEsocial, type ValoresDoEnvioEsocial } from "@/banco/esquema";
import { dadosDaEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { hojeNoBrasil, mesAtualNoBrasil } from "@/lib/historico/prazos";
import { cnpjDaEmpresa } from "@/lib/rotina/base";
import { codigoPostgres, log, recusa, relogio, type Resposta } from "@/lib/rotina/dependencias";
import { MENSAGENS_DO_ESOCIAL, mensagemSemDemonstrativo } from "./mensagens";
import { prazoDoEsocial } from "./prazo";

// Só produção: não há modo simulado (decisão do usuário). Os testes trocam o cliente por um falso.
export const AMBIENTE: Ambiente = "producao";
export const PREPARO_VALIDO_MINUTOS = 30;
export const ENVIO_PARADO_MINUTOS = 15; // "enviando" parado assim (o processo caiu) vira incerto
export const PRIMEIRA_CONSULTA_SEGUNDOS = 10;
export const CONSULTA_MINIMA_SEGUNDOS = 15;

export type DependenciasEsocial = {
  banco: Banco;
  cliente: Pick<ClienteEsocial, "chamar" | "consultasRestantes"> | null; // nulo sem o certificado da plataforma
  transmissor: string | null; // o CNPJ da plataforma (o do certificado da conexão)
  propria?: boolean; // a empresa da própria plataforma: assina no servidor
  certificadoDaPlataforma?: () => Pem | null;
  agora?: () => Date;
  log?: (mensagem: string) => void;
};

export type Envio = typeof esocialEnvios.$inferSelect;
export type Evento = typeof esocialEventos.$inferSelect;
export type ConfigEsocial = typeof esocialConfig.$inferSelect;

const VIGENTES: Evento["estado"][] = ["aceito", "importado"];
const EM_ANDAMENTO: Envio["estado"][] = ["enviando", "aguardando", "incerto"];

export type SituacaoEsocial = {
  mes: string;
  config: ConfigEsocial | null;
  proLabore: number | null; // o informado no passo 2 da rotina
  valores: { proLabore: number; inss: number; liquido: number } | null;
  envio: Envio | null; // o último envio de verdade (sem os só preparados)
  emAndamento: Envio | null;
  remuneracao: Evento | null; // o S-1200 que vale no mês para o sócio (o último aceito ou baixado)
  pagamentoAceito: boolean; // o mês já tem S-1210
  fechado: boolean;
  portal: boolean; // o cliente marcou que lançou no portal do eSocial
  concluido: boolean;
  pagamento: PagamentoDoMes | null; // o S-1210 que iria agora (pagamento feito no mês)
  // Pago no mês seguinte e sem o demonstrativo (S-1200) do mês anterior aqui: o mês anterior, cujo pagamento feito neste
  // mês não teria como ir (o S-1210 precisa do ideDmDev dele). Pede a importação dele ou a decisão explícita do cliente.
  semDemonstrativoAnterior: string | null;
  prazo: string;
};

// Do mais recente para o mais antigo pelo Id do evento: pelo leiaute (MOD §8.3) ele leva a data e a hora em que o evento
// foi gerado e um sequencial, então a ordem do Id é a ordem em que os eventos foram feitos (inclusive os do contador).
const porData = (a: Evento, b: Evento) => b.idEvento.localeCompare(a.idEvento);

// "enviando" parado (o processo caiu no meio) vira incerto: pode ter chegado ao eSocial.
async function resolverParados(banco: Banco, acesso: AcessoEmpresa, agora: Date) {
  await dadosDaEmpresa(banco, acesso).alterar(
    esocialEnvios,
    { estado: "incerto", mensagem: MENSAGENS_DO_ESOCIAL.incerto },
    and(eq(esocialEnvios.estado, "enviando"), lt(esocialEnvios.criadoEm, new Date(agora.getTime() - ENVIO_PARADO_MINUTOS * 60_000)))!,
  );
}

async function proLaboreDoMes(banco: Banco, acesso: AcessoEmpresa, mes: string): Promise<number | null> {
  const [linha] = await dadosDaEmpresa(banco, acesso).listar(prolabores, eq(prolabores.mes, mes));
  return linha ? linha.valor : null;
}

export async function configDaEmpresa(banco: Banco, acesso: AcessoEmpresa): Promise<ConfigEsocial | null> {
  const [config] = await dadosDaEmpresa(banco, acesso).listar(esocialConfig);
  return config ?? null;
}

// O S-1200 que vale num mês para o sócio: o último aceito pela plataforma ou baixado do eSocial.
const remuneracaoVigente = (eventos: Evento[], cpf: string | null) =>
  eventos.filter((e) => e.tipo === "evtRemun" && VIGENTES.includes(e.estado) && (!cpf || e.cpf === cpf)).sort(porData)[0] ?? null;

// Situação do mês no eSocial (só banco).
export async function situacaoEsocial(banco: Banco, acesso: AcessoEmpresa, mes: string, agora: Date): Promise<SituacaoEsocial> {
  await resolverParados(banco, acesso, agora);
  const porta = dadosDaEmpresa(banco, acesso);
  const anterior = somarMeses(mes, -1);
  const [config, proLabore, proLaboreAnterior, envios, eventos, anteriores] = await Promise.all([
    configDaEmpresa(banco, acesso),
    proLaboreDoMes(banco, acesso, mes),
    proLaboreDoMes(banco, acesso, anterior),
    porta.listar(esocialEnvios, eq(esocialEnvios.mes, mes)).then((l) => l.sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime())),
    porta.listar(esocialEventos, eq(esocialEventos.mes, mes)),
    porta.listar(esocialEventos, eq(esocialEventos.mes, anterior)),
  ]);
  const cpf = config?.cpf ?? null;
  const envio = envios.find((e) => e.estado !== "preparado") ?? null;
  const emAndamento = envios.find((e) => EM_ANDAMENTO.includes(e.estado)) ?? null;
  const remuneracao = remuneracaoVigente(eventos, cpf);
  const pagamentoAceito = eventos.some((e) => e.tipo === "evtPgtos" && VIGENTES.includes(e.estado) && (!cpf || e.cpf === cpf));
  // Fechado: o último S-1299 ou S-1298 aceito é um fechamento; sem nenhum da plataforma, o S-1200 baixado do eSocial
  // (enviado pelo contador, que fecha o mês junto) conta como fechado.
  const [ultimoFechamento] = eventos.filter((e) => ["evtFechaEvPer", "evtReabreEvPer"].includes(e.tipo) && e.estado === "aceito").sort(porData);
  const portal = envios.some((e) => e.tipo === "portal");
  const fechado = ultimoFechamento ? ultimoFechamento.tipo === "evtFechaEvPer" : remuneracao?.estado === "importado";
  const valores = proLabore !== null ? valoresDoProLabore(proLabore, mes) : null;
  const pagamento = config && valores ? pagamentoDoMes(config, mes, valores, remuneracao, remuneracaoVigente(anteriores, cpf)) : null;
  // O mês anterior teve pró-labore (informado na rotina): sem o demonstrativo dele, o pagamento feito neste mês ficaria de
  // fora em silêncio.
  const semDemonstrativoAnterior =
    config?.pagamentoNoMes === "seguinte" && valores && !pagamento && !pagamentoAceito && (proLaboreAnterior ?? 0) > 0 ? anterior : null;
  return {
    mes,
    config,
    proLabore,
    valores,
    envio,
    emAndamento,
    remuneracao,
    pagamentoAceito,
    fechado,
    portal,
    concluido: portal || Boolean(remuneracao && fechado),
    pagamento,
    semDemonstrativoAnterior,
    prazo: prazoDoEsocial(mes),
  };
}

// O pagamento feito no mês: do pró-labore do mês anterior (o demonstrativo dele precisa estar no eSocial, enviado aqui ou
// pelo contador) ou do próprio mês, conforme o cadastro.
function pagamentoDoMes(config: ConfigEsocial, mes: string, valores: { liquido: number }, remuneracao: Evento | null, anterior: Evento | null): PagamentoDoMes | null {
  const dtPgto = dataPagamentoPadrao(mes, config.diaPagamento);
  if (config.pagamentoNoMes === "mesmo") return { dtPgto, perRef: mes, ideDmDev: remuneracao?.ideDmDev ?? undefined, liquido: valores.liquido };
  const liquido = anterior?.valores?.liquido;
  if (!anterior?.ideDmDev || liquido === undefined) return null;
  return { dtPgto, perRef: anterior.mes, ideDmDev: anterior.ideDmDev, liquido };
}

function motivoComum(s: SituacaoEsocial, agora: Date): string | null {
  if (s.mes >= mesAtualNoBrasil(agora)) return MENSAGENS_DO_ESOCIAL.mesAberto;
  if (!s.config) return MENSAGENS_DO_ESOCIAL.semConfig;
  if (s.proLabore === null) return MENSAGENS_DO_ESOCIAL.semProLabore;
  if (s.proLabore <= 0) return MENSAGENS_DO_ESOCIAL.proLaboreZero;
  if (s.emAndamento) return s.emAndamento.estado === "incerto" ? MENSAGENS_DO_ESOCIAL.incerto : MENSAGENS_DO_ESOCIAL.emAndamento;
  return null;
}

// Por que não dá para enviar o mês agora (só banco), ou null. O envio manda só o que falta (ex.: o fechamento que foi
// recusado); remuneração já no eSocial com outro valor só por retificação.
export function motivoParaNaoEnviar(s: SituacaoEsocial, agora: Date): string | null {
  const comum = motivoComum(s, agora);
  if (comum) return comum;
  if (s.concluido) return s.portal ? MENSAGENS_DO_ESOCIAL.concluido : MENSAGENS_DO_ESOCIAL.jaEnviado;
  if (s.remuneracao && s.remuneracao.valores?.proLabore !== s.proLabore) return MENSAGENS_DO_ESOCIAL.jaEnviado;
  return null;
}

export function motivoParaNaoRetificar(s: SituacaoEsocial, agora: Date): string | null {
  const comum = motivoComum(s, agora);
  if (comum) return comum;
  if (!s.remuneracao?.recibo || !s.remuneracao.ideDmDev) return MENSAGENS_DO_ESOCIAL.nadaARetificar;
  if (s.remuneracao.valores?.proLabore === s.proLabore) return MENSAGENS_DO_ESOCIAL.mesmoValor;
  return null;
}

// Uma transmissão da DCTFWeb do mês pela plataforma em andamento ou sem resposta: o envio do eSocial (que pede outra
// transmissão no fechamento) espera ela se resolver.
export async function dctfTransmitindo(banco: Banco, acesso: AcessoEmpresa, mes: string): Promise<boolean> {
  const linhas = await dadosDaEmpresa(banco, acesso).listar(dctfwebEnvios, and(eq(dctfwebEnvios.pa, mes), eq(dctfwebEnvios.etapa, "transmissao"), inArray(dctfwebEnvios.estado, ["enviando", "incerto"]))!);
  return linhas.length > 0;
}

export type EsocialDaDctf = {
  // Quando o eSocial aceitou o último fechamento do mês que pediu a transmissão da DCTFWeb (null se não houve, ou se o
  // mês foi reaberto depois).
  peloEsocial: Date | null;
  // Quando a plataforma mudou a declaração do mês pela última vez (fechamento ou reabertura aceitos): o que a DCTFWeb
  // registrou antes disso (conferência, transmissão) é da declaração anterior.
  desde: Date | null;
  // Envio do eSocial do mês com o pedido de transmissão a caminho (preparado ainda válido, enviando, aguardando o
  // resultado ou sem resposta): a transmissão pode acontecer a qualquer momento.
  emCurso: boolean;
};

// O que o eSocial do mês significa para a DCTFWeb (lib/rotina/dctfweb.ts usa para não transmitir duas vezes).
export async function esocialDaDctf(banco: Banco, acesso: AcessoEmpresa, mes: string, agora: Date): Promise<EsocialDaDctf> {
  const porta = dadosDaEmpresa(banco, acesso);
  const [eventos, envios] = await Promise.all([porta.listar(esocialEventos, eq(esocialEventos.mes, mes)), porta.listar(esocialEnvios, eq(esocialEnvios.mes, mes))]);
  const [ultimo] = eventos.filter((e) => ["evtFechaEvPer", "evtReabreEvPer"].includes(e.tipo) && e.estado === "aceito" && e.envioId).sort(porData);
  const quando = ultimo ? (ultimo.processadoEm ?? ultimo.criadoEm) : null;
  const envioDoUltimo = ultimo ? envios.find((e) => e.id === ultimo.envioId) : undefined;
  const preparoValido = (e: Envio) => agora.getTime() - e.criadoEm.getTime() <= PREPARO_VALIDO_MINUTOS * 60_000;
  return {
    peloEsocial: ultimo?.tipo === "evtFechaEvPer" && envioDoUltimo?.transDctf ? quando : null,
    desde: quando,
    emCurso: envios.some((e) => e.transDctf && (EM_ANDAMENTO.includes(e.estado) || (e.estado === "preparado" && preparoValido(e)))),
  };
}

export type ResumoEsocial = {
  mes: string;
  tipo: "mensal" | "retificacao";
  cpf: string;
  proLabore: number;
  inss: number;
  liquido: number;
  pagamento: { perRef: string; dtPgto: string; liquido: number } | null;
  eventos: string[]; // S-1200, S-1210, S-1299…
  semPagamentoDe: string | null; // o mês anterior cujo pagamento não vai (decisão explícita do cliente)
};

type Montagem = { eventos: EventoMontado[]; resumo: ResumoEsocial; valores: ValoresDoEnvioEsocial };

type OpcoesDoMes = { retificar: boolean; dtPgto?: string | null; semPagamentoAnterior?: boolean };

async function montar(deps: DependenciasEsocial, acesso: AcessoEmpresa, mes: string, o: OpcoesDoMes): Promise<Resposta<{ m: Montagem }>> {
  const agora = relogio(deps);
  const s = await situacaoEsocial(deps.banco, acesso, mes, agora);
  const motivo = o.retificar ? motivoParaNaoRetificar(s, agora) : motivoParaNaoEnviar(s, agora);
  if (motivo) return recusa(motivo);
  if (!deps.cliente || !deps.transmissor) return recusa(MENSAGENS_DO_ESOCIAL.indisponivel);
  if (await dctfTransmitindo(deps.banco, acesso, mes)) return recusa(MENSAGENS_DO_ESOCIAL.dctfTransmitindo);
  const semPagamentoDe = !o.retificar && s.semDemonstrativoAnterior ? s.semDemonstrativoAnterior : null;
  if (semPagamentoDe && !o.semPagamentoAnterior) return recusa(mensagemSemDemonstrativo(semPagamentoDe));
  const config = s.config!;
  const parametros: ParametrosFolha = {
    empregador: { cnpj: await cnpjDaEmpresa(deps.banco, acesso) },
    cpf: config.cpf,
    categoria: config.categoria,
    matricula: config.matricula,
    lotacao: config.lotacao,
    tabRubrica: config.tabRubrica,
    rubricaProLabore: config.rubricaProLabore,
    rubricaInss: config.rubricaInss,
    qtdProLabore: config.qtdProLabore,
    proLabore: s.proLabore!,
  };
  let pagamento = o.retificar || s.pagamentoAceito ? null : s.pagamento;
  if (pagamento && o.dtPgto) {
    if (!dataValida(o.dtPgto) || !o.dtPgto.startsWith(mes)) return recusa(MENSAGENS_DO_ESOCIAL.dataDoPagamento);
    pagamento = { ...pagamento, dtPgto: o.dtPgto };
  }
  // O Id do evento leva a data e a hora até o segundo e um sequencial: continua depois dos já usados no mesmo segundo.
  const prefixo = idEvento(parametros.empregador.cnpj, 0, agora).slice(0, -5);
  const usados = await dadosDaEmpresa(deps.banco, acesso).listar(esocialEventos, like(esocialEventos.idEvento, `${prefixo}%`));
  const primeiroSequencial = usados.length + 1;
  const eventos = o.retificar
    ? montarRetificacao({
        mes,
        ambiente: AMBIENTE,
        parametros,
        original: { nrRecibo: s.remuneracao!.recibo!, ideDmDev: s.remuneracao!.ideDmDev! },
        reabrir: s.fechado,
        temPagamento: s.pagamentoAceito,
        // Todo fechamento pede a transmissão da declaração que ele gera (ver o começo do arquivo).
        transDCTFWeb: true,
        quando: agora,
        primeiroSequencial,
      })
    : montarEventosDoMes({
        mes,
        ambiente: AMBIENTE,
        parametros,
        pagamento,
        // Todo fechamento pede a transmissão da declaração que ele gera (ver o começo do arquivo).
        transDCTFWeb: true,
        remuneracaoAceita: s.remuneracao?.ideDmDev ? { ideDmDev: s.remuneracao.ideDmDev } : undefined,
        pagamentoAceito: s.pagamentoAceito,
        quando: agora,
        primeiroSequencial,
      });
  const v = s.valores!;
  const pagamentoNoEnvio = pagamento ? { perRef: pagamento.perRef, dtPgto: pagamento.dtPgto, liquido: pagamento.liquido } : null;
  return {
    ok: true,
    m: {
      eventos,
      valores: { proLabore: v.proLabore, inss: v.inss, liquido: v.liquido, pagamento: pagamentoNoEnvio },
      resumo: {
        mes,
        tipo: o.retificar ? "retificacao" : "mensal",
        cpf: config.cpf,
        proLabore: v.proLabore,
        inss: v.inss,
        liquido: v.liquido,
        pagamento: pagamentoNoEnvio,
        eventos: eventos.map((e) => CODIGO_DO_EVENTO[e.tipo]),
        semPagamentoDe,
      },
    },
  };
}

// O resumo do que iria agora, sem gravar nada (a confirmação da empresa da plataforma, assinada no servidor).
export async function previaEsocial(deps: DependenciasEsocial, acesso: AcessoEmpresa, mes: string, o: { retificar: boolean; semPagamentoAnterior?: boolean }): Promise<ResumoEsocial | null> {
  const r = await montar(deps, acesso, mes, o);
  return r.ok ? r.m.resumo : null;
}

// Grava o envio "preparado" e os eventos (com o marcador da assinatura ou já assinados no servidor). Preparos antigos do
// mês (outra aba, assinatura abandonada) deixam de valer.
async function gravarPreparo(deps: DependenciasEsocial, acesso: AcessoEmpresa, mes: string, m: Montagem, xmls: { xml: string; signedInfo: string | null }[], certificado: string, usuarioId?: string) {
  const porta = dadosDaEmpresa(deps.banco, acesso);
  const agora = relogio(deps);
  await porta.apagar(esocialEnvios, and(eq(esocialEnvios.mes, mes), eq(esocialEnvios.estado, "preparado"))!);
  const [envio] = await porta.inserir(esocialEnvios, {
    mes,
    tipo: m.resumo.tipo,
    estado: "preparado",
    loteAtual: 1,
    totalLotes: Math.max(...m.eventos.map((e) => e.lote)),
    cpf: m.resumo.cpf,
    valores: m.valores,
    transDctf: true, // todo S-1299 pede a transmissão da DCTFWeb (ver o começo do arquivo)
    certificado,
    criadoEm: agora,
    usuarioId: usuarioId ?? null,
  });
  const linhas = await Promise.all(
    m.eventos.map((e, i) =>
      porta.inserir(esocialEventos, {
        envioId: envio.id,
        mes,
        tipo: e.tipo,
        idEvento: e.id,
        lote: e.lote,
        cpf: e.tipo === "evtRemun" || e.tipo === "evtPgtos" ? m.resumo.cpf : null,
        indRetif: e.indRetif ?? null,
        ideDmDev: e.ideDmDev ?? null,
        xml: xmls[i].xml,
        signedInfo: xmls[i].signedInfo,
        estado: "preparado",
        valores:
          e.tipo === "evtRemun"
            ? { proLabore: m.valores.proLabore, inss: m.valores.inss, liquido: m.valores.liquido }
            : e.tipo === "evtPgtos" && m.valores.pagamento
              ? { liquido: m.valores.pagamento.liquido, dtPgto: m.valores.pagamento.dtPgto, perRef: m.valores.pagamento.perRef }
              : null,
        criadoEm: agora,
      }),
    ),
  );
  return { envio, eventos: linhas.map(([l]) => l) };
}

export type PreparoEsocial = { envioId: string; assinaturas: { idEvento: string; evento: string; signedInfo: string }[]; resumo: ResumoEsocial };

// Cliente (assina no navegador): monta os eventos do mês com o certificado que o navegador mandou (só a parte pública),
// confere que é o e-CNPJ A1 válido da própria empresa e devolve o texto a assinar de cada evento e o resumo.
export async function prepararEnvioEsocial(
  deps: DependenciasEsocial,
  acesso: AcessoEmpresa,
  mes: string,
  o: { certificado: string; retificar?: boolean; dtPgto?: string | null; semPagamentoAnterior?: boolean; usuarioId?: string },
): Promise<Resposta<PreparoEsocial>> {
  const r = await montar(deps, acesso, mes, { retificar: Boolean(o.retificar), dtPgto: o.dtPgto, semPagamentoAnterior: o.semPagamentoAnterior });
  if (!r.ok) return r;
  let pem: string;
  try {
    const info = lerCertificado(o.certificado);
    conferirAntesDeAssinar(info, await cnpjDaEmpresa(deps.banco, acesso), relogio(deps));
    pem = pemDoCertificado(o.certificado);
  } catch (erro) {
    return recusa(erro instanceof ErroCertificado ? erro.message : MENSAGENS_DO_ESOCIAL.certificadoDeOutraEmpresa);
  }
  const preparados = r.m.eventos.map((e) => prepararAssinaturaEsocialRemota(e.xml, pem));
  const { envio, eventos } = await gravarPreparo(deps, acesso, mes, r.m, preparados, o.certificado.replace(/\s/g, ""), o.usuarioId);
  return {
    ok: true,
    envioId: envio.id,
    assinaturas: eventos.map((e) => ({ idEvento: e.idEvento, evento: CODIGO_DO_EVENTO[e.tipo], signedInfo: e.signedInfo! })),
    resumo: r.m.resumo,
  };
}

// Confirmação do cliente: a caixa marcada e o pró-labore que ele viu no resumo, conferido com o do envio e o de agora.
type Confirmacao = { confirmado: boolean; confirmacao: { proLabore: number } };
const confirmacaoConfere = (valor: number, ...esperados: (number | null | undefined)[]) => esperados.every((e) => e !== null && e !== undefined && Math.abs(e - valor) < 0.005);

// Cliente: completa cada evento com o valor assinado no navegador, confere a assinatura e o esquema oficial e envia.
export async function enviarEsocialAssinado(
  deps: DependenciasEsocial,
  acesso: AcessoEmpresa,
  mes: string,
  o: Confirmacao & { envioId: string; assinaturas: { idEvento: string; valor: string }[]; usuarioId?: string },
): Promise<Resposta<{ estado: Envio["estado"] }>> {
  if (!o.confirmado) return recusa(MENSAGENS_DO_ESOCIAL.semConfirmacao);
  const agora = relogio(deps);
  const porta = dadosDaEmpresa(deps.banco, acesso);
  const [envio] = await porta.listar(esocialEnvios, and(eq(esocialEnvios.id, o.envioId), eq(esocialEnvios.mes, mes), eq(esocialEnvios.estado, "preparado")));
  if (!envio?.certificado || agora.getTime() - envio.criadoEm.getTime() > PREPARO_VALIDO_MINUTOS * 60_000) return recusa(MENSAGENS_DO_ESOCIAL.preparoVencido);
  const s = await situacaoEsocial(deps.banco, acesso, mes, agora);
  const motivo = envio.tipo === "retificacao" ? motivoParaNaoRetificar(s, agora) : motivoParaNaoEnviar(s, agora);
  if (motivo) return recusa(motivo);
  if (!confirmacaoConfere(o.confirmacao?.proLabore, envio.valores?.proLabore, s.proLabore)) return recusa(MENSAGENS_DO_ESOCIAL.confirmacaoMudou);
  if (!deps.cliente || !deps.transmissor) return recusa(MENSAGENS_DO_ESOCIAL.indisponivel);

  const certificadoPem = pemDoCertificado(envio.certificado);
  const eventos = await porta.listar(esocialEventos, eq(esocialEventos.envioId, envio.id));
  const assinados: { id: string; xml: string }[] = [];
  for (const e of eventos) {
    const valor = o.assinaturas?.find((a) => a.idEvento === e.idEvento)?.valor ?? "";
    let xml: string;
    try {
      xml = completarAssinaturaRemota(e.xml, valor);
    } catch {
      return recusa(MENSAGENS_DO_ESOCIAL.assinaturaInvalida);
    }
    if (!verificarAssinatura(xml, certificadoPem)) return recusa(MENSAGENS_DO_ESOCIAL.assinaturaInvalida);
    try {
      await validarAssinado(xml, e.tipo);
    } catch (erro) {
      log(deps, `[esocial] Evento ${e.tipo} de ${mes}, empresa ${acesso.empresaId}, fora do esquema: ${(erro as Error).message}`);
      return recusa(MENSAGENS_DO_ESOCIAL.eventoInvalido);
    }
    assinados.push({ id: e.id, xml });
  }
  return iniciarEnvio(deps, acesso, envio, assinados, o.usuarioId);
}

// Empresa da própria plataforma: monta, assina no servidor com o certificado do contrato (o e-CNPJ dela) e envia, com a
// mesma confirmação.
export async function enviarEsocialPelaPlataforma(
  deps: DependenciasEsocial,
  acesso: AcessoEmpresa,
  mes: string,
  o: Confirmacao & { retificar?: boolean; dtPgto?: string | null; semPagamentoAnterior?: boolean; usuarioId?: string },
): Promise<Resposta<{ estado: Envio["estado"] }>> {
  if (!o.confirmado) return recusa(MENSAGENS_DO_ESOCIAL.semConfirmacao);
  const pem = deps.propria ? (deps.certificadoDaPlataforma?.() ?? null) : null;
  if (!pem) return recusa(MENSAGENS_DO_ESOCIAL.indisponivel);
  const r = await montar(deps, acesso, mes, { retificar: Boolean(o.retificar), dtPgto: o.dtPgto, semPagamentoAnterior: o.semPagamentoAnterior });
  if (!r.ok) return r;
  if (!confirmacaoConfere(o.confirmacao?.proLabore, r.m.valores.proLabore)) return recusa(MENSAGENS_DO_ESOCIAL.confirmacaoMudou);
  const xmls: { xml: string; signedInfo: null }[] = [];
  for (const e of r.m.eventos) {
    try {
      xmls.push({ xml: await assinarEValidar(e.xml, e.tipo, pem), signedInfo: null });
    } catch (erro) {
      log(deps, `[esocial] Evento ${e.tipo} de ${mes}, empresa ${acesso.empresaId}, fora do esquema: ${(erro as Error).message}`);
      return recusa(MENSAGENS_DO_ESOCIAL.eventoInvalido);
    }
  }
  const { envio, eventos } = await gravarPreparo(deps, acesso, mes, r.m, xmls, pem.certificadoBase64, o.usuarioId);
  return iniciarEnvio(deps, acesso, envio, eventos.map((e) => ({ id: e.id, xml: e.xml })), o.usuarioId);
}

// Trava o envio (preparado → enviando: só uma aba passa) e grava os eventos assinados; o índice do S-1200 original barra
// um segundo original do mesmo sócio e mês.
async function iniciarEnvio(deps: DependenciasEsocial, acesso: AcessoEmpresa, envio: Envio, assinados: { id: string; xml: string }[], usuarioId?: string) {
  const porta = dadosDaEmpresa(deps.banco, acesso);
  const agora = relogio(deps);
  let travado: Envio | undefined;
  try {
    [travado] = await porta.alterar(esocialEnvios, { estado: "enviando", criadoEm: agora, usuarioId: usuarioId ?? envio.usuarioId }, and(eq(esocialEnvios.id, envio.id), eq(esocialEnvios.estado, "preparado"))!);
  } catch (erro) {
    if (codigoPostgres(erro) === "23505") return recusa(MENSAGENS_DO_ESOCIAL.emAndamento);
    throw erro;
  }
  if (!travado) return recusa(MENSAGENS_DO_ESOCIAL.emAndamento);
  // Conferido de novo depois de travar: uma transmissão da DCTFWeb por aqui que começou entre o preparo e agora (a
  // DCTFWeb confere o envio do eSocial também depois de travar a dela; pelo menos um dos dois vê o outro).
  if (await dctfTransmitindo(deps.banco, acesso, envio.mes)) {
    await porta.alterar(esocialEventos, { estado: "descartado" }, eq(esocialEventos.envioId, envio.id));
    await porta.alterar(esocialEnvios, { estado: "recusado", mensagem: MENSAGENS_DO_ESOCIAL.dctfTransmitindo, terminadoEm: agora }, eq(esocialEnvios.id, envio.id));
    return recusa(MENSAGENS_DO_ESOCIAL.dctfTransmitindo);
  }
  try {
    for (const a of assinados) await porta.alterar(esocialEventos, { estado: "assinado", xml: a.xml, signedInfo: null }, eq(esocialEventos.id, a.id));
  } catch (erro) {
    if (codigoPostgres(erro) !== "23505") throw erro;
    await porta.alterar(esocialEventos, { estado: "descartado" }, eq(esocialEventos.envioId, envio.id));
    await porta.alterar(esocialEnvios, { estado: "recusado", mensagem: MENSAGENS_DO_ESOCIAL.jaEnviado, terminadoEm: agora }, eq(esocialEnvios.id, envio.id));
    return recusa(MENSAGENS_DO_ESOCIAL.jaEnviado);
  }
  await porta.apagar(esocialEnvios, and(eq(esocialEnvios.mes, envio.mes), eq(esocialEnvios.estado, "preparado"))!);
  return enviarLoteAtual(deps, acesso, envio.id);
}

// Termina o envio com recusa: os eventos do lote recusado ficam recusados; os dos lotes seguintes, descartados.
async function recusar(deps: DependenciasEsocial, acesso: AcessoEmpresa, envio: Envio, ocorrencias: OcorrenciaEsocial[]) {
  const porta = dadosDaEmpresa(deps.banco, acesso);
  const agora = relogio(deps);
  await porta.alterar(esocialEventos, { estado: "descartado" }, and(eq(esocialEventos.envioId, envio.id), inArray(esocialEventos.estado, ["preparado", "assinado"]))!);
  await porta.alterar(esocialEnvios, { estado: "recusado", mensagem: MENSAGENS_DO_ESOCIAL.recusado, ocorrencias, protocolo: null, terminadoEm: agora }, eq(esocialEnvios.id, envio.id));
}

// Envia o lote atual do envio (quem chama já pôs o envio em "enviando"). Sem resposta: incerto (repetido depois com os
// mesmos eventos). Recusa do lote: recusado, com as ocorrências.
export async function enviarLoteAtual(deps: DependenciasEsocial, acesso: AcessoEmpresa, envioId: string): Promise<Resposta<{ estado: Envio["estado"] }>> {
  const porta = dadosDaEmpresa(deps.banco, acesso);
  const [envio] = await porta.listar(esocialEnvios, and(eq(esocialEnvios.id, envioId), eq(esocialEnvios.estado, "enviando")));
  if (!envio) return recusa(MENSAGENS_DO_ESOCIAL.emAndamento);
  if (!deps.cliente || !deps.transmissor) {
    await porta.alterar(esocialEnvios, { estado: "incerto", mensagem: MENSAGENS_DO_ESOCIAL.incerto }, eq(esocialEnvios.id, envio.id));
    return recusa(MENSAGENS_DO_ESOCIAL.indisponivel);
  }
  const eventos = (await porta.listar(esocialEventos, and(eq(esocialEventos.envioId, envio.id), eq(esocialEventos.lote, envio.loteAtual)))).sort((a, b) => a.idEvento.localeCompare(b.idEvento));
  const empregador = await cnpjDaEmpresa(deps.banco, acesso);
  let protocolo: string;
  try {
    protocolo = await enviarLote(deps.cliente, AMBIENTE, { empregador, transmissor: deps.transmissor }, GRUPO.periodico, eventos.map((e) => ({ id: e.idEvento, tipo: e.tipo, xml: e.xml })), envio.mes);
  } catch (erro) {
    log(deps, `[esocial] Envio do lote ${envio.loteAtual} de ${envio.mes}, empresa ${acesso.empresaId}: ${(erro as Error).message}`);
    if (erro instanceof ErroLoteRecusado) {
      await porta.alterar(esocialEventos, { estado: "recusado", cdResposta: erro.cdResposta }, and(eq(esocialEventos.envioId, envio.id), eq(esocialEventos.lote, envio.loteAtual))!);
      await recusar(deps, acesso, envio, erro.ocorrencias.map((o) => ({ evento: "lote", codigo: o.codigo, descricao: o.descricao })));
      return recusa(MENSAGENS_DO_ESOCIAL.recusado);
    }
    await porta.alterar(esocialEnvios, { estado: "incerto", mensagem: MENSAGENS_DO_ESOCIAL.incerto }, eq(esocialEnvios.id, envio.id));
    return recusa(MENSAGENS_DO_ESOCIAL.incerto);
  }
  const agora = relogio(deps);
  await porta.alterar(esocialEventos, { estado: "enviado" }, and(eq(esocialEventos.envioId, envio.id), eq(esocialEventos.lote, envio.loteAtual))!);
  await porta.alterar(
    esocialEnvios,
    { estado: "aguardando", protocolo, enviadoEm: agora, consultas: 0, mensagem: null, proximaConsultaEm: new Date(agora.getTime() + PRIMEIRA_CONSULTA_SEGUNDOS * 1000) },
    eq(esocialEnvios.id, envio.id),
  );
  return { ok: true, estado: "aguardando" };
}

// Consulta o resultado do lote atual (com o certificado da plataforma, o transmissor). Aceito o lote, manda o seguinte
// (o cliente já assinou e confirmou o envio inteiro) ou conclui. Duas consultas ao mesmo tempo: só uma processa (troca
// condicional do contador de consultas).
export async function acompanharEnvio(deps: DependenciasEsocial, acesso: AcessoEmpresa, envioId: string): Promise<Resposta<{ estado: Envio["estado"] }>> {
  const porta = dadosDaEmpresa(deps.banco, acesso);
  const [envio] = await porta.listar(esocialEnvios, eq(esocialEnvios.id, envioId));
  if (!envio) return recusa(MENSAGENS_DO_ESOCIAL.falhou);
  if (envio.estado !== "aguardando" || !envio.protocolo) return { ok: true, estado: envio.estado };
  if (!deps.cliente) return recusa(MENSAGENS_DO_ESOCIAL.indisponivel);
  const [meu] = await porta.alterar(
    esocialEnvios,
    { consultas: envio.consultas + 1 },
    and(eq(esocialEnvios.id, envio.id), eq(esocialEnvios.estado, "aguardando"), eq(esocialEnvios.consultas, envio.consultas))!,
  );
  if (!meu) return { ok: true, estado: "aguardando" };
  const agora = relogio(deps);
  const daqui = (segundos: number) => new Date(agora.getTime() + segundos * 1000);
  let r: Awaited<ReturnType<typeof consultarLote>>;
  try {
    r = await consultarLote(deps.cliente, AMBIENTE, envio.protocolo);
  } catch (erro) {
    log(deps, `[esocial] Consulta do lote ${envio.protocolo}, empresa ${acesso.empresaId}: ${(erro as Error).message}`);
    await porta.alterar(esocialEnvios, { proximaConsultaEm: daqui(60) }, eq(esocialEnvios.id, envio.id));
    return recusa(MENSAGENS_DO_ESOCIAL.falhou);
  }
  // Em processamento, ou erro passageiro do eSocial (5xx): consulta de novo depois.
  if (r.situacao === "aguardando" || (r.situacao === "erro" && r.cdResposta.startsWith("5"))) {
    if (r.situacao === "erro") log(deps, `[esocial] Lote ${envio.protocolo}: ${r.cdResposta} ${r.descricao}`);
    await porta.alterar(esocialEnvios, { proximaConsultaEm: daqui(Math.max(r.espera, CONSULTA_MINIMA_SEGUNDOS)) }, eq(esocialEnvios.id, envio.id));
    return { ok: true, estado: "aguardando" };
  }
  if (r.situacao === "erro") {
    log(deps, `[esocial] Lote ${envio.protocolo} não processado: ${r.cdResposta} ${r.descricao}`);
    await porta.alterar(esocialEventos, { estado: "recusado", cdResposta: r.cdResposta }, and(eq(esocialEventos.envioId, envio.id), eq(esocialEventos.lote, envio.loteAtual))!);
    await recusar(deps, acesso, envio, [{ evento: "lote", codigo: r.cdResposta, descricao: r.descricao }]);
    return { ok: true, estado: "recusado" };
  }

  const eventos = await porta.listar(esocialEventos, and(eq(esocialEventos.envioId, envio.id), eq(esocialEventos.lote, envio.loteAtual))!);
  const ocorrencias: OcorrenciaEsocial[] = [];
  let fechou = false;
  for (const e of eventos) {
    const resultado = r.eventos.find((x) => x.id === e.idEvento);
    const ok = resultado && aceito(resultado.cdResposta) && resultado.recibo;
    const dele = (resultado?.ocorrencias ?? []).map((o) => ({ evento: CODIGO_DO_EVENTO[e.tipo], codigo: o.codigo, descricao: o.descricao }));
    if (!ok) ocorrencias.push(...(dele.length ? dele : [{ evento: CODIGO_DO_EVENTO[e.tipo], codigo: resultado?.cdResposta ?? "", descricao: resultado?.descricao || "Sem resultado do eSocial para este evento." }]));
    if (ok && e.tipo === "evtFechaEvPer") fechou = true;
    await porta.alterar(
      esocialEventos,
      { estado: ok ? "aceito" : "recusado", cdResposta: resultado?.cdResposta ?? null, recibo: resultado?.recibo || null, ocorrencias: dele.length ? dele : null, processadoEm: agora },
      eq(esocialEventos.id, e.id),
    );
  }
  if (ocorrencias.length) {
    log(deps, `[esocial] Lote ${envio.protocolo} com evento recusado: ${ocorrencias.map((o) => `${o.evento} ${o.codigo} ${o.descricao}`).join(" | ")}`);
    await recusar(deps, acesso, envio, ocorrencias);
    return { ok: true, estado: "recusado" };
  }
  const extra = fechou ? { fechadoEm: agora } : {};
  if (envio.loteAtual < envio.totalLotes) {
    const [proximo] = await porta.alterar(
      esocialEnvios,
      { estado: "enviando", loteAtual: envio.loteAtual + 1, protocolo: null, criadoEm: agora, ...extra },
      and(eq(esocialEnvios.id, envio.id), eq(esocialEnvios.estado, "aguardando"), eq(esocialEnvios.loteAtual, envio.loteAtual))!,
    );
    if (!proximo) return { ok: true, estado: "aguardando" };
    return enviarLoteAtual(deps, acesso, envio.id);
  }
  await porta.alterar(esocialEnvios, { estado: "concluido", protocolo: null, terminadoEm: agora, mensagem: null, ...extra }, and(eq(esocialEnvios.id, envio.id), eq(esocialEnvios.estado, "aguardando"))!);
  return { ok: true, estado: "concluido" };
}

// Envios aguardando o eSocial cuja consulta já pode ser feita (a tela chama em segundo plano ao abrir).
export async function enviosParaConsultar(banco: Banco, acesso: AcessoEmpresa, agora: Date): Promise<Envio[]> {
  const aguardando = await dadosDaEmpresa(banco, acesso).listar(esocialEnvios, eq(esocialEnvios.estado, "aguardando"));
  return aguardando.filter((e) => !e.proximaConsultaEm || e.proximaConsultaEm <= agora);
}

// Envio sem resposta: manda de novo o MESMO lote (os mesmos eventos assinados, mesmos Ids). Se o eSocial já tinha
// recebido, ele devolve o recibo original (MOD §7.6.13); nada é duplicado.
export async function repetirEnvioEsocial(deps: DependenciasEsocial, acesso: AcessoEmpresa, mes: string, envioId: string): Promise<Resposta<{ estado: Envio["estado"] }>> {
  const agora = relogio(deps);
  await resolverParados(deps.banco, acesso, agora);
  const [travado] = await dadosDaEmpresa(deps.banco, acesso).alterar(
    esocialEnvios,
    { estado: "enviando", criadoEm: agora, mensagem: null },
    and(eq(esocialEnvios.id, envioId), eq(esocialEnvios.mes, mes), eq(esocialEnvios.estado, "incerto"))!,
  );
  if (!travado) return recusa(MENSAGENS_DO_ESOCIAL.emAndamento);
  return enviarLoteAtual(deps, acesso, envioId);
}

// "Lancei no portal do eSocial" (passo 21): o cliente fez por conta própria; o mês conta como feito (sem aviso de prazo).
export async function marcarFeitoNoPortal(deps: Pick<DependenciasEsocial, "banco" | "agora">, acesso: AcessoEmpresa, mes: string, o: { feito: boolean; usuarioId?: string }): Promise<Resposta> {
  const agora = relogio(deps);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes) || mes >= mesAtualNoBrasil(agora)) return recusa(MENSAGENS_DO_ESOCIAL.mesAberto);
  const porta = dadosDaEmpresa(deps.banco, acesso);
  await porta.apagar(esocialEnvios, and(eq(esocialEnvios.mes, mes), eq(esocialEnvios.tipo, "portal"))!);
  if (o.feito) await porta.inserir(esocialEnvios, { mes, tipo: "portal", estado: "concluido", criadoEm: agora, terminadoEm: agora, usuarioId: o.usuarioId ?? null });
  return { ok: true };
}

// O mês, para o aviso do prazo no sino: o último mês encerrado com pró-labore informado e ainda não feito, da empresa que
// usa o eSocial por aqui (com os cadastros ou algum envio); sem isso o contador pode estar enviando e o aviso seria falso
// (o cartão do painel mostra o prazo de qualquer forma).
export async function pendenciaDoMes(banco: Banco, acesso: AcessoEmpresa, agora: Date): Promise<{ mes: string; hoje: string; feito: boolean } | null> {
  const mes = somarMeses(mesAtualNoBrasil(agora), -1);
  const s = await situacaoEsocial(banco, acesso, mes, agora);
  if (!s.proLabore || s.proLabore <= 0 || (!s.config && !s.envio)) return null;
  return { mes, hoje: hojeNoBrasil(agora), feito: s.concluido };
}

// Valores de um S-1200 baixado do eSocial (as rubricas do cadastro): pró-labore, INSS e líquido.
export function valoresDoBaixado(itens: { codRubr: string; vrRubr: number }[], config: Pick<ConfigEsocial, "rubricaProLabore" | "rubricaInss">) {
  const somar = (rubrica: string) => centavos(itens.filter((i) => i.codRubr === rubrica).reduce((t, i) => t + i.vrRubr, 0));
  const proLabore = somar(config.rubricaProLabore);
  const inss = somar(config.rubricaInss);
  return { proLabore, inss, liquido: centavos(proLabore - inss) };
}
