import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { certificadoDeTeste, certificadoIcpDeTeste, type OpcoesCertificadoIcp } from "../certificado-teste.ts";
import { conferirTermo, ErroTermo, type Esperado } from "./conferir-termo.ts";
import { abrirCertificado, assinarTermo, dataEmBrasilia, montarTermo, somarDias, TEXTO_TERMO, type DadosTermo } from "./termo-autorizacao.ts";

const PLATAFORMA = { numero: "11444777000161", nome: "PLATAFORMA DE TESTE LTDA" };
const EMPRESA = "11222333000181";
const ESPERADO: Esperado = { contratante: PLATAFORMA, contribuinte: EMPRESA };
const AGORA = new Date();
const HOJE = dataEmBrasilia(AGORA);
const DIA = 24 * 60 * 60 * 1000;

// Assina um termo como o navegador faria: abre o .pfx, monta com o titular do certificado e assina. `mexer` altera o
// XML antes de assinar (a assinatura continua conferindo); alterações depois de assinar são feitas no resultado.
function termoAssinado(
  opcoes: Partial<OpcoesCertificadoIcp> = {},
  ajustar: (d: DadosTermo) => DadosTermo = (d) => d,
  mexer: (xml: string) => string = (x) => x,
) {
  const c = certificadoIcpDeTeste({ tipo: "PJ", numero: EMPRESA, nome: "EMPRESA DE TESTE LTDA", ...opcoes });
  const aberto = abrirCertificado(c.pfx, c.senha);
  const assinadoPor = { numero: aberto.titular.numero, nome: aberto.titular.nome };
  const xml = montarTermo(ajustar({ destinatario: PLATAFORMA, assinadoPor, dataAssinatura: HOJE, vigencia: somarDias(HOJE, 180) }));
  return assinarTermo(mexer(xml), aberto);
}

// Um termo válido para os testes de layout (gerar chave RSA leva tempo).
const VALIDO = termoAssinado();

test("confere o termo assinado com o e-CNPJ A1 da própria empresa", () => {
  const t = conferirTermo(VALIDO, ESPERADO, AGORA);
  assert.deepEqual(t.assinadoPor, { numero: EMPRESA, nome: "EMPRESA DE TESTE LTDA" });
  assert.deepEqual(t.destinatario, PLATAFORMA);
  assert.equal(t.dataAssinatura, HOJE);
  assert.equal(t.vigencia, somarDias(HOJE, 180));
  assert.equal(t.hash, createHash("sha256").update(VALIDO).digest("hex"));
  assert.equal(t.certificado.titular.numero, EMPRESA);
  assert.equal(t.certificado.politica, "A1");
});

test("recusa e-CNPJ de outra empresa, e-CPF e certificado A3", () => {
  assert.throws(() => conferirTermo(termoAssinado({ numero: "11444777000161" }), ESPERADO, AGORA), /outro CNPJ/);
  // e-CPF: o titular é PF; o termo montado com o CPF nem passa no montarTermo, então assina com o CNPJ no termo.
  const pf = termoAssinado({ tipo: "PF", numero: "52998224725", nome: "JOSE DA SILVA" }, (d) => ({ ...d, assinadoPor: { numero: EMPRESA, nome: "EMPRESA" } }));
  assert.throws(() => conferirTermo(pf, ESPERADO, AGORA), /titular do certificado/);
  const pfNoXml = VALIDO.replace('tipo="PJ"></assinadoPor>', 'tipo="PF"></assinadoPor>');
  assert.throws(() => conferirTermo(pfNoXml, ESPERADO, AGORA), /pela empresa \(e-CNPJ\)/);
  assert.throws(() => conferirTermo(termoAssinado({ politica: "A3" }), ESPERADO, AGORA), /A3 \(token ou cartão\)/);
  assert.throws(() => conferirTermo(termoAssinado({ politica: null }), ESPERADO, AGORA), /não é um e-CNPJ A1/);
});

