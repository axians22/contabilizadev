// Termo de autorização do Autentica Procurador (Integra Contador): montado e assinado no navegador do cliente, com o
// e-CNPJ A1 da própria empresa (.pfx) aberto só na memória da aba. A chave privada e a senha nunca saem daqui; só o
// XML assinado sobe para o servidor, que confere tudo de novo (conferir-termo.ts) antes de enviar
// (autentica-procurador.ts).
//
// Fonte oficial (estrutura, textos e padrão de assinatura):
// https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-contador-gerenciador/autenticaprocurador/padroes_tecnicos_assinatura_xml/
// https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-contador-gerenciador/autenticaprocurador/dados_de_dominio/
//
// Isomórfico: só node-forge (JavaScript puro), nenhum módulo do Node. O mesmo código roda no navegador e nos testes.
// O XML é gerado já na forma canônica (C14N inclusiva: atributos em ordem alfabética, sem elementos vazios
// abreviados, escape do C14N), então o digest é o SHA-256 do próprio texto do elemento raiz. A assinatura é conferida
// no servidor com o xml-crypto, que canoniza por conta própria: se a forma canônica daqui estiver errada, não confere.
//
// A parte que não depende do node-forge (textos, montagem, regras do certificado, assinatura com a chave do WebCrypto e
// datas) fica em termo-xml.ts e é reexportada daqui; este arquivo só abre o .pfx e lê certificados.
//
// As mensagens de erro daqui chegam à tela do cliente: nunca citam o fornecedor (a fonte é a Receita Federal).
import forge from "node-forge";
import { assinaturaDoTermo, documentoDoTermo, ErroCertificado, limparTexto, OID_CNPJ, OID_PF, OID_RESPONSAVEL, signedInfoDoTermo, type InfoCertificado, type Pessoa, type Politica } from "./termo-xml.ts";

export * from "./termo-xml.ts";

const PREFIXO_ICP = "2.16.76.1.3.";
// Políticas de certificado da ICP-Brasil (DOC-ICP-04, extensão certificatePolicies): 2.16.76.1.2.<tipo>.<n>, com
// tipo 1 = A1, 2 = A2, 3 = A3, 4 = A4, 101 a 104 = S1 a S4 (sigilo) e 30x = carimbo do tempo.
const PREFIXO_POLITICA = "2.16.76.1.2.";

// otherNames do SubjectAltName: { oid -> valor em texto }.
function outrosNomes(cert: forge.pki.Certificate): Record<string, string> {
  const ext = cert.getExtension("subjectAltName") as { altNames?: { type: number; value: unknown }[] } | null;
  const nomes: Record<string, string> = {};
  for (const alt of ext?.altNames ?? []) {
    if (alt.type !== 0 || !Array.isArray(alt.value)) continue;
    const [oid, valor] = alt.value as forge.asn1.Asn1[];
    if (!oid || oid.type !== forge.asn1.Type.OID || typeof oid.value !== "string") continue;
    // [0] EXPLICIT com o valor (OCTET STRING, PrintableString ou UTF8String, conforme a AC).
    const interno = Array.isArray(valor?.value) ? (valor.value as forge.asn1.Asn1[])[0] : undefined;
    if (!interno || typeof interno.value !== "string") continue;
    const bruto = interno.value;
    nomes[forge.asn1.derToOid(oid.value)] = interno.type === forge.asn1.Type.UTF8 ? forge.util.decodeUtf8(bruto) : bruto;
  }
  return nomes;
}

// Política ICP-Brasil do certificado (A1, A3...), lida da extensão certificatePolicies.
function politicaDo(cert: forge.pki.Certificate): Politica | null {
  const ext = cert.getExtension("certificatePolicies") as { value?: string } | null;
  if (!ext?.value) return null;
  let oids: string[];
  try {
    const seq = forge.asn1.fromDer(ext.value);
    oids = (seq.value as forge.asn1.Asn1[]).flatMap((info) => {
      const oid = Array.isArray(info.value) ? (info.value as forge.asn1.Asn1[])[0] : undefined;
      return oid && oid.type === forge.asn1.Type.OID && typeof oid.value === "string" ? [forge.asn1.derToOid(oid.value)] : [];
    });
  } catch {
    return null;
  }
  const icp = oids.find((o) => o.startsWith(PREFIXO_POLITICA));
  if (!icp) return null;
  const tipo = Number(icp.slice(PREFIXO_POLITICA.length).split(".")[0]);
  if (tipo >= 1 && tipo <= 4) return `A${tipo}` as Politica;
  if (tipo >= 101 && tipo <= 104) return "S";
  return "outra";
}

