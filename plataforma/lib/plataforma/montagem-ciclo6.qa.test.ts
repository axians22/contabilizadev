// QA (Parte 4, ciclo 6): a montagem única (montarPlataforma) com certificados de teste gerados na hora.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { certificadoIcpDeTeste } from "@contabilizadev/nucleo/certificado-teste";
import { converterParaPem } from "@contabilizadev/nucleo/serpro/termo-autorizacao";
import { avisoDoCertificadoDaPlataforma, estadoDoCertificado } from "./aviso";
import { montarPlataforma } from "./montagem";
import type { Guardado } from "./segredos";

const PLATAFORMA = "11444777000161";
const DIA = 24 * 60 * 60 * 1000;
const AGORA = new Date();
const chaves = { SERPRO_CONSUMER_KEY: "k", SERPRO_CONSUMER_SECRET: "s" };

describe("QA ciclo 6: montagem da plataforma", () => {
  it("CERT_PFX_PATH com um e-CPF (não é e-CNPJ): o certificado não pode ficar 'pronto' com o sino calado e o eSocial desligado", () => {
    const c = certificadoIcpDeTeste({ tipo: "PF", numero: "12345678909", nome: "FULANO" });
    const m = montarPlataforma({ PLATAFORMA_CNPJ: PLATAFORMA, CERT_PFX_PATH: "/drive/x.pfx", CERT_PFX_SENHA: c.senha, ...chaves }, undefined, AGORA, () => Buffer.from(c.pfx));
    const sino = avisoDoCertificadoDaPlataforma(estadoDoCertificado(m), AGORA);
    // Coerência: ou o certificado é aceito para tudo, ou é recusado e o ADMIN é avisado.
    assert.equal(m.certificado.pronto, m.esocial.pronto, `certificado.pronto=${m.certificado.pronto}, esocial.pronto=${m.esocial.pronto}, serpro.pronto=${m.serpro.pronto}`);
    if (!m.certificado.pronto) assert.equal(sino.length, 1);
  });

  it("guardado legível e válido: pronto pelo banco, sem ler o arquivo do ambiente", () => {
    const c = certificadoIcpDeTeste({ tipo: "PJ", numero: PLATAFORMA, nome: "PLAT", validoAte: new Date(AGORA.getTime() + 100 * DIA) });
    const { chave, certificado } = converterParaPem(c.pfx, c.senha);
    const guardado: Guardado = {
      certificado: { atualizadoEm: AGORA, atualizadoPor: "adm", info: { titular: "PLAT", cnpj: PLATAFORMA, validoDe: AGORA.toISOString(), validoAte: AGORA.toISOString(), emissor: "AC" }, legivel: true, pem: { chave, certificado } },
      chaves: null,
    };
    const m = montarPlataforma({ PLATAFORMA_CNPJ: PLATAFORMA, CERT_PFX_PATH: "/drive/x.pfx", CERT_PFX_SENHA: "s", ...chaves }, guardado, AGORA, () => assert.fail("não lê o ambiente"), () => assert.fail("não abre"));
    assert.ok(m.certificado.pronto && m.serpro.pronto && m.esocial.pronto);
    assert.equal(m.certificado.origem, "banco");
    // validade do certificado, não da coluna info (que diz AGORA)
    assert.ok(m.certificado.validoAte.getTime() > AGORA.getTime() + 99 * DIA);
  });
});