test("recusa termo feito para outro contratante (CNPJ ou razão social), com texto alterado ou adulterado depois de assinado", () => {
  const outro = termoAssinado(undefined, (d) => ({ ...d, destinatario: { numero: "11222333000181", nome: "OUTRA" } }));
  assert.throws(() => conferirTermo(outro, ESPERADO, AGORA), /não foi feito para esta plataforma/);
  assert.throws(() => conferirTermo(VALIDO, { ...ESPERADO, contratante: { ...PLATAFORMA, nome: "OUTRO NOME" } }, AGORA), /não foi feito para esta plataforma/);
  const texto = termoAssinado(undefined, undefined, (x) => x.replace(TEXTO_TERMO, "Autorizo tudo."));
  assert.throws(() => conferirTermo(texto, ESPERADO, AGORA), /texto oficial/);
  const adulterado = VALIDO.replace(`data="${somarDias(HOJE, 180)}"`, `data="${somarDias(HOJE, 181)}"`);
  assert.throws(() => conferirTermo(adulterado, ESPERADO, AGORA), /não confere/);
  // Assinado por um certificado e com outro no KeyInfo.
  const b = termoAssinado();
  const certB = /<X509Certificate>([^<]+)</.exec(b)![1];
  assert.throws(() => conferirTermo(VALIDO.replace(/<X509Certificate>[^<]+</, `<X509Certificate>${certB}<`), ESPERADO, AGORA), /não confere/);
});

test("recusa certificado autoassinado, sem ICP-Brasil, vencido e ainda não válido", () => {
  assert.throws(() => conferirTermo(termoAssinado({ autoassinado: true }), ESPERADO, AGORA), /autoassinado/);
  assert.throws(() => conferirTermo(termoAssinado({ semIcp: true }), ESPERADO, AGORA), /ICP-Brasil/);
  const vencido = termoAssinado({ validoDe: new Date(AGORA.getTime() - 400 * DIA), validoAte: new Date(AGORA.getTime() - DIA) }, (d) => ({ ...d, vigencia: HOJE }));
  assert.throws(() => conferirTermo(vencido, ESPERADO, AGORA), /vencido/);
  const futuro = termoAssinado({ validoDe: new Date(AGORA.getTime() + DIA) });
  assert.throws(() => conferirTermo(futuro, ESPERADO, AGORA), /ainda não está valendo/);
  // O .pfx do OpenSSL (autoassinado, sem ICP) também é recusado.
  const c = certificadoDeTeste();
  const aberto = abrirCertificado(c.pfx, c.senha);
  const xml = assinarTermo(montarTermo({ destinatario: PLATAFORMA, assinadoPor: { numero: EMPRESA, nome: aberto.titular.nome }, dataAssinatura: HOJE, vigencia: HOJE }), aberto);
  assert.throws(() => conferirTermo(xml, ESPERADO, AGORA), /autoassinado/);
});

test("recusa datas fora da regra: assinatura de outro dia, vigência vencida ou além da validade do certificado", () => {
  const ontem = somarDias(HOJE, -1);
  assert.throws(() => conferirTermo(termoAssinado(undefined, (d) => ({ ...d, dataAssinatura: somarDias(HOJE, 1), vigencia: somarDias(HOJE, 2) })), ESPERADO, AGORA), /depois de hoje/);
  assert.throws(() => conferirTermo(termoAssinado(undefined, (d) => ({ ...d, dataAssinatura: ontem })), ESPERADO, AGORA), /outro dia/);
  const curto = { validoAte: new Date(AGORA.getTime() + 10 * DIA) };
  assert.throws(() => conferirTermo(termoAssinado(curto, (d) => ({ ...d, vigencia: somarDias(HOJE, 60) })), ESPERADO, AGORA), /validade do certificado/);
  // No dia seguinte o mesmo termo já não passa (data de assinatura de ontem).
  assert.throws(() => conferirTermo(VALIDO, ESPERADO, new Date(AGORA.getTime() + DIA)), /outro dia/);
});

