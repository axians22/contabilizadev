// Parte do termo de autorização que não depende do node-forge: textos oficiais, montagem do XML (já na forma canônica),
// regras do certificado sobre as informações já lidas, a assinatura XMLDSig com uma chave qualquer (assinarTermoCom,
// assíncrona, para a chave não exportável do navegador) e as datas. Separada de termo-autorizacao.ts para a tela usar
// a chave guardada no navegador sem carregar o node-forge, que só é preciso para abrir o .pfx. termo-autorizacao.ts
// reexporta tudo daqui.
//
// As mensagens de erro daqui chegam à tela do cliente: nunca citam o fornecedor (a fonte é a Receita Federal).
import { cnpjValido, formatarCnpj } from "../formato.ts";

// Textos fixos do termo (dados de domínio oficiais). No modelo XML da página oficial, as quebras de linha do HTML
// grudam palavras ("deautorização", "AUTORPEDIDO", "webdisponibilizados", "APIINTEGRA", "OUTORGADODO"...); a tabela
// "Layout XML" e a página "Dados de Domínio" trazem os mesmos textos com os espaços certos, e é essa a versão usada.
// PONTO A CONFIRMAR no primeiro teste real: se a Receita recusar o layout (AUTENTICAPROCURADOR-013/016), comparar
// com a versão grudada.
export const SISTEMA = "API Integra Contador";
export const TEXTO_TERMO =
  "Autorizo a empresa CONTRATANTE, identificada neste termo de autorização como DESTINATÁRIO, a executar as requisições dos serviços web disponibilizados pela API INTEGRA CONTADOR, onde terei o papel de AUTOR PEDIDO DE DADOS no corpo da mensagem enviada na requisição do serviço web. Esse termo de autorização está assinado digitalmente com o certificado digital do PROCURADOR ou OUTORGADO DO CONTRIBUINTE responsável, identificado como AUTOR DO PEDIDO DE DADOS.";
export const TEXTO_AVISO_LEGAL =
  "O acesso a estas informações foi autorizado pelo próprio PROCURADOR ou OUTORGADO DO CONTRIBUINTE, responsável pela informação, via assinatura digital. É dever do destinatário da autorização e consumidor deste acesso observar a adoção de base legal para o tratamento dos dados recebidos conforme artigos 7º ou 11º da LGPD (Lei n.º 13.709, de 14 de agosto de 2018), aos direitos do titular dos dados (art. 9º, 17 e 18, da LGPD) e aos princípios que norteiam todos os tratamentos de dados no Brasil (art. 6º, da LGPD).";
export const TEXTO_FINALIDADE =
  "A finalidade única e exclusiva desse TERMO DE AUTORIZAÇÃO, é garantir que o CONTRATANTE apresente a API INTEGRA CONTADOR esse consentimento do PROCURADOR ou OUTORGADO DO CONTRIBUINTE assinado digitalmente, para que possa realizar as requisições dos serviços web da API INTEGRA CONTADOR em nome do AUTOR PEDIDO DE DADOS (PROCURADOR ou OUTORGADO DO CONTRIBUINTE).";
export const PAPEL_DESTINATARIO = "contratante";
export const PAPEL_ASSINANTE = "autor pedido de dados";

export const DSIG = "http://www.w3.org/2000/09/xmldsig#";
export const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
export const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
export const RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
export const SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256";
export const DECLARACAO = '<?xml version="1.0" encoding="UTF-8"?>';

export type TipoPessoa = "PF" | "PJ";
export type Pessoa = { tipo: TipoPessoa; numero: string; nome: string };
export type PessoaJuridica = { numero: string; nome: string };

// Quem assina é sempre a empresa (e-CNPJ, tipo PJ): ela é o autor do pedido de dados e o próprio contribuinte, então
// não precisa de procuração no e-CAC. O destinatário é a plataforma (contratante).
export type DadosTermo = {
  destinatario: PessoaJuridica;
  assinadoPor: PessoaJuridica;
  dataAssinatura: string; // AAAAMMDD
  vigencia: string; // AAAAMMDD
};

export class ErroCertificado extends Error {}

// Caracteres ocultos (controle, larguras zero, BOM) provocam o erro AUTENTICAPROCURADOR-013.
const faixa = (de: number, ate: number) => `${String.fromCharCode(de)}-${String.fromCharCode(ate)}`;
const OCULTOS = new RegExp(
  `[${[faixa(0x00, 0x1f), faixa(0x7f, 0x9f), faixa(0xad, 0xad), faixa(0x200b, 0x200f), faixa(0x2028, 0x202e), faixa(0x2060, 0x206f), faixa(0xfeff, 0xfeff)].join("")}]`,
  "g",
);
export const limparTexto = (v: string) => v.normalize("NFC").replace(OCULTOS, " ").replace(/\s+/g, " ").trim();

