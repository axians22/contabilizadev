// DCTFWeb do mês pela plataforma (Parte 6, passo 18): conferir a declaração que a Receita montou a partir do eSocial,
// assinar e transmitir com a confirmação do cliente. O DARF fica em guias.ts.
// "O certificado usado na assinatura deve ser o do autor do pedido de dados" (Integra DCTFWeb): para a empresa da
// própria plataforma (autora dos próprios pedidos), o servidor assina com o certificado do contrato; para um cliente
// (autor = a empresa, pelo termo de autorização), assina o e-CNPJ A1 da empresa, no navegador: o servidor prepara a
// assinatura (prepararTransmissaoDctf) e o navegador devolve só o valor assinado. A chave nunca sai do computador dele.
// Idempotência: uma transmissão viva por mês (índice único); sem resposta da Receita fica incerta, e só uma nova
// conferência (que mostra o recibo, se chegou) libera ou confirma.
// eSocial (Parte 7): todo fechamento do mês (S-1299) enviado pela plataforma pede a transmissão imediata da DCTFWeb
// (transDCTFWeb = S), com a mesma assinatura do cliente nos eventos (ver lib/esocial/envio.ts). Fonte: Manual de
// Orientação da DCTFWeb (Receita Federal, atualização de janeiro/2025, manual-dctfweb-atualizacao-janeiro2025_versao_final.pdf
// em gov.br/receitafederal), §14.5 (p. 83): o novo fechamento com transmissão imediata gera e transmite a declaração (a
// retificadora, se a anterior já foi transmitida), mas NÃO transmite se houver débito com exigibilidade suspensa; §17.1.1
// (p. 99): a retificadora "Em andamento" deve ser transmitida mesmo sem mudança de valores. A transmissão daqui fica
// bloqueada (não transmitir duas vezes) enquanto o envio do eSocial do mês está a caminho (preparado, enviando,
// aguardando o resultado ou sem resposta) e depois do fechamento aceito: a conferência mostra a declaração transmitida e
// o DARF sai normalmente. Só se uma conferência feita ESPERA_DCTF_PELO_ESOCIAL_MINUTOS depois do fechamento ainda mostrar
// a declaração em andamento (a transmissão automática não aconteceu, como no caso da exigibilidade suspensa do §14.5), a
// transmissão daqui volta a ser liberada (para não deixar de transmitir). Cada fechamento ou reabertura aceitos gera uma declaração nova (a retificadora, se a anterior
// já tinha sido transmitida): o que foi conferido ou transmitido antes dele é da declaração anterior e não conta.
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { assinarXml, completarAssinaturaRemota, verificarAssinatura } from "@contabilizadev/nucleo/assinatura";
import { inssProLaboreDoMes } from "@contabilizadev/nucleo/simples";
import type { Contexto } from "@contabilizadev/nucleo/serpro/cliente";
import { bloqueioTransmissaoDctf, conferir, ELEMENTO_ASSINADO_DCTF, prepararAssinaturaDctf, transmitirDctfAssinada } from "@contabilizadev/nucleo/serpro/dctfweb";
import { conferirAntesDeAssinar, ErroCertificado, lerCertificado, pemDoCertificado } from "@contabilizadev/nucleo/serpro/termo-autorizacao";
import type { Banco } from "@/banco";
import { dctfwebEnvios } from "@/banco/esquema";
import { dadosDaEmpresa, daEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { mesAtualNoBrasil } from "@/lib/historico/prazos";
import { ErroTermoAutorizacao } from "@/lib/termo/termo";
import { esocialDaDctf } from "@/lib/esocial/envio";
import { cnpjDaEmpresa, historicoDeValores } from "./base";
import { codigoPostgres, recusa, log, relogio, type DependenciasRotina, type Resposta } from "./dependencias";
import { MENSAGENS_DA_ROTINA, mensagemDaFalha } from "./mensagens";
import { ENVIO_PARADO_MINUTOS } from "./pgdasd";

export type EnvioDctf = typeof dctfwebEnvios.$inferSelect;
// A assinatura preparada vale por pouco tempo (o cliente assina logo em seguida).
export const PREPARO_VALIDO_MINUTOS = 30;
export const ESPERA_DCTF_PELO_ESOCIAL_MINUTOS = 60;

export type SituacaoDctf = {
  conferencia: EnvioDctf | null; // a última conferência que deu certo
  ultimaFalha: EnvioDctf | null; // a última tentativa (conferência ou transmissão) que falhou, se for a mais recente
  transmissao: EnvioDctf | null; // a transmissão viva (enviando, ok ou incerta)
  transmitida: boolean;
  recibo: string | null;
  inssEsperado: number | null; // 11% do pró-labore informado no mês, até o teto do INSS do ano
  peloEsocial: Date | null; // quando o eSocial aceitou o fechamento do mês que pediu a transmissão da DCTFWeb
  esocialEmCurso: boolean; // um envio do eSocial do mês com o pedido de transmissão está a caminho
};

async function contextoDa(deps: DependenciasRotina, acesso: AcessoEmpresa): Promise<Contexto | { mensagem: string }> {
  if (!deps.cliente) return { mensagem: MENSAGENS_DA_ROTINA.indisponivel };
  try {
    return await deps.contexto();
  } catch (erro) {
    if (erro instanceof ErroTermoAutorizacao) return { mensagem: erro.message };
    log(deps, `[serpro] DCTFWeb sem contexto da empresa ${acesso.empresaId}: ${(erro as Error).message}`);
    return { mensagem: MENSAGENS_DA_ROTINA.falhou };
  }
}

// O INSS esperado: 11% do pró-labore informado para o mês, limitado ao teto do salário de contribuição do ano (como o
// eSocial calcula); null sem pró-labore informado.
async function inssDoMes(banco: Banco, acesso: AcessoEmpresa, pa: string): Promise<number | null> {
  const valor = (await historicoDeValores(banco, acesso)).prolabores.get(pa);
  return valor === undefined ? null : inssProLaboreDoMes(pa, valor);
}

// Resolve a transmissão sem desfecho: "enviando" parada vira incerta; incerta é decidida pela conferência feita depois
// dela (transmitida = chegou; em andamento = não chegou, liberada).
async function resolverIncertas(banco: Banco, acesso: AcessoEmpresa, pa: string, agora: Date) {
  const porta = dadosDaEmpresa(banco, acesso);
  const limite = new Date(agora.getTime() - ENVIO_PARADO_MINUTOS * 60_000);
  await porta.alterar(
    dctfwebEnvios,
    { estado: "incerto", mensagem: MENSAGENS_DA_ROTINA.incerta, terminadoEm: agora },
    and(eq(dctfwebEnvios.pa, pa), eq(dctfwebEnvios.etapa, "transmissao"), eq(dctfwebEnvios.estado, "enviando"), lt(dctfwebEnvios.criadoEm, limite))!,
  );
  const [incerta] = await porta.listar(dctfwebEnvios, and(eq(dctfwebEnvios.pa, pa), eq(dctfwebEnvios.etapa, "transmissao"), eq(dctfwebEnvios.estado, "incerto")));
  if (!incerta) return;
  const [depois] = (await porta.listar(dctfwebEnvios, and(eq(dctfwebEnvios.pa, pa), eq(dctfwebEnvios.etapa, "conferencia"), eq(dctfwebEnvios.estado, "ok"))))
    .filter((c) => c.criadoEm > incerta.criadoEm)
    .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime());
  if (!depois) return;
  await porta.alterar(
    dctfwebEnvios,
    depois.situacao === "transmitida"
      ? { estado: "ok", recibo: depois.recibo, mensagem: null }
      : { estado: "erro", mensagem: "A Receita Federal não recebeu esta transmissão. Pode transmitir de novo." },
    eq(dctfwebEnvios.id, incerta.id),
  );
}

