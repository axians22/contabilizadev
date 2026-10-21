import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { InfoCertificado } from "@contabilizadev/nucleo/serpro/termo-xml";
import { avisoDoCertificadoGuardado, chaveDoCertificado, diaEmBrasilia, juntarAvisos, nivelMaisGrave, type AvisoDoSino } from "./central";

const aviso = (chave: string, nivel: AvisoDoSino["nivel"], extra: Partial<AvisoDoSino> = {}): AvisoDoSino => ({
  chave,
  nivel,
  titulo: chave,
  texto: `texto de ${chave}`,
  link: { href: `/${chave}`, texto: "Resolver" },
  ...extra,
});

describe("juntarAvisos: sem repetição, do mais grave ao informativo", () => {
  it("ordena por gravidade e, no mesmo nível, pela ordem das fontes", () => {
    const r = juntarAvisos([aviso("a", "info"), aviso("b", "vence")], [aviso("c", "vencida"), aviso("d", "vence")]);
    assert.deepEqual(r.map((a) => a.chave), ["c", "b", "d", "a"]);
  });

  it("a mesma chave aparece uma vez, com o nível mais grave", () => {
    const r = juntarAvisos([aviso("guia:DAS:2026-08", "vence", { titulo: "primeiro" })], [aviso("guia:DAS:2026-08", "vencida", { titulo: "mais grave" }), aviso("guia:DAS:2026-08", "vence")]);
    assert.equal(r.length, 1);
    assert.equal(r[0].titulo, "mais grave");
    // Empate: fica o primeiro.
    assert.equal(juntarAvisos([aviso("x", "vence", { titulo: "1" }), aviso("x", "vence", { titulo: "2" })])[0].titulo, "1");
  });

  it("aviso coberto por outro sai (o eSocial do mês cobre a DCTFWeb do mês), seja qual for a ordem", () => {
    const esocial = aviso("esocial:2026-09", "vence", { cobre: ["dctfweb:2026-09"] });
    const dctf = aviso("dctfweb:2026-09", "vencida");
    assert.deepEqual(juntarAvisos([dctf], [esocial]).map((a) => a.chave), ["esocial:2026-09"]);
    assert.deepEqual(juntarAvisos([esocial, dctf]).map((a) => a.chave), ["esocial:2026-09"]);
    // Cobrir a si mesmo não apaga o próprio aviso.
    assert.equal(juntarAvisos([aviso("y", "vence", { cobre: ["y"] })]).length, 1);
  });

  it("sem chave, título e link identificam o aviso", () => {
    const sem = { nivel: "vence" as const, titulo: "T", texto: "x", link: { href: "/a", texto: "A" } };
    assert.equal(juntarAvisos([sem, { ...sem }]).length, 1);
    assert.equal(juntarAvisos([sem, { ...sem, link: { href: "/b", texto: "B" } }]).length, 2);
  });

  it("nível mais grave (a cor do sino)", () => {
    assert.equal(nivelMaisGrave([]), null);
    assert.equal(nivelMaisGrave([aviso("a", "info")]), "info");
    assert.equal(nivelMaisGrave([aviso("a", "info"), aviso("b", "vence")]), "vence");
    assert.equal(nivelMaisGrave([aviso("a", "vence"), aviso("b", "vencida"), aviso("c", "info")]), "vencida");
  });
});

describe("certificado guardado no navegador", () => {
  const CNPJ = "12345678000195";
  const info = (validoAte: Date, numero = CNPJ) => ({ titular: { numero, nome: "ALFA" }, validoAte }) as unknown as Omit<InfoCertificado, "certificadoBase64">;
  const AGORA = new Date("2026-10-20T15:00:00Z");

  it("vencendo em 30 dias ou menos: amarelo, com o link para trocar", () => {
    const [a] = avisoDoCertificadoGuardado({ cnpj: CNPJ, info: info(new Date("2026-11-05T02:59:59Z")) }, CNPJ, AGORA);
    assert.equal(a.nivel, "vence");
    assert.match(a.titulo, /Certificado guardado vence em 16 dias/);
    assert.match(a.texto, /vale até 04\/11\/2026/);
    assert.deepEqual(a.link, { href: "/autorizacao", texto: "Trocar o certificado" });
    assert.equal(a.chave, "certificado:2026-11-04");
  });

  it("vencido: vermelho; longe de vencer, de outro CNPJ ou sem certificado: nada", () => {
    assert.equal(avisoDoCertificadoGuardado({ cnpj: CNPJ, info: info(new Date("2026-10-01T00:00:00Z")) }, CNPJ, AGORA)[0].nivel, "vencida");
    assert.deepEqual(avisoDoCertificadoGuardado({ cnpj: CNPJ, info: info(new Date("2027-10-01T00:00:00Z")) }, CNPJ, AGORA), []);
    assert.deepEqual(avisoDoCertificadoGuardado({ cnpj: "99999999000191", info: info(new Date("2026-10-25T00:00:00Z"), "99999999000191") }, CNPJ, AGORA), []);
    assert.deepEqual(avisoDoCertificadoGuardado(null, CNPJ, AGORA), []);
  });

  it("a chave é o dia em Brasília: o mesmo certificado do termo de autorização vira um aviso só", () => {
    assert.equal(diaEmBrasilia(new Date("2026-11-05T02:59:59Z")), "2026-11-04");
    assert.equal(chaveDoCertificado("2026-11-04"), chaveDoCertificado(new Date("2026-11-05T02:59:59Z")));
    const doTermo = aviso("autorizacao", "vence", { cobre: [chaveDoCertificado("2026-11-04")] });
    const [doNavegador] = avisoDoCertificadoGuardado({ cnpj: CNPJ, info: info(new Date("2026-11-05T02:59:59Z")) }, CNPJ, AGORA);
    assert.deepEqual(juntarAvisos([doTermo], [doNavegador]).map((a) => a.chave), ["autorizacao"]);
  });
});
