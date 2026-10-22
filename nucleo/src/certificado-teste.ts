// Só para testes: gera na hora um certificado autoassinado (.pfx) numa pasta temporária, lê para a memória e apaga.
// Nenhum certificado de verdade nem arquivo .pfx fica no projeto.
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import forge from "node-forge";
import type { Certificado } from "./http.ts";
import { confiancaDe, type Confianca } from "./serpro/cadeia-icp.ts";

let cache: Certificado | undefined;

export type OpcoesCertificadoTeste = {
  titular?: string; // CN do certificado. No e-CNPJ da ICP-Brasil é "RAZÃO SOCIAL:CNPJ".
  dias?: number; // validade a partir de agora
  senha?: string;
};

// Sem opções, o mesmo certificado é reaproveitado no processo (gerar uma chave RSA leva tempo).
export function certificadoDeTeste(opcoes?: OpcoesCertificadoTeste): Certificado {
  if (!opcoes && cache) return cache;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "cert-teste-"));
  const senha = opcoes?.senha ?? "senha-de-teste";
  try {
    const arquivo = (nome: string) => path.join(pasta, nome);
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", String(opcoes?.dias ?? 2),
      "-subj", `/CN=${opcoes?.titular ?? "EMPRESA DE TESTE LTDA:11222333000181"}`, "-utf8",
      "-keyout", arquivo("chave.pem"), "-out", arquivo("cert.pem"),
    ], { stdio: "ignore" });
    execFileSync("openssl", [
      "pkcs12", "-export", "-inkey", arquivo("chave.pem"), "-in", arquivo("cert.pem"),
      "-out", arquivo("teste.pfx"), "-passout", `pass:${senha}`,
    ], { stdio: "ignore" });
    const certificado = { pfx: fs.readFileSync(arquivo("teste.pfx")), senha };
    if (!opcoes) cache = certificado;
    return certificado;
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
}

// ---- e-CNPJ / e-CPF de teste no formato da ICP-Brasil (assinados por uma AC de teste) ----
// Só para testes do termo de autorização: certificado do titular com as extensões da ICP-Brasil (otherName no
// SubjectAltName com o CNPJ ou o CPF, DOC-ICP-04) e a política do tipo (A1 = 2.16.76.1.2.1.n, A3 = 2.16.76.1.2.3.n),
// emitido por uma AC de teste gerada na hora. Montado com o node-forge (validade exata, inclusive no passado) e com as
// chaves geradas pelo Node. Nada vai para o disco.

export type OpcoesCertificadoIcp = {
  tipo: "PJ" | "PF";
  numero: string; // CNPJ (14) ou CPF (11), só dígitos
  nome: string;
  validoDe?: Date; // padrão: agora - 1 minuto
  validoAte?: Date; // padrão: agora + 365 dias
  bits?: number; // padrão 2048
  politica?: "A1" | "A3" | null; // padrão A1; null = sem política da ICP-Brasil
  semIcp?: boolean; // sem o otherName da ICP-Brasil (só o CN "NOME:NÚMERO")
  autoassinado?: boolean;
  legado?: boolean; // .pfx com 3DES (certificados antigos) em vez de AES-256
  textoImprimivel?: boolean; // otherName como PrintableString em vez de OCTET STRING (as duas formas existem)
  senha?: string;
  // e-CNPJ: o responsável (OID 2.16.76.1.3.4: nascimento DDMMAAAA + CPF + NIS + RG + órgão; e 2.16.76.1.3.2: o nome).
  // Padrão: CPF_RESPONSAVEL_DE_TESTE; null = sem os OIDs do responsável.
  responsavel?: { cpf: string; nascimento?: string; nome?: string } | null;
  // Quem emite: a raiz de teste direto (padrão), uma AC intermediária dela, uma intermediária já vencida, ou uma AC
  // "forjada" (mesmo nome da raiz de teste, outra chave: a cadeia não confere).
  cadeia?: "raiz" | "intermediaria" | "intermediaria-vencida" | "forjada";
};

// CPF válido (dígitos verificadores certos) do responsável dos e-CNPJ de teste. O meio (123456) é o que os exemplos
// fictícios da consulta de CNPJ mostram no quadro de sócios ("***123456**"), então o mesmo CPF passa no cadastro.
export const CPF_RESPONSAVEL_DE_TESTE = "52912345634";

const OID_POLITICA = { A1: "2.16.76.1.2.1.1", A3: "2.16.76.1.2.3.1" } as const;

type ChavesForge = { privada: forge.pki.rsa.PrivateKey; publica: forge.pki.rsa.PublicKey };
function chavesNovas(bits: number): ChavesForge {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: bits });
  const privada = forge.pki.privateKeyFromPem(privateKey.export({ type: "pkcs1", format: "pem" }).toString()) as forge.pki.rsa.PrivateKey;
  return { privada, publica: forge.pki.setRsaPublicKey(privada.n, privada.e) };
}

type Ac = { chaves: ChavesForge; certificado: forge.pki.Certificate };
const ANO = 365 * 24 * 60 * 60 * 1000;
const NOME_DA_RAIZ = [{ name: "commonName", value: "AC DE TESTE CONTABILIZADEV" }, { name: "organizationName", value: "ICP-Brasil" }];

function novaAc(nome: { name: string; value: string }[], emissor: Ac | null, de: Date, ate: Date): Ac {
  const chaves = chavesNovas(2048);
  const c = forge.pki.createCertificate();
  c.publicKey = chaves.publica;
  c.serialNumber = `0${Math.floor(Math.random() * 1e12).toString(16)}`;
  c.validity.notBefore = de;
  c.validity.notAfter = ate;
  c.setSubject(nome);
  c.setIssuer(emissor ? emissor.certificado.subject.attributes : nome);
  c.setExtensions([{ name: "basicConstraints", cA: true, critical: true }, { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true }]);
  c.sign((emissor ?? { chaves }).chaves.privada, forge.md.sha256.create());
  return { chaves, certificado: c };
}

