import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ANO_DA_REFORMA_DO_IR, explicacaoDoLimiteIsento, explicacaoDoLucroAcima } from "./limite";

const R = { receita: 300_000, irpj: 1_000, limiteLucroIsento: 95_000 };

// Lei 15.270/2025 (em vigor desde 01/01/2026): retenção de 10% sobre lucros acima de R$ 50 mil no mês (Lei 9.250/1995,
// art. 6º-A) e tributação mínima das rendas altas (art. 16-A); a Receita Federal a aplica ao Simples Nacional
// (Perguntas e respostas sobre lucros e dividendos, dez/2025, questão 10).
describe("texto do limite de lucro isento, por ano", () => {
  it("até 2025: isento sem Imposto de Renda, sem falar da retenção", () => {
    const t = explicacaoDoLimiteIsento(2025, R).join(" ");
    assert.match(t, /em 2025 sem pagar Imposto de Renda/);
    assert.match(t, /LC 123\/2006, art\. 14/);
    assert.doesNotMatch(t, /15\.270|50\.000|retém/);
  });

  it("de 2026 em diante: o limite não afasta a retenção de 10% acima de R$ 50 mil no mês nem a tributação das rendas altas", () => {
    for (const ano of [ANO_DA_REFORMA_DO_IR, 2027]) {
      const t = explicacaoDoLimiteIsento(ano, R).join(" ");
      assert.doesNotMatch(t, /sem pagar Imposto de Renda/);
      assert.match(t, new RegExp(`em ${ano} como rendimento isento`));
      assert.match(t, /não afasta a retenção/);
      assert.match(t, /mais de R\$ 50\.000,00 de lucros no mesmo mês, retém 10% sobre o total/);
      assert.match(t, /Lei 9\.250\/1995, art\. 6º-A, incluído pela Lei 15\.270\/2025/);
      assert.match(t, /vale também para o Simples Nacional/);
      assert.match(t, /aprovada até 31\/12\/2025, ficam fora/);
      assert.match(t, /R\$ 600\.000,00 .*art\. 16-A/);
      // A conta continua a mesma.
      assert.match(t, /32% de R\$\s300\.000,00 = R\$\s96\.000,00, menos R\$\s1\.000,00 de IRPJ = R\$\s95\.000,00/);
    }
  });

  it("lucro acima do limite: a retenção só aparece a partir de 2026", () => {
    assert.doesNotMatch(explicacaoDoLucroAcima(2025).join(" "), /15\.270/);
    assert.match(explicacaoDoLucroAcima(2025).join(" "), /sai sem Imposto de Renda/);
    assert.match(explicacaoDoLucroAcima(2026).join(" "), /Se a empresa pagar ao mesmo sócio mais de R\$ 50\.000,00 de lucros no mês, ainda retém 10% sobre o total pago naquele mês \(Lei 15\.270\/2025\)/);
    assert.doesNotMatch(explicacaoDoLucroAcima(2026).join(" "), /sem Imposto de Renda/);
    // O limite de R$ 50 mil é por sócio (Lei 9.250/1995, art. 6º-A): o aviso não pode sugerir um teto da empresa.
    assert.doesNotMatch(explicacaoDoLucroAcima(2026).join(" "), /Acima de R\$ 50\.000,00 no mês/);
  });
});
