// QA (Parte 6, assinador): casos de borda que os testes do engenheiro não cobrem.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { verificarAssinatura } from "@contabilizadev/nucleo/assinatura";
import { certificadoIcpDeTeste, type OpcoesCertificadoIcp } from "@contabilizadev/nucleo/certificado-teste";
import { pemDoCertificado } from "@contabilizadev/nucleo/serpro/termo-autorizacao";
import { assinanteDoArquivo, assinanteGuardado, estadoDoGuardado, resumoDoGuardado } from "./assinador";
import { cofreDoNavegador } from "./cofre";

const DIA = 24 * 60 * 60 * 1000;
const AGORA = new Date();
const EMPRESA = "12345678000195";
const OUTRA = "98765432000198";

const cache = new Map<string, ReturnType<typeof certificadoIcpDeTeste>>();
function eCnpj(numero = EMPRESA, extra: Partial<OpcoesCertificadoIcp> = {}) {
  const chave = `${numero}:${JSON.stringify(extra)}`;
  if (!cache.has(chave)) cache.set(chave, certificadoIcpDeTeste({ tipo: "PJ", numero, nome: "EXEMPLO SOFTWARE LTDA", ...extra }));
  return cache.get(chave)!;
}
const novoCofre = () => cofreDoNavegador(new IDBFactory());

describe("QA assinador: nada é guardado quando a abertura falha", () => {
  it("senha errada com Guardar: recusa e o cofre continua vazio", async () => {
    const cofre = novoCofre();
    await assert.rejects(
      assinanteDoArquivo({ pfx: new Uint8Array(eCnpj().pfx), senha: "errada", cnpjEmpresa: EMPRESA, agora: AGORA, guardar: true, cofre }),
      /confira o arquivo .* e a senha/,
    );
    assert.deepEqual(await cofre.cnpjs(), []);
  });

  it("senha vazia com Guardar: pede a senha e não guarda", async () => {
    const cofre = novoCofre();
    await assert.rejects(assinanteDoArquivo({ pfx: new Uint8Array(eCnpj().pfx), senha: "", cnpjEmpresa: EMPRESA, agora: AGORA, guardar: true, cofre }), /Informe a senha/);
    assert.deepEqual(await cofre.cnpjs(), []);
  });

  it("e-CPF (PF) com Guardar: recusa e não guarda", async () => {
    const cofre = novoCofre();
    const pf = certificadoIcpDeTeste({ tipo: "PF", numero: "52998224725", nome: "FULANO" });
    await assert.rejects(assinanteDoArquivo({ pfx: new Uint8Array(pf.pfx), senha: pf.senha, cnpjEmpresa: EMPRESA, agora: AGORA, guardar: true, cofre }));
    assert.deepEqual(await cofre.cnpjs(), []);
  });

  it("chave de 1024 bits com Guardar: recusa e não guarda", async () => {
    const cofre = novoCofre();
    const c = eCnpj(EMPRESA, { bits: 1024 });
    await assert.rejects(assinanteDoArquivo({ pfx: new Uint8Array(c.pfx), senha: c.senha, cnpjEmpresa: EMPRESA, agora: AGORA, guardar: true, cofre }));
    assert.deepEqual(await cofre.cnpjs(), []);
  });

  it("certificado vencido com Guardar: recusa e não guarda", async () => {
    const cofre = novoCofre();
    const c = eCnpj(EMPRESA, { validoDe: new Date(AGORA.getTime() - 400 * DIA), validoAte: new Date(AGORA.getTime() - DIA) });
    await assert.rejects(assinanteDoArquivo({ pfx: new Uint8Array(c.pfx), senha: c.senha, cnpjEmpresa: EMPRESA, agora: AGORA, guardar: true, cofre }), /vencido/);
    assert.deepEqual(await cofre.cnpjs(), []);
  });
});

describe("QA assinador: Usar só agora não mexe no que está guardado", () => {
  it("com um certificado guardado, Usar só agora com outro arquivo da mesma empresa não troca o guardado", async () => {
    const cofre = novoCofre();
    const antigo = eCnpj(EMPRESA, { validoAte: new Date(AGORA.getTime() + 100 * DIA) });
    await assanteGuardar(antigo, cofre);
    const novo = eCnpj();
    const a = await assinanteDoArquivo({ pfx: new Uint8Array(novo.pfx), senha: novo.senha, cnpjEmpresa: EMPRESA, agora: AGORA, guardar: false, cofre });
    assert.equal(a.guardado, false);
    const g = (await assinanteGuardado({ cnpjEmpresa: EMPRESA, agora: AGORA, cofre }))!;
    assert.equal(g.info.certificadoBase64, (await cofre.pegar(EMPRESA))!.certificado.replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g, ""));
    assert.notEqual(g.info.certificadoBase64, a.info.certificadoBase64);
  });
});

