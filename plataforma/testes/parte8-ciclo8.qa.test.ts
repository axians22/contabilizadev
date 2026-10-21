// QA, Parte 8 (ciclo 8): a tabela "Os últimos 12 meses no eSocial" do passo 6 abre na página do mês aberto, mas a
// troca de mês no Roteiro é navegação do cliente (<Link> do CabecalhoMes e dos meses da própria tabela, só muda ?mes=).
// No Next 16 a busca não entra na chave do segmento da página (walk-tree-with-flight-router-state.js guarda a busca à
// parte), então o componente cliente <Tabela> não é remontado e o useState inicial (paginaInicial) não é lido de novo.
// Resultado: abrir o Roteiro de março/2026 (página 2) e clicar em "Próximo mês" até abril/2026 (página 1) mantém a
// tabela na página 2, sem o mês aberto à vista. Esperado: a tabela acompanha o mês aberto (ex.: key={atual} na Tabela,
// ou a página reajustada quando paginaInicial muda).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const APP = path.join(import.meta.dirname, "..", "app");

describe("QA: a tabela dos meses no eSocial acompanha o mês aberto na navegação do cliente", () => {
  it("o mês muda por <Link> (sem recarregar a página)", () => {
    const ui = readFileSync(path.join(APP, "ui.tsx"), "utf8");
    assert.match(ui, /<Link[^>]*href=\{`\$\{rota\}\?mes=\$\{somarMeses\(mes, 1\)\}`\}/);
  });

  it("a Tabela é remontada (ou reajusta a página) quando o mês aberto muda", () => {
    const esocial = readFileSync(path.join(APP, "(painel)", "roteiro", "esocial.tsx"), "utf8");
    const tabela = readFileSync(path.join(APP, "tabela.tsx"), "utf8");
    const remonta = /<Tabela\s[^>]*key=\{/.test(esocial) || /<details[^>]*key=\{/.test(esocial) || /<MesesNoEsocial[^>]*key=\{/.test(esocial);
    const reajusta = /useEffect\([^)]*paginaInicial|paginaInicial[\s\S]{0,200}setPagina\(/.test(tabela.replace(/useState\(\(\) => Math\.max\(1, paginaInicial \?\? 1\)\)/, ""));
    assert.ok(remonta || reajusta, "a página inicial só vale na primeira montagem: trocar o mês pelo cabeçalho deixa a tabela na página antiga");
  });
});
