// Assinador do navegador (Usar só agora / Guardar neste navegador): chave importada no WebCrypto como não exportável,
// cofre no IndexedDB (falso, fake-indexeddb, o mesmo comportamento do navegador, inclusive o CryptoKey guardado), XML
// assinado com a CryptoKey aceito pela verificação do núcleo e pelas conferências do servidor (termo e DCTFWeb), regras
// de CNPJ e validade e a remoção. Certificados de teste gerados na hora; nada sai da máquina.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { completarAssinaturaRemota, verificarAssinatura } from "@contabilizadev/nucleo/assinatura";
import { certificadoIcpDeTeste, confiancaDeTeste, type OpcoesCertificadoIcp } from "@contabilizadev/nucleo/certificado-teste";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import { conferirTermo } from "@contabilizadev/nucleo/serpro/conferir-termo";
import { xmlDctf } from "@contabilizadev/nucleo/serpro/dctf-exemplo";
import { prepararAssinaturaDctf, transmitirDctfAssinada } from "@contabilizadev/nucleo/serpro/dctfweb";
import { abrirCertificado, abrirChaveDoCertificado, assinarTermo, assinarTermoCom, dataEmBrasilia, montarTermo, pemDoCertificado, vigenciaPadrao, vigenciaPara } from "@contabilizadev/nucleo/serpro/termo-autorizacao";
import { assinanteDoArquivo, assinanteGuardado, AVISO_VENCIMENTO_DIAS, estadoDoGuardado, importarChave, MENSAGENS_DO_ASSINADOR, resumoDoGuardado, type Assinante } from "./assinador";
import { cofreDoNavegador, SEM_COFRE, type CertificadoGuardado } from "./cofre";

const DIA = 24 * 60 * 60 * 1000;
const AGORA = new Date();
const EMPRESA = "12345678000195";
const OUTRA = "98765432000198";
const PLATAFORMA = { numero: "11444777000161", nome: "PLATAFORMA DE TESTE LTDA" };

const cache = new Map<string, ReturnType<typeof certificadoIcpDeTeste>>();
function eCnpj(numero = EMPRESA, extra: Partial<OpcoesCertificadoIcp> = {}) {
  const chave = `${numero}:${JSON.stringify(extra)}`;
  if (!cache.has(chave)) cache.set(chave, certificadoIcpDeTeste({ tipo: "PJ", numero, nome: "EXEMPLO SOFTWARE LTDA", ...extra }));
  return cache.get(chave)!;
}
const novoCofre = () => cofreDoNavegador(new IDBFactory());
const doArquivo = (o: { certificado?: ReturnType<typeof eCnpj>; guardar: boolean; cofre?: ReturnType<typeof novoCofre>; agora?: Date; cnpjEmpresa?: string }) => {
  const c = o.certificado ?? eCnpj();
  return assinanteDoArquivo({ pfx: new Uint8Array(c.pfx), senha: c.senha, cnpjEmpresa: o.cnpjEmpresa ?? EMPRESA, agora: o.agora ?? AGORA, guardar: o.guardar, cofre: o.cofre ?? novoCofre() });
};

// O termo como a tela monta (parâmetros do servidor) e assina com o assinador.
function termoParaAssinar(a: Assinante) {
  const hoje = dataEmBrasilia(AGORA);
  return montarTermo({ destinatario: PLATAFORMA, assinadoPor: { numero: a.info.titular.numero, nome: "EXEMPLO SOFTWARE LTDA" }, dataAssinatura: hoje, vigencia: vigenciaPara(vigenciaPadrao(hoje), a.info) });
}

