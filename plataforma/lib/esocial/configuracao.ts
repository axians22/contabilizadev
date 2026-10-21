// Cadastros do eSocial da empresa (esocial_config): o que os eventos do pró-labore usam, sem nada fixo no código.
// Dois caminhos:
// - importar do eSocial: a plataforma procura os eventos do sócio que o contador já enviou num mês (identificadores) e
//   baixa (download), e tira dali a categoria, a matrícula, a lotação, as rubricas e o dia do pagamento. Os pedidos de
//   leitura são assinados pelo e-CNPJ da empresa (código 411 do MOD v1.16: só o próprio empregador, o representante legal
//   ou um procurador consultam) e transmitidos com o certificado da plataforma. Limites do eSocial (MOD §7.7.7): no
//   máximo 10 consultas de identificadores e downloads por dia e por empregador, nenhuma do dia 1 ao 7, uma de cada vez;
//   a importação gasta 2 (identificadores + download);
// - formulário: o cliente preenche, com a explicação de onde achar cada dado no tooltip.
import { eq, and, isNull } from "drizzle-orm";
import { assinarEsocial, completarAssinaturaRemota, prepararAssinaturaEsocialRemota, verificarAssinatura } from "@contabilizadev/nucleo/assinatura";
import { cadastroDosEventos, janelaDeRecepcao, lerIdentificadores, lerPagamentos, lerRemuneracao, lerRespostaDownload, pedidoDownload, pedidoIdsTrabalhador, type EventoBaixado } from "@contabilizadev/nucleo/esocial/leitura";
import { cpfValido, soDigitos } from "@contabilizadev/nucleo/formato";
import { somarMeses } from "@contabilizadev/nucleo/meses";
import { conferirAntesDeAssinar, ErroCertificado, lerCertificado, pemDoCertificado } from "@contabilizadev/nucleo/serpro/termo-autorizacao";
import { esocialConfig, esocialEventos, esocialPedidos } from "@/banco/esquema";
import { dadosDaEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { hojeNoBrasil, mesAtualNoBrasil } from "@/lib/historico/prazos";
import { cnpjDaEmpresa } from "@/lib/rotina/base";
import { codigoPostgres, log, recusa, relogio, type Resposta } from "@/lib/rotina/dependencias";
import { AMBIENTE, configDaEmpresa, valoresDoBaixado, type ConfigEsocial, type DependenciasEsocial } from "./envio";
import { MENSAGENS_DO_ESOCIAL, mensagemDaFalhaEsocial } from "./mensagens";

export const PEDIDO_VALIDO_MINUTOS = 30;
export const CONSULTAS_DA_IMPORTACAO = 2;

export type DadosDaConfig = {
  cpf: string;
  categoria: string;
  matricula: string;
  lotacao: string;
  tabRubrica: string;
  rubricaProLabore: string;
  rubricaInss: string;
  qtdProLabore: string | null;
  diaPagamento: number;
  pagamentoNoMes: "seguinte" | "mesmo";
};

export type CampoDaConfig = keyof DadosDaConfig;

// Confere o formulário (o mesmo formato dos campos do leiaute S-1.3); devolve os campos com problema.
export function errosDaConfig(d: DadosDaConfig): Partial<Record<CampoDaConfig, string>> {
  const erros: Partial<Record<CampoDaConfig, string>> = {};
  const codigo = /^[A-Za-z0-9_.\-]{1,30}$/;
  if (!cpfValido(soDigitos(d.cpf))) erros.cpf = "CPF inválido.";
  if (!/^\d{3}$/.test(d.categoria)) erros.categoria = "Três dígitos (ex.: 723).";
  if (!/^\S.{0,29}$/.test(d.matricula)) erros.matricula = "Até 30 caracteres.";
  if (!codigo.test(d.lotacao)) erros.lotacao = "Até 30 letras, números, ponto, hífen ou sublinhado.";
  if (!/^[A-Za-z0-9_.\-]{1,8}$/.test(d.tabRubrica)) erros.tabRubrica = "Até 8 caracteres.";
  if (!codigo.test(d.rubricaProLabore)) erros.rubricaProLabore = "Até 30 letras, números, ponto, hífen ou sublinhado.";
  if (!codigo.test(d.rubricaInss)) erros.rubricaInss = "Até 30 letras, números, ponto, hífen ou sublinhado.";
  if (!erros.rubricaInss && d.rubricaInss === d.rubricaProLabore) erros.rubricaInss = "Precisa ser diferente da rubrica do pró-labore.";
  if (d.qtdProLabore !== null && !/^\d{1,4}(\.\d{1,2})?$/.test(d.qtdProLabore)) erros.qtdProLabore = "Número com até duas casas (ex.: 220.00) ou vazio.";
  if (!Number.isInteger(d.diaPagamento) || d.diaPagamento < 1 || d.diaPagamento > 31) erros.diaPagamento = "Um dia de 1 a 31.";
  if (!["seguinte", "mesmo"].includes(d.pagamentoNoMes)) erros.pagamentoNoMes = "Escolha uma opção.";
  return erros;
}

// O "220,00" digitado vira "220.00"; vazio, null.
export const quantidadeDoFormulario = (v: string) => {
  const limpo = v.trim().replace(",", ".");
  if (!limpo) return null;
  return /^\d+$/.test(limpo) ? `${limpo}.00` : /^\d+\.\d$/.test(limpo) ? `${limpo}0` : limpo;
};

export async function salvarConfigEsocial(
  deps: Pick<DependenciasEsocial, "banco" | "agora">,
  acesso: AcessoEmpresa,
  d: DadosDaConfig,
  o: { usuarioId?: string; origem?: "formulario" | "importado"; importadoDe?: string | null } = {},
): Promise<Resposta | { ok: false; mensagem: string; erros: Partial<Record<CampoDaConfig, string>> }> {
  const dados = { ...d, cpf: soDigitos(d.cpf), categoria: d.categoria.trim(), matricula: d.matricula.trim(), lotacao: d.lotacao.trim(), tabRubrica: d.tabRubrica.trim(), rubricaProLabore: d.rubricaProLabore.trim(), rubricaInss: d.rubricaInss.trim() };
  const erros = errosDaConfig(dados);
  if (Object.keys(erros).length) return { ok: false, mensagem: MENSAGENS_DO_ESOCIAL.configInvalida, erros };
  const linha = { ...dados, origem: o.origem ?? ("formulario" as const), importadoDe: o.importadoDe ?? null, atualizadoEm: relogio(deps), atualizadoPorId: o.usuarioId ?? null };
  await dadosDaEmpresa(deps.banco, acesso).inserirOuAtualizar(esocialConfig, [linha], [esocialConfig.empresaId], [
    "cpf", "categoria", "matricula", "lotacao", "tabRubrica", "rubricaProLabore", "rubricaInss", "qtdProLabore", "diaPagamento", "pagamentoNoMes", "origem", "importadoDe", "atualizadoEm", "atualizadoPorId",
  ]);
  return { ok: true };
}

// O mês mais recente cujos eventos já deviam estar no eSocial (o prazo é o dia 15 do mês seguinte).
export function mesParaImportar(agora: Date): string {
  const hoje = hojeNoBrasil(agora);
  const atual = mesAtualNoBrasil(agora);
  return Number(hoje.slice(8)) >= 16 ? somarMeses(atual, -1) : somarMeses(atual, -2);
}

function motivoParaNaoConsultar(deps: DependenciasEsocial, agora: Date): string | null {
  if (!deps.cliente || !deps.transmissor) return MENSAGENS_DO_ESOCIAL.indisponivel;
  if (Number(hojeNoBrasil(agora).slice(8)) <= 7) return MENSAGENS_DO_ESOCIAL.diasUmASete;
  return null;
}

async function conferirCertificado(deps: DependenciasEsocial, acesso: AcessoEmpresa, certificado: string): Promise<{ pem: string } | { mensagem: string }> {
  try {
    conferirAntesDeAssinar(lerCertificado(certificado), await cnpjDaEmpresa(deps.banco, acesso), relogio(deps));
    return { pem: pemDoCertificado(certificado) };
  } catch (erro) {
    return { mensagem: erro instanceof ErroCertificado ? erro.message : MENSAGENS_DO_ESOCIAL.certificadoDeOutraEmpresa };
  }
}

export type PedidoParaAssinar = { pedidoId: string; signedInfo: string };

// 1) Prepara a consulta dos eventos do sócio recebidos no mês seguinte a `mes` (o cliente assina no navegador).
export async function prepararImportacao(
  deps: DependenciasEsocial,
  acesso: AcessoEmpresa,
  o: { cpf: string; mes: string; certificado: string },
): Promise<Resposta<PedidoParaAssinar>> {
  const agora = relogio(deps);
  const cpf = soDigitos(o.cpf);
  const motivo = motivoParaNaoConsultar(deps, agora);
  if (motivo) return recusa(motivo);
  if (!cpfValido(cpf)) return recusa(MENSAGENS_DO_ESOCIAL.cpfInvalido);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(o.mes) || o.mes > mesParaImportar(agora)) return recusa(MENSAGENS_DO_ESOCIAL.nadaAchado);
  if ((await deps.cliente!.consultasRestantes(AMBIENTE)) < CONSULTAS_DA_IMPORTACAO) return recusa(MENSAGENS_DO_ESOCIAL.limiteDoDia);
  const certificado = await conferirCertificado(deps, acesso, o.certificado);
  if ("mensagem" in certificado) return recusa(certificado.mensagem);
  const janela = janelaDeRecepcao(o.mes, agora);
  const xml = pedidoIdsTrabalhador({ cnpj: await cnpjDaEmpresa(deps.banco, acesso) }, cpf, janela.inicio, janela.fim);
  const preparado = prepararAssinaturaEsocialRemota(xml, certificado.pem);
  const [pedido] = await dadosDaEmpresa(deps.banco, acesso).inserir(esocialPedidos, {
    tipo: "identificadores",
    mes: o.mes,
    cpf,
    xml: preparado.xml,
    certificado: o.certificado.replace(/\s/g, ""),
    criadoEm: agora,
  });
  return { ok: true, pedidoId: pedido.id, signedInfo: preparado.signedInfo };
}

