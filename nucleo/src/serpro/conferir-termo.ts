// Conferência, no servidor, do termo de autorização assinado no navegador (termo-autorizacao.ts), antes de gastar uma
// chamada do contrato: layout oficial nó a nó, textos oficiais, destinatário (a plataforma), assinatura (XMLDSig
// enveloped, C14N, RSA-SHA256, uma Reference URI="", só o X509Certificate no KeyInfo), certificado (e-CNPJ A1 da
// ICP-Brasil da própria empresa, não autoassinado, dentro da validade, chave de 2048 bits ou mais) e datas.
//
// Fontes oficiais: "Padrões técnicos de assinatura" (layout e regras do certificado) e "Mensagens" do Autentica
// Procurador (https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-contador-gerenciador/autenticaprocurador/).
// As mensagens de erro daqui chegam à tela do cliente: nunca citam o fornecedor.
import { createHash } from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import { verificarAssinatura } from "../assinatura.ts";
import { formatarCnpj } from "../formato.ts";
import { conferirCadeia, confiancaIcpBrasil, ErroCadeia, type Confianca } from "./cadeia-icp.ts";
import {
  C14N,
  cnpjDoTermoValido,
  conferirTamanhoChave,
  conferirTipo,
  dataEmBrasilia,
  dataValida,
  DECLARACAO,
  DSIG,
  ENVELOPED,
  lerCertificado,
  limparTexto,
  montarTermo,
  PAPEL_ASSINANTE,
  PAPEL_DESTINATARIO,
  pemDoCertificado,
  RSA_SHA256,
  SHA256,
  SISTEMA,
  TEXTO_AVISO_LEGAL,
  TEXTO_FINALIDADE,
  TEXTO_TERMO,
  type InfoCertificado,
  type PessoaJuridica,
} from "./termo-autorizacao.ts";

// Tamanho máximo aceito do XML assinado (um termo tem uns 5 KB; o certificado é a maior parte).
export const TAMANHO_MAXIMO_TERMO = 64 * 1024;

export class ErroTermo extends Error {}

export type Esperado = {
  contratante: PessoaJuridica; // a plataforma (destinatário do termo): CNPJ e razão social
  contribuinte: string; // CNPJ da empresa ativa (quem assina)
  // CPF de quem está logado e envia o termo: tem de ser o do responsável pelo e-CNPJ (OID 2.16.76.1.3.4). Sem ele, a
  // conferência do responsável não é feita (só o núcleo testa assim; a plataforma sempre passa).
  cpfResponsavel?: string;
  // Raízes e ACs aceitas para a cadeia do certificado (padrão: as oficiais da ICP-Brasil; os testes usam as de teste).
  confianca?: Confianca;
};

