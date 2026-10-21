// QA (Parte 4, ciclo 4): o sino do ADMIN com o motivo vindo do resolvedor (falha), sem nada guardado e com guardado.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { certificadoIcpDeTeste } from "@contabilizadev/nucleo/certificado-teste";
import { converterParaPem } from "@contabilizadev/nucleo/serpro/termo-autorizacao";
import { resolverCertificadoDaPlataforma, type CertificadoDaPlataforma } from "@/lib/serpro/config";
import { montagemValeAte, RELEITURA_SEM_PRONTO_MS } from "./montagem";
import { avisoDoCertificadoDaPlataforma, estadoDoCertificado } from "./aviso";
import { NADA_GUARDADO, type Guardado } from "./segredos";

const PLATAFORMA = "11444777000161";
const AGORA = new Date("2026-10-20T15:00:00Z");
const DIA = 24 * 60 * 60 * 1000;
const env = { CERT_PFX_PATH: "/drive/plataforma.pfx", CERT_PFX_SENHA: "s" };
const ler = () => Buffer.from("pfx");
const sino = (certificado: CertificadoDaPlataforma) => avisoDoCertificadoDaPlataforma(estadoDoCertificado({ certificado }), AGORA);

// Um e-CNPJ de teste que venceu ontem (a validade que vale é a do certificado decifrado).
const vencido = certificadoIcpDeTeste({ tipo: "PJ", numero: PLATAFORMA, nome: "PLATAFORMA", validoDe: new Date(AGORA.getTime() - 400 * DIA), validoAte: new Date(AGORA.getTime() - DIA) });
const vencidoPem = converterParaPem(vencido.pfx, vencido.senha);
const guardadoVencido: Guardado = {
  certificado: {
    atualizadoEm: AGORA,
    atualizadoPor: "adm",
    info: { titular: "PLATAFORMA", cnpj: PLATAFORMA, validoDe: new Date(AGORA.getTime() - 400 * DIA).toISOString(), validoAte: new Date(AGORA.getTime() - DIA).toISOString(), emissor: "AC" },
    legivel: true,
    pem: { chave: vencidoPem.chave, certificado: vencidoPem.certificado },
  },
  chaves: null,
};

describe("QA ciclo 4: o texto do sino bate com a origem do certificado", () => {
  it("nada guardado, certificado do AMBIENTE de outro CNPJ: o texto não pode falar de 'certificado guardado'", () => {
    const c = resolverCertificadoDaPlataforma(PLATAFORMA, env, NADA_GUARDADO, ler, AGORA, () => ({ cnpj: "11222333000181", validoAte: new Date(AGORA.getTime() + 200 * DIA) }));
    const [a] = sino(c);
    assert.equal(a.titulo, "O certificado da plataforma não está em uso");
    assert.doesNotMatch(a.texto, /guardado/i, `nada foi guardado, mas o sino diz: "${a.texto}"`);
  });

  it("nada guardado, .pfx do AMBIENTE com senha errada: o texto não pode falar de 'certificado guardado'", () => {
    const c = resolverCertificadoDaPlataforma(PLATAFORMA, env, NADA_GUARDADO, ler, AGORA, () => {
      throw new Error("senha errada");
    });
    const [a] = sino(c);
    assert.doesNotMatch(a.texto, /guardado/i, `nada foi guardado, mas o sino diz: "${a.texto}"`);
  });
});

describe("QA ciclo 4: guardado vencido", () => {
  it("guardado legível e vencido (ambiente válido): o banco vale primeiro e o sino diz que venceu, com a data", () => {
    const c = resolverCertificadoDaPlataforma(PLATAFORMA, env, guardadoVencido, ler, AGORA, () => ({ cnpj: PLATAFORMA, validoAte: new Date(AGORA.getTime() + 200 * DIA) }));
    assert.equal(c.pronto, false);
    const [a] = sino(c);
    assert.equal(a.titulo, "O certificado da plataforma venceu");
    assert.match(a.texto, /19\/10\/2026/);
  });

  it("vencido: a montagem é refeita logo (o novo certificado aparece sem reiniciar)", () => {
    const c = resolverCertificadoDaPlataforma(PLATAFORMA, env, guardadoVencido, ler, AGORA);
    assert.equal(montagemValeAte({ certificado: c, serpro: { pronto: false }, esocial: { pronto: false } }, AGORA), AGORA.getTime() + RELEITURA_SEM_PRONTO_MS);
  });
});