describe("chave no WebCrypto: não exportável e só para assinar", () => {
  it("importarChave: não exportável, só sign, exportKey rejeita, e os bytes do PKCS#8 são zerados", async () => {
    const { pkcs8 } = abrirChaveDoCertificado(new Uint8Array(eCnpj().pfx), eCnpj().senha);
    const chave = await importarChave(pkcs8);
    assert.equal(chave.extractable, false);
    assert.equal(chave.type, "private");
    assert.deepEqual(chave.usages, ["sign"]);
    await assert.rejects(crypto.subtle.exportKey("pkcs8", chave));
    await assert.rejects(crypto.subtle.exportKey("jwk", chave));
    assert.ok(pkcs8.every((b) => b === 0));
  });

  it("chave que não é RSA válida é recusada com mensagem própria", async () => {
    await assert.rejects(importarChave(new Uint8Array([1, 2, 3])), /Não foi possível usar a chave do certificado/);
  });

  it("a assinatura da CryptoKey é a mesma do node-forge (RSA-SHA256 PKCS#1 v1.5 é determinística)", async () => {
    const a = await doArquivo({ guardar: false });
    const forge = abrirCertificado(new Uint8Array(eCnpj().pfx), eCnpj().senha);
    assert.equal(await a.assinar("texto com acentuação"), forge.assinar("texto com acentuação"));
  });
});

describe("XML assinado com a CryptoKey: aceito pelo núcleo e pelas conferências do servidor", () => {
  for (const guardar of [false, true]) {
    const opcao = guardar ? "Guardar neste navegador" : "Usar só agora";

    it(`termo de autorização (${opcao}): conferirTermo aceita e o XML é igual ao assinado pelo node-forge`, async () => {
      const cofre = novoCofre();
      const primeira = await doArquivo({ guardar, cofre });
      // Guardado: a segunda assinatura vem do cofre, sem arquivo nem senha.
      const a = guardar ? (await assinanteGuardado({ cnpjEmpresa: EMPRESA, agora: AGORA, cofre }))! : primeira;
      assert.equal(a.guardado, guardar);
      const termo = termoParaAssinar(a);
      const assinado = await assinarTermoCom(termo, a.info.certificadoBase64, a.assinar);
      assert.equal(verificarAssinatura(assinado, pemDoCertificado(a.info.certificadoBase64)), true);
      const conferido = conferirTermo(assinado, { contratante: PLATAFORMA, contribuinte: EMPRESA, confianca: confiancaDeTeste() }, AGORA);
      assert.equal(conferido.assinadoPor.numero, EMPRESA);
      assert.equal(assinado, assinarTermo(termo, abrirCertificado(new Uint8Array(eCnpj().pfx), eCnpj().senha)));
    });

    it(`DCTFWeb (${opcao}): o servidor prepara, a CryptoKey assina o SignedInfo e a conferência do servidor transmite`, async () => {
      const cofre = novoCofre();
      const primeira = await doArquivo({ guardar, cofre });
      const a = guardar ? (await assinanteGuardado({ cnpjEmpresa: EMPRESA, agora: AGORA, cofre }))! : primeira;
      const xml = xmlDctf();
      const pem = pemDoCertificado(a.info.certificadoBase64);
      const preparo = prepararAssinaturaDctf(xml, pem);
      const assinado = completarAssinaturaRemota(preparo.xml, await a.assinar(preparo.signedInfo));
      assert.equal(verificarAssinatura(assinado, pem), true);
      const cliente = clienteFalso({ status: 200, dados: { numeroRecibo: "1" }, mensagens: [{ codigo: "Sucesso", texto: "ok" }] });
      const r = await transmitirDctfAssinada(cliente, { contribuinte: { numero: EMPRESA, tipo: 2 } }, {
        pa: "2026-09",
        conferencia: { situacao: "em andamento", aPagar: 178.31, xml },
        inssEsperado: 178.31,
        xmlAssinado: assinado,
        certificadoPem: pem,
        confirmado: true,
      });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(cliente.chamadas.length, 1);
    });
  }

  it("assinatura de outra chave não passa na verificação", async () => {
    const a = await doArquivo({ guardar: false });
    const outra = await doArquivo({ guardar: false, certificado: eCnpj(OUTRA), cnpjEmpresa: OUTRA });
    const pem = pemDoCertificado(a.info.certificadoBase64);
    const preparo = prepararAssinaturaDctf(xmlDctf(), pem);
    assert.equal(verificarAssinatura(completarAssinaturaRemota(preparo.xml, await outra.assinar(preparo.signedInfo)), pem), false);
  });
});

