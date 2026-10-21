import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CertificadoDaPlataforma } from "@/lib/serpro/config";
import { montagemValeAte, montarPlataforma, RELEITURA_SEM_PRONTO_MS } from "./montagem";

const AGORA = new Date("2026-10-20T12:00:00-03:00");
const aceito = (validoAte: Date): CertificadoDaPlataforma => ({ pronto: true, origem: "banco", tls: {} as never, validoAte, pem: () => ({ chave: "", certificado: "", certificadoBase64: "" }) });
const pronto = { pronto: true };
const faltando = { pronto: false };

describe("até quando a montagem da plataforma vale (cache de lib/plataforma/servidor.ts)", () => {
  it("tudo pronto: vale até o validoAte do certificado em uso (vence às 14h: remonta às 14h, não à meia-noite)", () => {
    const vence = new Date("2026-10-20T14:00:00-03:00");
    assert.equal(montagemValeAte({ certificado: aceito(vence), serpro: pronto, esocial: pronto }, AGORA), vence.getTime());
  });

  it("certificado não pronto (drive de CERT_PFX_PATH desmontado): relê em poucos segundos", () => {
    const m = { certificado: { pronto: false as const, motivo: "Não foi possível ler o certificado", falha: { tipo: "falta" as const } }, serpro: faltando, esocial: faltando };
    assert.equal(montagemValeAte(m, AGORA), AGORA.getTime() + RELEITURA_SEM_PRONTO_MS);
    assert.ok(RELEITURA_SEM_PRONTO_MS <= 60_000);
  });

  it("certificado pronto mas falta a chave do contrato: relê logo, sem passar do validoAte", () => {
    const longe = new Date("2027-10-20T00:00:00-03:00");
    assert.equal(montagemValeAte({ certificado: aceito(longe), serpro: faltando, esocial: pronto }, AGORA), AGORA.getTime() + RELEITURA_SEM_PRONTO_MS);
    const jaJa = new Date(AGORA.getTime() + 5_000);
    assert.equal(montagemValeAte({ certificado: aceito(jaJa), serpro: faltando, esocial: pronto }, AGORA), jaJa.getTime());
  });
});

describe("montagem da plataforma: o certificado resolvido uma vez só", () => {
  const PLATAFORMA = "11444777000161";
  const env = { PLATAFORMA_CNPJ: PLATAFORMA, CERT_PFX_PATH: "/drive/plataforma.pfx", CERT_PFX_SENHA: "s", SERPRO_CONSUMER_KEY: "k", SERPRO_CONSUMER_SECRET: "s" };

  it("pelo ambiente: uma leitura e uma abertura do .pfx por montagem, e Serpro e eSocial usam o mesmo resultado", () => {
    const chamadas = { ler: 0, abrir: 0 };
    const validoAte = new Date("2027-01-01");
    const m = montarPlataforma(env, undefined, AGORA, () => (chamadas.ler++, Buffer.from("pfx")), () => (chamadas.abrir++, { cnpj: PLATAFORMA, validoAte }));
    assert.deepEqual(chamadas, { ler: 1, abrir: 1 });
    assert.ok(m.certificado.pronto && m.serpro.pronto && m.esocial.pronto);
    assert.equal(m.serpro.certificado, m.certificado.tls);
    assert.equal(m.esocial.certificado, m.certificado.tls);
  });

  it("enquanto não está pronto (arquivo fora do ar): ainda uma leitura só, e os dois motivos falam da mesma falha", () => {
    let ler = 0;
    const m = montarPlataforma(env, undefined, AGORA, () => (ler++, assert.fail("ENOENT")), () => assert.fail("não abre o que não leu"));
    assert.equal(ler, 1);
    assert.ok(!m.serpro.pronto && !m.esocial.pronto && !m.certificado.pronto);
    assert.ok(m.serpro.motivo.includes(m.certificado.motivo) && m.esocial.motivo.includes(m.certificado.motivo));
  });

  it("sem PLATAFORMA_CNPJ: nada é lido", () => {
    const m = montarPlataforma({ ...env, PLATAFORMA_CNPJ: "" }, undefined, AGORA, () => assert.fail("não lê"), () => assert.fail("não abre"));
    assert.ok(!m.certificado.pronto && !m.serpro.pronto && !m.esocial.pronto);
    assert.match(m.serpro.motivo, /PLATAFORMA_CNPJ/);
  });
});
