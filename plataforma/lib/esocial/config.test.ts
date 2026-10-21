import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { certificadoIcpDeTeste } from "@contabilizadev/nucleo/certificado-teste";
import { converterParaPem } from "@contabilizadev/nucleo/serpro/termo-autorizacao";
import { montarPlataforma } from "@/lib/plataforma/montagem";
import type { Guardado } from "@/lib/plataforma/segredos";
import type { ConfigEsocial } from "./config";

const PLATAFORMA = "11444777000161";
const env = (extra: Record<string, string | undefined> = {}) => ({ PLATAFORMA_CNPJ: "11.444.777/0001-61", CERT_PFX_PATH: "/segredos/plataforma.pfx", CERT_PFX_SENHA: "x", ...extra });
const ler = () => Buffer.from("pfx");
const AGORA = new Date("2026-10-19T12:00:00Z");
const valido = () => ({ cnpj: PLATAFORMA, validoAte: new Date("2027-01-01") });
// A configuração do eSocial como o servidor monta (o certificado resolvido uma vez, em montarPlataforma).
const esocialDe = (env: Record<string, string | undefined>, lerArquivo: (a: string) => Buffer, agora: Date, abrir: Parameters<typeof montarPlataforma>[4], guardado?: Guardado) =>
  montarPlataforma(env, guardado, agora, lerArquivo, abrir).esocial;

describe("configuração da plataforma como transmissora no eSocial", () => {
  it("pronta: o certificado da plataforma e o transmissor = PLATAFORMA_CNPJ", () => {
    const c = esocialDe(env(), ler, AGORA, valido);
    assert.ok(c.pronto && c.transmissor === PLATAFORMA && "pfx" in c.certificado && c.certificado.senha === "x");
  });

  it("sem CNPJ, sem certificado, arquivo ilegível, vencido ou de outro CNPJ: desligado, com o motivo técnico para o log", () => {
    const motivo = (c: ConfigEsocial) => (c.pronto ? "" : c.motivo);
    assert.match(motivo(esocialDe(env({ PLATAFORMA_CNPJ: undefined }), ler, AGORA, valido)), /PLATAFORMA_CNPJ/);
    assert.match(motivo(esocialDe(env({ CERT_PFX_PATH: "" }), ler, AGORA, valido)), /falta CERT_PFX_PATH/);
    assert.match(motivo(esocialDe(env(), () => { throw new Error("ENOENT"); }, AGORA, valido)), /Não foi possível ler/);
    assert.match(motivo(esocialDe(env(), ler, AGORA, () => ({ cnpj: PLATAFORMA, validoAte: new Date("2026-01-01") }))), /vencido/);
    assert.match(motivo(esocialDe(env(), ler, AGORA, () => ({ cnpj: "12345678000195", validoAte: new Date("2027-01-01") }))), /CNPJ 12345678000195, mas PLATAFORMA_CNPJ é 11444777000161/);
    assert.match(motivo(esocialDe(env(), ler, AGORA, () => ({ cnpj: null, validoAte: new Date("2027-01-01") }))), /não é um e-CNPJ .*PLATAFORMA_CNPJ 11444777000161/);
    assert.match(motivo(esocialDe(env(), ler, AGORA, () => { throw new Error("senha errada"); })), /senha errada/);
  });
});

describe("eSocial: o certificado guardado pelo ADMIN vem antes do ambiente (a mesma função do Serpro)", () => {
  const icp = certificadoIcpDeTeste({ tipo: "PJ", numero: PLATAFORMA, nome: "PLATAFORMA DE TESTE LTDA", validoDe: new Date("2026-01-01"), validoAte: new Date("2027-06-01") });
  const aberto = converterParaPem(icp.pfx, icp.senha);
  const pem = { chave: aberto.chave, certificado: aberto.certificado };
  const info = { titular: "PLATAFORMA DE TESTE LTDA", cnpj: PLATAFORMA, validoDe: "2026-01-01T00:00:00.000Z", validoAte: "2027-06-01T00:00:00.000Z", emissor: "AC TESTE" };
  const quem = { atualizadoEm: AGORA, atualizadoPor: null };
  const legivel: Guardado = { certificado: { ...quem, info, legivel: true, pem }, chaves: null };

  it("guardado legível: usa o do banco (PEM) e nem olha o arquivo do ambiente", () => {
    const c = esocialDe(env(), () => assert.fail("não deveria ler o arquivo"), AGORA, () => assert.fail("nem abrir"), legivel);
    assert.ok(c.pronto && c.transmissor === PLATAFORMA);
    assert.deepEqual(c.pronto && c.certificado, pem);
  });

  it("guardado ilegível (PLATAFORMA_CHAVE trocada): volta ao ambiente; sem ambiente, pede para enviar de novo", () => {
    const ilegivel: Guardado = { certificado: { ...quem, info, legivel: false }, chaves: null };
    assert.ok(esocialDe(env(), ler, AGORA, valido, ilegivel).pronto);
    const c = esocialDe(env({ CERT_PFX_PATH: undefined }), ler, AGORA, valido, ilegivel);
    assert.match(c.pronto ? "" : c.motivo, /não abre com a PLATAFORMA_CHAVE atual.*envie o e-CNPJ A1 de novo em \/admin\/plataforma/);
  });
});