const CNPJ = /^[0-9A-Z]{12}[0-9]{2}$/;

// Titular do certificado: CNPJ (e-CNPJ) ou CPF (e-CPF) pelas extensões da ICP-Brasil; sem elas, pelo CN no padrão
// "NOME:NÚMERO" que a ICP-Brasil também usa. O nome é o do CN, sem o número.
function titularDo(cert: forge.pki.Certificate, nomes: Record<string, string>): Pessoa {
  const cn = textoDoCampo(cert.subject, "CN");
  const [nomeCn, numeroCn] = cn.includes(":") ? [cn.slice(0, cn.lastIndexOf(":")), cn.slice(cn.lastIndexOf(":") + 1)] : [cn, ""];
  const nome = limparTexto(nomeCn);
  // O CNPJ pode ser alfanumérico (12 letras ou dígitos e 2 dígitos verificadores; IN RFB 2.229/2024).
  const cnpj = nomes[OID_CNPJ]?.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (cnpj && CNPJ.test(cnpj)) return { tipo: "PJ", numero: cnpj, nome };
  const pf = nomes[OID_PF]?.replace(/\D/g, "");
  if (pf && pf.length >= 19) return { tipo: "PF", numero: pf.slice(8, 19), nome };
  const cnpjCn = numeroCn.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (CNPJ.test(cnpjCn)) return { tipo: "PJ", numero: cnpjCn, nome };
  const numero = numeroCn.replace(/\D/g, "");
  if (numero.length === 11) return { tipo: "PF", numero, nome };
  throw new ErroCertificado("Este certificado não é um e-CNPJ: não achamos o CNPJ do titular nele.");
}

// Atributo do nome (CN etc.) em texto: o forge entrega UTF8String como bytes, sem decodificar.
function textoDoCampo(nome: forge.pki.Certificate["subject"], campo: string): string {
  const f = nome.getField(campo) as { value?: string; valueTagClass?: number } | null;
  if (!f?.value) return "";
  let valor = f.value;
  if (f.valueTagClass === forge.asn1.Type.UTF8) {
    try {
      valor = forge.util.decodeUtf8(valor);
    } catch {
      // UTF-8 malformado: fica o texto cru
    }
  }
  return limparTexto(valor);
}

// Responsável pelo e-CNPJ (OID 2.16.76.1.3.4): nascimento nas posições 1 a 8 (DDMMAAAA) e CPF nas 9 a 19.
function responsavelDo(nomes: Record<string, string>): InfoCertificado["responsavel"] {
  const valor = nomes[OID_RESPONSAVEL];
  if (!valor || valor.length < 19) return null;
  const nascimento = valor.slice(0, 8);
  const cpf = valor.slice(8, 19);
  return /^\d{11}$/.test(cpf) && !/^0{11}$/.test(cpf) ? { cpf, nascimento } : null;
}

function informacoes(cert: forge.pki.Certificate): InfoCertificado {
  const nomes = outrosNomes(cert);
  const cnpjIcp = nomes[OID_CNPJ]?.replace(/[^0-9A-Za-z]/g, "").toUpperCase() ?? null;
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return {
    titular: titularDo(cert, nomes),
    validoDe: cert.validity.notBefore,
    validoAte: cert.validity.notAfter,
    autoassinado: cert.isIssuer(cert),
    icpBrasil: Object.keys(nomes).some((oid) => oid.startsWith(PREFIXO_ICP)),
    politica: politicaDo(cert),
    emissor: textoDoCampo(cert.issuer, "CN"),
    bitsChave: (cert.publicKey as forge.pki.rsa.PublicKey).n?.bitLength() ?? 0,
    certificadoBase64: forge.util.encode64(der),
    cnpjIcp: cnpjIcp && CNPJ.test(cnpjIcp) ? cnpjIcp : null,
    responsavel: responsavelDo(nomes),
  };
}

// Lê um certificado X.509 em base64 (DER), como vem no X509Certificate de uma assinatura.
export function lerCertificado(base64: string): InfoCertificado {
  let cert: forge.pki.Certificate;
  try {
    cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.decode64(base64.replace(/\s/g, ""))));
  } catch {
    throw new ErroCertificado("Certificado ilegível (precisa ser X.509 com chave RSA).");
  }
  return informacoes(cert);
}

