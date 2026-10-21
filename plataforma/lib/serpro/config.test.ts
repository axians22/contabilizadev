import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { certificadoDeTeste } from "@contabilizadev/nucleo/certificado-teste";
import { certificadoIcpDeTeste } from "@contabilizadev/nucleo/certificado-teste";
import { converterParaPem } from "@contabilizadev/nucleo/serpro/termo-autorizacao";
import type { Guardado } from "@/lib/plataforma/segredos";
import { montarPlataforma } from "@/lib/plataforma/montagem";
import { LIMITE_PADRAO_POR_PERIODO, lerCertificado, lerCnpjPlataforma, resolverCertificadoDaPlataforma, resolverChavesDoContrato, type ConfigSerpro } from "./config";

const DIA = 24 * 60 * 60 * 1000;
const PLATAFORMA = "11444777000161";
const plataforma = certificadoDeTeste({ titular: `PLATAFORMA DE TESTE LTDA:${PLATAFORMA}`, dias: 30 });
const ENV = {
  PLATAFORMA_CNPJ: "11.444.777/0001-61",
  SERPRO_CONSUMER_KEY: "chave",
  SERPRO_CONSUMER_SECRET: "segredo",
  CERT_PFX_PATH: "/tmp/plataforma.pfx",
  CERT_PFX_SENHA: plataforma.senha,
};
const ler = (pfx: Buffer) => (arquivo: string) => {
  assert.equal(arquivo, "/tmp/plataforma.pfx");
  return pfx;
};
const motivo = (c: ConfigSerpro) => (c.pronto ? "" : c.motivo);
// A configuração do contrato como o servidor monta (o certificado resolvido uma vez, em montarPlataforma).
const serproDe = (env: Record<string, string | undefined>, ler?: (a: string) => Buffer, agora?: Date, abrir?: Parameters<typeof montarPlataforma>[4], guardado?: Guardado) =>
  montarPlataforma(env, guardado, agora, ler, abrir).serpro;

describe("CNPJ da plataforma (PLATAFORMA_CNPJ)", () => {
  it("aceita com ou sem pontuação, numérico ou alfanumérico, e guarda sem pontuação", () => {
    assert.deepEqual(lerCnpjPlataforma({ PLATAFORMA_CNPJ: " 11.444.777/0001-61 " }), { cnpj: PLATAFORMA });
    assert.deepEqual(lerCnpjPlataforma({ PLATAFORMA_CNPJ: "12.abc.345/01de-35" }), { cnpj: "12ABC34501DE35" });
  });
  it("sem ou inválido: diz o que falta", () => {
    assert.match((lerCnpjPlataforma({}) as { motivo: string }).motivo, /Falta PLATAFORMA_CNPJ/);
    assert.match((lerCnpjPlataforma({ PLATAFORMA_CNPJ: "11444777000162" }) as { motivo: string }).motivo, /inválido/);
  });
});

