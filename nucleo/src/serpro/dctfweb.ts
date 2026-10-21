// DCTFWeb pelo Serpro, em três etapas:
// 1. conferir: baixa o XML da declaração do mês e lê situação e valor a pagar;
// 2. transmitir: assina o XML com o certificado e transmite (só em andamento, valor conferido e confirmação);
// 3. gerar o DARF da declaração transmitida (ou, vencido, atualizado com multa e juros para uma data).
// As funções não gravam nada: devolvem o resultado (com o XML ou o PDF) para a plataforma guardar.
import { assinarXml, prepararAssinaturaRemota, verificarAssinatura, type AssinaturaPreparada } from "../assinatura.ts";
import type { Pem } from "../certificado.ts";
import { hoje, mesValido } from "../meses.ts";
import { textoDoPdf } from "../pdf.ts";
import { problemaNaDataDePagamento } from "./guias.ts";
import { falha, falhaDoErro, respostaOk, textoMensagens, type ClienteSerpro, type Contexto, type Resultado } from "./cliente.ts";

export const periodoDctf = (pa: string) => {
  if (!mesValido(pa)) throw new Error(`Período de apuração inválido: "${pa}".`);
  return { categoria: "GERAL_MENSAL", anoPA: pa.slice(0, 4), mesPA: pa.slice(5, 7) };
};

export type InfoXml = { aPagar: number; recibo: string | null; transmissao: string | null; zerada: boolean };

// Lê do XML: valor a pagar, recibo (se já transmitida) e se é declaração zerada.
export function lerXmlDctf(xml: string): InfoXml {
  const valores = [...xml.matchAll(/<saldoaPagar>([\d.]+)<\/saldoaPagar>/g)].map((m) => Number(m[1]));
  return {
    aPagar: Math.round(valores.reduce((s, v) => s + v, 0) * 100) / 100,
    recibo: xml.match(/<numeroRecibo>(\d+)<\/numeroRecibo>/)?.[1] ?? null,
    transmissao: xml.match(/<dataHoraTransmissao>(\d{14})<\/dataHoraTransmissao>/)?.[1] ?? null,
    zerada: /<indZerada>1<\/indZerada>/.test(xml) && valores.length === 0,
  };
}

export type Conferencia = InfoXml & { situacao: "transmitida" | "em andamento"; xml: string };

export async function conferir(
  cliente: ClienteSerpro,
  ctx: Contexto,
  d: { pa: string; mesAtual: string },
): Promise<Resultado<Conferencia>> {
  if (d.pa >= d.mesAtual) return falha("Não enviado: o mês ainda não terminou.");
  try {
    const r = await cliente.chamar(
      "Consultar",
      { idSistema: "DCTFWEB", idServico: "CONSXMLDECLARACAO38", versaoSistema: "1.0", dados: periodoDctf(d.pa) },
      `Conferir a DCTFWeb de ${d.pa} (situação e valor a pagar)`,
      ctx,
    );
    const base64 = (r.dados as { XMLStringBase64?: string } | undefined)?.XMLStringBase64;
    if (!base64) return falha(textoMensagens(r.mensagens) || `HTTP ${r.status}`);
    const xml = Buffer.from(base64, "base64").toString("utf8");
    const info = lerXmlDctf(xml);
    return {
      ok: true,
      ...info,
      xml,
      situacao: info.recibo ? "transmitida" : "em andamento",
      detalhe: info.recibo ? `Recibo ${info.recibo}, transmitida em ${info.transmissao}` : textoMensagens(r.mensagens),
    };
  } catch (erro) {
    return falha((erro as Error).message);
  }
}

// Motivo para não transmitir, ou null se pode. `inssEsperado` é o INSS do pró-labore do mês.
export function bloqueioTransmissaoDctf(conferencia: Pick<Conferencia, "situacao" | "aPagar" | "xml"> | null, inssEsperado: number): string | null {
  if (!conferencia) return "Confira a declaração antes de transmitir.";
  if (conferencia.situacao === "transmitida") return "A declaração deste mês já foi transmitida.";
  if (Math.abs(conferencia.aPagar - inssEsperado) >= 0.005)
    return "O valor a pagar da declaração não bate com o INSS do pró-labore. Confira o eSocial do mês.";
  if (!conferencia.xml) return "O XML da conferência não foi encontrado. Confira de novo.";
  return null;
}

// O elemento assinado é o ConteudoDeclaracao, com a assinatura logo depois dele. "O certificado usado na assinatura deve
// ser o do autor do pedido de dados" (Integra DCTFWeb, Transmitir Declaração): da empresa da plataforma, assinado aqui
// com o certificado do contrato (transmitirDctf); de um cliente, o e-CNPJ da própria empresa, no navegador dele
// (prepararAssinaturaDctf no servidor, a assinatura no navegador e transmitirDctfAssinada).
export const ELEMENTO_ASSINADO_DCTF = "ConteudoDeclaracao";

export function prepararAssinaturaDctf(xml: string, certificadoPem: string): AssinaturaPreparada {
  return prepararAssinaturaRemota(xml, ELEMENTO_ASSINADO_DCTF, certificadoPem, "after");
}