export type CertificadoAberto = InfoCertificado & {
  // Assina (RSA-SHA256, PKCS#1 v1.5) o texto em UTF-8 e devolve a assinatura em base64. A chave fica só aqui dentro.
  assinar(texto: string): string;
};

const paraBinario = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
};

// Abre o .pfx/.p12 na memória: acha a chave privada e o certificado dela (o arquivo pode trazer a cadeia junto).
function abrirPfx(pfx: Uint8Array | ArrayBuffer, senha: string): { chave: forge.pki.rsa.PrivateKey; cert: forge.pki.Certificate; cadeia: forge.pki.Certificate[] } {
  const bytes = pfx instanceof Uint8Array ? pfx : new Uint8Array(pfx);
  if (!bytes.length) throw new ErroCertificado("Arquivo do certificado vazio.");
  if (!senha) throw new ErroCertificado("Informe a senha do certificado.");
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(paraBinario(bytes)), senha);
  } catch {
    throw new ErroCertificado("Não foi possível abrir o certificado: confira o arquivo (.pfx ou .p12) e a senha.");
  }
  const chaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const chave = chaves.map((b) => b.key).find((k): k is forge.pki.rsa.PrivateKey => Boolean(k && "n" in k));
  if (!chave) throw new ErroCertificado("O arquivo não tem a chave privada (ou ela não é RSA).");
  const certificados = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).map((b) => b.cert).filter(Boolean) as forge.pki.Certificate[];
  // O certificado do titular é o da chave pública que bate com a chave privada (os outros são da cadeia).
  const cert = certificados.find((c) => {
    const pub = c.publicKey as forge.pki.rsa.PublicKey;
    return pub.n?.equals(chave.n) && pub.e?.equals(chave.e);
  });
  if (!cert) throw new ErroCertificado("O arquivo não tem o certificado da chave privada.");
  return { chave, cert, cadeia: certificados.filter((c) => c !== cert) };
}

export function abrirCertificado(pfx: Uint8Array | ArrayBuffer, senha: string): CertificadoAberto {
  const { chave, cert } = abrirPfx(pfx, senha);
  return {
    ...informacoes(cert),
    assinar(texto) {
      const md = forge.md.sha256.create();
      md.update(texto, "utf8");
      return forge.util.encode64(chave.sign(md));
    },
  };
}

// Abre o .pfx e devolve a chave privada em PKCS#8 (DER), só para a tela importar no WebCrypto como chave não
// exportável (crypto.subtle.importKey) e zerar os bytes logo em seguida. Nada daqui vai para o servidor.
export function abrirChaveDoCertificado(pfx: Uint8Array | ArrayBuffer, senha: string): { info: InfoCertificado; pkcs8: Uint8Array<ArrayBuffer> } {
  const { chave, cert } = abrirPfx(pfx, senha);
  const der = forge.asn1.toDer(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(chave))).getBytes();
  const pkcs8 = new Uint8Array(der.length);
  for (let i = 0; i < der.length; i++) pkcs8[i] = der.charCodeAt(i);
  return { info: informacoes(cert), pkcs8 };
}

// Abre o .pfx e devolve a chave (PKCS#8) e o certificado com a cadeia, em PEM: a forma em que o servidor guarda, cifrado,
// o e-CNPJ da própria plataforma (a senha não precisa ficar guardada). Só para o servidor; o do cliente nunca passa aqui.
export function converterParaPem(pfx: Uint8Array | ArrayBuffer, senha: string): { info: InfoCertificado; chave: string; certificado: string } {
  const { chave, cert, cadeia } = abrirPfx(pfx, senha);
  return {
    info: informacoes(cert),
    chave: forge.pki.privateKeyInfoToPem(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(chave))),
    certificado: [cert, ...cadeia].map((c) => forge.pki.certificateToPem(c)).join(""),
  };
}

// ---- Assinatura ----

const sha256Base64 = (texto: string) => {
  const md = forge.md.sha256.create();
  md.update(texto, "utf8");
  return forge.util.encode64(md.digest().getBytes());
};

// Assina o termo montado por montarTermo com o certificado aberto pelo node-forge (síncrono). A tela usa
// assinarTermoCom (termo-xml.ts), com a chave no WebCrypto; o resultado é o mesmo.
export function assinarTermo(xml: string, certificado: CertificadoAberto): string {
  const digest = sha256Base64(documentoDoTermo(xml));
  return assinaturaDoTermo(xml, digest, certificado.assinar(signedInfoDoTermo(digest)), certificado.certificadoBase64);
}
