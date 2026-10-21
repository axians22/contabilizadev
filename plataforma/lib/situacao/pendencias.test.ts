import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { debitosComGuia, explicarPendencias, mesesComGuiaVencida } from "./pendencias";

// Trechos no formato do "Diagnóstico Fiscal" do relatório de situação fiscal (já sem o cabeçalho e o rodapé).
const RELATORIO = [
  "Pendência - Débito (SIEF)",
  "Receita PA/Exerc. Dt. Vcto Vl.Original Sdo.Devedor Multa Juros Sdo.Dev.Cons. Situação",
  "1099-01 - CP SEGURADOS 12/2025 20/01/2026 178,31 178,31 35,66 9,42 223,39 DEVEDOR",
  "Pendência - Débito (SIMPLES NACIONAL)",
  "PA 08/2026 Vencimento 21/09/2026 Valor 1.170,84 Saldo 1.170,84",
  "Pendência - Omissão de DCTF (SIEF)",
  "Período 07/2026",
  "Pendência - Inscrição (SIDA)",
  "Inscrição 10.1.26.000001-00 - Saldo 2.500,00",
].join("\n");

describe("pendências do relatório em linguagem simples", () => {
  it("cada cabeçalho vira um grupo com título e o que fazer; débitos com tributo, mês, vencimento e saldo", () => {
    const p = explicarPendencias(RELATORIO);
    assert.deepEqual(p.map((x) => x.tipo), ["debito", "debito", "omissao", "divida-ativa"]);
    assert.equal(p[0].titulo, "Imposto vencido sem pagamento");
    assert.match(p[0].oQueFazer, /multa e juros/);
    assert.deepEqual(p[0].debitos.map((d) => [d.tributo, d.pa, d.vencimento, d.saldo]), [["INSS", "2025-12", "2026-01-20", 223.39]]);
    assert.deepEqual(p[1].debitos.map((d) => [d.tributo, d.pa, d.vencimento, d.saldo]), [["DAS", "2026-08", "2026-09-21", 1170.84]]);
    assert.equal(p[2].titulo, "Declaração em falta");
    assert.equal(p[3].titulo, "Dívida ativa na Procuradoria");
    assert.deepEqual(p[3].debitos, []);
  });

  it("os débitos que uma guia vencida da plataforma resolve (DAS e INSS com o mês), sem repetir", () => {
    const texto = `${RELATORIO}\nPendência - Débito (SIEF)\n1099-01 - CP SEGURADOS 12/2025 20/01/2026 178,31 178,31 DEVEDOR`;
    assert.deepEqual(debitosComGuia(explicarPendencias(texto)), [
      { tributo: "INSS", pa: "2025-12" },
      { tributo: "DAS", pa: "2026-08" },
    ]);
  });

  it("outros tipos: parcelamento, processo, divergência e o que não se reconhece", () => {
    const p = explicarPendencias("Pendência - Parcelamento (SIPADE)\nPendência - Processo Fiscal (SIEF)\nPendência - Divergência de GFIP x GPS\nPendência - Cadastro");
    assert.deepEqual(p.map((x) => x.tipo), ["parcelamento", "processo", "divergencia", "outra"]);
  });

  it("texto fora do formato (sem cabeçalho) e vazio não se perdem nem quebram", () => {
    const p = explicarPendencias("Débito\nIRPJ - PA 05/2026 - saldo devedor");
    assert.equal(p.length, 1);
    assert.equal(p[0].tipo, "outra");
    assert.equal(p[0].cabecalho, "Débito");
    assert.deepEqual(explicarPendencias(""), []);
    assert.deepEqual(explicarPendencias(null), []);
  });

  it("a data de vencimento não é confundida com o mês de apuração", () => {
    const [p] = explicarPendencias("Pendência - Débito (SIEF)\n1099-01 - CP SEGURADOS 20/01/2026 178,31");
    assert.deepEqual([p.debitos[0].pa, p.debitos[0].vencimento], [null, "2026-01-20"]);
    assert.deepEqual(debitosComGuia([p]), []);
  });
});