// CPF mostrado só com o meio, como a Receita publica o quadro de sócios: ***.456.789-**.
export const cpfMascarado = (cpf: string) => `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;

export const outroResponsavel = (cpf: string) =>
  `Este e-CNPJ está em nome de outro responsável (CPF ${cpfMascarado(cpf)}). Quem assina o termo precisa entrar com a própria conta.`;

export type TermoConferido = {
  assinadoPor: PessoaJuridica;
  destinatario: PessoaJuridica;
  dataAssinatura: string; // AAAAMMDD
  vigencia: string; // AAAAMMDD
  certificado: InfoCertificado;
  hash: string; // SHA-256 (hex) do XML assinado, para reconhecer o mesmo termo enviado de novo
};

function lerXml(xml: string) {
  const erros: string[] = [];
  const doc = new DOMParser({
    errorHandler: { warning: (m) => void erros.push(String(m)), error: (m) => void erros.push(String(m)), fatalError: (m) => void erros.push(String(m)) },
  }).parseFromString(xml, "text/xml");
  if (erros.length || !doc?.documentElement) throw new ErroTermo("O termo assinado está mal formado. Assine de novo.");
  return doc;
}

type No = {
  localName?: string | null;
  namespaceURI?: string | null;
  nodeType: number;
  childNodes: ArrayLike<No>;
  getAttribute?: (n: string) => string | null;
  textContent?: string | null;
  attributes?: ArrayLike<{ name: string }>;
};
const filhos = (n: No) => Array.from(n.childNodes).filter((c) => c.nodeType === 1);
const um = (n: No, nome: string, ns: string | null = null): No => {
  const achados = filhos(n).filter((c) => c.localName === nome && (c.namespaceURI ?? null) === ns);
  if (achados.length !== 1) throw new ErroTermo(`Layout do termo inválido: precisa de exatamente uma tag ${nome}.`);
  return achados[0];
};
const atributo = (n: No, nome: string) => n.getAttribute?.(nome) ?? "";
const atributos = (n: No) =>
  Array.from(n.attributes ?? [])
    .map((a) => a.name)
    .sort()
    .join(",");

// Layout nó a nó da assinatura (fora do SignedInfo nada é coberto por ela): cada tag só com os atributos do padrão;
// as de valor (DigestValue, SignatureValue, X509Certificate) com um único nó de texto em base64; as de algoritmo
// vazias; e as demais só com tags dentro (sem texto solto, comentário, instrução de processamento ou CDATA). A
// documentação pede "apenas a tag X509Certificate nas informações que dizem respeito ao certificado".
const ATRIBUTOS_DSIG: Record<string, string> = {
  Signature: "xmlns",
  CanonicalizationMethod: "Algorithm",
  SignatureMethod: "Algorithm",
  Reference: "URI",
  Transform: "Algorithm",
  DigestMethod: "Algorithm",
};
const TAGS_COM_VALOR = new Set(["DigestValue", "SignatureValue", "X509Certificate"]);
const TAGS_VAZIAS = new Set(["CanonicalizationMethod", "SignatureMethod", "Transform", "DigestMethod"]);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function conferirLayoutAssinatura(n: No): void {
  const nome = n.localName ?? "";
  if (n.namespaceURI !== DSIG) throw new ErroTermo("A assinatura só pode ter tags do XMLDSig.");
  if (atributos(n) !== (ATRIBUTOS_DSIG[nome] ?? "")) throw new ErroTermo(`A tag ${nome} da assinatura tem atributos fora do padrão.`);
  const nos = Array.from(n.childNodes);
  if (TAGS_COM_VALOR.has(nome)) {
    if (nos.length !== 1 || nos[0].nodeType !== 3 || !BASE64.test(nos[0].textContent ?? "")) {
      throw new ErroTermo(`A tag ${nome} da assinatura deve ter só o valor em base64.`);
    }
    return;
  }
  if (TAGS_VAZIAS.has(nome)) {
    if (nos.length) throw new ErroTermo(`A tag ${nome} da assinatura deve ser vazia.`);
    return;
  }
  if (nos.some((c) => c.nodeType !== 1)) throw new ErroTermo(`A tag ${nome} da assinatura só pode ter outras tags dentro (sem texto, comentário ou instrução).`);
  for (const c of nos) conferirLayoutAssinatura(c);
}

const FORMA_GERAL = /^<termoDeAutorizacao><dados><[^]*<\/dados><Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#"><[^]*<\/Signature><\/termoDeAutorizacao>$/;

export function conferirTermo(xml: string, esperado: Esperado, agora: Date): TermoConferido {
  if (typeof xml !== "string" || !xml) throw new ErroTermo("Termo vazio.");
  if (xml.length > TAMANHO_MAXIMO_TERMO) throw new ErroTermo("Termo grande demais.");
  if (!xml.startsWith(DECLARACAO)) throw new ErroTermo('O termo precisa começar com <?xml version="1.0" encoding="UTF-8"?>.');
  if (xml.slice(DECLARACAO.length).includes("<?xml")) throw new ErroTermo("O termo só pode ter uma declaração XML.");
  if (limparTexto(xml) !== xml) throw new ErroTermo("O termo tem quebras de linha, indentação ou caracteres ocultos, que a Receita Federal recusa.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ErroTermo("O termo não pode ter DOCTYPE.");
  if (!xml.startsWith(`${DECLARACAO}<termoDeAutorizacao>`)) throw new ErroTermo("A tag raiz deve ser termoDeAutorizacao.");
  // O parser do xmldom tolera alguns erros de sintaxe; a forma geral é conferida no texto antes.
  if (!FORMA_GERAL.test(xml.slice(DECLARACAO.length))) throw new ErroTermo("O termo assinado está mal formado: esperado <termoDeAutorizacao> com <dados> e <Signature>.");

  const raiz = lerXml(xml).documentElement as unknown as No;
  if (raiz.localName !== "termoDeAutorizacao" || raiz.namespaceURI) throw new ErroTermo("A tag raiz deve ser termoDeAutorizacao.");
  if (filhos(raiz).length !== 2) throw new ErroTermo("O termo deve ter só a tag dados e a assinatura.");
  const dados = um(raiz, "dados");
  const assinatura = um(raiz, "Signature", DSIG);

  // dados: as oito tags, com os atributos e textos oficiais.
  if (filhos(dados).length !== 8) throw new ErroTermo("Layout do termo inválido: a tag dados deve ter só as tags oficiais.");
  const sistema = um(dados, "sistema");
  if (atributos(sistema) !== "id" || atributo(sistema, "id") !== SISTEMA) throw new ErroTermo("Layout do termo inválido: a tag sistema não tem o valor oficial.");
  for (const [tag, texto] of [["termo", TEXTO_TERMO], ["avisoLegal", TEXTO_AVISO_LEGAL], ["finalidade", TEXTO_FINALIDADE]] as const) {
    const n = um(dados, tag);
    if (atributos(n) !== "texto" || atributo(n, "texto") !== texto) throw new ErroTermo(`O texto da tag ${tag} não é o texto oficial do termo.`);
  }
  const dataAssinatura = atributo(um(dados, "dataAssinatura"), "data");
  const vigencia = atributo(um(dados, "vigencia"), "data");
  if (!dataValida(dataAssinatura)) throw new ErroTermo("Data de assinatura inválida (AAAAMMDD).");
  if (!dataValida(vigencia)) throw new ErroTermo("Data de vigência inválida (AAAAMMDD).");

  const destinatarioNo = um(dados, "destinatario");
  const destinatario = { numero: atributo(destinatarioNo, "numero"), nome: atributo(destinatarioNo, "nome") };
  if (atributos(destinatarioNo) !== "nome,numero,papel,tipo" || atributo(destinatarioNo, "tipo") !== "PJ" || atributo(destinatarioNo, "papel") !== PAPEL_DESTINATARIO) {
    throw new ErroTermo('Layout do termo inválido: destinatario precisa de numero, nome, tipo="PJ" e papel="contratante".');
  }
  if (destinatario.numero !== esperado.contratante.numero || destinatario.nome !== limparTexto(esperado.contratante.nome)) {
    throw new ErroTermo("O termo não foi feito para esta plataforma. Recarregue a página e assine de novo.");
  }

  const assinadoPorNo = um(dados, "assinadoPor");
  if (atributos(assinadoPorNo) !== "nome,numero,papel,tipo" || atributo(assinadoPorNo, "papel") !== PAPEL_ASSINANTE) {
    throw new ErroTermo('Layout do termo inválido: assinadoPor precisa de numero, nome, tipo e papel="autor pedido de dados".');
  }
  if (atributo(assinadoPorNo, "tipo") !== "PJ") throw new ErroTermo("O termo precisa ser assinado pela empresa (e-CNPJ), não por pessoa física.");
  const assinadoPor = { numero: atributo(assinadoPorNo, "numero"), nome: atributo(assinadoPorNo, "nome") };
  if (!cnpjDoTermoValido(assinadoPor.numero)) throw new ErroTermo("CNPJ de quem assina inválido.");
  if (assinadoPor.numero !== esperado.contribuinte) throw new ErroTermo("O termo foi assinado por outro CNPJ, não pela empresa. Use o e-CNPJ A1 da própria empresa.");
  // Os dados têm de ser exatamente os que montarTermo gera com esses valores (forma canônica, nada a mais).
  let montado: string;
  try {
    montado = montarTermo({ destinatario, assinadoPor, dataAssinatura, vigencia });
  } catch (erro) {
    throw new ErroTermo((erro as Error).message);
  }
  if (!xml.startsWith(montado.replace(/<\/termoDeAutorizacao>$/, "<Signature "))) {
    throw new ErroTermo("O termo não está no formato montado pela plataforma. Recarregue a página e assine de novo.");
  }

  // Assinatura: só o subconjunto aceito.
  const signedInfo = um(assinatura, "SignedInfo", DSIG);
  if (atributo(um(signedInfo, "CanonicalizationMethod", DSIG), "Algorithm") !== C14N) throw new ErroTermo("CanonicalizationMethod deve ser C14N.");
  if (atributo(um(signedInfo, "SignatureMethod", DSIG), "Algorithm") !== RSA_SHA256) throw new ErroTermo("SignatureMethod deve ser RSA-SHA256.");
  const reference = um(signedInfo, "Reference", DSIG);
  if (atributo(reference, "URI") !== "") throw new ErroTermo('A assinatura deve ser sobre o documento inteiro (Reference URI="").');
  const transformsNo = um(reference, "Transforms", DSIG);
  const transforms = filhos(transformsNo).map((t) => atributo(t, "Algorithm"));
  if (filhos(transformsNo).some((t) => t.localName !== "Transform" || t.namespaceURI !== DSIG) || transforms.join(" ") !== `${ENVELOPED} ${C14N}`) {
    throw new ErroTermo("As transformações devem ser enveloped-signature e C14N.");
  }
  if (atributo(um(reference, "DigestMethod", DSIG), "Algorithm") !== SHA256) throw new ErroTermo("DigestMethod deve ser SHA-256.");
  // Fora do SignedInfo nada é coberto pela assinatura: o resto do layout é conferido aqui. A documentação pede só o
  // X509Certificate no KeyInfo (EndCertOnly) e o exemplo oficial traz Signature = SignedInfo, SignatureValue, KeyInfo.
  const ordem = (n: No) => filhos(n).map((c) => `${c.namespaceURI ?? ""} ${c.localName}`).join("|");
  const esperadoDsig = (...nomes: string[]) => nomes.map((n) => `${DSIG} ${n}`).join("|");
  if (ordem(assinatura) !== esperadoDsig("SignedInfo", "SignatureValue", "KeyInfo")) throw new ErroTermo("A assinatura deve ter só SignedInfo, SignatureValue e KeyInfo, nessa ordem.");
  if (ordem(signedInfo) !== esperadoDsig("CanonicalizationMethod", "SignatureMethod", "Reference")) throw new ErroTermo("O SignedInfo deve ter só CanonicalizationMethod, SignatureMethod e uma Reference.");
  if (ordem(reference) !== esperadoDsig("Transforms", "DigestMethod", "DigestValue")) throw new ErroTermo("A Reference deve ter só Transforms, DigestMethod e DigestValue.");
  const keyInfo = um(assinatura, "KeyInfo", DSIG);
  if (ordem(keyInfo) !== esperadoDsig("X509Data")) throw new ErroTermo("O KeyInfo deve ter só o X509Data com o certificado de quem assina.");
  const x509Data = um(keyInfo, "X509Data", DSIG);
  if (ordem(x509Data) !== esperadoDsig("X509Certificate")) throw new ErroTermo("O KeyInfo deve ter só o certificado de quem assina.");
  conferirLayoutAssinatura(assinatura);
  if (xml.slice(xml.indexOf("<Signature ")).includes("&")) throw new ErroTermo("A assinatura não pode ter referências de entidade (&...;).");
  const certificadoBase64 = um(x509Data, "X509Certificate", DSIG).textContent ?? "";

  let certificado: InfoCertificado;
  try {
    certificado = lerCertificado(certificadoBase64);
  } catch (erro) {
    throw new ErroTermo(`Certificado da assinatura: ${(erro as Error).message}`);
  }
  if (!verificarAssinatura(xml, pemDoCertificado(certificado.certificadoBase64))) {
    throw new ErroTermo("A assinatura do termo não confere (o termo foi alterado depois de assinado?). Assine de novo.");
  }

  // Certificado: as regras da Receita que dá para conferir aqui, antes de gastar a chamada (a revogação é conferida por
  // ela na hora do envio). A cadeia é conferida até uma raiz oficial da ICP-Brasil (cadeia-icp.ts): "parecer ICP-Brasil"
  // não basta.
  if (certificado.autoassinado) throw new ErroTermo("O certificado não pode ser autoassinado: use o e-CNPJ A1 da empresa, emitido pela ICP-Brasil.");
  if (!certificado.icpBrasil) throw new ErroTermo("O certificado não tem as extensões da ICP-Brasil: use o e-CNPJ A1 da empresa.");
  if (agora < certificado.validoDe) throw new ErroTermo("O certificado ainda não está valendo.");
  if (agora >= certificado.validoAte) throw new ErroTermo("O certificado está vencido. Renove o e-CNPJ e assine de novo.");
  try {
    conferirCadeia(certificado.certificadoBase64, esperado.confianca ?? confiancaIcpBrasil(), agora);
  } catch (erro) {
    if (erro instanceof ErroCadeia) throw new ErroTermo(`${erro.message} Use o e-CNPJ A1 da empresa, emitido pela ICP-Brasil.`);
    throw erro;
  }
  if (certificado.titular.tipo !== "PJ" || certificado.titular.numero !== assinadoPor.numero) {
    throw new ErroTermo("Quem assina no termo precisa ser o titular do certificado (o mesmo CNPJ).");
  }
  try {
    conferirTipo(certificado, esperado.contribuinte);
    conferirTamanhoChave(certificado);
  } catch (erro) {
    throw new ErroTermo((erro as Error).message);
  }
  // O CNPJ tem de vir do campo da ICP-Brasil (OID 2.16.76.1.3.3), não só do nome do certificado.
  if (!certificado.cnpjIcp) throw new ErroTermo("O certificado não traz o CNPJ no campo da ICP-Brasil: use o e-CNPJ A1 da empresa.");
  if (certificado.cnpjIcp !== esperado.contribuinte) {
    throw new ErroTermo(`Este e-CNPJ é do CNPJ ${formatarCnpj(certificado.cnpjIcp)}, não da empresa. Use o e-CNPJ A1 da própria empresa.`);
  }
  if (esperado.cpfResponsavel !== undefined) {
    if (!certificado.responsavel) throw new ErroTermo("O certificado não traz o CPF do responsável pelo e-CNPJ: use o e-CNPJ A1 da empresa, emitido pela ICP-Brasil.");
    if (certificado.responsavel.cpf !== esperado.cpfResponsavel) throw new ErroTermo(outroResponsavel(certificado.responsavel.cpf));
  }

  // Datas, no dia de Brasília.
  const hoje = dataEmBrasilia(agora);
  if (dataAssinatura > hoje) throw new ErroTermo("A data de assinatura não pode ser depois de hoje.");
  if (dataAssinatura < hoje) throw new ErroTermo("O termo foi montado em outro dia. Recarregue a página e assine de novo.");
  if (vigencia < hoje) throw new ErroTermo("A vigência do termo já terminou.");
  if (vigencia > dataEmBrasilia(certificado.validoAte)) throw new ErroTermo("A vigência do termo passa da validade do certificado.");

  return { assinadoPor, destinatario, dataAssinatura, vigencia, certificado, hash: createHash("sha256").update(xml, "utf8").digest("hex") };
}