test("recusa XML fora do padrão antes de olhar a assinatura", () => {
  const xml = VALIDO;
  assert.throws(() => conferirTermo("", ESPERADO, AGORA), /vazio/);
  assert.throws(() => conferirTermo("x".repeat(70_000), ESPERADO, AGORA), /grande demais/);
  assert.throws(() => conferirTermo(xml.replace('<?xml version="1.0" encoding="UTF-8"?>', ""), ESPERADO, AGORA), /começar com/);
  assert.throws(() => conferirTermo(xml.replace("<dados>", "\n<dados>"), ESPERADO, AGORA), /quebras de linha/);
  assert.throws(() => conferirTermo(xml.replace("<dados>", `<dados>${String.fromCharCode(0x200b)}`), ESPERADO, AGORA), /ocultos/);
  assert.throws(() => conferirTermo(xml.replace("<termoDeAutorizacao>", '<?xml version="1.0"?><termoDeAutorizacao>'), ESPERADO, AGORA), /uma declaração/);
  assert.throws(() => conferirTermo(xml.replace("<termoDeAutorizacao>", "<!DOCTYPE x [<!ENTITY a 'b'>]><termoDeAutorizacao>"), ESPERADO, AGORA), /DOCTYPE/);
  assert.throws(() => conferirTermo(xml.replace(/termoDeAutorizacao>/g, "termo>"), ESPERADO, AGORA), /raiz deve ser termoDeAutorizacao/);
  assert.throws(() => conferirTermo(xml.replace("</dados>", "</dados"), ESPERADO, AGORA), /mal formado/);
  assert.throws(() => conferirTermo(xml.replace('<Reference URI="">', '<Reference URI="#x">'), ESPERADO, AGORA), /documento inteiro/);
  assert.throws(() => conferirTermo(xml.replace("</Reference>", '</Reference><Reference URI=""></Reference>'), ESPERADO, AGORA), /exatamente uma tag Reference/);
  assert.throws(() => conferirTermo(xml.replace("xmldsig-more#rsa-sha256", "xmldsig#rsa-sha1"), ESPERADO, AGORA), /RSA-SHA256/);
  assert.throws(() => conferirTermo(xml.replace(/<Transform Algorithm="[^"]+enveloped-signature"><\/Transform>/, ""), ESPERADO, AGORA), /transformações/);
  assert.throws(() => conferirTermo(xml.replace("</X509Certificate>", "</X509Certificate><X509SubjectName>CN=X</X509SubjectName>"), ESPERADO, AGORA), /só o certificado/);
  // Fora do SignedInfo (a assinatura continua conferindo): só o layout da documentação passa.
  assert.throws(() => conferirTermo(xml.replace("<KeyInfo>", "<KeyInfo><KeyName>x</KeyName>"), ESPERADO, AGORA), /KeyInfo deve ter só/);
  assert.throws(() => conferirTermo(xml.replace("</X509Data></KeyInfo>", "</X509Data><X509Data></X509Data></KeyInfo>"), ESPERADO, AGORA), /KeyInfo deve ter só/);
  assert.throws(() => conferirTermo(xml.replace("</KeyInfo></Signature>", "</KeyInfo><Object>x</Object></Signature>"), ESPERADO, AGORA), /só SignedInfo, SignatureValue e KeyInfo/);
  const keyInfo = /<KeyInfo>.*<\/KeyInfo>/.exec(xml)![0];
  assert.throws(() => conferirTermo(xml.replace(keyInfo, "").replace("<SignatureValue>", `${keyInfo}<SignatureValue>`), ESPERADO, AGORA), /nessa ordem/);
  assert.throws(() => conferirTermo(xml.replace("</DigestValue>", "</DigestValue><Extra></Extra>"), ESPERADO, AGORA), /Reference deve ter só/);
  assert.throws(() => conferirTermo(xml.replace("<Transforms>", "<Transforms><Outro></Outro>"), ESPERADO, AGORA), /transformações/);
  assert.throws(() => conferirTermo(xml.replace('<sistema id="API Integra Contador">', '<sistema id="Outro">'), ESPERADO, AGORA), /sistema/);
  assert.throws(() => conferirTermo(xml.replace("</dados>", "<extra></extra></dados>"), ESPERADO, AGORA), /só as tags oficiais/);
  assert.throws(() => conferirTermo(xml.replace('papel="contratante"', 'papel="outro"'), ESPERADO, AGORA), /destinatario precisa/);
  assert.throws(() => conferirTermo(xml.replace('papel="autor pedido de dados"', 'papel="outro"'), ESPERADO, AGORA), /assinadoPor precisa/);
});

test("certificado ilegível no KeyInfo vira erro do termo (mensagem para o cliente)", () => {
  const xml = VALIDO.replace(/<X509Certificate>[^<]+</, "<X509Certificate>bm9wZQ==<");
  assert.throws(() => conferirTermo(xml, ESPERADO, AGORA), (e: Error) => e instanceof ErroTermo && /Certificado da assinatura: Certificado ilegível/.test(e.message));
});

test("recusa certificado com chave RSA menor que 2048 bits e aceita 4096", () => {
  assert.throws(() => conferirTermo(termoAssinado({ bits: 1024 }), ESPERADO, AGORA), (e) => e instanceof ErroTermo && /1024 bits.*2048/.test(e.message));
  assert.equal(conferirTermo(termoAssinado({ bits: 4096 }), ESPERADO, AGORA).certificado.bitsChave, 4096);
});

// Fora do SignedInfo nada é assinado: o layout da assinatura é conferido nó a nó (texto solto, comentário, instrução de
// processamento, CDATA, entidade, atributo ou tag a mais). A Receita recusaria (AUTENTICAPROCURADOR-013) cobrando a
// chamada.
test("recusa assinatura com qualquer nó ou atributo fora do layout, mesmo fora do SignedInfo", () => {
  const xml = VALIDO;
  const casos: [string, string][] = [
    ["texto em Signature", xml.replace("<KeyInfo>", "lixo<KeyInfo>")],
    ["texto em KeyInfo", xml.replace("<KeyInfo>", "<KeyInfo>lixo")],
    ["texto em X509Data", xml.replace("</X509Data>", "lixo</X509Data>")],
    ["comentário em KeyInfo", xml.replace("<KeyInfo>", "<KeyInfo><!--x-->")],
    ["comentário em Signature", xml.replace("<SignatureValue>", "<!--x--><SignatureValue>")],
    ["instrução de processamento em Signature", xml.replace("<KeyInfo>", "<?pi x?><KeyInfo>")],
    ["instrução de processamento em X509Data", xml.replace("<X509Certificate>", "<?pi x?><X509Certificate>")],
    ["CDATA em X509Data", xml.replace("<X509Certificate>", "<![CDATA[x]]><X509Certificate>")],
    ["CDATA no X509Certificate", xml.replace(/<X509Certificate>([^<]+)</, "<X509Certificate><![CDATA[$1]]><")],
    ["tag dentro de X509Certificate", xml.replace("</X509Certificate>", "<a></a></X509Certificate>")],
    ["tag dentro de SignatureValue", xml.replace("</SignatureValue>", "<a></a></SignatureValue>")],
    ["comentário dentro de SignatureValue", xml.replace("</SignatureValue>", "<!--x--></SignatureValue>")],
    ["texto que não é base64 em SignatureValue", xml.replace("</SignatureValue>", "*</SignatureValue>")],
    ["entidade no X509Certificate", xml.replace("<X509Certificate>M", "<X509Certificate>&#77;")],
    ["atributo em KeyInfo", xml.replace("<KeyInfo>", '<KeyInfo Id="k">')],
    ["atributo em X509Data", xml.replace("<X509Data>", '<X509Data foo="bar">')],
    ["atributo em X509Certificate", xml.replace("<X509Certificate>", '<X509Certificate foo="bar">')],
    ["atributo em SignatureValue", xml.replace("<SignatureValue>", '<SignatureValue Id="v">')],
    ["atributo a mais em Signature", xml.replace('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">', '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#" Id="s">')],
    ["namespace a mais em KeyInfo", xml.replace("<KeyInfo>", '<KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">')],
    ["tag de outro namespace em X509Data", xml.replace("</X509Data>", '<x xmlns="urn:x"></x></X509Data>')],
  ];
  for (const [nome, alterado] of casos) {
    assert.notEqual(alterado, xml, nome);
    assert.throws(() => conferirTermo(alterado, ESPERADO, AGORA), ErroTermo, nome);
  }
});

test("as mensagens de erro (que vão para a tela) não citam o fornecedor", async () => {
  const fonte = (await import("node:fs")).readFileSync(new URL("./conferir-termo.ts", import.meta.url), "utf8");
  for (const m of fonte.matchAll(/new ErroTermo\(([^)]*)\)/g)) assert.doesNotMatch(m[1], /serpro|integra contador/i, m[1]);
});
