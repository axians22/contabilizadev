// Parte 4, passos 14 a 16: termo de autorização de ponta a ponta, com a empresa cadastrada pela Parte 3 como cliente 1.
// Nada sai da máquina: o cliente do contrato é o falso do núcleo (respostas gravadas no formato da documentação
// oficial) ou o cliente real com um transporte falso. O certificado é gerado na hora (e-CNPJ A1 de teste, AC de
// teste). O termo é montado e assinado com o mesmo código que roda no navegador (nucleo/src/serpro/termo-autorizacao.ts).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { buscarExemplo, buscarFalso, respostaGravada } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { certificadoIcpDeTeste, type OpcoesCertificadoIcp } from "@contabilizadev/nucleo/certificado-teste";
import type { Certificado, Transporte } from "@contabilizadev/nucleo/http";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import { criarClienteSerpro, type Resposta } from "@contabilizadev/nucleo/serpro/cliente";
import { abrirCertificado, assinarTermo, montarTermo, vigenciaPara } from "@contabilizadev/nucleo/serpro/termo-autorizacao";
import { empresas, empresaUsuarios, serproChamadas, termosAutorizacao, usuarios } from "@/banco/esquema";
import { entrarComGoogle, resolverSessao } from "@/lib/autenticacao/servico";
import { removerEmpresa } from "@/lib/empresas/remocao";
import { exigirAcessoEmpresa, SemAcessoEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { autorizacaoDoPreparo, ESTADO_INICIAL, reduzir, vistaDaAutorizacao, type EventoAssistente } from "@/lib/empresas/assistente";
import { cadastrarPelaPrevia, CNPJ_RESERVADO, consultarParaCadastro } from "@/lib/empresas/cadastro";
import { criarEmpresa, ErroDeEmpresa } from "@/lib/empresas/servico";
import { decifrar } from "@/lib/termo/cifra";
import { nomeDaPlataforma } from "@/lib/termo/plataforma";
import { liberada, avisoDaSituacao } from "@/lib/termo/situacao";
import {
  contextoSerpro,
  ErroAutenticaProcurador,
  ErroTermo,
  ErroTermoAutorizacao,
  parametrosDoTermo,
  prepararAutorizacao,
  registrarTermo,
  situacaoTermo,
  type DependenciasTermo,
  type ParametrosTermo,
} from "@/lib/termo/termo";
import { registroNoBanco } from "@/lib/serpro/registro";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const DIA = 24 * 60 * 60 * 1000;
const AGORA = new Date(); // o certificado de teste vale a partir de agora; o termo precisa ser do dia de hoje
const depois = (ms: number) => new Date(AGORA.getTime() + ms);
const CHAVE = randomBytes(32);
const PLATAFORMA = { numero: "11444777000161", nome: "PLATAFORMA DE TESTE LTDA" };
const EMPRESA = "12345678000195"; // a do exemplo ti-fator-r
const CNPJ_EMPRESA = { numero: EMPRESA, tipo: 2 as const };
const TOKEN = "b06feea3-1ca8-49f4-bdb4-211ab006cb92";
const PERFIS = { ana: perfil("ana@a.com", "sub-ana"), beto: perfil("beto@b.com", "sub-beto"), admin: perfil("admin@plataforma.com", "sub-admin") };
const ADMINS = ["admin@plataforma.com"];
const entrar = async (quem: keyof typeof PERFIS) => (await entrarComGoogle(depsLogin(t.banco, PERFIS, { adminEmails: ADMINS }), quem)).usuario;

// Resposta do ENVIOXMLASSINADO81 como na documentação (dados já lidos pelo cliente do núcleo).
const tokenRecebido = (token: string, expira: string): Resposta => ({
  status: 200,
  dados: { autenticar_procurador_token: token, data_hora_expiracao: expira },
  mensagens: [{ codigo: "200", texto: "Sucesso na execução." }],
});
// Expira à meia-noite do dia seguinte (Brasília), como a documentação diz.
const meiaNoiteDeAmanha = (agora: Date) => `${new Date(agora.getTime() + DIA).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })}T23:59:59`;
const recusa = (codigo: string): Resposta => ({ status: 403, dados: undefined, mensagens: [{ codigo: `[AcessoNegado-AUTENTICAPROCURADOR-${codigo}]`, texto: "texto da API" }] });

function dependencias(cliente: DependenciasTermo["cliente"], agora = AGORA): DependenciasTermo {
  return { banco: t.banco, chave: CHAVE, cliente, contratante: PLATAFORMA, adminEmails: ADMINS, agora: () => agora };
}

// O que a tela faz no navegador: abre o .pfx com a senha, confere, monta o termo com os parâmetros do servidor e assina.
function assinarNoNavegador(certificado: Certificado, p: ParametrosTermo): string {
  const aberto = abrirCertificado(new Uint8Array(certificado.pfx), certificado.senha);
  const termo = montarTermo({
    destinatario: p.contratante,
    assinadoPor: { numero: aberto.titular.numero, nome: p.empresa.razaoSocial },
    dataAssinatura: p.dataAssinatura,
    vigencia: vigenciaPara(p.vigenciaMaxima, aberto),
  });
  return assinarTermo(termo, aberto);
}

const eCnpjDaEmpresa = (extra: Partial<OpcoesCertificadoIcp> = {}) => certificadoIcpDeTeste({ tipo: "PJ", numero: EMPRESA, nome: "EXEMPLO SOFTWARE LTDA", ...extra });

// Cliente 1: a empresa cadastrada pelo fluxo da Parte 3 (Ana é a dona).
async function cliente1() {
  const ana = (await entrarComGoogle(depsLogin(t.banco, PERFIS), "ana")).usuario;
  const beto = (await entrarComGoogle(depsLogin(t.banco, PERFIS), "beto")).usuario;
  const r = await consultarParaCadastro(t.banco, ana, "12.345.678/0001-95", { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-fator-r") });
  assert.equal(r.tipo, "previa");
  const empresaId = await cadastrarPelaPrevia(t.banco, ana, r.previa.token, { segredo: SEGREDO, agora: AGORA });
  const acesso = await exigirAcessoEmpresa(t.banco, ana, empresaId);
  return { ana, beto, empresaId, acesso };
}

// Uma sessão da Ana (para a remoção da empresa, que mexe na empresa ativa da sessão).
async function entrarSessao() {
  const d = depsLogin(t.banco, PERFIS);
  const sessao = await resolverSessao(d, (await entrarComGoogle(d, "ana")).cookie);
  assert.ok(sessao);
  return sessao;
}

const linhas = (acesso: AcessoEmpresa) => t.banco.select().from(termosAutorizacao).where(eq(termosAutorizacao.empresaId, acesso.empresaId));
const contextoCifra = (acesso: AcessoEmpresa, id: string, campo: string) => `termo-autorizacao:${acesso.empresaId}:${id}:${campo}`;

async function assinado(acesso: AcessoEmpresa, cliente: DependenciasTermo["cliente"], certificado = eCnpjDaEmpresa()) {
  const d = dependencias(cliente);
  await registrarTermo(d, acesso, assinarNoNavegador(certificado, await parametrosDoTermo(d, acesso)));
}

describe("passo 16: termo de autorização de ponta a ponta (cliente 1, envio falso)", () => {
  it("antes de assinar: modo guiado (nada liberado, sem aviso, sem contexto)", async () => {
    const { acesso } = await cliente1();
    const s = await situacaoTermo(dependencias(clienteFalso()), acesso);
    assert.deepEqual(s, { estado: "ausente" });
    assert.equal(liberada(s), false);
    assert.equal(avisoDaSituacao(s), null);
    await assert.rejects(contextoSerpro(dependencias(clienteFalso()), acesso), (e: Error) => e instanceof ErroTermoAutorizacao && e.motivo === "sem-termo");
  });

  it("monta, assina, confere, envia, guarda cifrado, usa o token sem chamar de novo e renova sozinho no dia seguinte", async () => {
    const { acesso } = await cliente1();
    const cliente = clienteFalso(tokenRecebido(TOKEN, meiaNoiteDeAmanha(AGORA)));
    const d = dependencias(cliente);

    // 1. Parâmetros do servidor (datas de Brasília, vigência de 1 ano) e assinatura no "navegador".
    const p = await parametrosDoTermo(d, acesso);
    assert.deepEqual(p.contratante, PLATAFORMA);
    assert.deepEqual(p.empresa, { cnpj: EMPRESA, razaoSocial: "EXEMPLO SOFTWARE LTDA" });
    assert.equal(+p.vigenciaMaxima.slice(0, 4), +p.dataAssinatura.slice(0, 4) + 1);
    const xml = assinarNoNavegador(eCnpjDaEmpresa(), p);
    assert.match(xml, /<destinatario nome="PLATAFORMA DE TESTE LTDA" numero="11444777000161" papel="contratante" tipo="PJ">/);
    assert.match(xml, /<assinadoPor nome="EXEMPLO SOFTWARE LTDA" numero="12345678000195" papel="autor pedido de dados" tipo="PJ">/);

    // 2. Conferência e envio: a empresa é contribuinte e autora do pedido.
    const r = await registrarTermo(d, acesso, xml);
    assert.equal(r.enviado, true);
    assert.equal(r.situacao.estado, "vigente");
    assert.equal(liberada(r.situacao), true);
    assert.equal(cliente.chamadas.length, 1);
    const [chamada] = cliente.chamadas;
    assert.equal(chamada.acao, "Apoiar");
    assert.equal(chamada.pedido.idSistema, "AUTENTICAPROCURADOR");
    assert.equal(chamada.pedido.idServico, "ENVIOXMLASSINADO81");
    assert.equal(Buffer.from((chamada.pedido.dados as { xml: string }).xml, "base64").toString("utf8"), xml);
    assert.deepEqual(chamada.opcoes, { contribuinte: CNPJ_EMPRESA, autorPedidoDados: CNPJ_EMPRESA });

    // 3. No banco: só cifrado (nem o token nem o termo em claro), com quem assinou, o contratante, as datas e o hash.
    const [linha] = await linhas(acesso);
    assert.equal(linha.contratante, PLATAFORMA.numero);
    assert.equal(linha.signatarioCnpj, EMPRESA);
    assert.equal(linha.signatarioNome, "EXEMPLO SOFTWARE LTDA");
    assert.equal(linha.enviadoEm.getTime(), AGORA.getTime());
    assert.equal(linha.enviadoPorId, acesso.usuarioId);
    assert.equal(linha.xmlHash.length, 64);
    const bruto = JSON.stringify(linha);
    assert.doesNotMatch(bruto, new RegExp(TOKEN));
    assert.doesNotMatch(bruto, /termoDeAutorizacao|X509Certificate|BEGIN/);
    assert.equal(decifrar(linha.tokenCifrado!, CHAVE, contextoCifra(acesso, linha.id, "token")), TOKEN);
    assert.equal(decifrar(linha.termoCifrado, CHAVE, contextoCifra(acesso, linha.id, "termo")), xml);

    // 4. Banco primeiro: com o token válido, o contexto sai do banco e nada é chamado.
    const ctx = await contextoSerpro(dependencias(cliente, depois(60_000)), acesso);
    assert.deepEqual(ctx, { contribuinte: CNPJ_EMPRESA, autorPedidoDados: CNPJ_EMPRESA, tokenProcurador: TOKEN });
    assert.equal(cliente.chamadas.length, 1);

    // 5. Dois dias depois o token expirou: o termo guardado é reenviado (sem o cliente assinar de novo).
    const renovado = clienteFalso(tokenRecebido("token-novo", meiaNoiteDeAmanha(depois(2 * DIA))));
    assert.equal((await contextoSerpro(dependencias(renovado, depois(2 * DIA)), acesso)).tokenProcurador, "token-novo");
    assert.equal(renovado.chamadas.length, 1);
    assert.equal(Buffer.from((renovado.chamadas[0].pedido.dados as { xml: string }).xml, "base64").toString("utf8"), xml);
    assert.match(renovado.chamadas[0].finalidade, /Renovar o token/);
    const [depoisDaRenovacao] = await linhas(acesso);
    assert.equal(depoisDaRenovacao.id, linha.id);
    assert.doesNotMatch(JSON.stringify(depoisDaRenovacao), /token-novo/);
    assert.equal((await contextoSerpro(dependencias(renovado, depois(2 * DIA + 60_000)), acesso)).tokenProcurador, "token-novo");
    assert.equal(renovado.chamadas.length, 1);
  });

  it("aviso de vencimento: nada até faltar 30 dias, atenção com 30 ou menos, vermelho e sem envio depois de vencer", async () => {
    const { acesso } = await cliente1();
    // Certificado vale 90 dias: a vigência do termo fica limitada a ele.
    await assinado(acesso, clienteFalso(tokenRecebido(TOKEN, meiaNoiteDeAmanha(AGORA))), eCnpjDaEmpresa({ validoAte: depois(90 * DIA) }));
    const em = (dias: number) => situacaoTermo(dependencias(null, depois(dias * DIA)), acesso);
    const s59 = await em(59);
    assert.equal(s59.estado, "vigente");
    assert.equal(avisoDaSituacao(s59), null);
    const s61 = await em(61);
    assert.equal(s61.estado, "vencendo");
    assert.ok(s61.estado === "vencendo" && s61.motivo === "certificado");
    assert.equal(liberada(s61), true);
    assert.equal(avisoDaSituacao(s61)?.nivel, "vence");
    assert.match(avisoDaSituacao(s61)!.texto, /certificado usado na autorização/);
    const s91 = await em(91);
    assert.equal(s91.estado, "vencida");
    assert.equal(liberada(s91), false);
    assert.equal(avisoDaSituacao(s91)?.nivel, "vencida");
    const nada = clienteFalso();
    await assert.rejects(contextoSerpro(dependencias(nada, depois(91 * DIA)), acesso), (e: Error) => e instanceof ErroTermoAutorizacao && e.motivo === "termo-vencido");
    assert.equal(nada.chamadas.length, 0);
  });

  it("o mesmo termo de novo com o token válido não é reenviado; com o token expirado, renova a mesma linha; um termo novo substitui", async () => {
    const { acesso } = await cliente1();
    const cliente = clienteFalso(
      tokenRecebido(TOKEN, meiaNoiteDeAmanha(AGORA)),
      tokenRecebido("token-2", meiaNoiteDeAmanha(AGORA)),
    );
    const d = dependencias(cliente);
    const p = await parametrosDoTermo(d, acesso);
    const xml = assinarNoNavegador(eCnpjDaEmpresa(), p);
    await registrarTermo(d, acesso, xml);
    const repetido = await registrarTermo(d, acesso, xml);
    assert.equal(repetido.enviado, false);
    assert.equal(cliente.chamadas.length, 1);

    const novo = await registrarTermo(d, acesso, assinarNoNavegador(eCnpjDaEmpresa(), p));
    assert.equal(novo.enviado, true);
    assert.equal(cliente.chamadas.length, 2);
    const todas = await linhas(acesso);
    assert.equal(todas.length, 2);
    assert.equal(todas.filter((l) => l.substituidoEm === null).length, 1);
    assert.equal((await contextoSerpro(d, acesso)).tokenProcurador, "token-2");
  });

  it("duplo clique: dois envios do mesmo termo ao mesmo tempo chamam uma vez só (a empresa fica travada)", async () => {
    const { acesso } = await cliente1();
    const cliente = clienteFalso(tokenRecebido(TOKEN, meiaNoiteDeAmanha(AGORA)), tokenRecebido("nao-devia", meiaNoiteDeAmanha(AGORA)));
    const d = dependencias(cliente);
    const xml = assinarNoNavegador(eCnpjDaEmpresa(), await parametrosDoTermo(d, acesso));
    const [a, b] = await Promise.all([registrarTermo(d, acesso, xml), registrarTermo(d, acesso, xml)]);
    assert.deepEqual([a.enviado, b.enviado].sort(), [false, true]);
    assert.equal(cliente.chamadas.length, 1);
    assert.equal((await linhas(acesso)).length, 1);
  });

  it("duas requisições com o token expirado pedem um token só (a linha fica travada durante a renovação)", async () => {
    const { acesso } = await cliente1();
    await assinado(acesso, clienteFalso(tokenRecebido(TOKEN, meiaNoiteDeAmanha(AGORA))));
    const renovar = clienteFalso(tokenRecebido("token-unico", meiaNoiteDeAmanha(depois(2 * DIA))));
    const [x, y] = await Promise.all([contextoSerpro(dependencias(renovar, depois(2 * DIA)), acesso), contextoSerpro(dependencias(renovar, depois(2 * DIA)), acesso)]);
    assert.equal(x.tokenProcurador, "token-unico");
    assert.equal(y.tokenProcurador, "token-unico");
    assert.equal(renovar.chamadas.length, 1);
  });

  it("remoção da empresa no meio: o envio do termo e a renovação que esperaram a trava param sem chamar nada nem quebrar", async () => {
    const { ana, acesso } = await cliente1();
    const sessao = await entrarSessao();
    assert.equal(sessao.usuario.id, ana.id);
    await assinado(acesso, clienteFalso(tokenRecebido(TOKEN, meiaNoiteDeAmanha(AGORA))));
    const enviar = clienteFalso(tokenRecebido("nao-devia", meiaNoiteDeAmanha(AGORA)));
    const renovar = clienteFalso(tokenRecebido("nao-devia", meiaNoiteDeAmanha(depois(2 * DIA))));
    const xml = assinarNoNavegador(eCnpjDaEmpresa(), await parametrosDoTermo(dependencias(enviar), acesso));
    const capturar = (p: Promise<unknown>) => p.then((v) => ({ ok: v }), (e: unknown) => ({ erro: e }));

    // A remoção trava a empresa primeiro (a mesma trava de removerEmpresa); os dois chegam enquanto ela está aberta.
    let pendentes: Promise<{ ok?: unknown; erro?: unknown }>[] = [];
    await t.banco.transaction(async (tx) => {
      await tx.select({ id: empresas.id }).from(empresas).where(eq(empresas.id, acesso.empresaId)).for("no key update");
      pendentes = [capturar(registrarTermo(dependencias(enviar), acesso, xml)), capturar(contextoSerpro(dependencias(renovar, depois(2 * DIA)), acesso))];
      await new Promise((r) => setTimeout(r, 300));
      await tx.delete(termosAutorizacao).where(eq(termosAutorizacao.empresaId, acesso.empresaId));
      await tx.delete(empresaUsuarios).where(eq(empresaUsuarios.empresaId, acesso.empresaId));
      await tx.delete(empresas).where(eq(empresas.id, acesso.empresaId));
    });
    for (const r of await Promise.all(pendentes)) assert.ok(r.erro instanceof SemAcessoEmpresa, `veio: ${String((r.erro as Error)?.message ?? "ok")}`);
    assert.equal(enviar.chamadas.length, 0);
    assert.equal(renovar.chamadas.length, 0);
    assert.equal((await t.banco.select().from(termosAutorizacao)).length, 0);
  });

  it("removerEmpresa com envio do termo ao mesmo tempo: um dos dois termina inteiro, nada quebra nem sobra", async () => {
    const { acesso } = await cliente1();
    const sessao = await entrarSessao();
    const cliente = clienteFalso(tokenRecebido(TOKEN, meiaNoiteDeAmanha(AGORA)));
    const xml = assinarNoNavegador(eCnpjDaEmpresa(), await parametrosDoTermo(dependencias(cliente), acesso));
    const [envio, remocao] = await Promise.allSettled([
      registrarTermo(dependencias(cliente), acesso, xml),
      removerEmpresa(t.banco, sessao, acesso.empresaId, EMPRESA, { log: () => {} }),
    ]);
    assert.equal(remocao.status, "fulfilled");
    if (envio.status === "rejected") assert.ok(envio.reason instanceof SemAcessoEmpresa, String(envio.reason));
    assert.equal((await t.banco.select().from(termosAutorizacao)).length, 0);
    assert.equal((await t.banco.select().from(empresas)).length, 0);
  });

  it("sem margem: até a meia-noite o token guardado é usado (reenviar só traria 304 e gastaria a cota)", async () => {
    const { acesso } = await cliente1();
    await assinado(acesso, clienteFalso(tokenRecebido(TOKEN, meiaNoiteDeAmanha(AGORA))));
    const [{ tokenExpiraEm }] = await linhas(acesso);
    const expira = tokenExpiraEm!;
    const mesmo = clienteFalso(tokenRecebido(TOKEN, meiaNoiteDeAmanha(AGORA)));
    for (const instante of [new Date(expira.getTime() - 4 * 60_000), new Date(expira.getTime() - 1000)]) {
      assert.equal((await contextoSerpro(dependencias(mesmo, instante), acesso)).tokenProcurador, TOKEN);
    }
    assert.equal(mesmo.chamadas.length, 0);
    const depoisDaMeiaNoite = new Date(expira.getTime() + 1000);
    const novo = clienteFalso(tokenRecebido("token-do-dia", meiaNoiteDeAmanha(depoisDaMeiaNoite)));
    for (const instante of [depoisDaMeiaNoite, new Date(depoisDaMeiaNoite.getTime() + 60_000)]) {
      assert.equal((await contextoSerpro(dependencias(novo, instante), acesso)).tokenProcurador, "token-do-dia");
    }
    assert.equal(novo.chamadas.length, 1);
  });

  it("renovação recusada de vez (certificado revogado): o termo fica recusado, o automático desliga e o sino avisa", async () => {
    const { acesso } = await cliente1();
    await assinado(acesso, clienteFalso(tokenRecebido(TOKEN, meiaNoiteDeAmanha(AGORA))));
    const revogado = clienteFalso(recusa("037"));
    await assert.rejects(contextoSerpro(dependencias(revogado, depois(2 * DIA)), acesso), (e: Error) => e instanceof ErroAutenticaProcurador && e.motivo === "certificado-revogado");
    const [linha] = await linhas(acesso);
    assert.ok(linha.recusadoEm);
    assert.equal(linha.recusaMotivo, "certificado-revogado");
    assert.equal(linha.tokenCifrado, null);
    const s = await situacaoTermo(dependencias(null, depois(2 * DIA)), acesso);
    assert.equal(s.estado, "recusada");
    assert.equal(liberada(s), false);
    assert.equal(avisoDaSituacao(s)?.nivel, "vencida");
    assert.match(avisoDaSituacao(s)!.texto, /revogado.*assine de novo/);
    // Daí em diante, nada é chamado até assinar de novo.
    const nada = clienteFalso();
    await assert.rejects(contextoSerpro(dependencias(nada, depois(2 * DIA)), acesso), (e: Error) => e instanceof ErroTermoAutorizacao && e.motivo === "termo-recusado");
    assert.equal(nada.chamadas.length, 0);
    // Um termo novo (o mesmo dia do teste, com outro certificado) religa.
    await assinado(acesso, clienteFalso(tokenRecebido("novo", meiaNoiteDeAmanha(AGORA))));
    assert.equal((await situacaoTermo(dependencias(null), acesso)).estado, "vigente");
  });

  it("renovação com falha passageira (fora do ar) não marca nada: tenta de novo depois", async () => {
    const { acesso } = await cliente1();
    await assinado(acesso, clienteFalso(tokenRecebido(TOKEN, meiaNoiteDeAmanha(AGORA))));
    const foraDoAr = clienteFalso({ status: 503, dados: undefined, mensagens: [] }, new Error("ECONNRESET"));
    for (let i = 0; i < 2; i++) {
      await assert.rejects(contextoSerpro(dependencias(foraDoAr, depois(2 * DIA)), acesso), (e: Error) => e instanceof ErroAutenticaProcurador && e.motivo === "indisponivel");
    }
    const [linha] = await linhas(acesso);
    assert.equal(linha.recusadoEm, null);
    assert.equal((await situacaoTermo(dependencias(null, depois(2 * DIA)), acesso)).estado, "vigente");
  });

  it("recusas no envio não gravam nada: membro, configuração incompleta, e-CNPJ de outra empresa, A3 e recusa da Receita", async () => {
    const { acesso, beto, empresaId } = await cliente1();
    const p = await parametrosDoTermo(dependencias(clienteFalso()), acesso);
    const xml = assinarNoNavegador(eCnpjDaEmpresa(), p);

    await t.banco.insert(empresaUsuarios).values({ empresaId, usuarioId: beto.id, papel: "MEMBRO" });
    const membro = await exigirAcessoEmpresa(t.banco, beto, empresaId);
    await assert.rejects(registrarTermo(dependencias(clienteFalso()), membro, xml), (e: Error) => e instanceof ErroTermoAutorizacao && e.motivo === "so-dono");
    for (const [falta, motivo] of [
      [{ contratante: null }, "sem-plataforma"],
      [{ contratante: { ...PLATAFORMA, nome: "" } }, "sem-plataforma"],
      [{ chave: null }, "sem-chave"],
      [{ cliente: null }, "sem-contrato"],
    ] as const) {
      await assert.rejects(registrarTermo({ ...dependencias(clienteFalso()), ...falta }, acesso, xml), (e: Error) => e instanceof ErroTermoAutorizacao && e.motivo === motivo);
      await assert.rejects(parametrosDoTermo({ ...dependencias(clienteFalso()), ...falta }, acesso), (e: Error) => e instanceof ErroTermoAutorizacao && e.motivo === motivo);
    }

    const outra = assinarNoNavegador(certificadoIcpDeTeste({ tipo: "PJ", numero: "11222333000181", nome: "OUTRA LTDA" }), p);
    await assert.rejects(registrarTermo(dependencias(clienteFalso()), acesso, outra), (e: Error) => e instanceof ErroTermo && /outro CNPJ/.test(e.message));
    const a3 = assinarNoNavegador(eCnpjDaEmpresa({ politica: "A3" }), p);
    await assert.rejects(registrarTermo(dependencias(clienteFalso()), acesso, a3), (e: Error) => e instanceof ErroTermo && /A3/.test(e.message));
    await assert.rejects(registrarTermo(dependencias(clienteFalso()), acesso, xml.replace("PLATAFORMA DE TESTE", "PLATAFORMA DE OUTRO")), ErroTermo);

    await assert.rejects(registrarTermo(dependencias(clienteFalso(recusa("040"))), acesso, xml), (e: Error) => e instanceof ErroAutenticaProcurador && e.motivo === "certificado");
    assert.equal((await linhas(acesso)).length, 0);
    assert.equal((await situacaoTermo(dependencias(null), acesso)).estado, "ausente");
  });

  it("CNPJ alfanumérico: o termo só aceita números, então a tela avisa e nada é montado", async () => {
    const ana = (await entrarComGoogle(depsLogin(t.banco, PERFIS), "ana")).usuario;
    const empresa = await criarEmpresa(t.banco, ana, { cnpj: "12ABC34501DE35", razaoSocial: "ALFA LTDA" });
    const acesso = await exigirAcessoEmpresa(t.banco, ana, empresa.id);
    await assert.rejects(parametrosDoTermo(dependencias(clienteFalso()), acesso), (e: Error) => e instanceof ErroTermoAutorizacao && e.motivo === "cnpj-alfanumerico");
  });

  it("empresa da própria plataforma (CNPJ = PLATAFORMA_CNPJ e dono ADMIN): automático ligado sem termo, sem token e nada é chamado", async () => {
    const admin = await entrar("admin");
    const empresa = await criarEmpresa(t.banco, admin, { cnpj: PLATAFORMA.numero, razaoSocial: PLATAFORMA.nome });
    const acesso = await exigirAcessoEmpresa(t.banco, admin, empresa.id);
    const nada = clienteFalso();
    const s = await situacaoTermo(dependencias(nada), acesso);
    assert.deepEqual(s, { estado: "propria" });
    assert.equal(liberada(s), true);
    assert.equal(avisoDaSituacao(s), null);
    // O contratante é o autor dos pedidos (padrão do cliente): sem autorPedidoDados e sem token.
    assert.deepEqual(await contextoSerpro(dependencias(nada), acesso), { contribuinte: { numero: PLATAFORMA.numero, tipo: 2 } });
    await assert.rejects(parametrosDoTermo(dependencias(nada), acesso), (e: Error) => e instanceof ErroTermoAutorizacao && e.motivo === "propria");
    assert.equal(nada.chamadas.length, 0);
    // Mesmo sem a razão social configurada, o CNPJ basta para reconhecer a própria empresa.
    assert.deepEqual(await situacaoTermo({ ...dependencias(nada), contratante: { numero: PLATAFORMA.numero, nome: "" } }, acesso), { estado: "propria" });
    // Um membro que o administrador pôs na empresa da plataforma também a vê como a da plataforma (o dono é ADMIN).
    const beto = await entrar("beto");
    await t.banco.insert(empresaUsuarios).values({ empresaId: empresa.id, usuarioId: beto.id, papel: "MEMBRO" });
    assert.deepEqual(await situacaoTermo(dependencias(nada), await exigirAcessoEmpresa(t.banco, beto, empresa.id)), { estado: "propria" });
  });

  it("CNPJ da plataforma sem dono ADMIN (cadastro antigo, ou o administrador saiu de ADMIN_EMAILS): modo guiado, sem automático, sem termo e nada é chamado", async () => {
    const ana = await entrar("ana");
    // criarEmpresa direto: simula um cadastro feito antes da regra de reserva (o assistente já recusa, veja abaixo).
    const empresa = await criarEmpresa(t.banco, ana, { cnpj: PLATAFORMA.numero, razaoSocial: PLATAFORMA.nome });
    const acesso = await exigirAcessoEmpresa(t.banco, ana, empresa.id);
    const nada = clienteFalso();
    const reservada = (e: Error) => e instanceof ErroTermoAutorizacao && e.motivo === "plataforma-reservada" && !/serpro|integra/i.test(e.message);
    const s = await situacaoTermo(dependencias(nada), acesso);
    assert.deepEqual(s, { estado: "ausente" });
    assert.equal(liberada(s), false);
    await assert.rejects(contextoSerpro(dependencias(nada), acesso), reservada);
    await assert.rejects(parametrosDoTermo(dependencias(nada), acesso), reservada);
    // Nem com um termo assinado pelo próprio CNPJ: o contratante não assina termo para si mesmo.
    await assert.rejects(registrarTermo(dependencias(nada), acesso, "<termoDeAutorizacao/>"), reservada);
    assert.equal(nada.chamadas.length, 0);
    assert.equal((await linhas(acesso)).length, 0);

    // ADMIN_EMAILS vazia ou o dono que saiu da lista: ninguém é a plataforma.
    const admin = await entrar("admin");
    await t.banco.update(empresaUsuarios).set({ usuarioId: admin.id }).where(eq(empresaUsuarios.empresaId, empresa.id));
    const doAdmin = await exigirAcessoEmpresa(t.banco, admin, empresa.id);
    assert.deepEqual(await situacaoTermo(dependencias(nada), doAdmin), { estado: "propria" });
    assert.deepEqual(await situacaoTermo({ ...dependencias(nada), adminEmails: [] }, doAdmin), { estado: "ausente" });
    await assert.rejects(contextoSerpro({ ...dependencias(nada), adminEmails: ["outro@plataforma.com"] }, doAdmin), reservada);
    // Conta do administrador desativada: também não vale.
    await t.banco.update(usuarios).set({ ativo: false }).where(eq(usuarios.id, admin.id));
    assert.deepEqual(await situacaoTermo(dependencias(nada), doAdmin), { estado: "ausente" });
    assert.equal(nada.chamadas.length, 0);
  });

  it("cadastro: só um ADMIN cadastra o CNPJ da plataforma; os outros recebem uma mensagem sem consultar nada", async () => {
    const ana = await entrar("ana");
    const daPlataforma = { status: 200, corpo: { ...respostaGravada("ti-fator-r"), cnpj: PLATAFORMA.numero } };
    // Na ordem: a empresa da Ana, a prévia sem reserva e a do administrador. A recusa não consulta nada.
    const buscar = buscarFalso({ status: 200, corpo: respostaGravada("ti-fator-r") }, daPlataforma, daPlataforma);
    const opcoes = { segredo: SEGREDO, agora: AGORA, buscar, cnpjReservado: PLATAFORMA.numero };
    await assert.rejects(consultarParaCadastro(t.banco, ana, "11.444.777/0001-61", opcoes), (e: Error) => e instanceof ErroDeEmpresa && e.message === CNPJ_RESERVADO);
    assert.equal(buscar.chamadas.length, 0);
    // A prévia de outro CNPJ continua normal; uma prévia do CNPJ reservado (feita antes da regra) também é recusada.
    const outra = await consultarParaCadastro(t.banco, ana, "12.345.678/0001-95", opcoes);
    assert.equal(outra.tipo, "previa");
    const semReserva = await consultarParaCadastro(t.banco, ana, "11.444.777/0001-61", { ...opcoes, cnpjReservado: null });
    assert.equal(semReserva.tipo, "previa");
    await assert.rejects(cadastrarPelaPrevia(t.banco, ana, semReserva.previa.token, opcoes), (e: Error) => e.message === CNPJ_RESERVADO);

    const admin = await entrar("admin");
    const r = await consultarParaCadastro(t.banco, admin, "11.444.777/0001-61", opcoes);
    assert.equal(r.tipo, "previa");
    const empresaId = await cadastrarPelaPrevia(t.banco, admin, r.previa.token, opcoes);
    const acesso = await exigirAcessoEmpresa(t.banco, admin, empresaId);
    assert.deepEqual(await situacaoTermo(dependencias(clienteFalso()), acesso), { estado: "propria" });
  });

  it("PLATAFORMA_CNPJ trocado: o termo feito para o contratante antigo não vale mais", async () => {
    const { acesso } = await cliente1();
    await assinado(acesso, clienteFalso(tokenRecebido(TOKEN, meiaNoiteDeAmanha(AGORA))));
    const outroContratante = { ...dependencias(clienteFalso()), contratante: { numero: "11222333000181", nome: "NOVA PLATAFORMA" } };
    assert.equal((await situacaoTermo(outroContratante, acesso)).estado, "ausente");
    await assert.rejects(contextoSerpro(outroContratante, acesso), (e: Error) => e instanceof ErroTermoAutorizacao && e.motivo === "sem-termo");
  });

  it("isolamento: termo e token de uma empresa não servem para outra, nem copiados no banco; chave trocada pede para assinar de novo", async () => {
    const { acesso, beto } = await cliente1();
    const cliente = clienteFalso(tokenRecebido(TOKEN, meiaNoiteDeAmanha(AGORA)), tokenRecebido("token-b", meiaNoiteDeAmanha(AGORA)));
    await assinado(acesso, cliente);

    const empresaB = await criarEmpresa(t.banco, beto, { cnpj: "11.222.333/0001-81", razaoSocial: "EMPRESA B LTDA" });
    const acessoB = await exigirAcessoEmpresa(t.banco, beto, empresaB.id);
    await assert.rejects(exigirAcessoEmpresa(t.banco, beto, acesso.empresaId), SemAcessoEmpresa);
    assert.equal((await situacaoTermo(dependencias(cliente), acessoB)).estado, "ausente");
    await assinado(acessoB, cliente, certificadoIcpDeTeste({ tipo: "PJ", numero: "11222333000181", nome: "EMPRESA B LTDA" }));

    // Alguém com acesso ao banco copia o token cifrado da empresa A para a B: não abre (cifra presa à empresa e ao registro).
    const [a] = await linhas(acesso);
    await t.banco.update(termosAutorizacao).set({ tokenCifrado: a.tokenCifrado }).where(eq(termosAutorizacao.empresaId, acessoB.empresaId));
    await assert.rejects(contextoSerpro(dependencias(cliente, depois(60_000)), acessoB), (e: Error) => e instanceof ErroTermoAutorizacao && e.motivo === "chave-trocada");
    // A TOKEN_CHAVE trocada também não abre: mensagem própria, pedindo para assinar de novo.
    await assert.rejects(contextoSerpro({ ...dependencias(cliente, depois(60_000)), chave: randomBytes(32) }, acesso), (e: Error) => e instanceof ErroTermoAutorizacao && /Assine de novo para renovar a autorização/.test(e.message));
  });
});

describe("razão social da plataforma (destinatário do termo): do ambiente ou da empresa cadastrada, nunca fixa", () => {
  it("PLATAFORMA_RAZAO_SOCIAL primeiro; senão a empresa com o PLATAFORMA_CNPJ de dono ADMIN; senão nada", async () => {
    assert.equal(await nomeDaPlataforma(t.banco, PLATAFORMA.numero, ADMINS, { PLATAFORMA_RAZAO_SOCIAL: "  Plataforma   do Ambiente Ltda " }), "PLATAFORMA DO AMBIENTE LTDA");
    assert.equal(await nomeDaPlataforma(t.banco, PLATAFORMA.numero, ADMINS, {}), null);
    const admin = await entrar("admin");
    await criarEmpresa(t.banco, admin, { cnpj: PLATAFORMA.numero, razaoSocial: "Plataforma Cadastrada Ltda" });
    assert.equal(await nomeDaPlataforma(t.banco, PLATAFORMA.numero, ADMINS, {}), "PLATAFORMA CADASTRADA LTDA");
    assert.equal(await nomeDaPlataforma(t.banco, PLATAFORMA.numero, [], {}), null);
  });

  it("um cadastro qualquer com o PLATAFORMA_CNPJ não escolhe o nome do destinatário do termo", async () => {
    const ana = await entrar("ana");
    await criarEmpresa(t.banco, ana, { cnpj: PLATAFORMA.numero, razaoSocial: "Nome Escolhido Pelo Intruso Ltda" });
    assert.equal(await nomeDaPlataforma(t.banco, PLATAFORMA.numero, ADMINS, {}), null);
  });
});

describe("cliente real do núcleo (transporte falso): registro no banco, 304 e o token nas chamadas seguintes", () => {
  it("o token vai no header autenticar_procurador_token e o registro das chamadas não guarda token nem XML", async () => {
    const { acesso } = await cliente1();
    const enviados: { url: string; headers: Record<string, string>; corpo: string }[] = [];
    const respostas = [
      { status: 200, texto: JSON.stringify({ access_token: "acesso", jwt_token: "jwt", expires_in: 3600 }) },
      // Termo repetido em cache: 304 sem corpo, token no etag (documentação: "Cache do Termo de Autorização").
      { status: 304, texto: "", cabecalhos: { "cache-control": "termo_autorizacao", etag: `"autenticar_procurador_token:${TOKEN}"`, expires: depois(DIA).toUTCString() } },
      { status: 200, texto: JSON.stringify({ status: 200, dados: JSON.stringify({ ok: true }), mensagens: [] }) },
    ];
    const transporte: Transporte = async (url, headers, corpo) => {
      enviados.push({ url, headers, corpo });
      const r = respostas.shift();
      if (!r) throw new Error("sem resposta gravada");
      return r;
    };
    const cliente = criarClienteSerpro({
      consumerKey: "chave",
      consumerSecret: "segredo",
      certificado: { pfx: Buffer.from("pfx"), senha: "x" },
      contratante: PLATAFORMA.numero,
      limitePorPeriodo: 40,
      registro: registroNoBanco(t.banco),
      transporte,
      agora: () => AGORA,
    });
    const d = dependencias(cliente);
    const r = await registrarTermo(d, acesso, assinarNoNavegador(eCnpjDaEmpresa(), await parametrosDoTermo(d, acesso)));
    assert.equal(r.enviado, true);
    assert.ok(enviados[1].url.endsWith("/Apoiar"));
    const corpo = JSON.parse(enviados[1].corpo);
    assert.deepEqual(corpo.contratante, { numero: PLATAFORMA.numero, tipo: 2 });
    assert.deepEqual(corpo.autorPedidoDados, CNPJ_EMPRESA);
    assert.deepEqual(corpo.contribuinte, CNPJ_EMPRESA);
    assert.ok(JSON.parse(corpo.pedidoDados.dados).xml.length > 1000);
    assert.equal(enviados[1].headers.autenticar_procurador_token, undefined);

    // A próxima parte usa o contexto: o token vai no header e a empresa é a autora do pedido.
    const ctx = await contextoSerpro(d, acesso);
    await cliente.chamar("Consultar", { idSistema: "PGDASD", idServico: "CONSEXTRATO16", versaoSistema: "1.0", dados: {} }, "Teste do token de procurador", ctx);
    assert.equal(enviados[2].headers.autenticar_procurador_token, TOKEN);
    assert.deepEqual(JSON.parse(enviados[2].corpo).autorPedidoDados, CNPJ_EMPRESA);

    const registradas = await t.banco.select().from(serproChamadas);
    assert.deepEqual(
      registradas.map((c) => [c.acao, c.servico, c.status]),
      [
        ["Autenticar", "SAPI", 200],
        ["Apoiar", "AUTENTICAPROCURADOR/ENVIOXMLASSINADO81", 304],
        ["Consultar", "PGDASD/CONSEXTRATO16", 200],
      ],
    );
    assert.doesNotMatch(JSON.stringify(registradas), new RegExp(`${TOKEN}|termoDeAutorizacao`));
  });
});

// Assistente de cadastro (Parte 3) com a autorização no passo 7: o cadastro no passo 5 e, logo depois, o mesmo preparo e
// o mesmo envio da página Autorização, com o envio falso e o e-CNPJ de teste gerado na hora. O estado do assistente
// segue os mesmos eventos que a tela despacha.
describe("assistente: cadastro no passo 5 e autorização no passo 7 (envio falso, certificado de teste)", () => {
  const passos = (...eventos: EventoAssistente[]) => eventos.reduce(reduzir, ESTADO_INICIAL);

  it("cadastra, prepara o passo 7, assina com o e-CNPJ A1 e envia: autorização concluída; voltar não recadastra", async () => {
    const ana = await entrar("ana");
    const opcoes = { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-fator-r"), cnpjReservado: PLATAFORMA.numero };
    const r = await consultarParaCadastro(t.banco, ana, "12.345.678/0001-95", opcoes);
    assert.equal(r.tipo, "previa");
    const continuar = { tipo: "continuar", agora: AGORA.getTime() } as const;
    let e = passos({ tipo: "digitar", cnpj: "12.345.678/0001-95" }, { tipo: "consultou", previa: r.previa, agora: AGORA.getTime() }, continuar, continuar, continuar);
    assert.equal(e.etapa, "diagnostico");

    // Passo 5: cadastra (Ana é a dona). Logo depois, o preparo do passo 7 (só banco: nada é chamado).
    const empresaId = await cadastrarPelaPrevia(t.banco, ana, r.previa.token, opcoes);
    const acesso = await exigirAcessoEmpresa(t.banco, ana, empresaId);
    const cliente = clienteFalso(tokenRecebido(TOKEN, meiaNoiteDeAmanha(AGORA)));
    const d = dependencias(cliente);
    const preparo = await prepararAutorizacao(d, acesso);
    assert.deepEqual(preparo.situacao, { estado: "ausente" });
    assert.equal(preparo.bloqueio, null);
    assert.deepEqual(preparo.parametros, await parametrosDoTermo(d, acesso));
    const autorizacao = autorizacaoDoPreparo(preparo);
    assert.equal(autorizacao.tipo, "assinar");
    assert.equal(cliente.chamadas.length, 0);
    e = [{ tipo: "cadastrou", empresaId } as const, { tipo: "preparou", autorizacao } as const, continuar].reduce(reduzir, e);
    assert.deepEqual([e.etapa, vistaDaAutorizacao(e)], ["autorizacao", "assinar"]);

    // Voltar ao início (só leitura) e seguir de novo não cadastra outra empresa nem consulta de novo.
    for (let i = 0; i < 6; i++) e = reduzir(e, { tipo: "voltar" });
    assert.equal(e.etapa, "cnpj");
    for (let i = 0; i < 6; i++) e = reduzir(e, continuar);
    assert.equal(e.etapa, "autorizacao");
    assert.equal((await t.banco.select().from(empresas)).length, 1);
    // Mesmo que o mesmo CNPJ fosse pesquisado de novo, a empresa já existe: o servidor só a abre, sem duplicar.
    assert.deepEqual(await consultarParaCadastro(t.banco, ana, "12.345.678/0001-95", opcoes), { tipo: "ja-cadastrada", empresaId });

    // Passo 7: assina no "navegador" com os parâmetros do preparo e envia, como a página Autorização.
    assert.ok(autorizacao.tipo === "assinar");
    const enviado = await registrarTermo(d, acesso, assinarNoNavegador(eCnpjDaEmpresa(), autorizacao.parametros));
    assert.equal(enviado.situacao.estado, "vigente");
    assert.equal(cliente.chamadas.length, 1);
    assert.ok(enviado.situacao.estado === "vigente");
    e = reduzir(e, { tipo: "autorizou", validaAte: enviado.situacao.validaAte });
    assert.equal(vistaDaAutorizacao(e), "concluida");
    // A página Autorização passa a mostrar a autorização ativa (e ainda permite assinar de novo).
    assert.equal((await prepararAutorizacao(d, acesso)).situacao.estado, "vigente");
    assert.equal((await linhas(acesso)).length, 1);
  });

  it("Fazer depois: a empresa fica cadastrada, sem termo, no modo guiado; a página Autorização continua oferecendo assinar", async () => {
    const { acesso } = await cliente1();
    const cliente = clienteFalso();
    const preparo = await prepararAutorizacao(dependencias(cliente), acesso);
    assert.deepEqual(preparo.situacao, { estado: "ausente" });
    assert.ok(preparo.parametros);
    assert.equal(liberada(preparo.situacao), false);
    assert.equal((await linhas(acesso)).length, 0);
    assert.equal(cliente.chamadas.length, 0);
  });

  it("empresa da própria plataforma (cadastrada por um ADMIN): o passo 7 mostra que já está autorizada, sem nada a assinar", async () => {
    const admin = await entrar("admin");
    const daPlataforma = { status: 200, corpo: { ...respostaGravada("ti-fator-r"), cnpj: PLATAFORMA.numero } };
    const opcoes = { segredo: SEGREDO, agora: AGORA, buscar: buscarFalso(daPlataforma), cnpjReservado: PLATAFORMA.numero };
    const r = await consultarParaCadastro(t.banco, admin, "11.444.777/0001-61", opcoes);
    assert.equal(r.tipo, "previa");
    const acesso = await exigirAcessoEmpresa(t.banco, admin, await cadastrarPelaPrevia(t.banco, admin, r.previa.token, opcoes));
    const nada = clienteFalso();
    const preparo = await prepararAutorizacao(dependencias(nada), acesso);
    assert.deepEqual(preparo, { situacao: { estado: "propria" }, parametros: null, bloqueio: null });
    assert.deepEqual(autorizacaoDoPreparo(preparo), { tipo: "propria" });
    assert.equal(nada.chamadas.length, 0);
  });

  it("sem a assinatura disponível na instalação, ou para quem não é o dono: mensagem própria, sem detalhe técnico", async () => {
    const { acesso, beto, empresaId } = await cliente1();
    const semContrato = autorizacaoDoPreparo(await prepararAutorizacao(dependencias(null), acesso));
    assert.equal(semContrato.tipo, "indisponivel");
    assert.ok(semContrato.tipo === "indisponivel" && /ainda não está disponível/.test(semContrato.mensagem) && !/serpro|integra|SERPRO_|TOKEN_CHAVE/i.test(semContrato.mensagem));
    await t.banco.insert(empresaUsuarios).values({ empresaId, usuarioId: beto.id, papel: "MEMBRO" });
    const membro = await prepararAutorizacao(dependencias(clienteFalso()), await exigirAcessoEmpresa(t.banco, beto, empresaId));
    assert.equal(membro.parametros, null);
    assert.equal(membro.bloqueio, "Só o dono da empresa na plataforma pode assinar o termo de autorização.");
  });
});
