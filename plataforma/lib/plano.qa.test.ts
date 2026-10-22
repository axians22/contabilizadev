// QA (21/10/2026): casos de borda do leitor do plano.txt — plano.txt real, CRLF, SEGURANÇA sem acento,
// FEITO com espaços/caixa, item sem gravidade, abas e ordem das listas.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { abaDoPlano, contagemDeSeguranca, interpretarPlano, itemDeSeguranca, lerPlano } from "./plano";

describe("QA: leitor do plano.txt", () => {
  it("plano.txt real: MVP, Backlog e Decisões separados; SEGURANÇA fora das listas com 16 itens na ordem", () => {
    const plano = lerPlano();
    const titulos = plano.listas.map((l) => l.titulo);
    const iMvp = titulos.findIndex((t) => /MVP/.test(t));
    const iBacklog = titulos.indexOf("BACKLOG (fora do plano por enquanto)");
    const iDecisoes = titulos.indexOf("DECISÕES TOMADAS");
    assert.ok(iMvp >= 0 && iBacklog === iMvp + 1 && iDecisoes > iBacklog, titulos.join(" | "));
    assert.ok(!plano.listas[iMvp].itens.some((i) => /Convite de membro/i.test(i)), "Backlog grudado no MVP");
    assert.ok(plano.listas[iBacklog].itens.length > 0);
    assert.ok(!titulos.some((t) => /SEGURAN/.test(t)));
    assert.ok(!plano.listas.some((l) => l.itens.some((i) => /\[Alta\]|\[Média\]|\[Decisão\]/.test(i))), "item de segurança numa lista");
    const s = plano.seguranca!;
    assert.match(s.introducao, /^Auditoria de 21\/10\/2026/);
    assert.match(s.introducao, /nenhum segredo no git\.$/);
    assert.equal(s.itens.length, 16);
    assert.deepEqual(
      s.itens.map((i) => i.gravidade),
      ["Alta", "Média", "Média", "Média", "Média", "Média", "Média", "Média", "Baixa", "Baixa", "Baixa", "Baixa", "Baixa", "Baixa", "Alta", "Decisão"],
    );
    assert.ok(s.itens.every((i) => !/^\[/.test(i.texto) && !/\s{2,}/.test(i.texto)));
    assert.match(s.itens[0].texto, /Correção: cota por empresa e reserva atômica\.$/);
    const c = contagemDeSeguranca(s.itens);
    // Dois itens de Média já feitos (posse pelo termo e cadeia do certificado, Parte 3 em 22/10/2026).
    assert.deepEqual(c.porGravidade.map((g) => g.total), [2, 5, 6, 1]);
    assert.equal(c.feitos, 2);
    // A seção seguinte (DECISÕES TOMADAS) não entra na segurança.
    assert.ok(!s.itens.some((i) => /Postgres 17 \(Docker/.test(i.texto)));
  });

  it("CRLF e título SEGURANCA sem acento ou com espaço no fim", () => {
    const texto = "T\r\nPARTE 0 - A\r\n 1. x\r\n\r\nSEGURANCA   \r\nIntro.\r\n- [alta] Um\r\n  dois. [feito em 01/01/2027:  ok  ]\r\n- [MÉDIA] Três.\r\n";
    const p = interpretarPlano(texto);
    assert.equal(p.listas.length, 0);
    assert.equal(p.seguranca?.introducao, "Intro.");
    assert.deepEqual(p.seguranca?.itens, [
      { gravidade: "Alta", texto: "Um dois.", feito: { data: "01/01/2027", resumo: "ok" } },
      { gravidade: "Média", texto: "Três.", feito: null },
    ]);
    const c = contagemDeSeguranca(p.seguranca!.itens);
    assert.deepEqual(c.porGravidade.map((g) => g.total), [0, 1, 0, 0]);
    assert.equal(c.feitos, 1);
  });

  it("item sem marca de gravidade não conta em nenhuma gravidade e não perde o texto", () => {
    const i = itemDeSeguranca("Sem marca nenhuma.");
    assert.deepEqual(i, { gravidade: null, texto: "Sem marca nenhuma.", feito: null });
    assert.deepEqual(contagemDeSeguranca([i]).porGravidade.map((g) => g.total), [0, 0, 0, 0]);
  });

  it("FEITO com data inválida no formato não é reconhecido", () => {
    assert.equal(itemDeSeguranca("[Alta] x [FEITO em 1/1/2027: y]").feito, null);
    assert.equal(itemDeSeguranca("[Alta] x [FEITO]").feito, null);
  });

  it("subitem recuado com traço dentro da segurança é continuação, não item novo", () => {
    const p = interpretarPlano("T\nPARTE 0 - A\n 1. x\n\nSEGURANÇA\n- [Baixa] Um:\n  - detalhe\n- [Alta] Dois\n");
    assert.deepEqual(p.seguranca?.itens.map((i) => i.texto), ["Um: - detalhe", "Dois"]);
  });

  it("abaDoPlano: só 'seguranca' exato", () => {
    assert.equal(abaDoPlano("seguranca"), "seguranca");
    for (const v of [undefined, "", "plano", "Seguranca", "segurança", " seguranca", ["seguranca"], ["seguranca", "plano"]]) {
      assert.equal(abaDoPlano(v as string | string[] | undefined), "plano", String(v));
    }
  });
});
