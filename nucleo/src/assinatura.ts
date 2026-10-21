// Assinatura XMLDSig enveloped (C14N, RSA-SHA256, SHA-256), padrão exigido pela Receita e pelo eSocial.
// O certificado (chave e certificado em PEM) vem por parâmetro: do cliente, só em memória durante o envio.
import { SignedXml } from "xml-crypto";
import type { Pem } from "./certificado.ts";

const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256";

const assinador = (pem: Pem) =>
  new SignedXml({ privateKey: pem.chave, publicCert: pem.certificado, canonicalizationAlgorithm: C14N, signatureAlgorithm: RSA_SHA256 });

// Assina o elemento `elemento` (que precisa ter atributo id/Id) e coloca a assinatura logo depois dele
// ("after") ou como último filho dele ("append").
export function assinarXml(xml: string, elemento: string, pem: Pem, posicao: "after" | "append" = "after"): string {
  if (!/^[A-Za-z_][\w.-]*$/.test(elemento)) throw new Error(`Nome de elemento inválido: "${elemento}".`);
  const xpath = `//*[local-name()='${elemento}']`;
  const assinatura = assinador(pem);
  assinatura.addReference({ xpath, transforms: [ENVELOPED, C14N], digestAlgorithm: SHA256 });
  assinatura.computeSignature(xml, { location: { reference: xpath, action: posicao } });
  return assinatura.getSignedXml();
}

// Assinatura em duas etapas, para a chave nunca sair do computador do cliente: o servidor monta a assinatura (digest,
// SignedInfo e o certificado do cliente no KeyInfo) com um marcador no lugar do SignatureValue e devolve o SignedInfo
// canônico; o navegador assina esse texto (RSA-SHA256) com a chave do e-CNPJ no WebCrypto, não exportável (guardada no
// navegador ou só em memória: plataforma/lib/assinador) e o servidor troca o marcador pelo valor e confere a assinatura.
export const MARCADOR_ASSINATURA = "AGUARDANDO-ASSINATURA-DO-CLIENTE";
export type AssinaturaPreparada = { xml: string; signedInfo: string };

// Assinador do xml-crypto com o RSA-SHA256 "de mentira": guarda o SignedInfo canônico e devolve o marcador (a chave não
// está aqui).
function assinadorRemoto(certificadoPem: string) {
  const capturado = { signedInfo: "" };
  class Capturar {
    getSignature = (texto: string) => {
      capturado.signedInfo = texto;
      return MARCADOR_ASSINATURA;
    };
    verifySignature = () => false;
    getAlgorithmName = () => RSA_SHA256;
  }
  const assinatura = new SignedXml({ privateKey: "remota", publicCert: certificadoPem, canonicalizationAlgorithm: C14N, signatureAlgorithm: RSA_SHA256 });
  assinatura.SignatureAlgorithms = { [RSA_SHA256]: Capturar as never };
  return { assinatura, capturado };
}

function preparado(assinatura: SignedXml, signedInfo: string): AssinaturaPreparada {
  const xml = assinatura.getSignedXml();
  if (!signedInfo || xml.split(MARCADOR_ASSINATURA).length !== 2) throw new Error("Não foi possível preparar a assinatura.");
  return { xml, signedInfo };
}

export function prepararAssinaturaRemota(xml: string, elemento: string, certificadoPem: string, posicao: "after" | "append" = "after"): AssinaturaPreparada {
  if (!/^[A-Za-z_][\w.-]*$/.test(elemento)) throw new Error(`Nome de elemento inválido: "${elemento}".`);
  if (xml.includes(MARCADOR_ASSINATURA)) throw new Error("O XML já tem uma assinatura preparada.");
  const xpath = `//*[local-name()='${elemento}']`;
  const { assinatura, capturado } = assinadorRemoto(certificadoPem);
  assinatura.addReference({ xpath, transforms: [ENVELOPED, C14N], digestAlgorithm: SHA256 });
  assinatura.computeSignature(xml, { location: { reference: xpath, action: posicao } });
  return preparado(assinatura, capturado.signedInfo);
}

// A mesma preparação no padrão do eSocial (assinarEsocial): Reference URI="" e a assinatura como último filho da raiz.
// É assim que o evento do pró-labore de um cliente é assinado com o e-CNPJ dele, no navegador (Parte 7).
export function prepararAssinaturaEsocialRemota(xml: string, certificadoPem: string): AssinaturaPreparada {
  if (xml.includes(MARCADOR_ASSINATURA)) throw new Error("O XML já tem uma assinatura preparada.");
  const { assinatura, capturado } = assinadorRemoto(certificadoPem);
  assinatura.addReference({ xpath: "/*", isEmptyUri: true, transforms: [ENVELOPED, C14N], digestAlgorithm: SHA256 });
  assinatura.computeSignature(xml, { location: { reference: "/*", action: "append" } });
  return preparado(assinatura, capturado.signedInfo);
}

// Troca o marcador pelo valor da assinatura (base64) feito pelo cliente. Quem chama confere com verificarAssinatura.
export function completarAssinaturaRemota(preparado: string, valor: string): string {
  const limpo = valor.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(limpo) || limpo.length < 300) throw new Error("Valor de assinatura inválido.");
  if (preparado.split(MARCADOR_ASSINATURA).length !== 2) throw new Error("Assinatura preparada inválida.");
  return preparado.replace(MARCADOR_ASSINATURA, limpo);
}

// Padrão do eSocial: Reference URI="" (documento inteiro) e Signature como último filho da raiz <eSocial>.
export function assinarEsocial(xml: string, pem: Pem): string {
  const assinatura = assinador(pem);
  assinatura.addReference({ xpath: "/*", isEmptyUri: true, transforms: [ENVELOPED, C14N], digestAlgorithm: SHA256 });
  assinatura.computeSignature(xml, { location: { reference: "/*", action: "append" } });
  return assinatura.getSignedXml();
}

// Confere uma assinatura (usado para testar antes de enviar).
export function verificarAssinatura(xmlAssinado: string, certificadoPem: string): boolean {
  const no = xmlAssinado.match(/<(?:ds:)?Signature[\s\S]+?<\/(?:ds:)?Signature>/)?.[0];
  if (!no) return false;
  const assinatura = new SignedXml({ publicCert: certificadoPem });
  assinatura.loadSignature(no);
  try {
    return assinatura.checkSignature(xmlAssinado);
  } catch {
    return false;
  }
}
