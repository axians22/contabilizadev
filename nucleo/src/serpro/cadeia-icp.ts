// Cadeia do certificado até uma AC raiz da ICP-Brasil, conferida no servidor antes de gastar uma chamada paga com o termo
// de autorização (conferir-termo.ts). "Parecer ICP-Brasil" (os OIDs 2.16.76.1.3.*) qualquer um consegue num certificado
// feito em casa; o que prova é a assinatura: cada certificado da cadeia tem de ser assinado pelo de cima, todos dentro da
// validade, os de cima marcados como AC, e o último tem de ser uma das raízes oficiais guardadas no repositório
// (nucleo/certificados/icp-brasil, baixadas do ITI; a origem está no ORIGEM.md de lá). O caminho entre o certificado e a
// raiz sai das ACs oficiais do mesmo repositório (o termo traz só o certificado de quem assina).
//
// Só servidor (node:crypto). As mensagens chegam à tela do cliente: nunca citam o fornecedor.
import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export class ErroCadeia extends Error {}

// Quem é confiável (raízes) e o caminho possível até elas (intermediárias, nunca confiáveis por si).
export type Confianca = { raizes: X509Certificate[]; intermediarias: X509Certificate[] };

const PROFUNDIDADE_MAXIMA = 6;
const PEM = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

export function certificadosDoPem(texto: string): X509Certificate[] {
  return [...texto.matchAll(PEM)].map((m) => new X509Certificate(m[0]));
}

// Autoassinado: emissor igual ao titular. Só o nome basta para não servir de caminho nem de folha (checkIssued exige o uso
// de chave de AC, e um autoassinado de usuário não tem).
const autoassinado = (c: X509Certificate) => c.subject === c.issuer;

export function confiancaDe(raizesPem: string[], intermediariasPem: string[] = []): Confianca {
  const raizes = raizesPem.flatMap(certificadosDoPem);
  // Autoassinado no meio do pacote (cópia de uma raiz) não é caminho nem ponto de confiança.
  const intermediarias = intermediariasPem.flatMap(certificadosDoPem).filter((c) => !autoassinado(c));
  return { raizes, intermediarias };
}

// A pasta dos certificados oficiais, achada na hora (como os esquemas do eSocial, esocial/validar.ts): ao lado do núcleo
// (testes, Node) ou a partir da pasta de trabalho do site (plataforma/ ou a raiz do projeto).
function pastaIcp(): string {
  const candidatas = [
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "certificados", "icp-brasil"),
    path.join(process.cwd(), "..", "nucleo", "certificados", "icp-brasil"),
    path.join(process.cwd(), "nucleo", "certificados", "icp-brasil"),
  ];
  const pasta = candidatas.find((c) => fs.existsSync(path.join(c, "raizes")));
  if (!pasta) throw new Error("Certificados da ICP-Brasil não encontrados (nucleo/certificados/icp-brasil).");
  return pasta;
}

const lerPasta = (pasta: string) =>
  fs
    .readdirSync(pasta)
    .filter((f) => /\.(crt|pem|cer)$/i.test(f))
    .sort()
    .map((f) => fs.readFileSync(path.join(pasta, f), "latin1"));

let oficial: Confianca | undefined;
// As raízes e ACs oficiais da ICP-Brasil (lidas uma vez por processo).
export function confiancaIcpBrasil(): Confianca {
  if (oficial) return oficial;
  const pasta = pastaIcp();
  return (oficial = confiancaDe(lerPasta(path.join(pasta, "raizes")), lerPasta(path.join(pasta, "acs"))));
}

const valeEm = (c: X509Certificate, agora: Date) => new Date(c.validFrom) <= agora && agora <= new Date(c.validTo);
const nomeDe = (c: X509Certificate) => /(?:^|\n)CN=([^\n]+)/.exec(c.subject)?.[1] ?? "AC sem nome";

// `emissor` assinou `filho`? (Nome do emissor igual e assinatura conferida com a chave dele; chave de algoritmo que o
// Node não lê conta como não.)
function assinadoPor(filho: X509Certificate, emissor: X509Certificate): boolean {
  if (!filho.checkIssued(emissor)) return false;
  try {
    return filho.verify(emissor.publicKey);
  } catch {
    return false;
  }
}

export type CadeiaConferida = { raiz: string; caminho: string[] };

// Confere a cadeia do certificado (DER em base64, como no X509Certificate da assinatura) até uma raiz de `confianca`, no
// instante `agora`. Lança ErroCadeia com o motivo.
export function conferirCadeia(certificadoBase64: string, confianca: Confianca, agora: Date): CadeiaConferida {
  let folha: X509Certificate;
  try {
    folha = new X509Certificate(Buffer.from(certificadoBase64.replace(/\s/g, ""), "base64"));
  } catch {
    throw new ErroCadeia("Certificado ilegível.");
  }
  if (autoassinado(folha)) throw new ErroCadeia("O certificado é autoassinado: não foi emitido por uma autoridade da ICP-Brasil.");
  if (!valeEm(folha, agora)) throw new ErroCadeia("O certificado está fora da validade.");

  const caminho: string[] = [];
  const vistos = new Set<string>([folha.fingerprint256]);
  let atual = folha;
  for (let nivel = 0; nivel < PROFUNDIDADE_MAXIMA; nivel++) {
    // Chegou a uma raiz oficial: é a raiz guardada (a mesma chave), não só o mesmo nome.
    const raiz = confianca.raizes.find((r) => assinadoPor(atual, r));
    if (raiz) {
      if (!valeEm(raiz, agora)) throw new ErroCadeia(`A AC raiz da cadeia (${nomeDe(raiz)}) está fora da validade.`);
      return { raiz: nomeDe(raiz), caminho };
    }
    const candidatas = confianca.intermediarias.filter((c) => !vistos.has(c.fingerprint256) && c.ca && assinadoPor(atual, c));
    const valida = candidatas.find((c) => valeEm(c, agora));
    if (!valida) {
      if (candidatas.length) throw new ErroCadeia(`A autoridade que emitiu o certificado (${nomeDe(candidatas[0])}) está fora da validade.`);
      throw new ErroCadeia("O certificado não foi emitido por uma autoridade da ICP-Brasil: a cadeia não chega a uma AC raiz oficial.");
    }
    caminho.push(nomeDe(valida));
    vistos.add(valida.fingerprint256);
    atual = valida;
  }
  throw new ErroCadeia("A cadeia do certificado é longa demais para ser da ICP-Brasil.");
}
