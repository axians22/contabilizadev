// Passo 7 do assistente de cadastro (Autorização) e os passos 1 a 5 só para leitura depois do cadastro, no HTML do
// servidor. O passo 7 usa os mesmos componentes da página Autorização (requisitos, AssinarTermo, texto oficial); aqui
// conferimos cada caso: assinar (com "Fazer depois"), empresa da própria plataforma, assinatura indisponível, ainda
// carregando e autorização concluída. Nenhuma tela diz "Ligar o automático".
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { lerRespostaCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { respostaGravada } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { diagnosticar } from "@contabilizadev/nucleo/diagnostico";
import { Assistente } from "@/app/(painel)/empresas/nova/assistente";
import { ESTADO_INICIAL, type Autorizacao, type EstadoAssistente, type IdEtapa } from "@/lib/empresas/assistente";
import { explicacoes, paragrafosVisiveis, semExplicacoes, texto } from "./tela";

const dados = lerRespostaCnpj(respostaGravada("ti-fator-r"));
const previa = { dados, diagnostico: diagnosticar(dados, "2026-10-16"), consultadaEm: new Date().toISOString(), token: "t" };
const PARAMETROS = {
  contratante: { numero: "11444777000161", nome: "PLATAFORMA DE TESTE LTDA" },
  empresa: { cnpj: dados.cnpj, razaoSocial: dados.razaoSocial },
  dataAssinatura: "20261018",
  vigenciaMaxima: "20271018",
};
const ASSINAR: Autorizacao = { tipo: "assinar", parametros: PARAMETROS };

const nada = async () => ({ erro: "não chamado" });
const tela = (estado: EstadoAssistente) =>
  renderToStaticMarkup(createElement(Assistente, { consultar: nada, cadastrar: nada, preparar: nada as never, enviar: nada, inicial: estado })).replace(/ /g, " ");
const visivel = (html: string) => texto(semExplicacoes(html));

// Empresa cadastrada, na etapa pedida.
const cadastrada = (etapa: IdEtapa, resto: Partial<EstadoAssistente> = {}): EstadoAssistente => ({
  ...ESTADO_INICIAL,
  etapa,
  cnpj: "12.345.678/0001-95",
  previa,
  recebidaEm: Date.now(),
  empresaId: "emp-1",
  autorizacao: ASSINAR,
  ...resto,
});

function etapaAtual(html: string): string {
  const atuais = [...html.matchAll(/<li aria-current="step"[^>]*>(.*?)<\/li>/g)];
  assert.equal(atuais.length, 1, "uma etapa atual na trilha");
  return texto(atuais[0][1]);
}

// Botão (link) do rodapé com este texto, e a classe dele.
const link = (html: string, rotulo: string) => new RegExp(`<a[^>]*href="/"[^>]*>${rotulo}</a>`).exec(html)?.[0] ?? null;

function enxuta(html: string) {
  for (const p of paragrafosVisiveis(html)) assert.ok(p.length <= 140, `parágrafo longo na tela: ${p}`);
  assert.doesNotMatch(html, /<details|Saiba mais/);
}

describe("assistente, passo 7 (Autorização)", () => {
  it("assinar: Passo 7 de 7, requisitos com tooltips, Fazer depois para o painel e Voltar; sem formulário dentro de formulário", () => {
    const html = tela(cadastrada("autorizacao"));
    const t = visivel(html);
    assert.match(t, /Passo 7 de 7 · Autorização/);
    assert.match(etapaAtual(html), /7\. Autorização/);
    assert.match(html, /<h2 id="titulo-etapa" tabindex="-1"[^>]*>Autorize a plataforma na Receita Federal<\/h2>/);
    assert.match(t, /Opcional: com a autorização, declarações e guias são feitas aqui mesmo/);
    // Os mesmos requisitos da página Autorização: dois itens para marcar, cada um com o tooltip de onde conseguir.
    assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2);
    assert.match(t, /Certificado digital e-CNPJ A1 da empresa/);
    assert.match(t, /Conta gov\.br nível prata ou ouro/);
    const rotulos = explicacoes(html).map((e) => e.rotulo);
    for (const r of ["O que é o e-CNPJ A1 e onde conseguir?", "Para que serve a conta gov.br prata ou ouro?", "O que é o termo de autorização?"]) assert.ok(rotulos.includes(r), r);
    // Fazer depois: link discreto para o painel; nada de "Ir para o painel" ainda.
    assert.ok(link(html, "Fazer depois"), "Fazer depois");
    assert.equal(link(html, "Ir para o painel"), null);
    assert.match(t, /Voltar/);
    // A assinatura tem o próprio formulário: o passo 7 não fica dentro do <form> do assistente.
    assert.doesNotMatch(html, /<form/);
    assert.match(html, /<section aria-labelledby="titulo-etapa"/);
    enxuta(html);
  });

  it("empresa da própria plataforma: já está autorizada, sem requisitos, e Ir para o painel", () => {
    const html = tela(cadastrada("autorizacao", { autorizacao: { tipo: "propria" } }));
    const t = visivel(html);
    assert.match(t, /Passo 7 de 7 · Autorização/);
    assert.match(html, /<h2[^>]*>A empresa já está autorizada<\/h2>/);
    assert.match(t, /já está autorizada, sem termo/);
    assert.ok(explicacoes(html).some((e) => e.rotulo === "Por que esta empresa não precisa de termo?"));
    assert.doesNotMatch(html, /type="checkbox"/);
    assert.match(link(html, "Ir para o painel") ?? "", /rounded-full/);
    assert.equal(link(html, "Fazer depois"), null);
  });

  it("assinatura indisponível: a mensagem própria, o modo guiado no tooltip e Ir para o painel", () => {
    const mensagem = "A assinatura da autorização ainda não está disponível. Enquanto isso, use o modo guiado.";
    const html = tela(cadastrada("autorizacao", { autorizacao: { tipo: "indisponivel", mensagem } }));
    const t = visivel(html);
    assert.ok(t.includes(mensagem));
    assert.match(t, /A empresa já está cadastrada e funciona no modo guiado/);
    assert.ok(explicacoes(html).some((e) => /autorizar depois, pela página Autorização/.test(e.texto)));
    assert.ok(link(html, "Ir para o painel"));
    assert.doesNotMatch(html, /type="checkbox"/);
  });

  it("ainda preparando: aviso curto e Fazer depois", () => {
    const html = tela(cadastrada("autorizacao", { autorizacao: null }));
    assert.match(visivel(html), /Preparando a autorização…/);
    assert.ok(link(html, "Fazer depois"));
  });

  it("depois de assinar: Tudo pronto, Autorização concluída com a validade e Ir para o painel", () => {
    const html = tela(cadastrada("autorizacao", { autorizadaAte: "2027-10-18" }));
    const t = visivel(html);
    assert.match(html, /<h2[^>]*>Tudo pronto<\/h2>/);
    assert.match(t, /Autorização concluída\. Autorização ativa até 18\/10\/2027\. Avisamos aqui e no sino quando faltar 30 dias para vencer\./);
    assert.match(html, /role="status"/);
    assert.ok(link(html, "Ir para o painel"));
    assert.equal(link(html, "Fazer depois"), null);
    assert.doesNotMatch(html, /type="checkbox"/);
  });
});

