// Parte do termo sem node-forge: assinatura com uma chave do WebCrypto (assinarTermoCom) igual à do node-forge e aceita
// pela conferência do servidor; a chave PKCS#8 do .pfx importável como não exportável.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { certificadoIcpDeTeste } from "../certificado-teste.ts";
import { conferirTermo } from "./conferir-termo.ts";
import { abrirCertificado, abrirChaveDoCertificado, assinarTermo } from "./termo-autorizacao.ts";
import { assinarTermoCom, dataEmBrasilia, documentoDoTermo, montarTermo, vigenciaPadrao, vigenciaPara } from "./termo-xml.ts";

const AGORA = new Date();
const EMPRESA = "12345678000195";
const PLATAFORMA = { numero: "11444777000161", nome: "PLATAFORMA DE TESTE LTDA" };
const pfx = certificadoIcpDeTeste({ tipo: "PJ", numero: EMPRESA, nome: "EXEMPLO SOFTWARE LTDA" });
const ALGORITMO = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };

const termo = (validoAte: Date) => {
  const hoje = dataEmBrasilia(AGORA);
  return montarTermo({ destinatario: PLATAFORMA, assinadoPor: { numero: EMPRESA, nome: "EXEMPLO SOFTWARE LTDA" }, dataAssinatura: hoje, vigencia: vigenciaPara(vigenciaPadrao(hoje), { validoAte }) });
};

describe("abrirChaveDoCertificado", () => {
  it("devolve as informações do certificado e a chave em PKCS#8, que o WebCrypto importa como não exportável", async () => {
    const { info, pkcs8 } = abrirChaveDoCertificado(new Uint8Array(pfx.pfx), pfx.senha);
    assert.equal(info.titular.numero, EMPRESA);
    assert.equal(info.certificadoBase64, abrirCertificado(new Uint8Array(pfx.pfx), pfx.senha).certificadoBase64);
    const chave = await crypto.subtle.importKey("pkcs8", pkcs8, ALGORITMO, false, ["sign"]);
    assert.equal(chave.extractable, false);
    await assert.rejects(crypto.subtle.exportKey("pkcs8", chave));
  });

  it("senha errada ou arquivo vazio: as mesmas mensagens de abrirCertificado", () => {
    assert.throws(() => abrirChaveDoCertificado(new Uint8Array(pfx.pfx), "errada"), /confira o arquivo/);
    assert.throws(() => abrirChaveDoCertificado(new Uint8Array(), pfx.senha), /vazio/);
  });
});

describe("assinarTermoCom (chave do WebCrypto)", () => {
  it("gera o mesmo XML que assinarTermo (node-forge) e passa na conferência do servidor", async () => {
    const { info, pkcs8 } = abrirChaveDoCertificado(new Uint8Array(pfx.pfx), pfx.senha);
    const chave = await crypto.subtle.importKey("pkcs8", pkcs8, ALGORITMO, false, ["sign"]);
    const assinar = async (texto: string) => Buffer.from(await crypto.subtle.sign(ALGORITMO, chave, new TextEncoder().encode(texto))).toString("base64");
    const xml = termo(info.validoAte);
    const assinado = await assinarTermoCom(xml, info.certificadoBase64, assinar);
    assert.equal(assinado, assinarTermo(xml, abrirCertificado(new Uint8Array(pfx.pfx), pfx.senha)));
    assert.equal(conferirTermo(assinado, { contratante: PLATAFORMA, contribuinte: EMPRESA }, AGORA).assinadoPor.numero, EMPRESA);
  });

  it("recusa termo já assinado ou fora do formato", async () => {
    const assinar = async () => "x";
    await assert.rejects(assinarTermoCom("<termoDeAutorizacao/>", "", assinar), /montado por montarTermo/);
    const xml = termo(new Date(AGORA.getTime() + 365 * 86_400_000));
    const assinado = assinarTermo(xml, abrirCertificado(new Uint8Array(pfx.pfx), pfx.senha));
    await assert.rejects(assinarTermoCom(assinado, "", assinar), /ainda sem assinatura/);
    assert.equal(documentoDoTermo(xml), xml.slice('<?xml version="1.0" encoding="UTF-8"?>'.length));
  });
});