export async function situacaoDctf(banco: Banco, acesso: AcessoEmpresa, pa: string, agora: Date): Promise<SituacaoDctf> {
  await resolverIncertas(banco, acesso, pa, agora);
  const esocial = await esocialDaDctf(banco, acesso, pa, agora);
  const todas = await banco.select().from(dctfwebEnvios).where(daEmpresa(acesso, dctfwebEnvios, eq(dctfwebEnvios.pa, pa))).orderBy(desc(dctfwebEnvios.criadoEm));
  // Da declaração anterior ao último fechamento/reabertura não conta (a transmissão ainda viva conta sempre).
  const desde = esocial.desde;
  const linhas = desde ? todas.filter((l) => l.criadoEm >= desde || ["enviando", "incerto"].includes(l.estado)) : todas;
  const conferencia = linhas.find((l) => l.etapa === "conferencia" && l.estado === "ok") ?? null;
  const transmissao = linhas.find((l) => l.etapa === "transmissao" && ["enviando", "ok", "incerto"].includes(l.estado)) ?? null;
  const ultima = linhas.find((l) => l.estado !== "preparada") ?? null;
  const transmitida = transmissao?.estado === "ok" || conferencia?.situacao === "transmitida";
  return {
    conferencia,
    ultimaFalha: ultima?.estado === "erro" ? ultima : null,
    transmissao,
    transmitida,
    recibo: transmissao?.estado === "ok" ? transmissao.recibo : conferencia?.situacao === "transmitida" ? conferencia.recibo : null,
    inssEsperado: await inssDoMes(banco, acesso, pa),
    peloEsocial: esocial.peloEsocial,
    esocialEmCurso: esocial.emCurso,
  };
}

