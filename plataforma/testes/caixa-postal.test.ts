// Parte 8, passo 22a: Caixa Postal de ponta a ponta, contra o banco de teste, com a empresa cadastrada pela Parte 3. Nada
// sai da máquina: o cliente do contrato é o falso do núcleo, com respostas gravadas no formato dos exemplos oficiais (lista
// e conteúdo), ou o cliente real com um transporte falso (registro e custo).
// Regra legal conferida aqui: listar NUNCA chama o serviço que registra a ciência; o conteúdo só sai com o pedido do
// cliente e, para mensagem não lida, com a confirmação; aberto, fica guardado e não é pedido de novo.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import type { Transporte } from "@contabilizadev/nucleo/http";
import { AVISO_LIDO, CORPO_INTIMACAO, INTIMACAO, respostaConteudoCaixa, respostaListaCaixa } from "@contabilizadev/nucleo/serpro/caixa-postal-exemplo";
import { SERVICO_DA_LISTA, SERVICO_DO_CONTEUDO } from "@contabilizadev/nucleo/serpro/caixa-postal";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import { cnpj, criarClienteSerpro, ErroSemResposta } from "@contabilizadev/nucleo/serpro/cliente";
import { caixaPostal, historicoConsultas, serproChamadas } from "@/banco/esquema";
import { entrarComGoogle, resolverSessao } from "@/lib/autenticacao/servico";
import { abrirMensagemDaCaixa, atualizarCaixaPostal, ehNova, listaEmDia, marcarComoVistas, mensagensDaEmpresa, resumoDaCaixa, type DependenciasCaixa } from "@/lib/caixa-postal/caixa-postal";
import { MENSAGENS_DA_CAIXA } from "@/lib/caixa-postal/mensagens";
import { exigirAcessoEmpresa } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro } from "@/lib/empresas/cadastro";
import { removerEmpresa } from "@/lib/empresas/remocao";
import { registroNoBanco } from "@/lib/serpro/registro";
import { ErroTermoAutorizacao } from "@/lib/termo/termo";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const em = (iso: string) => new Date(`${iso}-03:00`);
const AGORA = em("2026-10-20T10:00:00");
const HORA = 60 * 60 * 1000;
const SUPORTE = "98765432000198";
const TOKEN = "b06feea3-1ca8-49f4-bdb4-211ab006cb92";
const PERFIS = { ana: perfil("ana@a.com", "sub-ana"), beto: perfil("beto@b.com", "sub-beto") };

async function empresa(quem: "ana" | "beto" = "ana", exemplo: "ti-anexo-iii" | "ti-fator-r" = "ti-anexo-iii") {
  const usuario = (await entrarComGoogle(depsLogin(t.banco, PERFIS), quem)).usuario;
  const numero = exemplo === "ti-anexo-iii" ? "98.765.432/0001-98" : "12.345.678/0001-95";
  const r = await consultarParaCadastro(t.banco, usuario, numero, { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo(exemplo) });
  assert.equal(r.tipo, "previa");
  const empresaId = await cadastrarPelaPrevia(t.banco, usuario, r.previa.token, { segredo: SEGREDO, agora: AGORA });
  return { usuario, empresaId, acesso: await exigirAcessoEmpresa(t.banco, usuario, empresaId) };
}

const contexto = async () => ({ contribuinte: cnpj(SUPORTE), autorPedidoDados: cnpj(SUPORTE), tokenProcurador: TOKEN });
function dependencias(cliente: DependenciasCaixa["cliente"], agora = AGORA, log: string[] = []): DependenciasCaixa {
  return { banco: t.banco, cliente, contexto, agora: () => agora, log: (m) => void log.push(m) };
}
const servicos = (cliente: ReturnType<typeof clienteFalso>) => cliente.chamadas.map((c) => c.pedido.idServico);