describe("Usar só agora e Guardar neste navegador", () => {
  it("Usar só agora: nada fica no cofre", async () => {
    const cofre = novoCofre();
    const a = await doArquivo({ guardar: false, cofre });
    assert.equal(a.guardado, false);
    assert.deepEqual(await cofre.cnpjs(), []);
    assert.equal(await assinanteGuardado({ cnpjEmpresa: EMPRESA, agora: AGORA, cofre }), null);
  });

  it("Guardar: fica a chave não exportável, o certificado público (PEM) e o CNPJ; nunca a senha nem o .pfx", async () => {
    const cofre = novoCofre();
    await doArquivo({ guardar: true, cofre });
    const registro = (await cofre.pegar(EMPRESA))!;
    assert.deepEqual(Object.keys(registro).sort(), ["certificado", "chave", "cnpj", "guardadoEm", "info"]);
    assert.equal(registro.cnpj, EMPRESA);
    assert.match(registro.certificado, /^-----BEGIN CERTIFICATE-----\n[\s\S]+\n-----END CERTIFICATE-----\n$/);
    assert.equal(registro.chave.extractable, false);
    await assert.rejects(crypto.subtle.exportKey("pkcs8", registro.chave));
    // O corpo do PEM é base64 aleatório e às vezes contém "pfx"/"senha" por acaso (ex.: "PfX"): fica fora da busca de
    // palavras e só se confere que é um certificado público, sem chave privada.
    assert.doesNotMatch(registro.certificado, /PRIVATE KEY/);
    const texto = JSON.stringify({ ...registro, certificado: "PEM" });
    assert.doesNotMatch(texto, new RegExp(eCnpj().senha));
    assert.doesNotMatch(texto, /PRIVATE KEY|senha|pfx/i);
    assert.equal(resumoDoGuardado(registro), `Certificado guardado neste navegador · CNPJ 12.345.678/0001-95 · válido até ${registro.info.validoAte.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
  });

  it("um certificado por CNPJ: várias empresas convivem e guardar de novo troca o da mesma empresa", async () => {
    const cofre = novoCofre();
    await doArquivo({ guardar: true, cofre });
    await doArquivo({ guardar: true, cofre, certificado: eCnpj(OUTRA), cnpjEmpresa: OUTRA });
    assert.deepEqual(await cofre.cnpjs(), [EMPRESA, OUTRA].sort());
    const novo = eCnpj(EMPRESA, { validoAte: new Date(AGORA.getTime() + 200 * DIA) });
    await doArquivo({ guardar: true, cofre, certificado: novo });
    assert.deepEqual(await cofre.cnpjs(), [EMPRESA, OUTRA].sort());
    const a = (await assinanteGuardado({ cnpjEmpresa: EMPRESA, agora: AGORA, cofre }))!;
    assert.equal(a.info.certificadoBase64, abrirCertificado(new Uint8Array(novo.pfx), novo.senha).certificadoBase64);
  });

  it("remover apaga a chave deste CNPJ e deixa as outras", async () => {
    const cofre = novoCofre();
    await doArquivo({ guardar: true, cofre });
    await doArquivo({ guardar: true, cofre, certificado: eCnpj(OUTRA), cnpjEmpresa: OUTRA });
    await cofre.remover(EMPRESA);
    assert.equal(await cofre.pegar(EMPRESA), null);
    assert.equal(await assinanteGuardado({ cnpjEmpresa: EMPRESA, agora: AGORA, cofre }), null);
    assert.deepEqual(await cofre.cnpjs(), [OUTRA]);
    await cofre.remover(OUTRA);
    assert.deepEqual(await cofre.cnpjs(), []);
  });

  it("o cofre só aceita chave privada não exportável e só para assinar", async () => {
    const cofre = novoCofre();
    const { privateKey } = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
    const a = await doArquivo({ guardar: false });
    const { certificadoBase64, ...info } = a.info;
    const registro: CertificadoGuardado = { cnpj: EMPRESA, chave: privateKey, certificado: pemDoCertificado(certificadoBase64), info, guardadoEm: AGORA };
    await assert.rejects(cofre.guardar(registro), /não exportável/);
    assert.deepEqual(await cofre.cnpjs(), []);
  });

  it("sem IndexedDB: a opção não fica disponível e guardar recusa", async () => {
    const cofre = cofreDoNavegador(undefined);
    assert.equal(cofre.disponivel, false);
    assert.equal(await cofre.pegar(EMPRESA), null);
    assert.deepEqual(await cofre.cnpjs(), []);
    await assert.rejects(doArquivo({ guardar: true, cofre }), (e: Error) => e.message === SEM_COFRE);
  });
});

describe("regras: CNPJ da empresa ativa e validade do certificado", () => {
  it("certificado de outro CNPJ é recusado ao abrir e não é guardado", async () => {
    const cofre = novoCofre();
    await assert.rejects(doArquivo({ guardar: true, cofre, certificado: eCnpj(OUTRA) }), /não o da empresa/);
    assert.deepEqual(await cofre.cnpjs(), []);
  });

  it("o guardado de outra empresa não é usado na empresa ativa; registro com CNPJ trocado é recusado", async () => {
    const cofre = novoCofre();
    await doArquivo({ guardar: true, cofre, certificado: eCnpj(OUTRA), cnpjEmpresa: OUTRA });
    assert.equal(await assinanteGuardado({ cnpjEmpresa: EMPRESA, agora: AGORA, cofre }), null);
    // Um registro adulterado (guardado sob o CNPJ da empresa, mas com o certificado de outra) não serve.
    const deOutra = (await cofre.pegar(OUTRA))!;
    await cofre.guardar({ ...deOutra, cnpj: EMPRESA });
    assert.equal(estadoDoGuardado({ ...deOutra, cnpj: EMPRESA }, EMPRESA, AGORA).estado, "outro-cnpj");
    await assert.rejects(assinanteGuardado({ cnpjEmpresa: EMPRESA, agora: AGORA, cofre }), (e: Error) => e.message === MENSAGENS_DO_ASSINADOR.outroCnpj);
  });

  it("certificado vencido é recusado ao abrir", async () => {
    const vencido = eCnpj(EMPRESA, { validoDe: new Date(AGORA.getTime() - 400 * DIA), validoAte: new Date(AGORA.getTime() - DIA) });
    await assert.rejects(doArquivo({ guardar: true, certificado: vencido }), /vencido/);
  });

  it("guardado: pronto, avisa a partir de 30 dias para vencer e, vencido, pede para trocar", async () => {
    const cofre = novoCofre();
    const validoAte = new Date(Math.floor(AGORA.getTime() / 1000) * 1000 + 90 * DIA); // o certificado guarda segundos
    await doArquivo({ guardar: true, cofre, certificado: eCnpj(EMPRESA, { validoAte }) });
    const registro = (await cofre.pegar(EMPRESA))!;
    assert.equal(estadoDoGuardado(registro, EMPRESA, AGORA).estado, "pronto");
    const emDias = (d: number) => new Date(validoAte.getTime() - d * DIA);
    assert.deepEqual(estadoDoGuardado(registro, EMPRESA, emDias(AVISO_VENCIMENTO_DIAS + 1)), { estado: "pronto", validoAte });
    assert.deepEqual(estadoDoGuardado(registro, EMPRESA, emDias(AVISO_VENCIMENTO_DIAS)), { estado: "vencendo", validoAte, dias: 30 });
    assert.deepEqual(estadoDoGuardado(registro, EMPRESA, emDias(0.5)), { estado: "vencendo", validoAte, dias: 1 });
    assert.equal(MENSAGENS_DO_ASSINADOR.vencendo(1), "O certificado vence em 1 dia: troque quando renovar o e-CNPJ.");
    // Vencendo ainda assina.
    assert.ok(await assinanteGuardado({ cnpjEmpresa: EMPRESA, agora: emDias(10), cofre }));
    // Vencido: recusa com a data e o que fazer; o registro continua até o cliente trocar ou remover.
    assert.deepEqual(estadoDoGuardado(registro, EMPRESA, validoAte), { estado: "vencido", validoAte });
    await assert.rejects(assinanteGuardado({ cnpjEmpresa: EMPRESA, agora: validoAte, cofre }), (e: Error) => e.message === MENSAGENS_DO_ASSINADOR.vencido(validoAte));
    assert.match(MENSAGENS_DO_ASSINADOR.vencido(validoAte), /venceu em \d{2}\/\d{2}\/\d{4}\. Troque o certificado\.$/);
  });
});
