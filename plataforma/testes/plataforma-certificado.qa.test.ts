// QA (Parte 4, certificado da plataforma): casos de borda não cobertos pelos testes do engenheiro.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { certificadoIcpDeTeste } from "@contabilizadev/nucleo/certificado-teste";
import { plataformaSegredos } from "@/banco/esquema";
import { eq } from "drizzle-orm";
import { guardarCertificado, guardarChaves, lerGuardado, type Ator, type DependenciasSegredos } from "@/lib/plataforma/segredos";
import { avisoDoCertificadoDaPlataforma } from "@/lib/plataforma/aviso";
import { resolverCertificadoDaPlataforma, resolverChavesDoContrato } from "@/lib/serpro/config";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsDeLogin, perfil } from "./apoio";

const PLATAFORMA = "11444777000161";
const DIA = 24 * 60 * 60 * 1000;
const CHAVE = randomBytes(32);
const icp = certificadoIcpDeTeste({ tipo: "PJ", numero: PLATAFORMA, nome: "PLATAFORMA DE TESTE LTDA", senha: "senha-qa" });

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(async () => t.limpar());
after(() => t.fechar());

const deps = (extra: Partial<DependenciasSegredos> = {}): DependenciasSegredos => ({
  banco: t.banco, chave: CHAVE, plataforma: { cnpj: PLATAFORMA }, log: () => {}, ...extra,
});
async function admin(): Promise<Ator> {
  const email = "adm-qa@x.dev";
  const r = await entrarComGoogle(depsDeLogin(t.banco, { x: perfil(email, "sub-qa") }, { adminEmails: [email] }), "x");
  return { id: r.usuario.id, email, papel: "ADMIN" };
}

describe("QA: certificado da plataforma, bordas", () => {
  it("recusa certificado que ainda não começou a valer (validoDe no futuro)", async () => {
    const adm = await admin();
    const futuro = certificadoIcpDeTeste({ tipo: "PJ", numero: PLATAFORMA, nome: "X", senha: "s", validoDe: new Date(Date.now() + 5 * DIA), validoAte: new Date(Date.now() + 400 * DIA) });
    await assert.rejects(guardarCertificado(deps(), adm, futuro.pfx, "s"), (e: { status?: number }) => e.status === 400);
    assert.equal((await t.banco.select().from(plataformaSegredos)).length, 0);
  });

  it("troca recusada (senha errada) não apaga nem altera o certificado já guardado", async () => {
    const adm = await admin();
    await guardarCertificado(deps(), adm, icp.pfx, icp.senha);
    const [antes] = await t.banco.select().from(plataformaSegredos);
    await assert.rejects(guardarCertificado(deps(), adm, icp.pfx, "errada"));
    const [depois] = await t.banco.select().from(plataformaSegredos);
    assert.equal(depois.cifrado, antes.cifrado);
    assert.ok((await lerGuardado(t.banco, CHAVE)).certificado?.legivel);
  });

  it("o cifrado das chaves copiado para a linha do certificado não abre (nome como dado autenticado)", async () => {
    const adm = await admin();
    await guardarCertificado(deps(), adm, icp.pfx, icp.senha);
    await guardarChaves(deps(), adm, "chave-qa", "segredo-qa");
    const [k] = await t.banco.select().from(plataformaSegredos).where(eq(plataformaSegredos.nome, "chaves"));
    await t.banco.update(plataformaSegredos).set({ cifrado: k.cifrado }).where(eq(plataformaSegredos.nome, "certificado"));
    const g = await lerGuardado(t.banco, CHAVE);
    assert.equal(g.certificado?.legivel, false);
    assert.equal(g.chaves?.legivel, true);
  });

  it("guardado ilegível com o ambiente completo: o ambiente vale como alternativa (certificado e chaves)", async () => {
    const adm = await admin();
    await guardarCertificado(deps(), adm, icp.pfx, icp.senha);
    await guardarChaves(deps(), adm, "chave-qa", "segredo-qa");
    const g = await lerGuardado(t.banco, randomBytes(32));
    const env = { CERT_PFX_PATH: "/x.pfx", CERT_PFX_SENHA: "s", SERPRO_CONSUMER_KEY: "k", SERPRO_CONSUMER_SECRET: "s" };
    const c = resolverCertificadoDaPlataforma(PLATAFORMA, env, g, () => Buffer.from("x"), new Date(), () => ({ cnpj: PLATAFORMA, validoAte: new Date(Date.now() + 100 * DIA) }));
    assert.ok(c.pronto && c.origem === "ambiente");
    const k = resolverChavesDoContrato(env, g);
    assert.ok(k.pronto && k.origem === "ambiente");
  });
});

describe("QA: sino do ADMIN, bordas de data", () => {
  it("exatamente 30 dias antes: amarelo; 31 dias: nada", () => {
    const agora = new Date("2026-10-20T12:00:00-03:00");
    assert.equal(avisoDoCertificadoDaPlataforma({ estado: "ok", validoAte: new Date(agora.getTime() + 30 * DIA) }, agora)[0]?.nivel, "vence");
    assert.deepEqual(avisoDoCertificadoDaPlataforma({ estado: "ok", validoAte: new Date(agora.getTime() + 31 * DIA) }, agora), []);
  });

  it("no instante do vencimento: vermelho", () => {
    const agora = new Date("2026-10-20T12:00:00-03:00");
    assert.equal(avisoDoCertificadoDaPlataforma({ estado: "ok", validoAte: agora }, agora)[0]?.nivel, "vencida");
  });

  it("vence hoje à noite (poucas horas): o aviso não pode dizer 'amanhã'", () => {
    const agora = new Date("2026-10-20T09:00:00-03:00");
    const validoAte = new Date("2026-10-20T21:00:00-03:00");
    const [a] = avisoDoCertificadoDaPlataforma({ estado: "ok", validoAte }, agora);
    assert.ok(a, "deveria avisar");
    assert.doesNotMatch(a.titulo, /amanhã/, a.titulo);
  });
});
