// QA (Parte 2, remover empresa): casos que os testes do engenheiro não cobrem.
// 1. Corrida entre a remoção e o envio do termo de autorização: o envio que esperou a trava da empresa não pode seguir
//    com a empresa já apagada (chamar o Serpro, que é pago, e quebrar com erro do banco ao gravar o termo).
// 2. Remover uma empresa que NÃO é a ativa (aba antiga, outra aba trocou a ativa): a ativa da sessão não pode pular.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { certificadoIcpDeTeste, confiancaDeTeste } from "@contabilizadev/nucleo/certificado-teste";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import type { Resposta } from "@contabilizadev/nucleo/serpro/cliente";
import { abrirCertificado, assinarTermo, montarTermo, vigenciaPara } from "@contabilizadev/nucleo/serpro/termo-autorizacao";
import { empresas, sessoes, termosAutorizacao } from "@/banco/esquema";
import { entrarComGoogle, resolverSessao } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa, SemAcessoEmpresa } from "@/lib/empresas/acesso";
import { removerEmpresa } from "@/lib/empresas/remocao";
import { criarEmpresa, definirEmpresaAtiva } from "@/lib/empresas/servico";
import { parametrosDoTermo, registrarTermo, type DependenciasTermo } from "@/lib/termo/termo";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps, perfil, SEGREDO } from "./apoio";
import { cadastrarComprovada, consultarComDados } from "./apoio-empresa";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const DIA = 24 * 60 * 60 * 1000;
const AGORA = new Date();
const CHAVE = randomBytes(32);
const PLATAFORMA = { numero: "11444777000161", nome: "PLATAFORMA DE TESTE LTDA" };
const EMPRESA = "12345678000195";
const PERFIS = { ana: perfil("ana@a.com", "sub-ana") };
const semLog = () => {};
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

const tokenRecebido = (): Resposta => ({
  status: 200,
  dados: {
    autenticar_procurador_token: "b06feea3-1ca8-49f4-bdb4-211ab006cb92",
    data_hora_expiracao: `${new Date(AGORA.getTime() + DIA).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })}T23:59:59`,
  },
  mensagens: [{ codigo: "200", texto: "Sucesso na execução." }],
});

async function entrarAna() {
  const d = deps(t.banco, PERFIS);
  const { cookie } = await entrarComGoogle(d, "ana");
  const sessao = await resolverSessao(d, cookie);
  assert.ok(sessao);
  return sessao;
}

describe("QA remoção x envio do termo", () => {
  it("o envio do termo que esperou a trava da remoção não chama o Serpro nem quebra com erro do banco", async () => {
    const ana = await entrarAna();
    const r = await consultarComDados(t.banco, ana.usuario, EMPRESA, { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-fator-r") });
    assert.equal(r.tipo, "previa");
    const empresaId = await cadastrarComprovada(t.banco, ana.usuario, r.previa.token, { segredo: SEGREDO, agora: AGORA });
    const acesso = await exigirAcessoEmpresa(t.banco, ana.usuario, empresaId);

    const cliente = clienteFalso(tokenRecebido());
    const d: DependenciasTermo = { banco: t.banco, chave: CHAVE, cliente, contratante: PLATAFORMA, adminEmails: [], confianca: confiancaDeTeste(), agora: () => AGORA };
    const p = await parametrosDoTermo(d, acesso);
    const cert = certificadoIcpDeTeste({ tipo: "PJ", numero: EMPRESA, nome: "EXEMPLO SOFTWARE LTDA" });
    const aberto = abrirCertificado(new Uint8Array(cert.pfx), cert.senha);
    const xml = assinarTermo(
      montarTermo({
        destinatario: p.contratante,
        assinadoPor: { numero: aberto.titular.numero, nome: p.empresa.razaoSocial },
        dataAssinatura: p.dataAssinatura,
        vigencia: vigenciaPara(p.vigenciaMaxima, aberto),
      }),
      aberto,
    );

    // A remoção (o mesmo que removerEmpresa faz: trava a empresa e apaga) está no meio quando o envio chega na trava.
    let envio: Promise<unknown> | undefined;
    await t.banco.transaction(async (tx) => {
      await tx.select({ id: empresas.id }).from(empresas).where(eq(empresas.id, empresaId)).for("no key update");
      envio = registrarTermo(d, acesso, xml).then(
        (v) => ({ ok: v }),
        (e: unknown) => ({ erro: e }),
      );
      await espera(500);
      await tx.delete(empresas).where(eq(empresas.id, empresaId));
    });
    const resultado = (await envio) as { ok?: unknown; erro?: unknown };

    assert.equal(cliente.chamadas.length, 0, "chamou o Serpro (pago) para uma empresa já removida");
    assert.ok(resultado.erro instanceof SemAcessoEmpresa, `esperado 'Empresa não encontrada.', veio: ${String((resultado.erro as Error)?.message ?? JSON.stringify(resultado.ok))}`);
    assert.equal((await t.banco.select().from(termosAutorizacao)).length, 0);
  });
});

describe("QA remoção de empresa que não é a ativa", () => {
  it("remover outra empresa (aba antiga) não troca a empresa ativa da sessão", async () => {
    const ana = await entrarAna();
    const a = (await criarEmpresa(t.banco, ana.usuario, { cnpj: "45723174000110", razaoSocial: "AAA Ltda" })).id;
    const b = (await criarEmpresa(t.banco, ana.usuario, { cnpj: "11222333000181", razaoSocial: "BBB Ltda" })).id;
    const c = (await criarEmpresa(t.banco, ana.usuario, { cnpj: EMPRESA, razaoSocial: "CCC Ltda" })).id;
    // Ana estava com a B na aba antiga e trocou para a C em outra aba; confirma a remoção da B na aba antiga.
    await definirEmpresaAtiva(t.banco, ana, c);
    const r = await removerEmpresa(t.banco, ana, b, "11222333000181", { log: semLog });
    assert.equal(r.removida.id, b);
    const [s] = await t.banco.select({ ativa: sessoes.empresaAtivaId }).from(sessoes).where(eq(sessoes.id, ana.sessaoId));
    assert.equal(s.ativa, c, `a ativa pulou para ${s.ativa === a ? "AAA" : s.ativa}`);
  });
});