describe("lista da Caixa Postal: só os cabeçalhos, banco primeiro", () => {
  it("a primeira busca segue até 3 páginas e guarda os cabeçalhos; nada é aberto (o serviço da ciência não é chamado)", async () => {
    const { acesso } = await empresa();
    const cliente = clienteFalso(respostaListaCaixa([INTIMACAO], "20261001000000000000000"), respostaListaCaixa([AVISO_LIDO]));
    const r = await atualizarCaixaPostal(dependencias(cliente), acesso, { manual: false });
    assert.deepEqual(r, { estado: "atualizada", novas: 1 });
    assert.deepEqual(servicos(cliente), [SERVICO_DA_LISTA, SERVICO_DA_LISTA]);
    assert.ok(!servicos(cliente).includes(SERVICO_DO_CONTEUDO));
    assert.ok(cliente.chamadas.every((c) => c.opcoes.tokenProcurador === TOKEN && c.opcoes.contribuinte.numero === SUPORTE));

    const lista = await mensagensDaEmpresa(t.banco, acesso);
    assert.deepEqual(
      lista.map((m) => [m.isn, m.assunto, m.enviadaEm, m.lidaNaReceita, m.relevante, m.conteudo]),
      [
        ["0001626772", "Termo de Intimação - Processo 10000.000001/2026-11", "2026-10-15T09:29:49", false, true, null],
        ["0001626770", "Declaração processada", "2026-10-01T08:01:02", true, false, null],
      ],
    );
    assert.deepEqual(await resumoDaCaixa(t.banco, acesso), { total: 2, naoLidas: 1, novas: 1, novasImportantes: 1, importantesNaoLidas: 1, atualizadaEm: AGORA });
  });

  it("banco primeiro: a automática não busca de novo no mesmo dia; depois de um dia, só a primeira página", async () => {
    const { acesso } = await empresa();
    await atualizarCaixaPostal(dependencias(clienteFalso(respostaListaCaixa([INTIMACAO]))), acesso, { manual: false });
    const nada = clienteFalso();
    assert.deepEqual(await atualizarCaixaPostal(dependencias(nada, new Date(AGORA.getTime() + 23 * HORA)), acesso, { manual: false }), { estado: "em-dia" });
    assert.equal(nada.chamadas.length, 0);
    assert.equal(await listaEmDia(t.banco, acesso, new Date(AGORA.getTime() + 23 * HORA)), true);
    assert.equal(await listaEmDia(t.banco, acesso, new Date(AGORA.getTime() + 24 * HORA)), false);

    // No dia seguinte: a lista atualiza a leitura (lida no e-CAC) e traz a nova; uma página só.
    const amanha = clienteFalso(respostaListaCaixa([{ ...INTIMACAO, lida: true }, { isn: "0001626800", assunto: "Aviso de cobrança", envio: "20261020080000" }], "999"));
    const r = await atualizarCaixaPostal(dependencias(amanha, new Date(AGORA.getTime() + 25 * HORA)), acesso, { manual: false });
    assert.deepEqual(r, { estado: "atualizada", novas: 1 });
    assert.equal(amanha.chamadas.length, 1);
    const lista = await mensagensDaEmpresa(t.banco, acesso);
    assert.deepEqual(lista.map((m) => [m.isn, m.lidaNaReceita]), [["0001626800", false], ["0001626772", true]]);
  });

  it("botão Atualizar: intervalo mínimo de 10 minutos; a tentativa que falhou também conta", async () => {
    const { acesso } = await empresa();
    const log: string[] = [];
    const falha = clienteFalso({ status: 500, dados: null, mensagens: [{ codigo: "Erro-CAIXAPOSTAL-001", texto: "fora do ar" }] });
    const r = await atualizarCaixaPostal(dependencias(falha, AGORA, log), acesso, { manual: true });
    assert.deepEqual(r, { estado: "falhou", mensagem: MENSAGENS_DA_CAIXA.falhou });
    assert.ok(log.some((l) => l.startsWith("[serpro]") && /HTTP 500/.test(l)));
    // A falha não marca a lista como atualizada e não grava nada.
    assert.equal((await resumoDaCaixa(t.banco, acesso)).atualizadaEm, null);
    assert.equal((await mensagensDaEmpresa(t.banco, acesso)).length, 0);
    const cedo = clienteFalso();
    assert.deepEqual(await atualizarCaixaPostal(dependencias(cedo, new Date(AGORA.getTime() + 4 * 60_000)), acesso, { manual: true }), { estado: "espere", minutos: 6 });
    assert.equal(cedo.chamadas.length, 0);
    // A automática espera um dia depois da falha.
    assert.deepEqual(await atualizarCaixaPostal(dependencias(cedo, new Date(AGORA.getTime() + 2 * HORA)), acesso, { manual: false }), { estado: "em-dia" });
    const depois = clienteFalso(respostaListaCaixa([INTIMACAO]));
    assert.equal((await atualizarCaixaPostal(dependencias(depois, new Date(AGORA.getTime() + 11 * 60_000)), acesso, { manual: true })).estado, "atualizada");
  });

  it("duas buscas ao mesmo tempo (duas abas): uma chamada só", async () => {
    const { acesso } = await empresa();
    const cliente = clienteFalso(respostaListaCaixa([INTIMACAO]), respostaListaCaixa([INTIMACAO]));
    const [a, b] = await Promise.all([atualizarCaixaPostal(dependencias(cliente), acesso, { manual: false }), atualizarCaixaPostal(dependencias(cliente), acesso, { manual: false })]);
    assert.deepEqual([a.estado, b.estado].sort(), ["atualizada", "em-dia"]);
    assert.equal(cliente.chamadas.length, 1);
  });

  it("sem contrato ou sem autorização: nada é chamado, mensagem própria", async () => {
    const { acesso } = await empresa();
    assert.deepEqual(await atualizarCaixaPostal(dependencias(null), acesso, { manual: true }), { estado: "falhou", mensagem: MENSAGENS_DA_CAIXA.indisponivel });
    const cliente = clienteFalso();
    const semTermo = { ...dependencias(cliente), contexto: async () => Promise.reject(new ErroTermoAutorizacao("sem-termo")) };
    const r = await atualizarCaixaPostal(semTermo, acesso, { manual: true });
    assert.equal(r.estado, "falhou");
    assert.equal(cliente.chamadas.length, 0);
  });
});