export async function transmitirDctf(
  cliente: ClienteSerpro,
  ctx: Contexto,
  d: { pa: string; conferencia: Pick<Conferencia, "situacao" | "aPagar" | "xml"> | null; inssEsperado: number; pem: Pem; confirmado: boolean },
): Promise<Resultado<{ recibo: string }>> {
  const bloqueio = bloqueioTransmissaoDctf(d.conferencia, d.inssEsperado);
  if (bloqueio) return falha(`Não enviado: ${bloqueio}`);
  if (!d.confirmado) return falha("Não enviado: a transmissão precisa da confirmação do cliente.");
  let assinado: string;
  try {
    assinado = assinarXml(d.conferencia!.xml, ELEMENTO_ASSINADO_DCTF, d.pem, "after");
  } catch (erro) {
    return falha((erro as Error).message);
  }
  return transmitirDctfAssinada(cliente, ctx, { ...d, xmlAssinado: assinado, certificadoPem: d.pem.certificado });
}

// Transmite o XML já assinado (pelo servidor ou pelo navegador do cliente). Confere antes a assinatura com o certificado
// e que o conteúdo assinado é o da conferência (sem a assinatura, o XML tem de ser o mesmo, caractere por caractere).
export async function transmitirDctfAssinada(
  cliente: ClienteSerpro,
  ctx: Contexto,
  d: {
    pa: string;
    conferencia: Pick<Conferencia, "situacao" | "aPagar" | "xml"> | null;
    inssEsperado: number;
    xmlAssinado: string;
    certificadoPem: string;
    confirmado: boolean;
  },
): Promise<Resultado<{ recibo: string }>> {
  const bloqueio = bloqueioTransmissaoDctf(d.conferencia, d.inssEsperado);
  if (bloqueio) return falha(`Não enviado: ${bloqueio}`);
  if (!d.confirmado) return falha("Não enviado: a transmissão precisa da confirmação do cliente.");
  const semAssinatura = d.xmlAssinado.replace(/<(?:ds:)?Signature[\s>][\s\S]*?<\/(?:ds:)?Signature>/, "");
  if (semAssinatura === d.xmlAssinado || semAssinatura !== d.conferencia!.xml.replace(/^<\?xml[^>]*\?>\s*/, "")) {
    return falha("Não enviado: o conteúdo assinado não é o da declaração conferida.");
  }
  if (!verificarAssinatura(d.xmlAssinado, d.certificadoPem)) return falha("A assinatura gerada não passou na verificação. Nada foi enviado.");
  try {
    const r = await cliente.chamar(
      "Declarar",
      {
        idSistema: "DCTFWEB",
        idServico: "TRANSDECLARACAO310",
        versaoSistema: "1.0",
        dados: { ...periodoDctf(d.pa), xmlAssinadoBase64: Buffer.from(d.xmlAssinado, "utf8").toString("base64") },
      },
      `Transmitir a DCTFWeb de ${d.pa}, confirmada pelo cliente`,
      { ...ctx, confirmado: true },
    );
    if (!respostaOk(r)) return falha(textoMensagens(r.mensagens) || `HTTP ${r.status}`);
    const recibo = typeof r.dados === "object" && r.dados ? JSON.stringify(r.dados) : String(r.dados ?? "");
    return { ok: true, recibo, detalhe: [`Recibo ${recibo}`, textoMensagens(r.mensagens)].filter(Boolean).join(" | ") };
  } catch (erro) {
    return falhaDoErro(erro);
  }
}

// DARF: o valor total aparece depois de "Valor Total do Documento" (formato 1.234,56).
export function valorDoDarf(texto: string): number | null {
  const trecho = texto.split(/Valor Total do Documento/i)[1];
  const numero = trecho?.match(/\d{1,3}(?:\.\d{3})*,\d{2}/)?.[0];
  return numero ? Number(numero.replace(/\./g, "").replace(",", ".")) : null;
}

// Gera o DARF da DCTFWeb transmitida. Com `pagarEm` ("AAAA-MM-DD", dia útil deste mês, de `hoje` em diante), o DARF
// sai atualizado com multa e juros (DataAcolhimentoProposta); o total vem lido do PDF, porque a resposta só traz o arquivo.
export async function gerarDarf(
  cliente: ClienteSerpro,
  ctx: Contexto,
  d: { pa: string; transmitida: boolean; pagarEm?: string; hoje?: string; feriadosExtras?: string[] },
): Promise<Resultado<{ pdf: string; total: number | null }>> {
  if (!d.transmitida) return falha("Não enviado: o DARF só pode ser gerado para declaração transmitida. Confira a declaração antes.");
  const problema = d.pagarEm !== undefined ? problemaNaDataDePagamento(d.pagarEm, d.hoje ?? hoje(), d.feriadosExtras) : null;
  if (problema) return falha(`Não enviado: ${problema}`);
  try {
    const r = await cliente.chamar(
      "Emitir",
      {
        idSistema: "DCTFWEB",
        idServico: "GERARGUIA31",
        versaoSistema: "1.0",
        dados: { ...periodoDctf(d.pa), ...(d.pagarEm ? { DataAcolhimentoProposta: Number(d.pagarEm.replace(/-/g, "")) } : {}) },
      },
      d.pagarEm
        ? `Gerar o DARF do INSS de ${d.pa} atualizado (multa e juros) para pagar em ${d.pagarEm}`
        : `Gerar o DARF da DCTFWeb de ${d.pa} para pagamento`,
      ctx,
    );
    const pdf = (r.dados as { PDFByteArrayBase64?: string } | undefined)?.PDFByteArrayBase64;
    if (!pdf) return falha(textoMensagens(r.mensagens) || `HTTP ${r.status}`);
    let total: number | null = null;
    try {
      total = valorDoDarf(textoDoPdf(Buffer.from(pdf, "base64")));
    } catch {
      // Sem o valor: o PDF continua disponível.
    }
    return { ok: true, pdf, total, detalhe: textoMensagens(r.mensagens) };
  } catch (erro) {
    return falha((erro as Error).message);
  }
}
