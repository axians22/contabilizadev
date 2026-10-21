// Assinatura do cliente com as duas opções ("Usar só agora" e "Guardar neste navegador"), de ponta a ponta contra o banco
// de teste: o termo de autorização (assinar e "Assinar de novo") e a DCTFWeb da rotina do mês, com o assinador único da
// tela (lib/assinador), o cofre do navegador num IndexedDB falso, o e-CNPJ A1 de teste gerado na hora e o cliente do
// contrato falso (respostas no formato oficial). Nada sai da máquina e nada é transmitido de verdade.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { IDBFactory } from "fake-indexeddb";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { verificarAssinatura } from "@contabilizadev/nucleo/assinatura";
import { certificadoIcpDeTeste } from "@contabilizadev/nucleo/certificado-teste";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import { cnpj, type Resposta } from "@contabilizadev/nucleo/serpro/cliente";
import { xmlDctf } from "@contabilizadev/nucleo/serpro/dctf-exemplo";
import { assinarTermoCom, montarTermo, pemDoCertificado, vigenciaPara } from "@contabilizadev/nucleo/serpro/termo-xml";
import { dctfwebEnvios, termosAutorizacao } from "@/banco/esquema";
import { assinanteDoArquivo, assinanteGuardado, type Assinante } from "@/lib/assinador/assinador";
import { cofreDoNavegador, type Cofre } from "@/lib/assinador/cofre";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro } from "@/lib/empresas/cadastro";
import { conferirDctfMes, prepararTransmissaoDctf, situacaoDctf, transmitirDctfMes } from "@/lib/rotina/dctfweb";
import type { DependenciasRotina } from "@/lib/rotina/dependencias";
import { MENSAGENS_DA_ROTINA } from "@/lib/rotina/mensagens";
import { informarProLabore } from "@/lib/rotina/receitas";
import { parametrosDoTermo, registrarTermo, situacaoTermo, type DependenciasTermo } from "@/lib/termo/termo";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const DIA = 24 * 60 * 60 * 1000;
const PERFIS = { ana: perfil("ana@a.com", "sub-ana") };
const TOKEN = "b06feea3-1ca8-49f4-bdb4-211ab006cb92";
const ok = (dados: unknown): Resposta => ({ status: 200, dados, mensagens: [{ codigo: "Sucesso", texto: "ok" }] });

// Os dois exemplos de empresa de TI: "ti-fator-r" (12.345.678/0001-95) e "ti-anexo-iii" (98.765.432/0001-98).
async function empresa(exemplo: "ti-fator-r" | "ti-anexo-iii", agora: Date) {
  const usuario = (await entrarComGoogle(depsLogin(t.banco, PERFIS), "ana")).usuario;
  const numero = exemplo === "ti-fator-r" ? "12.345.678/0001-95" : "98.765.432/0001-98";
  const r = await consultarParaCadastro(t.banco, usuario, numero, { segredo: SEGREDO, agora, buscar: buscarExemplo(exemplo) });
  assert.equal(r.tipo, "previa");
  const empresaId = await cadastrarPelaPrevia(t.banco, usuario, r.previa.token, { segredo: SEGREDO, agora });
  return { usuario, acesso: await exigirAcessoEmpresa(t.banco, usuario, empresaId) };
}

// O que a tela faz: "Usar só agora" (arquivo e senha, nada guardado) ou "Guardar neste navegador" (na primeira vez,
// arquivo e senha; depois, só o clique: assinanteGuardado).
const doArquivo = (certificado: ReturnType<typeof certificadoIcpDeTeste>, numero: string, agora: Date, guardar: boolean, cofre: Cofre) =>
  assinanteDoArquivo({ pfx: new Uint8Array(certificado.pfx), senha: certificado.senha, cnpjEmpresa: numero, agora, guardar, cofre });