// Como o texto sai do PDF real (uma célula por linha: cada Tj/TJ vira uma linha), com cabeçalhos das colunas e vários débitos.
const EM_CELULAS = [
  "Pendência - Débito (SIEF)",
  ...["Receita", "PA/Exerc.", "Dt. Vcto", "Vl.Original", "Sdo.Devedor", "Multa", "Juros", "Sdo.Dev.Cons.", "Situação"],
  ...["1082-01 - CP-SEGURADOS", "08/2026", "21/09/2026", "178,31", "178,31", "35,66", "2,10", "216,07", "DEVEDOR"],
  ...["1082-01 - CP-SEGURADOS", "09/2026", "20/10/2026", "178,31", "178,31", "DEVEDOR"],
  ...["2089-01 - IRPJ", "2025", "31/03/2026", "1.000,00", "1.000,00", "A VENCER"],
  "Pendência - Débito (SIMPLES NACIONAL)",
  ...["PA", "Dt. Vcto", "Vl.Original", "Sdo.Devedor"],
  ...["07/2026", "20/08/2026", "900,00", "900,00"],
  ...["08/2026", "21/09/2026", "1.170,84", "1.170,84"],
  "Pendência - Omissão de DCTF (SIEF)",
  "Período 07/2026",
].join("\n");

describe("pendências com uma célula por linha (o texto real do PDF)", () => {
  it("cada débito junta as próprias células: tributo, mês, vencimento e saldo", () => {
    const p = explicarPendencias(EM_CELULAS);
    assert.deepEqual(p.map((x) => x.tipo), ["debito", "debito", "omissao"]);
    assert.deepEqual(p[0].debitos.map((d) => [d.tributo, d.pa, d.vencimento, d.saldo]), [
      ["INSS", "2026-08", "2026-09-21", 216.07],
      ["INSS", "2026-09", "2026-10-20", 178.31],
      ["outro", null, "2026-03-31", 1000],
    ]);
    assert.equal(p[0].debitos[1].linha, "1082-01 - CP-SEGURADOS 09/2026 20/10/2026 178,31 178,31 DEVEDOR");
    // Tabela sem código da receita nem situação: cada período começa um débito.
    assert.deepEqual(p[1].debitos.map((d) => [d.tributo, d.pa, d.vencimento, d.saldo]), [
      ["DAS", "2026-07", "2026-08-20", 900],
      ["DAS", "2026-08", "2026-09-21", 1170.84],
    ]);
    assert.deepEqual(p[2].debitos.map((d) => d.pa), ["2026-07"]);
  });

  it("os débitos com guia saem do texto em células", () => {
    assert.deepEqual(debitosComGuia(explicarPendencias(EM_CELULAS)), [
      { tributo: "INSS", pa: "2026-08" },
      { tributo: "INSS", pa: "2026-09" },
      { tributo: "DAS", pa: "2026-07" },
      { tributo: "DAS", pa: "2026-08" },
    ]);
  });

  it("os cabeçalhos das colunas sozinhos não viram débito", () => {
    const [p] = explicarPendencias("Pendência - Débito (SIEF)\nReceita\nPA/Exerc.\nDt. Vcto\nSituação");
    assert.deepEqual(p.debitos, []);
  });
});