// Pega o pedido (uma vez só: a troca condicional de usado_em barra a segunda aba), completa e confere a assinatura.
async function pedidoAssinado(deps: DependenciasEsocial, acesso: AcessoEmpresa, pedidoId: string, tipo: "identificadores" | "download", assinatura: string): Promise<Resposta<{ xml: string; mes: string; cpf: string; certificado: string }>> {
  const agora = relogio(deps);
  const porta = dadosDaEmpresa(deps.banco, acesso);
  const [pedido] = await porta.listar(esocialPedidos, and(eq(esocialPedidos.id, pedidoId), eq(esocialPedidos.tipo, tipo), isNull(esocialPedidos.usadoEm)));
  if (!pedido || agora.getTime() - pedido.criadoEm.getTime() > PEDIDO_VALIDO_MINUTOS * 60_000) return recusa(MENSAGENS_DO_ESOCIAL.pedidoVencido);
  let xml: string;
  try {
    xml = completarAssinaturaRemota(pedido.xml, assinatura);
  } catch {
    return recusa(MENSAGENS_DO_ESOCIAL.assinaturaInvalida);
  }
  if (!verificarAssinatura(xml, pemDoCertificado(pedido.certificado))) return recusa(MENSAGENS_DO_ESOCIAL.assinaturaInvalida);
  const [usado] = await porta.alterar(esocialPedidos, { usadoEm: agora }, and(eq(esocialPedidos.id, pedido.id), isNull(esocialPedidos.usadoEm))!);
  if (!usado) return recusa(MENSAGENS_DO_ESOCIAL.pedidoVencido);
  return { ok: true, xml, mes: pedido.mes, cpf: pedido.cpf, certificado: pedido.certificado };
}

