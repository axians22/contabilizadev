import { test } from "node:test";
import assert from "node:assert/strict";
import { assinarEsocial, assinarXml, verificarAssinatura } from "./assinatura.ts";
import { certificadoDeTeste } from "./certificado-teste.ts";
import { lerPfx } from "./certificado.ts";

test("lê chave e certificado do .pfx só em memória", () => {
  const pem = lerPfx(certificadoDeTeste());
  assert.match(pem.chave, /BEGIN (RSA )?PRIVATE KEY/);
  assert.match(pem.certificado, /BEGIN CERTIFICATE/);
  assert.doesNotMatch(pem.certificadoBase64, /BEGIN|\s/);
});

test("senha errada, arquivo vazio ou sem senha falham com mensagem clara", () => {
  const { pfx } = certificadoDeTeste();
  assert.throws(() => lerPfx({ pfx, senha: "errada" }), /confira o arquivo e a senha/);
  assert.throws(() => lerPfx({ pfx: Buffer.alloc(0), senha: "x" }), /vazio/);
  assert.throws(() => lerPfx({ pfx, senha: "" }), /senha/);
});

test("assina um elemento (enveloped, RSA-SHA256) e a verificação pega adulteração", () => {
  const pem = lerPfx(certificadoDeTeste());
  const xml = `<Raiz><Conteudo id="c1"><valor>178.31</valor></Conteudo></Raiz>`;
  const assinado = assinarXml(xml, "Conteudo", pem);
  assert.match(assinado, /<\/Conteudo><Signature/);
  assert.match(assinado, /rsa-sha256/);
  assert.match(assinado, /<X509Certificate>/);
  assert.equal(verificarAssinatura(assinado, pem.certificado), true);
  assert.equal(verificarAssinatura(assinado.replace("178.31", "1.00"), pem.certificado), false);
  assert.equal(verificarAssinatura(xml, pem.certificado), false);
  assert.match(assinarXml(xml, "Conteudo", pem, "append"), /<Signature[\s\S]*<\/Signature><\/Conteudo>/);
  assert.throws(() => assinarXml(xml, "a']|//*['", pem), /inválido/);
});

test("assinatura do eSocial: URI vazia e Signature como último filho da raiz", () => {
  const pem = lerPfx(certificadoDeTeste());
  const assinado = assinarEsocial(`<eSocial xmlns="http://www.esocial.gov.br/schema/evt/x"><evt Id="ID1"/></eSocial>`, pem);
  assert.match(assinado, /<Reference URI="">/);
  assert.match(assinado, /<\/Signature><\/eSocial>$/);
  assert.equal(verificarAssinatura(assinado, pem.certificado), true);
});
