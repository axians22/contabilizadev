// QA (Parte 4, ciclo 3): o sino do ADMIN com o certificado alternativo do ambiente (CERT_PFX_PATH), sem nada guardado.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolverCertificadoDaPlataforma } from "@/lib/serpro/config";
import { avisoDoCertificadoDaPlataforma, estadoDoCertificado } from "./aviso";
import { NADA_GUARDADO } from "./segredos";

const PLATAFORMA = "11444777000161";
const AGORA = new Date("2026-10-20T15:00:00Z");
const DIA = 24 * 60 * 60 * 1000;
const env = { CERT_PFX_PATH: "/drive/plataforma.pfx", CERT_PFX_SENHA: "s" };
const ler = () => Buffer.from("pfx");
const sino = (abrir: () => { cnpj: string | null; validoAte: Date }) => {
  const certificado = resolverCertificadoDaPlataforma(PLATAFORMA, env, NADA_GUARDADO, ler, AGORA, abrir);
  return avisoDoCertificadoDaPlataforma(estadoDoCertificado({ certificado }), AGORA);
};

describe("QA ciclo 3: sino com o certificado do ambiente", () => {
  it("certificado do ambiente vence em 10 dias: amarelo", () => {
    const [a] = sino(() => ({ cnpj: PLATAFORMA, validoAte: new Date(AGORA.getTime() + 10 * DIA) }));
    assert.equal(a.titulo, "Certificado da plataforma vence em 10 dias");
  });

  it("certificado do ambiente VENCIDO: o sino diz que venceu (não que falta)", () => {
    const [a] = sino(() => ({ cnpj: PLATAFORMA, validoAte: new Date(AGORA.getTime() - 2 * DIA) }));
    assert.equal(a.nivel, "vencida");
    assert.equal(a.titulo, "O certificado da plataforma venceu");
  });

  it("certificado do ambiente de OUTRO CNPJ: o sino diz que não está em uso (não que falta)", () => {
    const [a] = sino(() => ({ cnpj: "11222333000181", validoAte: new Date(AGORA.getTime() + 200 * DIA) }));
    assert.equal(a.nivel, "vencida");
    assert.equal(a.titulo, "O certificado da plataforma não está em uso");
  });
});