// 2) Manda a consulta assinada. Achou eventos: prepara o download deles (o cliente assina de novo, na mesma ação da tela).
export async function importarIdentificadores(
  deps: DependenciasEsocial,
  acesso: AcessoEmpresa,
  o: { pedidoId: string; assinatura: string },
): Promise<Resposta<{ achados: number; download: PedidoParaAssinar | null }>> {
  const agora = relogio(deps);
  const motivo = motivoParaNaoConsultar(deps, agora);
  if (motivo) return recusa(motivo);
  const p = await pedidoAssinado(deps, acesso, o.pedidoId, "identificadores", o.assinatura);
  if (!p.ok) return p;
  let ids: string[];
  try {
    ids = lerIdentificadores(await deps.cliente!.chamar("identificadoresTrabalhador", AMBIENTE, p.xml, `Listar eventos do sócio de ${p.mes} no eSocial (importar os cadastros)`)).map((i) => i.id);
  } catch (erro) {
    log(deps, `[esocial] Identificadores do sócio, empresa ${acesso.empresaId}: ${(erro as Error).message}`);
    return recusa(mensagemDaFalhaEsocial(erro));
  }
  if (ids.length === 0) return { ok: true, achados: 0, download: null };
  const xml = pedidoDownload({ cnpj: await cnpjDaEmpresa(deps.banco, acesso) }, ids.slice(0, 50));
  const preparado = prepararAssinaturaEsocialRemota(xml, pemDoCertificado(p.certificado));
  const [pedido] = await dadosDaEmpresa(deps.banco, acesso).inserir(esocialPedidos, { tipo: "download", mes: p.mes, cpf: p.cpf, xml: preparado.xml, certificado: p.certificado, criadoEm: agora });
  return { ok: true, achados: ids.length, download: { pedidoId: pedido.id, signedInfo: preparado.signedInfo } };
}