describe("abrir uma mensagem: só a pedido, com a confirmação da ciência", () => {
  async function comLista() {
    const e = await empresa();
    await atualizarCaixaPostal(dependencias(clienteFalso(respostaListaCaixa([INTIMACAO, AVISO_LIDO]))), e.acesso, { manual: false });
    const lista = await mensagensDaEmpresa(t.banco, e.acesso);
    return { ...e, intimacao: lista.find((m) => m.isn === INTIMACAO.isn)!, lida: lista.find((m) => m.isn === AVISO_LIDO.isn)! };
  }

  it("não lida sem confirmação: recusa e não chama nada; confirmada: uma chamada ao conteúdo, guardado e lido", async () => {
    const { acesso, usuario, intimacao } = await comLista();
    const nada = clienteFalso();
    assert.deepEqual(await abrirMensagemDaCaixa(dependencias(nada), acesso, intimacao.id, { confirmado: false }), { ok: false, mensagem: MENSAGENS_DA_CAIXA.confirme });
    assert.equal(nada.chamadas.length, 0);

    const cliente = clienteFalso(respostaConteudoCaixa(CORPO_INTIMACAO, ["10000.000001/2026-11", "30"]));
    const r = await abrirMensagemDaCaixa(dependencias(cliente), acesso, intimacao.id, { confirmado: true, usuarioId: usuario.id });
    assert.ok(r.ok && r.nova);
    assert.deepEqual(servicos(cliente), [SERVICO_DO_CONTEUDO]);
    assert.deepEqual(cliente.chamadas[0].pedido.dados, { isn: INTIMACAO.isn });
    assert.match(r.mensagem.conteudo!, /processo 10000\.000001\/2026-11 em 30 dias/);
    assert.equal(r.mensagem.lidaNaReceita, true);
    assert.equal(r.mensagem.abertaPor, usuario.id);
    assert.deepEqual(r.mensagem.abertaEm, AGORA);

    // Banco primeiro: abrir de novo não chama nada.
    const denovo = clienteFalso();
    const r2 = await abrirMensagemDaCaixa(dependencias(denovo), acesso, intimacao.id, { confirmado: false });
    assert.ok(r2.ok && !r2.nova);
    assert.equal(denovo.chamadas.length, 0);
    assert.equal((await resumoDaCaixa(t.banco, acesso)).naoLidas, 0);
  });

  it("já lida na Receita: abre sem a confirmação (a ciência já foi registrada)", async () => {
    const { acesso, lida } = await comLista();
    const cliente = clienteFalso(respostaConteudoCaixa("<p>Declaração processada.</p>"));
    const r = await abrirMensagemDaCaixa(dependencias(cliente), acesso, lida.id, { confirmado: false });
    assert.ok(r.ok);
    assert.equal(r.mensagem.conteudo, "<p>Declaração processada.</p>");
  });

  it("duplo clique: o conteúdo é pedido uma vez só", async () => {
    const { acesso, intimacao } = await comLista();
    let soltar!: () => void;
    const espera = new Promise<void>((r) => (soltar = r));
    let chamadas = 0;
    const lento: DependenciasCaixa["cliente"] = {
      async chamar() {
        chamadas++;
        await espera;
        return respostaConteudoCaixa("<p>Texto</p>");
      },
    };
    const primeira = abrirMensagemDaCaixa(dependencias(lento), acesso, intimacao.id, { confirmado: true });
    await new Promise((r) => setTimeout(r, 50));
    const segunda = await abrirMensagemDaCaixa(dependencias(lento), acesso, intimacao.id, { confirmado: true });
    assert.deepEqual(segunda, { ok: false, mensagem: MENSAGENS_DA_CAIXA.abrindo });
    soltar();
    assert.ok((await primeira).ok);
    assert.equal(chamadas, 1);
  });

  it("falha: libera a trava e diz o que fazer; sem resposta, avisa que a ciência pode ter sido registrada", async () => {
    const { acesso, intimacao } = await comLista();
    const log: string[] = [];
    const r = await abrirMensagemDaCaixa(dependencias(clienteFalso(new ErroSemResposta("tempo esgotado")), AGORA, log), acesso, intimacao.id, { confirmado: true });
    assert.deepEqual(r, { ok: false, mensagem: MENSAGENS_DA_CAIXA.semResposta });
    assert.ok(log.some((l) => l.startsWith("[serpro]")));
    const vazia = await abrirMensagemDaCaixa(dependencias(clienteFalso({ status: 200, dados: { conteudo: [] }, mensagens: [] })), acesso, intimacao.id, { confirmado: true });
    assert.deepEqual(vazia, { ok: false, mensagem: MENSAGENS_DA_CAIXA.falhou });
    // A trava foi solta: dá para tentar de novo na hora.
    const ok = await abrirMensagemDaCaixa(dependencias(clienteFalso(respostaConteudoCaixa("<p>x</p>"))), acesso, intimacao.id, { confirmado: true });
    assert.ok(ok.ok);
  });

  it("trava parada (servidor reiniciado no meio) é liberada depois de 2 minutos", async () => {
    const { acesso, intimacao } = await comLista();
    await t.banco.update(caixaPostal).set({ abrindoEm: new Date(AGORA.getTime() - 60_000) }).where(eq(caixaPostal.id, intimacao.id));
    assert.deepEqual(await abrirMensagemDaCaixa(dependencias(clienteFalso()), acesso, intimacao.id, { confirmado: true }), { ok: false, mensagem: MENSAGENS_DA_CAIXA.abrindo });
    await t.banco.update(caixaPostal).set({ abrindoEm: new Date(AGORA.getTime() - 3 * 60_000) }).where(eq(caixaPostal.id, intimacao.id));
    assert.ok((await abrirMensagemDaCaixa(dependencias(clienteFalso(respostaConteudoCaixa("<p>x</p>"))), acesso, intimacao.id, { confirmado: true })).ok);
  });

  it("id malformado ou de outra empresa: não encontrada, nada é chamado", async () => {
    const { intimacao } = await comLista();
    const beto = await empresa("beto", "ti-fator-r");
    const nada = clienteFalso();
    assert.deepEqual(await abrirMensagemDaCaixa(dependencias(nada), beto.acesso, intimacao.id, { confirmado: true }), { ok: false, mensagem: MENSAGENS_DA_CAIXA.naoEncontrada });
    assert.deepEqual(await abrirMensagemDaCaixa(dependencias(nada), beto.acesso, "x' or 1=1", { confirmado: true }), { ok: false, mensagem: MENSAGENS_DA_CAIXA.naoEncontrada });
    assert.equal(nada.chamadas.length, 0);
    assert.deepEqual(await mensagensDaEmpresa(t.banco, beto.acesso), []);
  });
});