// A transmissão pedida no fechamento do eSocial ainda pode estar acontecendo: até uma conferência feita bem depois do
// fechamento mostrar a declaração em andamento.
export function esperandoOEsocial(s: Pick<SituacaoDctf, "peloEsocial" | "conferencia" | "transmitida" | "esocialEmCurso">): boolean {
  if (s.esocialEmCurso) return true;
  if (!s.peloEsocial || s.transmitida) return false;
  const limite = s.peloEsocial.getTime() + ESPERA_DCTF_PELO_ESOCIAL_MINUTOS * 60_000;
  return !(s.conferencia && s.conferencia.criadoEm.getTime() >= limite && s.conferencia.situacao === "em andamento");
}

// Conferir a declaração do mês (consulta). Banco primeiro: transmitida (pela plataforma ou já vista transmitida numa
// conferência) não é consultada de novo.
export async function conferirDctfMes(deps: DependenciasRotina, acesso: AcessoEmpresa, pa: string, opcoes: { usuarioId?: string } = {}): Promise<Resposta<{ situacao: SituacaoDctf }>> {
  const { banco } = deps;
  const agora = relogio(deps);
  if (pa >= mesAtualNoBrasil(agora)) return recusa(MENSAGENS_DA_ROTINA.mesAberto);
  const antes = await situacaoDctf(banco, acesso, pa, agora);
  if (antes.transmitida && antes.transmissao?.estado !== "incerto") return { ok: true, situacao: antes };
  const ctx = await contextoDa(deps, acesso);
  if ("mensagem" in ctx) return recusa(ctx.mensagem);
  const r = await conferir(deps.cliente!, ctx, { pa, mesAtual: mesAtualNoBrasil(agora) });
  if (!r.ok) log(deps, `[serpro] Conferência da DCTFWeb de ${pa}, empresa ${acesso.empresaId}: ${r.detalhe}`);
  await dadosDaEmpresa(banco, acesso).inserir(dctfwebEnvios, {
    pa,
    etapa: "conferencia",
    estado: r.ok ? "ok" : "erro",
    situacao: r.ok ? r.situacao : null,
    aPagar: r.ok ? r.aPagar : null,
    recibo: r.ok ? r.recibo : null,
    xml: r.ok ? r.xml : null,
    mensagem: r.ok ? null : mensagemDaFalha(r.detalhe),
    criadoEm: agora,
    terminadoEm: relogio(deps),
    usuarioId: opcoes.usuarioId ?? null,
  });
  if (!r.ok) return recusa(mensagemDaFalha(r.detalhe));
  return { ok: true, situacao: await situacaoDctf(banco, acesso, pa, relogio(deps)) };
}

// Por que não dá para transmitir (só banco), ou null.
export function motivoParaNaoTransmitirDctf(s: SituacaoDctf): string | null {
  if (s.transmissao?.estado === "incerto") return MENSAGENS_DA_ROTINA.incerta;
  if (s.transmissao?.estado === "enviando") return MENSAGENS_DA_ROTINA.transmitindo;
  if (s.esocialEmCurso) return MENSAGENS_DA_ROTINA.dctfPeloEsocial;
  if (s.transmitida) return MENSAGENS_DA_ROTINA.dctfRetificar;
  if (esperandoOEsocial(s)) return MENSAGENS_DA_ROTINA.dctfPeloEsocial;
  if (!s.conferencia?.xml) return MENSAGENS_DA_ROTINA.dctfConfiraAntes;
  if (s.inssEsperado === null) return MENSAGENS_DA_ROTINA.dctfSemProLabore;
  const bloqueio = bloqueioTransmissaoDctf({ situacao: s.conferencia.situacao ?? "em andamento", aPagar: s.conferencia.aPagar ?? 0, xml: s.conferencia.xml }, s.inssEsperado);
  if (bloqueio) return /não bate/.test(bloqueio) ? MENSAGENS_DA_ROTINA.dctfValorDiferente : MENSAGENS_DA_ROTINA.dctfConfiraAntes;
  return null;
}