describe("assistente, passos 1 a 5 depois do cadastro: só leitura", () => {
  it("passo 1: CNPJ só para leitura, sem pesquisar de novo; o botão só segue adiante", () => {
    const html = tela(cadastrada("cnpj"));
    const t = visivel(html);
    assert.match(t, /Passo 1 de 7 · Pesquisar o CNPJ/);
    assert.match(html, /<input[^>]*id="cnpj"[^>]*readOnly=""|<input[^>]*readOnly=""[^>]*id="cnpj"/);
    assert.match(t, /Empresa já cadastrada: os dados ficam só para conferir\./);
    assert.match(html, /<button type="submit"[^>]*>Continuar<\/button>/);
    assert.doesNotMatch(t, /Pesquisar CNPJ/);
  });

  it("passo 5: diz que já está cadastrada; o botão é Continuar, não Confirmar e cadastrar", () => {
    const html = tela(cadastrada("diagnostico"));
    const t = visivel(html);
    assert.match(t, /A EXEMPLO SOFTWARE LTDA já está cadastrada e você é o dono dela\./);
    assert.doesNotMatch(t, /Confirmar e cadastrar|Ao confirmar, cadastramos/);
    assert.match(html, /<button type="submit"[^>]*>Continuar<\/button>/);
    // Mesmo com a prévia vencida, nada de pesquisar de novo: a empresa já existe.
    const vencida = visivel(tela(cadastrada("diagnostico", { recebidaEm: Date.now() - 60 * 60_000 })));
    assert.doesNotMatch(vencida, /mais de 30 minutos/);
    assert.match(visivel(tela(cadastrada("cnpj", { recebidaEm: Date.now() - 60 * 60_000 }))), /Continuar/);
  });
});

describe("nome novo: nenhuma tela do assistente diz 'Ligar o automático' nem aponta para /automatico", () => {
  it("todas as etapas, antes e depois do cadastro, e cada caso do passo 7", () => {
    const etapas: IdEtapa[] = ["cnpj", "empresa", "atividades", "simples", "diagnostico", "proximos", "autorizacao"];
    const telas = [
      ...etapas.map((e) => tela({ ...cadastrada(e), empresaId: null, autorizacao: null })),
      ...etapas.map((e) => tela(cadastrada(e))),
      tela(cadastrada("autorizacao", { autorizacao: { tipo: "propria" } })),
      tela(cadastrada("autorizacao", { autorizadaAte: "2027-10-18" })),
    ];
    for (const html of telas) {
      assert.doesNotMatch(html, /autom[aá]tico/i);
      assert.doesNotMatch(html, /serpro|integra[\s-]*contador|brasil[\s-]*api/i);
    }
  });
});
