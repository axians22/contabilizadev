// QA ciclo 5 (Parte 3, tooltip único): casos de borda das correções do ciclo 4 nas etapas 2, 4 e 5 do assistente,
// e a lógica de abrir/fechar e posicionar o balão.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { lerRespostaCnpj, type DadosCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { respostaGravada } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { diagnosticar } from "@contabilizadev/nucleo/diagnostico";
import { Assistente } from "@/app/(painel)/empresas/nova/assistente";
import { explicarNatureza, resumoSimples, type EstadoAssistente, type IdEtapa } from "@/lib/empresas/assistente";
import { aberta, FECHADA, posicionarBalao, reduzirExplicacao, type EventoExplicacao } from "@/lib/explicacao";
import { explicacoes, paragrafosVisiveis, semExplicacoes, texto } from "./tela";

const HOJE = "2026-10-16";
const nada = async () => ({ erro: "não chamado" });

function tela(dados: DadosCnpj, etapa: IdEtapa): string {
  const estado: EstadoAssistente = {
    etapa,
    cnpj: "12.345.678/0001-95",
    previa: { dados, diagnostico: diagnosticar(dados, HOJE), consultadaEm: `${HOJE}T12:00:00.000Z`, token: "t", qsa: "confere" as const },
    recebidaEm: Date.now(),
    empresaId: null,
    autorizacao: null,
    autorizadaAte: null,
  };
  return renderToStaticMarkup(createElement(Assistente, { consultar: nada, cadastrar: nada, preparar: nada as never, enviar: nada, inicial: estado })).replace(/ /g, " ");
}

const base = () => lerRespostaCnpj(respostaGravada("ti-fator-r"));
const visivel = (html: string) => texto(semExplicacoes(html));

describe("QA ciclo5: etapa 2 (empresa)", () => {
  it("antiga EIRELI (2305) é atendida: ✓ sem tooltip de 'o que fazer'", () => {
    const d = base();
    d.naturezaJuridica = { codigo: "2305", descricao: "Empresa Individual de Responsabilidade Limitada (de natureza empresária)" };
    const html = tela(d, "empresa");
    assert.equal(explicarNatureza("2305").ok, true);
    assert.ok(!explicacoes(html).some((e) => /tipo de empresa impede/.test(e.rotulo)));
  });

  it("natureza sem código: '!' com o motivo curto e o tooltip do que fazer", () => {
    const d = base();
    d.naturezaJuridica = { codigo: "", descricao: "" };
    const html = tela(d, "empresa");
    assert.match(visivel(html), /Tipo de empresa ainda não atendido\./);
    assert.ok(explicacoes(html).some((e) => e.rotulo === "Por que o tipo de empresa impede o cadastro?" && /antiga EIRELI/.test(e.texto)));
  });

  it("sem sócios: nenhum parágrafo explicativo aparece no lugar do pró-labore", () => {
    const d = base();
    d.socios = [];
    const html = tela(d, "empresa");
    for (const p of paragrafosVisiveis(html)) assert.ok(p.length <= 140, p);
    assert.doesNotMatch(visivel(html), /pró-labore/i);
  });
});

describe("QA ciclo5: etapa 4 (Simples)", () => {
  it("Simples não informado: valor 'Não informado' e alerta curto (impede)", () => {
    const d = base();
    d.simples = { optante: null, dataOpcao: null, dataExclusao: null };
    const html = tela(d, "simples");
    assert.match(visivel(html), /Simples Nacional.*Não informado/);
    assert.match(visivel(html), /A Receita Federal não informa se a empresa é optante\./);
    assert.ok(explicacoes(html).some((e) => e.rotulo === "Por que precisamos saber se a empresa é do Simples?"));
  });

  it("MEI não informado: sem ✓ nem '!' na linha do MEI", () => {
    const d = base();
    d.mei = { optante: null, dataOpcao: null, dataExclusao: null };
    const html = tela(d, "simples");
    const r = resumoSimples(d, HOJE);
    assert.deepEqual(r.mei, { ok: true, neutro: true, curto: "A Receita Federal não informa se a empresa é MEI." });
    const trecho = html.slice(html.indexOf(">MEI<"));
    const linha = trecho.slice(0, trecho.indexOf("</li>"));
    assert.doesNotMatch(linha, /✓|>!</);
    assert.match(texto(linha), /Não informado/);
  });

  it("exclusão do Simples hoje (data = hoje) já vale: fora do Simples, com a data", () => {
    const d = base();
    d.simples = { optante: true, dataOpcao: "2022-01-01", dataExclusao: HOJE };
    const r = resumoSimples(d, HOJE);
    assert.equal(r.simples.ok, false);
    assert.match(r.simples.curto, /Fora do Simples Nacional desde 16\/10\/2026/);
  });

  it("exclusão amanhã: ✓ optante na etapa 4, aviso só na etapa 5", () => {
    const d = base();
    d.simples = { optante: true, dataOpcao: "2022-01-01", dataExclusao: "2026-10-17" };
    assert.doesNotMatch(visivel(tela(d, "simples")), /Atenção:? Saída/);
    assert.match(visivel(tela(d, "diagnostico")), /Atenção: Saída do Simples marcada para 17\/10\/2026/);
  });
});

