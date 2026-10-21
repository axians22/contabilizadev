import { test } from "node:test";
import assert from "node:assert/strict";
import { decodificar, paragrafos } from "./mensagem-receita.ts";

test("decodifica acentos em entidades HTML", () => {
  assert.equal(decodificar("Cobran&ccedil;a e Fiscaliza&ccedil;&atilde;o / Regulariza&ccedil;&atilde;o de D&eacute;bitos"), "Cobrança e Fiscalização / Regularização de Débitos");
  assert.equal(decodificar("Caixa Postal Eletr&ocirc;nica, n&ordm; 10.522, &#233; &#xE7;"), "Caixa Postal Eletrônica, nº 10.522, é ç");
});

test("separa parágrafos e mantém links, completando os do e-CAC", () => {
  const html =
    '<p>Prezado Contribuinte,</p> <p>N&uacute;mero da Intima&ccedil;&atilde;o: <u><a href="/Servicos/ATSPO/intimacao.asp?Id=1">100000067448720</a></u></p><p>Veja <a href="javascript:alert(1)">aqui</a></p>';
  const p = paragrafos(html);
  assert.equal(p.length, 3);
  assert.deepEqual(p[0], [{ texto: "Prezado Contribuinte," }]);
  assert.equal(p[1][0].texto, "Número da Intimação: ");
  assert.deepEqual(p[1][1], { texto: "100000067448720", link: "https://cav.receita.fazenda.gov.br/Servicos/ATSPO/intimacao.asp?Id=1" });
  assert.equal(p[2][1].link, undefined);
});