export type Importacao = { config: ConfigEsocial | null; baixados: number; mensagem: string | null };

// 3) Manda o download assinado, guarda os S-1200 e S-1210 baixados e tira deles os cadastros.
export async function importarEventos(
  deps: DependenciasEsocial,
  acesso: AcessoEmpresa,
  o: { pedidoId: string; assinatura: string; usuarioId?: string },
): Promise<Resposta<Importacao>> {
  const motivo = motivoParaNaoConsultar(deps, relogio(deps));
  if (motivo) return recusa(motivo);
  const p = await pedidoAssinado(deps, acesso, o.pedidoId, "download", o.assinatura);
  if (!p.ok) return p;
  let baixados: EventoBaixado[];
  try {
    baixados = lerRespostaDownload(await deps.cliente!.chamar("downloadPorId", AMBIENTE, p.xml, `Baixar os eventos do sócio de ${p.mes} do eSocial (importar os cadastros)`));
  } catch (erro) {
    log(deps, `[esocial] Download dos eventos do sócio, empresa ${acesso.empresaId}: ${(erro as Error).message}`);
    return recusa(mensagemDaFalhaEsocial(erro));
  }
  return guardarBaixados(deps, acesso, baixados, p.mes, p.cpf, o.usuarioId);
}

// Empresa da própria plataforma: as duas consultas assinadas no servidor, numa chamada.
export async function importarPelaPlataforma(deps: DependenciasEsocial, acesso: AcessoEmpresa, o: { cpf: string; mes: string; usuarioId?: string }): Promise<Resposta<Importacao>> {
  const agora = relogio(deps);
  const cpf = soDigitos(o.cpf);
  if (!cpfValido(cpf)) return recusa(MENSAGENS_DO_ESOCIAL.cpfInvalido);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(o.mes) || o.mes > mesParaImportar(agora)) return recusa(MENSAGENS_DO_ESOCIAL.nadaAchado);
  const pem = deps.propria ? (deps.certificadoDaPlataforma?.() ?? null) : null;
  const motivo = pem ? motivoParaNaoConsultar(deps, agora) : MENSAGENS_DO_ESOCIAL.indisponivel;
  if (motivo) return recusa(motivo);
  if ((await deps.cliente!.consultasRestantes(AMBIENTE)) < CONSULTAS_DA_IMPORTACAO) return recusa(MENSAGENS_DO_ESOCIAL.limiteDoDia);
  const empregador = { cnpj: await cnpjDaEmpresa(deps.banco, acesso) };
  const janela = janelaDeRecepcao(o.mes, agora);
  let baixados: EventoBaixado[];
  try {
    const ids = lerIdentificadores(
      await deps.cliente!.chamar("identificadoresTrabalhador", AMBIENTE, assinarEsocial(pedidoIdsTrabalhador(empregador, cpf, janela.inicio, janela.fim), pem!), `Listar eventos do sócio de ${o.mes} no eSocial (importar os cadastros)`),
    ).map((i) => i.id);
    if (ids.length === 0) return { ok: true, config: await configDaEmpresa(deps.banco, acesso), baixados: 0, mensagem: MENSAGENS_DO_ESOCIAL.nadaAchado };
    baixados = lerRespostaDownload(await deps.cliente!.chamar("downloadPorId", AMBIENTE, assinarEsocial(pedidoDownload(empregador, ids.slice(0, 50)), pem!), `Baixar os eventos do sócio de ${o.mes} do eSocial (importar os cadastros)`));
  } catch (erro) {
    log(deps, `[esocial] Importação dos cadastros, empresa ${acesso.empresaId}: ${(erro as Error).message}`);
    return recusa(mensagemDaFalhaEsocial(erro));
  }
  return guardarBaixados(deps, acesso, baixados, o.mes, cpf, o.usuarioId);
}