// Cliente (assina no navegador): prepara a assinatura com o certificado que o navegador mandou (só a parte pública) e
// devolve o texto a assinar. Confere de novo que é o e-CNPJ A1 válido da própria empresa.
export async function prepararTransmissaoDctf(
  deps: DependenciasRotina,
  acesso: AcessoEmpresa,
  pa: string,
  opcoes: { certificado: string; usuarioId?: string },
): Promise<Resposta<{ preparoId: string; signedInfo: string; aPagar: number }>> {
  const { banco } = deps;
  const agora = relogio(deps);
  const s = await situacaoDctf(banco, acesso, pa, agora);
  const motivo = motivoParaNaoTransmitirDctf(s);
  if (motivo) return recusa(motivo);
  const cnpj = await cnpjDaEmpresa(banco, acesso);
  let pem: string;
  try {
    const info = lerCertificado(opcoes.certificado);
    conferirAntesDeAssinar(info, cnpj, agora);
    pem = pemDoCertificado(opcoes.certificado);
  } catch (erro) {
    return recusa(erro instanceof ErroCertificado ? erro.message : MENSAGENS_DA_ROTINA.certificadoDeOutraEmpresa);
  }
  const preparada = prepararAssinaturaDctf(s.conferencia!.xml!, pem);
  const [linha] = await dadosDaEmpresa(banco, acesso).inserir(dctfwebEnvios, {
    pa,
    etapa: "transmissao",
    estado: "preparada",
    situacao: "em andamento",
    aPagar: s.conferencia!.aPagar,
    xml: preparada.xml,
    signedInfo: preparada.signedInfo,
    certificado: opcoes.certificado.replace(/\s/g, ""),
    criadoEm: agora,
    usuarioId: opcoes.usuarioId ?? null,
  });
  return { ok: true, preparoId: linha.id, signedInfo: preparada.signedInfo, aPagar: s.conferencia!.aPagar ?? 0 };
}