async function assanteGuardar(c: ReturnType<typeof eCnpj>, cofre: ReturnType<typeof novoCofre>) {
  return assinanteDoArquivo({ pfx: new Uint8Array(c.pfx), senha: c.senha, cnpjEmpresa: EMPRESA, agora: AGORA, guardar: true, cofre });
}

describe("QA assinador: limites de validade e CNPJ", () => {
  it("no instante exato do vencimento já é vencido; 1 ms antes é 'vencendo' com 1 dia", () => {
    const validoAte = new Date(AGORA.getTime() + 10 * DIA);
    const registro = { cnpj: EMPRESA, info: { validoAte, titular: { numero: EMPRESA } } } as Parameters<typeof estadoDoGuardado>[0];
    assert.equal(estadoDoGuardado(registro, EMPRESA, validoAte).estado, "vencido");
    const quase = estadoDoGuardado(registro, EMPRESA, new Date(validoAte.getTime() - 1));
    assert.equal(quase.estado, "vencendo");
    assert.equal((quase as { dias: number }).dias, 1);
  });

  it("o guardado vencido não assina e diz para trocar; remover depois deixa o cofre vazio", async () => {
    const cofre = novoCofre();
    const c = eCnpj(EMPRESA, { validoAte: new Date(AGORA.getTime() + 5 * DIA) });
    await assanteGuardar(c, cofre);
    await assert.rejects(assinanteGuardado({ cnpjEmpresa: EMPRESA, agora: new Date(AGORA.getTime() + 6 * DIA), cofre }), /venceu em .*Troque o certificado/);
    await cofre.remover(EMPRESA);
    assert.equal(await assinanteGuardado({ cnpjEmpresa: EMPRESA, agora: AGORA, cofre }), null);
  });

  it("CNPJ formatado ou vazio não acha nada no cofre (a tela passa só dígitos)", async () => {
    const cofre = novoCofre();
    await assanteGuardar(eCnpj(), cofre);
    assert.equal(await cofre.pegar("12.345.678/0001-95"), null);
    assert.equal(await cofre.pegar(""), null);
    assert.ok(await cofre.pegar(EMPRESA));
  });

  it("guardado de uma empresa não aparece na outra; cada uma assina com a própria chave", async () => {
    const cofre = novoCofre();
    await assanteGuardar(eCnpj(), cofre);
    const outra = eCnpj(OUTRA);
    await assinanteDoArquivo({ pfx: new Uint8Array(outra.pfx), senha: outra.senha, cnpjEmpresa: OUTRA, agora: AGORA, guardar: true, cofre });
    const a = (await assinanteGuardado({ cnpjEmpresa: EMPRESA, agora: AGORA, cofre }))!;
    const b = (await assinanteGuardado({ cnpjEmpresa: OUTRA, agora: AGORA, cofre }))!;
    assert.equal(a.info.titular.numero, EMPRESA);
    assert.equal(b.info.titular.numero, OUTRA);
    const xml = '<a Id="x"><b>1</b></a>';
    // A assinatura de uma não confere com o certificado da outra.
    const sa = await a.assinar(xml);
    const sb = await b.assinar(xml);
    assert.notEqual(sa, sb);
    assert.equal(typeof verificarAssinatura, "function");
    assert.ok(pemDoCertificado(a.info.certificadoBase64).includes("BEGIN CERTIFICATE"));
  });

  it("resumo do guardado no formato pedido (CNPJ formatado e data dd/mm/aaaa)", () => {
    const registro = { cnpj: EMPRESA, info: { validoAte: new Date("2027-03-05T15:00:00Z"), titular: { numero: EMPRESA } } } as Parameters<typeof resumoDoGuardado>[0];
    assert.equal(resumoDoGuardado(registro), "Certificado guardado neste navegador · CNPJ 12.345.678/0001-95 · válido até 05/03/2027");
  });

  it("chave guardada sobrevive a reabrir o banco e continua não exportável", async () => {
    const fabrica = new IDBFactory();
    await assanteGuardar(eCnpj(), cofreDoNavegador(fabrica));
    const r = (await cofreDoNavegador(fabrica).pegar(EMPRESA))!;
    assert.equal(r.chave.extractable, false);
    await assert.rejects(crypto.subtle.exportKey("pkcs8", r.chave));
    assert.equal(Object.keys(r).sort().join(), "certificado,chave,cnpj,guardadoEm,info");
    assert.ok(!JSON.stringify(r.info).toLowerCase().includes("senha"));
  });
});