async function guardarBaixados(deps: DependenciasEsocial, acesso: AcessoEmpresa, baixados: EventoBaixado[], mes: string, cpf: string, usuarioId?: string): Promise<Resposta<Importacao>> {
  const agora = relogio(deps);
  const porta = dadosDaEmpresa(deps.banco, acesso);
  const remuneracoes = baixados.map((b) => ({ b, r: lerRemuneracao(b.xml) })).filter((x) => x.r && soDigitos(x.r.cpf) === cpf);
  const pagamentos = baixados.flatMap((b) => lerPagamentos(b.xml).map((p) => ({ b, p }))).filter((x) => soDigitos(x.p.cpf) === cpf);
  // O S-1200 do mês pedido (o último, se houve retificação) dá os cadastros.
  const doMes = remuneracoes.filter((x) => x.r!.perApur === mes).at(-1) ?? remuneracoes.at(-1);
  const cadastro = doMes ? cadastroDosEventos(doMes.r!, pagamentos.map((x) => x.p)) : null;
  let config = await configDaEmpresa(deps.banco, acesso);
  let mensagem: string | null = null;
  if (cadastro) {
    const salvo = await salvarConfigEsocial(
      deps,
      acesso,
      { ...cadastro, diaPagamento: cadastro.diaPagamento ?? config?.diaPagamento ?? 5, pagamentoNoMes: cadastro.pagamentoNoMes ?? config?.pagamentoNoMes ?? "seguinte" },
      { usuarioId, origem: "importado", importadoDe: doMes!.r!.perApur },
    );
    if (salvo.ok) config = await configDaEmpresa(deps.banco, acesso);
    else mensagem = MENSAGENS_DO_ESOCIAL.semCadastroNosEventos;
  } else {
    mensagem = doMes ? MENSAGENS_DO_ESOCIAL.semCadastroNosEventos : MENSAGENS_DO_ESOCIAL.nadaAchado;
  }
  // Guarda os eventos baixados (o S-1200 de um mês dá o demonstrativo que o S-1210 do mês seguinte paga). O mesmo evento
  // baixado de novo não duplica (Id único por empresa).
  let guardados = 0;
  for (const { b, r } of remuneracoes) {
    guardados += await guardar(porta, { mes: r!.perApur, tipo: "evtRemun", idEvento: b.id, cpf, indRetif: r!.indRetif, ideDmDev: r!.ideDmDev, xml: b.xml, recibo: b.recibo, valores: config ? valoresDoBaixado(r!.itens, config) : null, criadoEm: agora, processadoEm: agora });
  }
  for (const { b, p } of pagamentos) {
    guardados += await guardar(porta, { mes: p.perApur, tipo: "evtPgtos", idEvento: b.id, cpf, indRetif: 1, ideDmDev: p.ideDmDev, xml: b.xml, recibo: b.recibo, valores: { liquido: p.vrLiq, dtPgto: p.dtPgto, perRef: p.perRef }, criadoEm: agora, processadoEm: agora });
  }
  return { ok: true, config, baixados: guardados, mensagem };
}

async function guardar(porta: ReturnType<typeof dadosDaEmpresa>, linha: Omit<typeof esocialEventos.$inferInsert, "empresaId" | "estado">): Promise<number> {
  try {
    await porta.inserir(esocialEventos, { ...linha, estado: "importado" });
    return 1;
  } catch (erro) {
    if (codigoPostgres(erro) === "23505") return 0; // já guardado (ou o S-1200 original do mês já está aqui)
    throw erro;
  }
}