// Transmite com a confirmação do cliente sobre o valor a pagar que ele viu. Cliente: com o preparo e o valor assinado no
// navegador. Empresa da plataforma: assinada aqui com o certificado do contrato.
export async function transmitirDctfMes(
  deps: DependenciasRotina,
  acesso: AcessoEmpresa,
  pa: string,
  opcoes: { confirmado: boolean; confirmacao: { aPagar: number }; preparoId?: string; assinatura?: string; usuarioId?: string },
): Promise<Resposta<{ recibo: string }>> {
  const { banco } = deps;
  if (!opcoes.confirmado) return recusa(MENSAGENS_DA_ROTINA.semConfirmacao);
  const agora = relogio(deps);
  const s = await situacaoDctf(banco, acesso, pa, agora);
  const motivo = motivoParaNaoTransmitirDctf(s);
  if (motivo) return recusa(motivo);
  if (Math.abs((s.conferencia!.aPagar ?? 0) - opcoes.confirmacao.aPagar) >= 0.005) return recusa(MENSAGENS_DA_ROTINA.confirmacaoMudou);
  const ctx = await contextoDa(deps, acesso);
  if ("mensagem" in ctx) return recusa(ctx.mensagem);
  const porta = dadosDaEmpresa(banco, acesso);
  const propria = !ctx.autorPedidoDados;

  let xmlAssinado: string;
  let certificadoPem: string;
  let envioId: string;
  try {
    if (propria) {
      const pem = deps.certificadoDaPlataforma?.() ?? null;
      if (!pem) return recusa(MENSAGENS_DA_ROTINA.indisponivel);
      xmlAssinado = assinarXml(s.conferencia!.xml!, ELEMENTO_ASSINADO_DCTF, pem, "after");
      certificadoPem = pem.certificado;
      [{ id: envioId }] = await porta.inserir(dctfwebEnvios, {
        pa, etapa: "transmissao", estado: "enviando", situacao: "em andamento", aPagar: s.conferencia!.aPagar, criadoEm: agora, usuarioId: opcoes.usuarioId ?? null,
      });
    } else {
      const [preparo] = opcoes.preparoId
        ? await porta.listar(dctfwebEnvios, and(eq(dctfwebEnvios.id, opcoes.preparoId), eq(dctfwebEnvios.pa, pa), eq(dctfwebEnvios.estado, "preparada")))
        : [];
      if (!preparo?.xml || !preparo.certificado || agora.getTime() - preparo.criadoEm.getTime() > PREPARO_VALIDO_MINUTOS * 60_000) return recusa(MENSAGENS_DA_ROTINA.preparoVencido);
      certificadoPem = pemDoCertificado(preparo.certificado);
      try {
        xmlAssinado = completarAssinaturaRemota(preparo.xml, opcoes.assinatura ?? "");
      } catch {
        return recusa(MENSAGENS_DA_ROTINA.assinaturaInvalida);
      }
      if (!verificarAssinatura(xmlAssinado, certificadoPem)) return recusa(MENSAGENS_DA_ROTINA.assinaturaInvalida);
      // O preparo vira a transmissão viva (o índice único barra a segunda aba).
      const [travada] = await porta.alterar(dctfwebEnvios, { estado: "enviando", xml: xmlAssinado, criadoEm: agora }, and(eq(dctfwebEnvios.id, preparo.id), eq(dctfwebEnvios.estado, "preparada"))!);
      if (!travada) return recusa(MENSAGENS_DA_ROTINA.transmitindo);
      envioId = travada.id;
    }
  } catch (erro) {
    if (codigoPostgres(erro) === "23505") return recusa(MENSAGENS_DA_ROTINA.transmitindo);
    throw erro;
  }
  // Conferido de novo depois de travar: um envio do eSocial com o pedido de transmissão que começou entre a checagem e
  // agora (o eSocial confere a DCTFWeb também depois de travar o envio dele; pelo menos um dos dois vê o outro).
  if ((await esocialDaDctf(banco, acesso, pa, relogio(deps))).emCurso) {
    await porta.alterar(dctfwebEnvios, { estado: "erro", mensagem: MENSAGENS_DA_ROTINA.dctfPeloEsocial, terminadoEm: relogio(deps) }, eq(dctfwebEnvios.id, envioId));
    return recusa(MENSAGENS_DA_ROTINA.dctfPeloEsocial);
  }

  const r = await transmitirDctfAssinada(deps.cliente!, ctx, {
    pa,
    conferencia: { situacao: s.conferencia!.situacao ?? "em andamento", aPagar: s.conferencia!.aPagar ?? 0, xml: s.conferencia!.xml! },
    inssEsperado: s.inssEsperado!,
    xmlAssinado,
    certificadoPem,
    confirmado: true,
  });
  const fim = relogio(deps);
  if (!r.ok) {
    log(deps, `[serpro] Transmissão da DCTFWeb de ${pa}, empresa ${acesso.empresaId}${r.semResposta ? " (sem resposta)" : ""}: ${r.detalhe}`);
    const mensagem = r.semResposta ? MENSAGENS_DA_ROTINA.incerta : /assinatura|assinado/i.test(r.detalhe) ? MENSAGENS_DA_ROTINA.assinaturaInvalida : mensagemDaFalha(r.detalhe);
    await porta.alterar(dctfwebEnvios, { estado: r.semResposta ? "incerto" : "erro", mensagem, terminadoEm: fim }, eq(dctfwebEnvios.id, envioId));
    return recusa(mensagem);
  }
  const recibo = lerRecibo(r.recibo);
  await porta.alterar(dctfwebEnvios, { estado: "ok", situacao: "transmitida", recibo, terminadoEm: fim, mensagem: null }, eq(dctfwebEnvios.id, envioId));
  // Preparos que sobraram (outra aba) não valem mais.
  await porta.apagar(dctfwebEnvios, and(eq(dctfwebEnvios.pa, pa), inArray(dctfwebEnvios.estado, ["preparada"]))!);
  return { ok: true, recibo };
}

// A resposta da transmissão traz o recibo num objeto (formato não fixado na documentação): o número, se houver.
export function lerRecibo(texto: string): string {
  const numero = /"(?:numeroRecibo|recibo|numRecibo)"\s*:\s*"?(\d+)/i.exec(texto)?.[1] ?? /\b(\d{10,})\b/.exec(texto)?.[1];
  return numero ?? texto.slice(0, 100);
}