// Escape de valor de atributo na forma canônica (C14N 1.0, seção 2.2).
const escAtributo = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/\t/g, "&#x9;").replace(/\n/g, "&#xA;").replace(/\r/g, "&#xD;");

// Elemento sem filhos na forma canônica: atributos em ordem alfabética e marca de fechamento explícita.
function elemento(nome: string, atributos: Record<string, string>): string {
  const attrs = Object.keys(atributos)
    .sort()
    .map((k) => ` ${k}="${escAtributo(atributos[k])}"`)
    .join("");
  return `<${nome}${attrs}></${nome}>`;
}

export function dataValida(aaaammdd: string): boolean {
  if (!/^\d{8}$/.test(aaaammdd)) return false;
  const [a, m, d] = [aaaammdd.slice(0, 4), aaaammdd.slice(4, 6), aaaammdd.slice(6)].map(Number);
  const data = new Date(Date.UTC(a, m - 1, d));
  return data.getUTCFullYear() === a && data.getUTCMonth() === m - 1 && data.getUTCDate() === d;
}

// CNPJ como o termo exige: 14 posições, só números, com os dígitos verificadores certos.
export const cnpjDoTermoValido = (numero: string) => /^\d{14}$/.test(numero) && cnpjValido(numero);

// Monta o termo (sem assinatura), com a declaração XML exigida e sem indentação nem quebras de linha.
export function montarTermo(d: DadosTermo): string {
  const destinatario = { numero: d.destinatario.numero, nome: limparTexto(d.destinatario.nome) };
  const assinadoPor = { numero: d.assinadoPor.numero, nome: limparTexto(d.assinadoPor.nome) };
  if (!cnpjDoTermoValido(destinatario.numero)) throw new Error("CNPJ da plataforma inválido no termo (14 dígitos, só números).");
  if (!destinatario.nome) throw new Error("Falta a razão social da plataforma no termo.");
  if (!cnpjDoTermoValido(assinadoPor.numero)) throw new Error("CNPJ da empresa inválido no termo (14 dígitos, só números, com os dígitos verificadores certos).");
  if (!assinadoPor.nome) throw new Error("Falta a razão social da empresa no termo.");
  if (!dataValida(d.dataAssinatura)) throw new Error("Data de assinatura inválida (AAAAMMDD).");
  if (!dataValida(d.vigencia)) throw new Error("Data de vigência inválida (AAAAMMDD).");
  if (d.vigencia < d.dataAssinatura) throw new Error("A vigência não pode ser anterior à data de assinatura.");
  const dados = [
    elemento("sistema", { id: SISTEMA }),
    elemento("termo", { texto: TEXTO_TERMO }),
    elemento("avisoLegal", { texto: TEXTO_AVISO_LEGAL }),
    elemento("finalidade", { texto: TEXTO_FINALIDADE }),
    elemento("dataAssinatura", { data: d.dataAssinatura }),
    elemento("vigencia", { data: d.vigencia }),
    elemento("destinatario", { numero: destinatario.numero, nome: destinatario.nome, tipo: "PJ", papel: PAPEL_DESTINATARIO }),
    elemento("assinadoPor", { numero: assinadoPor.numero, nome: assinadoPor.nome, tipo: "PJ", papel: PAPEL_ASSINANTE }),
  ].join("");
  return `${DECLARACAO}<termoDeAutorizacao><dados>${dados}</dados></termoDeAutorizacao>`;
}

// ---- Certificado (ICP-Brasil) ----

// OIDs do "otherName" no SubjectAltName dos certificados ICP-Brasil (DOC-ICP-04): 2.16.76.1.3.1 = dados da pessoa
// física (nascimento + CPF + ...); 2.16.76.1.3.3 = CNPJ da pessoa jurídica.
export const OID_PF = "2.16.76.1.3.1";
export const OID_CNPJ = "2.16.76.1.3.3";
// e-CNPJ: dados do responsável pelo certificado (DOC-ICP-04): nascimento DDMMAAAA (posições 1 a 8), CPF (9 a 19), NIS,
// RG e órgão expedidor.
export const OID_RESPONSAVEL = "2.16.76.1.3.4";
export type Politica = "A1" | "A2" | "A3" | "A4" | "S" | "outra";