describe("sino e contadores", () => {
  it("ver a lista tira o destaque de nova sem registrar nada na Receita; continua não lida (e importante) no painel e no sino", async () => {
    const { acesso } = await empresa();
    const cliente = clienteFalso(respostaListaCaixa([INTIMACAO, AVISO_LIDO]));
    await atualizarCaixaPostal(dependencias(cliente), acesso, { manual: false });
    assert.equal((await mensagensDaEmpresa(t.banco, acesso)).filter(ehNova).length, 1);
    await marcarComoVistas(t.banco, acesso, AGORA);
    const resumo = await resumoDaCaixa(t.banco, acesso);
    assert.deepEqual([resumo.novas, resumo.novasImportantes, resumo.naoLidas, resumo.importantesNaoLidas], [0, 0, 1, 1]);
    assert.ok(!servicos(cliente).includes(SERVICO_DO_CONTEUDO));
  });
});

describe("cliente real do núcleo (transporte falso) e remoção da empresa", () => {
  it("a lista fica em serpro_chamadas com o serviço, a finalidade e o custo; nenhuma chamada ao conteúdo", async () => {
    const { acesso } = await empresa();
    const respostas = [
      { status: 200, texto: JSON.stringify({ access_token: "acesso", jwt_token: "jwt", expires_in: 3600 }) },
      { status: 200, texto: JSON.stringify({ status: 200, dados: JSON.stringify(respostaListaCaixa([INTIMACAO]).dados), mensagens: [] }) },
    ];
    const transporte: Transporte = async () => respostas.shift()!;
    const cliente = criarClienteSerpro({
      consumerKey: "chave",
      consumerSecret: "segredo",
      certificado: { pfx: Buffer.from("pfx"), senha: "x" },
      contratante: "11444777000161",
      limitePorPeriodo: 40,
      registro: registroNoBanco(t.banco),
      transporte,
      agora: () => AGORA,
    });
    assert.equal((await atualizarCaixaPostal(dependencias(cliente), acesso, { manual: true })).estado, "atualizada");
    const registradas = await t.banco.select().from(serproChamadas);
    assert.deepEqual(
      registradas.map((c) => [c.acao, c.servico, c.status, c.empresaId]),
      [
        ["Autenticar", "SAPI", 200, null],
        ["Consultar", `CAIXAPOSTAL/${SERVICO_DA_LISTA}`, 200, acesso.empresaId],
      ],
    );
    assert.match(registradas[1].finalidade, /sem abrir o conteúdo/);
    assert.equal(registradas[1].custo, 0.24);
  });

  it("remover a empresa apaga as mensagens e a consulta da Caixa Postal (nada órfão)", async () => {
    const { acesso, usuario } = await empresa();
    await atualizarCaixaPostal(dependencias(clienteFalso(respostaListaCaixa([INTIMACAO]))), acesso, { manual: false });
    assert.equal((await t.banco.select().from(caixaPostal)).length, 1);
    const d = depsLogin(t.banco, PERFIS);
    const sessao = await resolverSessao(d, (await entrarComGoogle(d, "ana")).cookie);
    assert.ok(sessao && sessao.usuario.id === usuario.id);
    await removerEmpresa(t.banco, sessao, acesso.empresaId, SUPORTE);
    assert.equal((await t.banco.select().from(caixaPostal)).length, 0);
    assert.equal((await t.banco.select().from(historicoConsultas)).length, 0);
  });
});