describe("QA ciclo5: etapa 5 (diagnóstico)", () => {
  it("atendida com Fator R: sem regra aberta, parágrafos curtos, um tooltip do Fator R e o exemplo com números", () => {
    const html = tela(base(), "diagnostico");
    const t = visivel(html);
    assert.match(t, /Anexo III ou V ?, conforme o Fator R/);
    assert.doesNotMatch(t, /28%|folha|mais barato|mais caro/);
    for (const p of paragrafosVisiveis(html)) assert.ok(p.length <= 140, p);
    const fr = explicacoes(html).filter((e) => e.rotulo === "O que é o Fator R?");
    assert.equal(fr.length, 1);
    const ex = explicacoes(html).find((e) => /Ver exemplo/.test(e.rotulo));
    assert.ok(ex && /R\$ 2\.800,00/.test(ex.texto) && /R\$ 33\.600,00/.test(ex.texto));
  });

  it("não atendida (MEI): o motivo fica visível, curto", () => {
    const d = lerRespostaCnpj(respostaGravada("mei"));
    const html = tela(d, "diagnostico");
    assert.match(visivel(html), /A empresa é MEI: ainda não atendemos MEI\./);
    assert.match(visivel(html), /Motivo/);
  });
});

describe("QA ciclo5: tooltip, abrir e fechar", () => {
  const passa = (...ev: EventoExplicacao["tipo"][]) => ev.reduce((e, tipo) => reduzirExplicacao(e, { tipo } as EventoExplicacao), FECHADA);

  it("toque no celular (foca e clica): abre; segundo toque: fecha", () => {
    assert.equal(aberta(passa("focou", "alternar")), true);
    assert.equal(aberta(passa("focou", "alternar", "alternar")), false);
  });
  it("Tab abre, Enter fixa, Esc fecha; mouse sai e o que foi fixado continua", () => {
    assert.equal(aberta(passa("focou")), true);
    assert.equal(aberta(passa("focou", "alternar", "esc")), false);
    assert.equal(aberta(passa("entrou", "alternar", "saiu")), true);
    assert.equal(aberta(passa("entrou", "saiu")), false);
  });
  it("mouse no balão (entrou de novo antes de fechar) não fecha", () => {
    assert.equal(aberta(passa("entrou", "saiu", "entrou")), true);
  });
  it("clique fora fecha mesmo o fixado; sair com Tab também", () => {
    assert.equal(aberta(passa("alternar", "fora")), false);
    assert.equal(aberta(passa("focou", "alternar", "desfocou")), false);
  });
});

describe("QA ciclo5: tooltip, posição", () => {
  it("celular 320px: balão encostado nas duas margens, sem sair da tela", () => {
    const p = posicionarBalao({ esquerda: 290, topo: 100, largura: 24, altura: 24 }, 200, { largura: 320, altura: 640 });
    assert.equal(p.esquerda, 16);
    assert.equal(p.largura, 288);
    assert.ok(p.esquerda + p.largura <= 320 - 16);
    assert.ok(p.seta >= 12 && p.seta <= p.largura - 12);
  });
  it("gatilho no pé da tela: vai para cima", () => {
    const p = posicionarBalao({ esquerda: 100, topo: 600, largura: 24, altura: 24 }, 200, { largura: 1280, altura: 640 });
    assert.equal(p.lado, "cima");
    assert.ok(p.topo + 200 <= 600);
  });
  it("balão maior que a tela: fica dentro da margem de cima", () => {
    const p = posicionarBalao({ esquerda: 100, topo: 300, largura: 24, altura: 24 }, 2000, { largura: 1280, altura: 640 });
    assert.ok(p.topo >= 16);
  });
  it("computador: largura máxima legível de 320px, centrado no gatilho", () => {
    const p = posicionarBalao({ esquerda: 600, topo: 100, largura: 24, altura: 24 }, 100, { largura: 1280, altura: 800 });
    assert.equal(p.largura, 320);
    assert.equal(p.esquerda, 612 - 160);
    assert.equal(p.lado, "baixo");
  });
  it("janela estreita demais (largura 20): sem largura negativa", () => {
    const p = posicionarBalao({ esquerda: 0, topo: 0, largura: 10, altura: 10 }, 50, { largura: 20, altura: 100 });
    assert.ok(p.largura >= 0);
  });
});