describe("relatório com mais de uma página", () => {
  it("o cabeçalho e o rodapé de página no meio da tabela não entram no débito", () => {
    const texto = [
      "Pendência - Débito (SIMPLES NACIONAL)",
      ...["07/2026", "20/08/2026", "900,00", "900,00"],
      ...["Página: 1 /", "2", "MINISTÉRIO DA ECONOMIA", "Por meio do fornecedor", "SECRETARIA ESPECIAL DA RECEITA FEDERAL DO BRASIL"],
      ...["Autor pedido: 98.765.432/0001-98. Contratante: 98.765.432/0001-98", "PROCURADORIA-GERAL DA FAZENDA NACIONAL", "15/10/2026 20:29:23"],
      ...["08/2026", "21/09/2026", "1.170,84", "1.170,84"],
    ].join("\n");
    const [p] = explicarPendencias(texto);
    assert.deepEqual(p.debitos.map((d) => d.linha), ["07/2026 20/08/2026 900,00 900,00", "08/2026 21/09/2026 1.170,84 1.170,84"]);
  });
  it("o fim do cabeçalho (CNPJ e nome da empresa) no meio de um débito também sai, e o nome não muda o tributo", () => {
    const cabecalho = ["Página: 1 /", "2", "INFORMAÇÕES DE APOIO PARA EMISSÃO DE CERTIDÃO"];
    for (const fim of [
      ["CNPJ:", "98.765.432 - SEGURADORA PREVIDENCIA INSS CP LTDA"],
      ["CNPJ: 98.765.432 - SEGURADORA PREVIDENCIA LTDA"],
      ["CNPJ:", "98.765.432/0001-98 – SEGURADORA PREVIDENCIA LTDA"],
    ]) {
      const texto = ["Pendência - Débito (SIMPLES NACIONAL)", "07/2026", "20/08/2026", ...cabecalho, ...fim, "900,00", "900,00"].join("\n");
      const [p] = explicarPendencias(texto);
      assert.deepEqual(p.debitos.map((d) => [d.tributo, d.pa, d.linha]), [["DAS", "2026-07", "07/2026 20/08/2026 900,00 900,00"]], fim.join(" | "));
      assert.deepEqual(debitosComGuia([p]), [{ tributo: "DAS", pa: "2026-07" }]);
    }
  });

  it("um débito de INSS cortado pelo cabeçalho continua INSS (pelo código da receita, não pelo nome da empresa)", () => {
    const texto = [
      "Pendência - Débito (SIEF)",
      "1082-01 - CP-SEGURADOS",
      "08/2026",
      ...["Página: 2 /", "3", "INFORMAÇÕES DE APOIO PARA EMISSÃO DE CERTIDÃO", "CNPJ:", "98.765.432 - ALFA SISTEMAS LTDA"],
      "20/09/2026",
      "220,00",
      "220,00",
      "DEVEDOR",
    ].join("\n");
    const [p] = explicarPendencias(texto);
    assert.deepEqual(p.debitos.map((d) => [d.tributo, d.pa, d.linha]), [["INSS", "2026-08", "1082-01 - CP-SEGURADOS 08/2026 20/09/2026 220,00 220,00 DEVEDOR"]]);
  });
});

describe("mesesComGuiaVencida (o botão 'Gerar novas guias' da situação fiscal)", () => {
  const vencidas = [
    { tipo: "DAS", pa: "2026-08" },
    { tipo: "INSS", pa: "2025-12" },
    { tipo: "DAS", pa: "2026-03" },
  ];
  it("com o mês do débito no relatório: só as vencidas que resolvem um débito, em ordem", () => {
    assert.deepEqual(mesesComGuiaVencida(explicarPendencias(RELATORIO), vencidas), ["2025-12", "2026-08"]);
  });
  it("débito com mês e nenhuma guia vencida que o resolva: nada", () => {
    assert.deepEqual(mesesComGuiaVencida(explicarPendencias(RELATORIO), [{ tipo: "DAS", pa: "2026-03" }]), []);
  });
  it("relatório sem o mês de nenhum débito: todas as vencidas (como o ../fiscal), sem repetir mês", () => {
    const pendencias = explicarPendencias("Pendência - Débito (SIMPLES NACIONAL)");
    assert.deepEqual(mesesComGuiaVencida(pendencias, [...vencidas, { tipo: "INSS", pa: "2026-08" }]), ["2025-12", "2026-03", "2026-08"]);
  });
  it("sem pendência: nenhum mês", () => {
    assert.deepEqual(mesesComGuiaVencida([], vencidas), []);
  });
});
