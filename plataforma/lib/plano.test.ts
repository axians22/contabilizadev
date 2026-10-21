// O leitor do plano.txt (lib/plano.ts): partes, listas (inclusive o título com complemento em minúsculas entre
// parênteses, como o do Backlog), a seção SEGURANÇA (gravidades, continuação recuada, item FEITO) e a aba do endereço.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { abaDoPlano, contagemDeSeguranca, interpretarPlano, itemDeSeguranca, lerPlano } from "./plano";

const EXEMPLO = `PLANO DE TESTE
==============

Objetivo: testar.

PARTE 0 - PREPARAÇÃO  [FEITO em 16/10/2026: pronto]
 1. Primeiro passo.

PARTE 1 - NÚCLEO
 2. Segundo passo
    que continua.

PRIMEIRA VERSÃO (MVP) ATENDE SÓ
- Empresas de TI.
- Só exportação.


BACKLOG (fora do plano por enquanto)
- Convite de membro: o banco já tem o papel, mas não
  há tela.


SEGURANÇA
Auditoria de teste. Já está bom:
isolamento entre empresas.
- [Alta] Sem limite de chamadas pagas: um cliente
  pode gastar tudo (cliente.ts).
- [Média] Faltam cabeçalhos.
- [Baixa] Sessão longa. [FEITO em 22/10/2026: expira em 7 dias sem uso]
- [Decisão] Rota da área do administrador.
- [Média] Postgres aberto
  na rede. [FEITO em 23/10/2026]


DECISÕES TOMADAS
- Banco: Postgres.
`;

describe("leitor do plano.txt", () => {
  const plano = interpretarPlano(EXEMPLO);

  it("lê título, introdução e partes como antes", () => {
    assert.equal(plano.titulo, "PLANO DE TESTE");
    assert.deepEqual(plano.introducao, ["Objetivo: testar."]);
    assert.deepEqual(
      plano.partes.map((p) => [p.numero, p.nome, p.feito]),
      [
        [0, "PREPARAÇÃO", true],
        [1, "NÚCLEO", false],
      ],
    );
    assert.equal(plano.partes[1].passos[0].texto, "Segundo passo que continua.");
  });

  it("título com complemento em minúsculas entre parênteses vira lista própria: o Backlog não gruda no MVP", () => {
    assert.deepEqual(
      plano.listas.map((l) => l.titulo),
      ["PRIMEIRA VERSÃO (MVP) ATENDE SÓ", "BACKLOG (fora do plano por enquanto)", "DECISÕES TOMADAS"],
    );
    assert.deepEqual(plano.listas[0].itens, ["Empresas de TI.", "Só exportação."]);
    assert.deepEqual(plano.listas[1].itens, ["Convite de membro: o banco já tem o papel, mas não há tela."]);
  });

  it("frase comum com parênteses não vira título", () => {
    const p = interpretarPlano("T\nPARTE 0 - A\n 1. x\n\nLISTA\n- item\nContinua (sem recuo)\nVALOR (de exemplo) aqui\n");
    assert.deepEqual(p.listas.map((l) => l.titulo), ["LISTA"]);
    assert.deepEqual(p.listas[0].itens, ["item Continua (sem recuo) VALOR (de exemplo) aqui"]);
  });

  it("a SEGURANÇA é uma seção à parte, fora das listas, com o parágrafo inicial", () => {
    assert.ok(!plano.listas.some((l) => /SEGURAN/.test(l.titulo)));
    assert.equal(plano.seguranca?.introducao, "Auditoria de teste. Já está bom: isolamento entre empresas.");
  });

  it("cada item com a gravidade, na ordem do arquivo, juntando a continuação recuada", () => {
    const itens = plano.seguranca!.itens;
    assert.deepEqual(
      itens.map((i) => i.gravidade),
      ["Alta", "Média", "Baixa", "Decisão", "Média"],
    );
    assert.equal(itens[0].texto, "Sem limite de chamadas pagas: um cliente pode gastar tudo (cliente.ts).");
    assert.equal(itens[0].feito, null);
  });

  it("item que termina com [FEITO em DD/MM/AAAA: resumo] fica Feito (o resumo é opcional, mesmo na continuação)", () => {
    const itens = plano.seguranca!.itens;
    assert.deepEqual(itens[2], { gravidade: "Baixa", texto: "Sessão longa.", feito: { data: "22/10/2026", resumo: "expira em 7 dias sem uso" } });
    assert.deepEqual(itens[4], { gravidade: "Média", texto: "Postgres aberto na rede.", feito: { data: "23/10/2026", resumo: null } });
  });

  it("contagem: os abertos por gravidade e os feitos à parte", () => {
    assert.deepEqual(contagemDeSeguranca(plano.seguranca!.itens), {
      porGravidade: [
        { gravidade: "Alta", total: 1 },
        { gravidade: "Média", total: 1 },
        { gravidade: "Baixa", total: 0 },
        { gravidade: "Decisão", total: 1 },
      ],
      feitos: 2,
    });
  });

  it("gravidade sem acento ou em outra caixa é reconhecida; marca desconhecida fica no texto, sem gravidade", () => {
    assert.equal(itemDeSeguranca("[media] x").gravidade, "Média");
    assert.equal(itemDeSeguranca("[DECISAO] x").gravidade, "Decisão");
    assert.deepEqual(itemDeSeguranca("[Crítica] x"), { gravidade: null, texto: "[Crítica] x", feito: null });
    assert.deepEqual(itemDeSeguranca("sem marca"), { gravidade: null, texto: "sem marca", feito: null });
    // "[FEITO …]" no meio do texto não conta: só no fim.
    assert.equal(itemDeSeguranca("[Alta] [FEITO em 01/01/2026: x] e mais").feito, null);
  });

  it("plano sem seção SEGURANÇA: seguranca null", () => {
    assert.equal(interpretarPlano("T\nPARTE 0 - A\n 1. x\n").seguranca, null);
  });

  it("o plano.txt de verdade: Backlog separado do MVP e a seção Segurança com itens de todas as gravidades", () => {
    const real = lerPlano();
    const backlog = real.listas.find((l) => l.titulo.startsWith("BACKLOG"));
    assert.ok(backlog && backlog.itens.length > 0);
    const mvp = real.listas.find((l) => l.titulo.startsWith("PRIMEIRA VERSÃO"))!;
    assert.ok(!mvp.itens.some((i) => /Convite de membro/.test(i)));
    assert.ok(real.seguranca && real.seguranca.introducao.startsWith("Auditoria"));
    assert.ok(real.seguranca.itens.every((i) => i.gravidade !== null));
    for (const g of ["Alta", "Média", "Baixa", "Decisão"]) assert.ok(real.seguranca.itens.some((i) => i.gravidade === g), g);
    assert.ok(!real.listas.some((l) => /SEGURAN/.test(l.titulo)));
  });
});

describe("aba da página /admin/plano pelo endereço", () => {
  it("só ?aba=seguranca abre Segurança; o resto (vazio, inválido, repetido) cai em Plano", () => {
    assert.equal(abaDoPlano("seguranca"), "seguranca");
    for (const v of [undefined, "", "plano", "Seguranca", "segurança", "x", ["seguranca", "plano"]]) assert.equal(abaDoPlano(v), "plano", String(v));
  });
});