export type InfoCertificado = {
  titular: Pessoa;
  validoDe: Date;
  validoAte: Date;
  autoassinado: boolean;
  icpBrasil: boolean; // tem as extensões de identificação da ICP-Brasil
  politica: Politica | null; // null = sem política da ICP-Brasil
  emissor: string;
  bitsChave: number; // tamanho do módulo RSA da chave pública
  certificadoBase64: string; // DER em base64, sem quebras (para o X509Certificate)
  // Lidos dos OIDs da ICP-Brasil (opcionais: o certificado guardado no navegador antes de 21/10/2026 não tem): o CNPJ do
  // OID 2.16.76.1.3.3 (sem cair para o CN) e o responsável do OID 2.16.76.1.3.4.
  cnpjIcp?: string | null;
  responsavel?: { cpf: string; nascimento: string } | null;
};

// "Padrões técnicos de assinatura": "Tamanho da chave criptográfica: compatível com os certificados A1 e A3 (2048
// bits)". A mesma página cita 1024 como padrão antigo, mas a ICP-Brasil não emite mais chave de 1024
// (DOC-ICP-01.01): um certificado assim seria recusado e a chamada cobrada à toa.
export const BITS_MINIMOS_CHAVE = 2048;

export function conferirTamanhoChave(info: Pick<InfoCertificado, "bitsChave">): void {
  if (!(info.bitsChave >= BITS_MINIMOS_CHAVE)) {
    throw new ErroCertificado(
      `A chave do certificado tem ${info.bitsChave} bits; a Receita Federal exige pelo menos ${BITS_MINIMOS_CHAVE} bits. Use um certificado mais novo.`,
    );
  }
}

// PEM de um certificado em base64 (DER): linhas de 64 caracteres e nenhuma linha em branco. Com o tamanho múltiplo
// de 64, uma quebra a mais antes do END faz o OpenSSL recusar o PEM (erro DECODER unsupported).
export function pemDoCertificado(base64: string): string {
  const linhas = base64.replace(/\s/g, "").match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${linhas.join("\n")}\n-----END CERTIFICATE-----\n`;
}

// Só o e-CNPJ A1 da própria empresa serve. e-CPF: o autor do pedido seria a pessoa, que precisaria de procuração da
// empresa no e-CAC. A3 (token ou cartão): a chave não sai do dispositivo, e o navegador não assina com ele sem um
// programa instalado; num .pfx só vem A1. A2/A4 e certificados de sigilo (S) não são aceitos.
export function conferirTipo(info: Pick<InfoCertificado, "titular" | "politica">, cnpjEmpresa: string): void {
  if (info.titular.tipo === "PF") {
    throw new ErroCertificado("Este é um e-CPF (certificado de pessoa física). Use o e-CNPJ A1 da própria empresa.");
  }
  if (info.politica === "A3") {
    throw new ErroCertificado("Este é um certificado A3 (token ou cartão), que não serve aqui. Use o e-CNPJ A1 da empresa (arquivo .pfx ou .p12).");
  }
  if (info.politica !== "A1") {
    throw new ErroCertificado("Este certificado não é um e-CNPJ A1 da ICP-Brasil. Use o e-CNPJ A1 da empresa (arquivo .pfx ou .p12).");
  }
  if (info.titular.numero !== cnpjEmpresa) {
    throw new ErroCertificado(
      `Este é o e-CNPJ do CNPJ ${formatarCnpj(info.titular.numero)}, não o da empresa (${formatarCnpj(cnpjEmpresa)}). Use o e-CNPJ A1 da própria empresa.`,
    );
  }
}

// Conferências que a tela faz logo depois de abrir o .pfx, antes de assinar (o servidor confere tudo de novo em
// conferirTermo): tamanho da chave, validade, e-CNPJ A1 e se é o CNPJ da empresa.
export function conferirAntesDeAssinar(info: InfoCertificado, cnpjEmpresa: string, agora: Date): void {
  conferirTipo(info, cnpjEmpresa);
  conferirTamanhoChave(info);
  if (agora >= info.validoAte) throw new ErroCertificado("O certificado está vencido. Renove o e-CNPJ e assine de novo.");
  if (agora < info.validoDe) throw new ErroCertificado("O certificado ainda não está valendo.");
}

// ---- Assinatura ----

// SignedInfo como fica no documento (o namespace vem do <Signature>); na forma canônica ele recebe o xmlns.
const signedInfo = (digest: string, xmlns: boolean) =>
  `<SignedInfo${xmlns ? ` xmlns="${DSIG}"` : ""}><CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod><SignatureMethod Algorithm="${RSA_SHA256}"></SignatureMethod><Reference URI=""><Transforms><Transform Algorithm="${ENVELOPED}"></Transform><Transform Algorithm="${C14N}"></Transform></Transforms><DigestMethod Algorithm="${SHA256}"></DigestMethod><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;

// O texto que a chave assina (RSA-SHA256): o SignedInfo canônico para o digest (SHA-256 em base64) do documento.
export const signedInfoDoTermo = (digest: string) => signedInfo(digest, true);

// C14N do documento (URI="" com a transformação enveloped): sem a declaração XML e sem a assinatura. O termo montado
// por montarTermo já está na forma canônica, então é o próprio elemento raiz.
export function documentoDoTermo(xml: string): string {
  if (!xml.startsWith(`${DECLARACAO}<termoDeAutorizacao>`) || !xml.endsWith("</termoDeAutorizacao>") || /<Signature[\s>]/.test(xml)) {
    throw new Error("O termo precisa ser o montado por montarTermo, ainda sem assinatura.");
  }
  return xml.slice(DECLARACAO.length);
}

// Coloca a assinatura no termo: XMLDSig enveloped, Reference URI="" (o documento inteiro), C14N, RSA-SHA256, digest
// SHA-256 e só o certificado do titular no KeyInfo (EndCertOnly). <Signature> com o próprio namespace, como último
// filho de <termoDeAutorizacao>, nessa ordem: SignedInfo, SignatureValue, KeyInfo.
export function assinaturaDoTermo(xml: string, digest: string, valor: string, certificadoBase64: string): string {
  documentoDoTermo(xml);
  const assinatura =
    `<Signature xmlns="${DSIG}">${signedInfo(digest, false)}<SignatureValue>${valor}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${certificadoBase64}</X509Certificate></X509Data></KeyInfo></Signature>`;
  return xml.replace(/<\/termoDeAutorizacao>$/, `${assinatura}</termoDeAutorizacao>`);
}

const base64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

// Assina o termo com uma chave que só sabe assinar um texto (RSA-SHA256, PKCS#1 v1.5, devolvendo base64): a chave
// não exportável do navegador (WebCrypto), guardada ou só em memória. O digest sai do WebCrypto (navegador e Node 22).
export async function assinarTermoCom(xml: string, certificadoBase64: string, assinar: (texto: string) => Promise<string>): Promise<string> {
  const documento = documentoDoTermo(xml);
  const digest = base64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(documento))));
  return assinaturaDoTermo(xml, digest, await assinar(signedInfoDoTermo(digest)), certificadoBase64);
}