describe("termo de autorização com as duas opções (assinar e Assinar de novo)", () => {
  const AGORA = new Date(); // o termo precisa ser do dia de hoje e o certificado de teste vale a partir de agora
  const EMPRESA = "12345678000195";
  const PLATAFORMA = { numero: "11444777000161", nome: "PLATAFORMA DE TESTE LTDA" };
  const CHAVE = randomBytes(32);
  const eCnpj = certificadoIcpDeTeste({ tipo: "PJ", numero: EMPRESA, nome: "EXEMPLO SOFTWARE LTDA" });
  const tokenRecebido = (agora: Date): Resposta => ({
    status: 200,
    dados: { autenticar_procurador_token: TOKEN, data_hora_expiracao: `${new Date(agora.getTime() + DIA).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })}T23:59:59` },
    mensagens: [{ codigo: "200", texto: "Sucesso na execução." }],
  });
  const dependencias = (cliente: DependenciasTermo["cliente"], agora: Date): DependenciasTermo => ({ banco: t.banco, chave: CHAVE, cliente, contratante: PLATAFORMA, adminEmails: [], agora: () => agora });

  // A tela: monta o termo com os parâmetros do servidor e assina com o assinador (assinarTermoCom, chave no WebCrypto).
  async function assinarEEnviar(acesso: AcessoEmpresa, a: Assinante, agora: Date) {
    const cliente = clienteFalso(tokenRecebido(agora));
    const d = dependencias(cliente, agora);
    const p = await parametrosDoTermo(d, acesso);
    const termo = montarTermo({ destinatario: p.contratante, assinadoPor: { numero: a.info.titular.numero, nome: p.empresa.razaoSocial }, dataAssinatura: p.dataAssinatura, vigencia: vigenciaPara(p.vigenciaMaxima, a.info) });
    const xml = await assinarTermoCom(termo, a.info.certificadoBase64, a.assinar);
    const r = await registrarTermo(d, acesso, xml);
    return { r, cliente, xml };
  }

  it("Usar só agora: assina, o servidor confere e envia, e nada fica guardado no navegador", async () => {
    const { acesso } = await empresa("ti-fator-r", AGORA);
    const cofre = cofreDoNavegador(new IDBFactory());
    const a = await doArquivo(eCnpj, EMPRESA, AGORA, false, cofre);
    const { r, cliente, xml } = await assinarEEnviar(acesso, a, AGORA);
    assert.equal(r.enviado, true);
    assert.equal(r.situacao.estado, "vigente");
    assert.equal(cliente.chamadas.length, 1);
    assert.equal(Buffer.from((cliente.chamadas[0].pedido.dados as { xml: string }).xml, "base64").toString("utf8"), xml);
    assert.deepEqual(await cofre.cnpjs(), []);
    // O servidor só guardou o termo cifrado: nada da chave.
    const [linha] = await t.banco.select().from(termosAutorizacao).where(eq(termosAutorizacao.empresaId, acesso.empresaId));
    assert.doesNotMatch(JSON.stringify(linha), /PRIVATE KEY|BEGIN/);
  });

  it("Guardar neste navegador: na primeira vez com o arquivo; no Assinar de novo, só com a chave guardada", async () => {
    const { acesso } = await empresa("ti-fator-r", AGORA);
    const cofre = cofreDoNavegador(new IDBFactory());
    const primeira = await doArquivo(eCnpj, EMPRESA, AGORA, true, cofre);
    assert.equal((await assinarEEnviar(acesso, primeira, AGORA)).r.enviado, true);
    assert.deepEqual(await cofre.cnpjs(), [EMPRESA]);

    // Dois dias depois, "Assinar de novo": sem arquivo nem senha, a chave guardada assina um termo novo (outra data).
    const depois = new Date(AGORA.getTime() + 2 * DIA);
    const guardada = await assinanteGuardado({ cnpjEmpresa: EMPRESA, agora: depois, cofre });
    assert.ok(guardada);
    const { r, cliente } = await assinarEEnviar(acesso, guardada, depois);
    assert.equal(r.enviado, true);
    assert.equal(cliente.chamadas.length, 1);
    assert.equal((await situacaoTermo(dependencias(clienteFalso(), depois), acesso)).estado, "vigente");
    const linhas = await t.banco.select().from(termosAutorizacao).where(eq(termosAutorizacao.empresaId, acesso.empresaId));
    assert.equal(linhas.length, 2); // o novo substitui o anterior
    assert.equal(linhas.filter((l) => !l.substituidoEm).length, 1);

    // Removido do navegador, não há mais o que usar sem o arquivo.
    await cofre.remover(EMPRESA);
    assert.equal(await assinanteGuardado({ cnpjEmpresa: EMPRESA, agora: depois, cofre }), null);
  });
});