describe("configuração do contrato (credenciais e certificado da plataforma)", () => {
  it("completa: contratante = PLATAFORMA_CNPJ, certificado em memória e limite padrão", () => {
    const c = serproDe(ENV, ler(plataforma.pfx));
    assert.equal(c.pronto, true, motivo(c));
    if (!c.pronto) return;
    assert.equal(c.contratante, PLATAFORMA);
    assert.equal(c.limitePorPeriodo, LIMITE_PADRAO_POR_PERIODO);
    assert.equal(c.consumerKey, "chave");
    assert.ok("pfx" in c.certificado && c.certificado.pfx === plataforma.pfx);
    assert.match(c.pem().chave, /PRIVATE KEY/);
    const com300 = serproDe({ ...ENV, SERPRO_LIMITE_POR_PERIODO: "300" }, ler(plataforma.pfx));
    assert.equal(com300.pronto && com300.limitePorPeriodo, 300);
  });

  it("sem credenciais (como hoje no .env.local): desligada, dizendo o que falta, sem ler arquivo nenhum", () => {
    const nada = () => assert.fail("não deveria ler o certificado");
    const semNada = motivo(serproDe({ PLATAFORMA_CNPJ: PLATAFORMA }, nada));
    assert.match(semNada, /Faltam as chaves do contrato: informe em \/admin\/plataforma .*SERPRO_CONSUMER_KEY, SERPRO_CONSUMER_SECRET/);
    assert.match(semNada, /Falta o certificado da plataforma: envie o e-CNPJ A1 em \/admin\/plataforma .*CERT_PFX_PATH, CERT_PFX_SENHA/);
    assert.match(motivo(serproDe({ ...ENV, CERT_PFX_SENHA: " " }, nada)), /falta CERT_PFX_SENHA/);
    // Sem o CNPJ da plataforma, nem olha o resto.
    assert.match(motivo(serproDe({ ...ENV, PLATAFORMA_CNPJ: "" }, nada)), /PLATAFORMA_CNPJ/);
  });

  it("arquivo ausente, senha errada, vencido, de outro CNPJ ou limite inválido: desligada com o motivo", () => {
    assert.match(motivo(serproDe(ENV, () => { throw new Error("ENOENT"); })), /Não foi possível ler o certificado/);
    assert.match(motivo(serproDe({ ...ENV, CERT_PFX_SENHA: "errada" }, ler(plataforma.pfx))), /confira o arquivo e a senha/);
    assert.match(motivo(serproDe(ENV, ler(plataforma.pfx), new Date(Date.now() + 31 * DIA))), /vencido/);
    const outro = certificadoDeTeste({ titular: "OUTRA EMPRESA LTDA:11222333000181" });
    assert.match(motivo(serproDe({ ...ENV, CERT_PFX_SENHA: outro.senha }, ler(outro.pfx))), /CNPJ 11222333000181, mas PLATAFORMA_CNPJ é 11444777000161/);
    assert.match(motivo(serproDe({ ...ENV, SERPRO_LIMITE_POR_PERIODO: "0" }, ler(plataforma.pfx))), /inteiro positivo/);
    assert.match(motivo(serproDe({ ...ENV, SERPRO_LIMITE_POR_PERIODO: "abc" }, ler(plataforma.pfx))), /inteiro positivo/);
  });

  it("lerCertificado: CNPJ do e-CNPJ (CN ou extensão ICP-Brasil, inclusive alfanumérico) e validade; sem CNPJ, recusado", () => {
    const t = lerCertificado(plataforma);
    assert.equal(t.cnpj, PLATAFORMA);
    assert.ok(t.validoAte.getTime() > Date.now() + 29 * DIA);
    const alfa = certificadoIcpDeTeste({ tipo: "PJ", numero: "12ABC34501DE35", nome: "ALFA" });
    assert.equal(lerCertificado(alfa).cnpj, "12ABC34501DE35");
    // Sem número no CN nem extensão: não abre como certificado da plataforma.
    const semCnpj = certificadoDeTeste({ titular: "PLATAFORMA" });
    assert.throws(() => lerCertificado(semCnpj), /não é um e-CNPJ/);
    const c = resolverCertificadoDaPlataforma(PLATAFORMA, { ...ENV, CERT_PFX_SENHA: semCnpj.senha }, undefined, ler(semCnpj.pfx));
    assert.ok(!c.pronto && c.falha.tipo === "invalido");
    assert.equal(serproDe({ ...ENV, CERT_PFX_SENHA: semCnpj.senha }, ler(semCnpj.pfx)).pronto, false);
  });

  it("CERT_PFX_PATH com um e-CPF ICP-Brasil: recusado como o guardado (o mesmo critério), com o motivo técnico", () => {
    const ecpf = certificadoIcpDeTeste({ tipo: "PF", numero: "12345678909", nome: "FULANO" });
    assert.equal(lerCertificado(ecpf).cnpj, null);
    const c = resolverCertificadoDaPlataforma(PLATAFORMA, { ...ENV, CERT_PFX_SENHA: ecpf.senha }, undefined, ler(ecpf.pfx));
    assert.ok(!c.pronto);
    assert.equal(c.falha.tipo, "outro-cnpj");
    assert.match(c.motivo, /\(CERT_PFX_PATH\) não é um e-CNPJ .*PLATAFORMA_CNPJ 11444777000161/);
    const s = serproDe({ ...ENV, CERT_PFX_SENHA: ecpf.senha }, ler(ecpf.pfx));
    assert.equal(s.pronto, false);
    assert.match(motivo(s), /não é um e-CNPJ/);
  });
});