// ---- Datas ----

// Data AAAAMMDD de um instante no horário de Brasília (as datas do termo são comparadas com o dia corrente de lá).
export function dataEmBrasilia(instante: Date): string {
  return instante.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).replace(/-/g, "");
}

// Data AAAAMMDD somada de dias (calendário, sem fuso).
export function somarDias(aaaammdd: string, dias: number): string {
  const d = new Date(Date.UTC(+aaaammdd.slice(0, 4), +aaaammdd.slice(4, 6) - 1, +aaaammdd.slice(6)));
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

// Vigência padrão do termo: 1 ano a partir da assinatura (o mesmo dia do ano seguinte; 29/02 vira 28/02). A
// documentação oficial (Padrões técnicos, Dados de domínio, Mensagens) não fixa prazo máximo: só exige vigência maior
// ou igual à data corrente (AUTENTICAPROCURADOR-017). Um ano é a escolha da plataforma, limitada pela validade do
// certificado (vigenciaPara), para o cliente renovar junto com o e-CNPJ A1, que também vale um ano.
export function vigenciaPadrao(dataAssinatura: string): string {
  const ano = +dataAssinatura.slice(0, 4) + 1;
  const mesDia = dataAssinatura.slice(4);
  return mesDia === "0229" ? `${ano}0228` : `${ano}${mesDia}`;
}

// Vigência do termo: a pedida, limitada ao último dia de validade do certificado (depois disso a Receita recusa:
// "Certificado Digital está expirado", AUTENTICAPROCURADOR-010).
export function vigenciaPara(vigenciaPedida: string, certificado: Pick<InfoCertificado, "validoAte">): string {
  const ultimoDia = dataEmBrasilia(certificado.validoAte);
  return vigenciaPedida < ultimoDia ? vigenciaPedida : ultimoDia;
}
