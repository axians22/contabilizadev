// QA (Parte 4, ciclo 2 do termo): empresa com o PLATAFORMA_CNPJ ("propria" x "reservada") em casos de borda.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import { empresaUsuarios, termosAutorizacao } from "@/banco/esquema";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { criarEmpresa } from "@/lib/empresas/servico";
import { cifrar } from "@/lib/termo/cifra";
import { nomeDaPlataforma } from "@/lib/termo/plataforma";
import { liberada } from "@/lib/termo/situacao";
import { contextoSerpro, ErroTermoAutorizacao, situacaoTermo, type DependenciasTermo } from "@/lib/termo/termo";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const CHAVE = randomBytes(32);
const AGORA = new Date();
const PLATAFORMA = { numero: "11444777000161", nome: "PLATAFORMA DE TESTE LTDA" };
const PERFIS = { admin: perfil("admin@plataforma.com", "sub-admin"), intruso: perfil("intruso@x.com", "sub-intruso") };
const entrar = async (quem: keyof typeof PERFIS) =>
  (await entrarComGoogle(depsLogin(t.banco, PERFIS, { adminEmails: ["admin@plataforma.com"] }), quem)).usuario;
const dependencias = (cliente: DependenciasTermo["cliente"]): DependenciasTermo => ({
  banco: t.banco, chave: CHAVE, cliente, contratante: PLATAFORMA, adminEmails: ["admin@plataforma.com"], agora: () => AGORA,
});

async function intrusoDonoComAdminMembro(): Promise<{ intruso: AcessoEmpresa; admin: AcessoEmpresa }> {
  const intrusoU = await entrar("intruso");
  const adminU = await entrar("admin");
  const empresa = await criarEmpresa(t.banco, intrusoU, { cnpj: PLATAFORMA.numero, razaoSocial: "INTRUSO LTDA" });
  await t.banco.insert(empresaUsuarios).values({ empresaId: empresa.id, usuarioId: adminU.id, papel: "MEMBRO" });
  return { intruso: await exigirAcessoEmpresa(t.banco, intrusoU, empresa.id), admin: await exigirAcessoEmpresa(t.banco, adminU, empresa.id) };
}

describe("QA ciclo 2: empresa com o CNPJ da plataforma", () => {
  it("admin só como MEMBRO (dono é o intruso) não torna a empresa 'propria', nem para o admin", async () => {
    const { intruso, admin } = await intrusoDonoComAdminMembro();
    for (const acesso of [intruso, admin]) {
      const s = await situacaoTermo(dependencias(clienteFalso()), acesso);
      assert.equal(liberada(s), false, JSON.stringify(s));
    }
  });

  it("razão social do destinatário não vem de empresa cujo ADMIN é só MEMBRO", async () => {
    await intrusoDonoComAdminMembro();
    assert.equal(await nomeDaPlataforma(t.banco, PLATAFORMA.numero, ["admin@plataforma.com"], {}), null);
  });

  it("empresa reservada com um termo e token válidos guardados (de antes da regra) não usa nem renova nada", async () => {
    const { intruso } = await intrusoDonoComAdminMembro();
    const id = crypto.randomUUID();
    const ctx = (campo: string) => `termo-autorizacao:${intruso.empresaId}:${id}:${campo}`;
    await t.banco.insert(termosAutorizacao).values({
      id, empresaId: intruso.empresaId, contratante: PLATAFORMA.numero, enviadoEm: AGORA,
      dataAssinatura: "2026-10-18", vigencia: "2027-10-18", certificadoValidoAte: new Date(AGORA.getTime() + 400 * 86400000),
      signatarioCnpj: PLATAFORMA.numero, signatarioNome: "INTRUSO LTDA", xmlHash: "x",
      termoCifrado: cifrar("<termo/>", CHAVE, ctx("termo")), tokenCifrado: cifrar("tok", CHAVE, ctx("token")),
      tokenExpiraEm: new Date(AGORA.getTime() + 3600000), tokenObtidoEm: AGORA,
    });
    const cliente = clienteFalso();
    assert.equal(liberada(await situacaoTermo(dependencias(cliente), intruso)), false);
    await assert.rejects(contextoSerpro(dependencias(cliente), intruso), (e: Error) => e instanceof ErroTermoAutorizacao && e.motivo === "plataforma-reservada");
  });
});