describe("DCTFWeb da rotina do mês com as duas opções", () => {
  const em = (iso: string) => new Date(`${iso}-03:00`);
  const AGORA = em("2026-10-18T10:00:00");
  const SUPORTE = "98765432000198";
  const eCnpj = certificadoIcpDeTeste({ tipo: "PJ", numero: SUPORTE, nome: "SUPORTE TI LTDA", validoDe: new Date("2026-01-01") });
  const conferencia = () => ok({ XMLStringBase64: Buffer.from(xmlDctf(), "utf8").toString("base64") });
  const dependencias = (cliente: DependenciasRotina["cliente"]): DependenciasRotina => ({
    banco: t.banco,
    cliente,
    contexto: async () => ({ contribuinte: cnpj(SUPORTE), autorPedidoDados: cnpj(SUPORTE), tokenProcurador: TOKEN }),
    agora: () => AGORA,
    log: () => {},
  });

  // O que a tela faz depois do clique: o servidor prepara com o certificado público, o cliente confirma o valor e a chave
  // (do arquivo ou guardada) assina o texto preparado.
  async function transmitirCom(acesso: AcessoEmpresa, d: DependenciasRotina, pa: string, a: Assinante) {
    const preparo = await prepararTransmissaoDctf(d, acesso, pa, { certificado: a.info.certificadoBase64 });
    assert.ok(preparo.ok, JSON.stringify(preparo));
    if (!preparo.ok) throw new Error("sem preparo");
    // Sem a confirmação explícita, nada é enviado (a tela só chama com a caixa "Confirmo" marcada).
    assert.deepEqual(
      await transmitirDctfMes(d, acesso, pa, { confirmado: false, confirmacao: { aPagar: preparo.aPagar }, preparoId: preparo.preparoId, assinatura: await a.assinar(preparo.signedInfo) }),
      { ok: false, mensagem: MENSAGENS_DA_ROTINA.semConfirmacao },
    );
    return transmitirDctfMes(d, acesso, pa, { confirmado: true, confirmacao: { aPagar: preparo.aPagar }, preparoId: preparo.preparoId, assinatura: await a.assinar(preparo.signedInfo) });
  }

  for (const guardar of [false, true]) {
    it(`${guardar ? "Guardar neste navegador" : "Usar só agora"}: o servidor prepara, a chave do navegador assina e a DCTFWeb é transmitida`, async () => {
      const { acesso } = await empresa("ti-anexo-iii", AGORA);
      const cliente = clienteFalso(conferencia(), ok({ numeroRecibo: "1" }));
      const d = dependencias(cliente);
      await informarProLabore(d, acesso, { mes: "2026-09", valor: 1_621 }); // INSS 11% = 178,31
      assert.ok((await conferirDctfMes(d, acesso, "2026-09")).ok);
      const cofre = cofreDoNavegador(new IDBFactory());
      const a = await doArquivo(eCnpj, SUPORTE, AGORA, guardar, cofre);
      assert.deepEqual(await transmitirCom(acesso, d, "2026-09", a), { ok: true, recibo: "1" });
      assert.equal(cliente.chamadas.length, 2);
      const enviado = Buffer.from((cliente.chamadas[1].pedido.dados as { xmlAssinadoBase64: string }).xmlAssinadoBase64, "base64").toString("utf8");
      assert.equal(verificarAssinatura(enviado, pemDoCertificado(a.info.certificadoBase64)), true);
      assert.equal(cliente.chamadas[1].opcoes.confirmado, true);
      assert.equal((await situacaoDctf(t.banco, acesso, "2026-09", AGORA)).transmitida, true);
      assert.deepEqual(await cofre.cnpjs(), guardar ? [SUPORTE] : []);
      // O servidor recebeu só o certificado público e o XML assinado.
      const linhas = await t.banco.select().from(dctfwebEnvios).where(eq(dctfwebEnvios.empresaId, acesso.empresaId));
      assert.doesNotMatch(JSON.stringify(linhas), /PRIVATE KEY/);
    });
  }

  it("Guardar neste navegador: no mês seguinte basta clicar (sem arquivo nem senha); de outra empresa ou vencido não assina", async () => {
    const { acesso } = await empresa("ti-anexo-iii", AGORA);
    const cliente = clienteFalso(conferencia(), ok({ numeroRecibo: "1" }), conferencia(), ok({ numeroRecibo: "2" }));
    const d = dependencias(cliente);
    for (const mes of ["2026-08", "2026-09"]) await informarProLabore(d, acesso, { mes, valor: 1_621 });
    const cofre = cofreDoNavegador(new IDBFactory());

    assert.ok((await conferirDctfMes(d, acesso, "2026-08")).ok);
    assert.equal((await transmitirCom(acesso, d, "2026-08", await doArquivo(eCnpj, SUPORTE, AGORA, true, cofre))).ok, true);

    assert.ok((await conferirDctfMes(d, acesso, "2026-09")).ok);
    const guardada = await assinanteGuardado({ cnpjEmpresa: SUPORTE, agora: AGORA, cofre });
    assert.ok(guardada);
    assert.deepEqual(await transmitirCom(acesso, d, "2026-09", guardada), { ok: true, recibo: "2" });
    assert.equal(cliente.chamadas.length, 4);

    // Na outra empresa do usuário (outro CNPJ), a chave desta não aparece; vencido, pede para trocar.
    assert.equal(await assinanteGuardado({ cnpjEmpresa: "12345678000195", agora: AGORA, cofre }), null);
    const registro = (await cofre.pegar(SUPORTE))!;
    await assert.rejects(assinanteGuardado({ cnpjEmpresa: SUPORTE, agora: registro.info.validoAte, cofre }), /venceu em .*Troque o certificado/);
  });
});
