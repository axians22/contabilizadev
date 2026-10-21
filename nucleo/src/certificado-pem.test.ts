// O e-CNPJ da plataforma guardado já aberto (chave e certificado em PEM, sem a senha): a conversão do .pfx e a conexão TLS
// com essa forma. Certificados de teste gerados na hora.
import assert from "node:assert/strict";
import { createPrivateKey, X509Certificate } from "node:crypto";
import { describe, it } from "node:test";
import { certificadoIcpDeTeste } from "./certificado-teste.ts";
import { opcoesTls } from "./http.ts";
import { converterParaPem, ErroCertificado } from "./serpro/termo-autorizacao.ts";

describe("converterParaPem", () => {
  const pj = certificadoIcpDeTeste({ tipo: "PJ", numero: "11444777000161", nome: "PLATAFORMA DE TESTE LTDA" });

  it("devolve a chave PKCS#8 e o certificado do titular primeiro, com a cadeia depois", () => {
    const { info, chave, certificado } = converterParaPem(pj.pfx, pj.senha);
    assert.equal(info.titular.numero, "11444777000161");
    assert.equal(info.politica, "A1");
    assert.match(chave, /^-----BEGIN PRIVATE KEY-----/);
    const certs = certificado.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
    assert.equal(certs.length, 2, "titular + AC de teste");
    const titular = new X509Certificate(certs[0]);
    assert.ok(titular.checkPrivateKey(createPrivateKey(chave)), "o primeiro é o certificado da chave");
    assert.equal(titular.raw.toString("base64"), info.certificadoBase64);
  });

  it("abre o .pfx antigo (3DES) e recusa senha errada ou arquivo vazio com a mensagem de sempre", () => {
    const legado = certificadoIcpDeTeste({ tipo: "PJ", numero: "11444777000161", nome: "X", legado: true });
    assert.equal(converterParaPem(legado.pfx, legado.senha).info.titular.numero, "11444777000161");
    assert.throws(() => converterParaPem(pj.pfx, "errada"), (e: Error) => e instanceof ErroCertificado && /confira o arquivo/.test(e.message));
    assert.throws(() => converterParaPem(new Uint8Array(), "x"), /vazio/);
    assert.throws(() => converterParaPem(pj.pfx, ""), /senha/);
  });
});

describe("opcoesTls", () => {
  it("o .pfx vai com a senha; o PEM vai como chave e certificado (sem senha)", () => {
    const pfx = Buffer.from("pfx");
    assert.deepEqual(opcoesTls({ pfx, senha: "s" }), { pfx, passphrase: "s" });
    assert.deepEqual(opcoesTls({ chave: "K", certificado: "C" }), { key: "K", cert: "C" });
  });
});