describe("ordem de leitura: o guardado no banco primeiro, o ambiente como alternativa", () => {
  const icp = certificadoIcpDeTeste({ tipo: "PJ", numero: PLATAFORMA, nome: "PLATAFORMA DE TESTE LTDA", validoAte: new Date(Date.now() + 90 * DIA) });
  const aberto = converterParaPem(icp.pfx, icp.senha);
  const quem = { atualizadoEm: new Date(), atualizadoPor: "Admin" };
  const info = { titular: "PLATAFORMA DE TESTE LTDA", cnpj: PLATAFORMA, validoDe: aberto.info.validoDe.toISOString(), validoAte: aberto.info.validoAte.toISOString(), emissor: aberto.info.emissor };
  const guardado: Guardado = {
    certificado: { ...quem, info, legivel: true, pem: { chave: aberto.chave, certificado: aberto.certificado } },
    chaves: { ...quem, info: { finalDaChave: "anco" }, legivel: true, consumerKey: "chave-do-banco", consumerSecret: "segredo-do-banco" },
  };
  const nada = () => assert.fail("não deveria ler o arquivo do ambiente");

  it("tudo no banco: pronta sem nenhuma variável do contrato, com o certificado em PEM (sem senha) e as chaves do banco", () => {
    const c = serproDe({ PLATAFORMA_CNPJ: PLATAFORMA }, nada, new Date(), undefined, guardado);
    assert.equal(c.pronto, true, motivo(c));
    if (!c.pronto) return;
    assert.deepEqual(c.certificado, { chave: aberto.chave, certificado: aberto.certificado });
    assert.equal(c.consumerKey, "chave-do-banco");
    assert.equal(c.consumerSecret, "segredo-do-banco");
    // O PEM para assinar como a plataforma: o certificado do titular (o primeiro), não o da AC.
    assert.equal(c.pem().certificadoBase64, aberto.info.certificadoBase64);
  });

  it("o banco ganha do ambiente (o drive com o .pfx pode nem estar montado)", () => {
    const c = serproDe(ENV, nada, new Date(), undefined, guardado);
    assert.ok(c.pronto && c.consumerKey === "chave-do-banco" && !("pfx" in c.certificado));
  });

  it("só o certificado no banco: as chaves vêm do ambiente; só as chaves no banco: o certificado vem do arquivo", () => {
    const soCertificado = serproDe(ENV, nada, new Date(), undefined, { ...guardado, chaves: null });
    assert.ok(soCertificado.pronto && soCertificado.consumerKey === "chave" && !("pfx" in soCertificado.certificado));
    const soChaves = serproDe(ENV, ler(plataforma.pfx), new Date(), undefined, { ...guardado, certificado: null });
    assert.ok(soChaves.pronto && soChaves.consumerKey === "chave-do-banco" && "pfx" in soChaves.certificado);
  });

  it("guardado vencido ou de outro CNPJ: desligada, dizendo o que fazer (não cai para o ambiente)", () => {
    const depois = new Date(Date.now() + 91 * DIA);
    assert.match(motivo(serproDe(ENV, nada, depois, undefined, guardado)), /guardado venceu em .*\/admin\/plataforma/);
    const outroCnpj = resolverCertificadoDaPlataforma("11222333000181", ENV, guardado, nada);
    assert.match(outroCnpj.pronto ? "" : outroCnpj.motivo, /guardado é do CNPJ 11444777000161, mas PLATAFORMA_CNPJ é 11222333000181/);
  });

  it("guardado ilegível (PLATAFORMA_CHAVE trocada): usa o ambiente se houver; sem ele, pede para enviar de novo", () => {
    const ilegivel: Guardado = { certificado: { ...quem, info, legivel: false }, chaves: { ...quem, info: { finalDaChave: "anco" }, legivel: false } };
    assert.equal(serproDe(ENV, ler(plataforma.pfx), new Date(), undefined, ilegivel).pronto, true);
    const m = motivo(serproDe({ PLATAFORMA_CNPJ: PLATAFORMA }, nada, new Date(), undefined, ilegivel));
    assert.match(m, /certificado da plataforma guardado não abre com a PLATAFORMA_CHAVE atual/);
    assert.match(m, /chaves do contrato guardadas não abrem com a PLATAFORMA_CHAVE atual/);
    const chaves = resolverChavesDoContrato({}, ilegivel);
    assert.equal(chaves.pronto, false);
  });

  it("o motivo nunca traz o conteúdo do segredo", () => {
    const vencido = motivo(serproDe(ENV, nada, new Date(Date.now() + 91 * DIA), undefined, guardado));
    assert.ok(!vencido.includes("segredo-do-banco") && !vencido.includes("PRIVATE KEY"));
  });
});