const acs: Partial<Record<"raiz" | "intermediaria" | "intermediaria-vencida" | "forjada", Ac>> = {};
function acDeTeste(qual: keyof typeof acs = "raiz"): Ac {
  const pronta = acs[qual];
  if (pronta) return pronta;
  const agora = Date.now();
  const nova =
    qual === "raiz"
      ? novaAc(NOME_DA_RAIZ, null, new Date(agora - 10 * ANO), new Date(agora + 10 * ANO))
      : qual === "forjada"
        ? novaAc(NOME_DA_RAIZ, null, new Date(agora - 10 * ANO), new Date(agora + 10 * ANO))
        : qual === "intermediaria"
          ? novaAc([{ name: "commonName", value: "AC INTERMEDIARIA DE TESTE" }, { name: "organizationName", value: "ICP-Brasil" }], acDeTeste("raiz"), new Date(agora - ANO), new Date(agora + 5 * ANO))
          : novaAc([{ name: "commonName", value: "AC INTERMEDIARIA VENCIDA DE TESTE" }, { name: "organizationName", value: "ICP-Brasil" }], acDeTeste("raiz"), new Date(agora - 3 * ANO), new Date(agora - ANO));
  acs[qual] = nova;
  return nova;
}

// A confiança dos testes: a raiz de teste (no lugar das raízes oficiais da ICP-Brasil) e as intermediárias de teste.
export function confiancaDeTeste(): Confianca {
  const pem = (qual: keyof typeof acs) => forge.pki.certificateToPem(acDeTeste(qual).certificado);
  return confiancaDe([pem("raiz")], [pem("intermediaria"), pem("intermediaria-vencida")]);
}

const { asn1 } = forge;
const outroNome = (oid: string, valor: string, imprimivel: boolean) =>
  asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(oid).getBytes()),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [asn1.create(asn1.Class.UNIVERSAL, imprimivel ? asn1.Type.PRINTABLESTRING : asn1.Type.OCTETSTRING, false, valor)]),
  ]);

export function certificadoIcpDeTeste(o: OpcoesCertificadoIcp): Certificado {
  const senha = o.senha ?? "senha-de-teste";
  const chaves = chavesNovas(o.bits ?? 2048);
  const emissor = o.autoassinado ? { chaves, certificado: null } : acDeTeste(o.cadeia ?? "raiz");
  const c = forge.pki.createCertificate();
  c.publicKey = chaves.publica;
  c.serialNumber = `0${Math.floor(Math.random() * 1e12).toString(16)}`;
  c.validity.notBefore = o.validoDe ?? new Date(Date.now() - 60_000);
  c.validity.notAfter = o.validoAte ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  // CN como UTF8String (a forge codifica): o nome com acento chega igual a quem ler.
  const sujeito = [{ name: "commonName", value: `${o.nome}:${o.numero}`, valueTagClass: asn1.Type.UTF8 }, { name: "organizationName", value: "ICP-Brasil" }];
  c.setSubject(sujeito as forge.pki.CertificateField[]);
  c.setIssuer(emissor.certificado ? emissor.certificado.subject.attributes : (sujeito as forge.pki.CertificateField[]));
  const imprimivel = Boolean(o.textoImprimivel);
  // e-CPF (2.16.76.1.3.1): nascimento DDMMAAAA + CPF + NIS + RG + órgão; e-CNPJ (2.16.76.1.3.3): o CNPJ.
  const dadosPf = `01011980${o.numero}${"0".repeat(11)}${"0".repeat(15)}SSPSP `;
  const responsavel = o.responsavel === undefined ? { cpf: CPF_RESPONSAVEL_DE_TESTE } : o.responsavel;
  const dadosResponsavel = responsavel ? `${responsavel.nascimento ?? "01011980"}${responsavel.cpf}${"0".repeat(11)}${"0".repeat(15)}SSPSP     ` : "";
  const otherNames = o.semIcp
    ? []
    : o.tipo === "PJ"
      ? [
          ...(responsavel ? [outroNome("2.16.76.1.3.2", responsavel.nome ?? "RESPONSAVEL DE TESTE", imprimivel), outroNome("2.16.76.1.3.4", dadosResponsavel, imprimivel)] : []),
          outroNome("2.16.76.1.3.3", o.numero, imprimivel),
        ]
      : [outroNome("2.16.76.1.3.1", dadosPf, imprimivel)];
  const politica = o.politica === undefined ? "A1" : o.politica;
  const extensoes: object[] = [
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, nonRepudiation: true, keyEncipherment: true, critical: true },
  ];
  if (otherNames.length) extensoes.push({ id: "2.5.29.17", value: asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, otherNames) });
  if (politica) {
    const info = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(OID_POLITICA[politica]).getBytes())]);
    extensoes.push({ id: "2.5.29.32", value: asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [info]) });
  }
  c.setExtensions(extensoes);
  c.sign(emissor.chaves.privada, forge.md.sha256.create());
  const cadeia = emissor.certificado ? [c, emissor.certificado, ...(o.cadeia?.startsWith("intermediaria") ? [acDeTeste("raiz").certificado] : [])] : [c];
  const p12 = forge.pkcs12.toPkcs12Asn1(chaves.privada, cadeia, senha, { algorithm: o.legado ? "3des" : "aes256" });
  return { pfx: Buffer.from(asn1.toDer(p12).getBytes(), "binary"), senha };
}
