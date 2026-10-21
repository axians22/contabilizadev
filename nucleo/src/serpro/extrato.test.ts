import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { documentoReal } from "../casos-reais.ts";
import { textoDoPdf } from "../pdf.ts";
import { identificarAtividade, lerExtrato, normalizar, numeroBr } from "./extrato.ts";
import { ATIVIDADE_29, linhasDoExtrato, pdfDoExtrato } from "./historico-exemplo.ts";

test("números e descrições no formato do extrato", () => {
  assert.equal(numeroBr("1.000,76"), 1000.76);
  assert.equal(numeroBr("352.998,85"), 352_998.85);
  assert.equal(numeroBr("0,00"), 0);
  assert.equal(normalizar('Não sujeitos ao fator "r" e tributados pelo Anexo III'), "nao sujeitos ao fator r e tributados pelo anexo iii");
});

test("identifica a atividade pelo texto do extrato (catálogo exato)", () => {
  assert.equal(identificarAtividade("Prestação de Serviços para o exterior - Não sujeitos ao fator r e tributados pelo Anexo III"), 30);
  assert.equal(identificarAtividade("Prestação de serviços para o exterior Sujeitos ao fator \"r\""), 29);
  assert.equal(identificarAtividade("Prestação de serviços para o exterior - Sujeitos ao Anexo IV"), 31);
  assert.equal(
    identificarAtividade("Prestação de serviços, exceto para o exterior - Sujeitos ao fator \"r\", sem retenção/substituição tributária de ISS, com ISS devido ao próprio Município do estabelecimento"),
    11,
  );
  assert.equal(identificarAtividade("Revenda de mercadorias para o exterior"), 3);
});

test("identifica pelo texto em pedaços (exemplo oficial, sem parte da frase) e não chuta o que não sabe", () => {
  // Texto do exemplo oficial da documentação, como sai do leitor: falta "Não sujeitos ao fator r e tributados pelo Anexo".
  assert.equal(
    identificarAtividade("Prestação de Serviços, exceto para o exterior - III, sem retenção/substituição tributária de ISS, com ISS devido ao próprio Município do estabelecimento"),
    14,
  );
  assert.equal(identificarAtividade("Prestação de Serviços, exceto para o exterior - Sujeitos ao fator r, com retenção/substituição tributária de ISS"), 12);
  assert.equal(identificarAtividade("Prestação de Serviços, exceto para o exterior - Sujeitos ao fator r, com ISS devido a outro(s) Município(s)"), 10);
  // Sem dizer onde o ISS é devido, no mercado interno: não sabe.
  assert.equal(identificarAtividade("Prestação de Serviços, exceto para o exterior - Sujeitos ao fator r"), null);
  assert.equal(identificarAtividade("Prestação de Serviços para o exterior"), null);
  assert.equal(identificarAtividade("Prestação de serviços dos subitens 7.02 e 7.05 da lista anexa à LC 116/2003, para o exterior Anexo III"), null);
  assert.equal(identificarAtividade(""), null);
  assert.equal(identificarAtividade("qualquer coisa"), null);
});

test("lê o extrato (texto do extrato real de 09/2026, anonimizado): receita, atividade 30, débito, DAS e pagamento", () => {
  const e = lerExtrato(linhasDoExtrato({ pa: "2026-09", receita: 23_000 }).join("\n"));
  assert.equal(e.pa, "2026-09");
  assert.equal(e.apuracao, "original");
  assert.equal(e.numeroApuracao, "11222333202609001");
  assert.equal(e.receita, 23_000);
  assert.equal(e.receitaExterna, 23_000);
  assert.equal(e.rbt12, 352_998.85);
  assert.equal(e.fatorR, null);
  assert.deepEqual(e.atividades, [{ idAtividade: 30, descricao: "Prestação de Serviços para o exterior - Não sujeitos ao fator r e tributados pelo Anexo III", receita: 23_000, valor: 1000.76 }]);
  assert.equal(e.totalDebito, 1000.76);
  assert.deepEqual(e.das, { numero: "07202609000000000", vencimento: "2026-10-20", total: 1000.76 });
  assert.deepEqual(e.pagamento, { data: "2026-10-13", valor: 1000.76 });
  assert.deepEqual(e.receitasAnteriores, []); // sem o item 2.2 no exemplo
  assert.deepEqual(e.folhasAnteriores, []); // "Nenhuma"
});

test("lê o extrato do PDF (o mesmo leitor dos relatórios): fator r, retificadora e sem pagamento", () => {
  const e = lerExtrato(textoDoPdf(Buffer.from(pdfDoExtrato({ pa: "2026-12", receita: 30_000, atividade: ATIVIDADE_29, fatorR: 0.3112, retificadora: true, pago: null, numeroDas: "07202612999999999" }), "base64")));
  assert.equal(e.pa, "2026-12");
  assert.equal(e.apuracao, "retificadora");
  assert.equal(e.fatorR, 0.31);
  assert.equal(e.atividades[0].idAtividade, 29);
  assert.equal(e.das?.vencimento, "2027-01-20");
  assert.equal(e.das?.numero, "07202612999999999");
  assert.equal(e.pagamento, null);
});

test("extrato ilegível: tudo null e nenhuma atividade, sem lançar erro", () => {
  const e = lerExtrato("Página 1\nqualquer coisa");
  assert.deepEqual(e, {
    pa: null, apuracao: null, numeroApuracao: null, receita: null, receitaExterna: null, rbt12: null, fatorR: null,
    atividades: [], totalDebito: null, das: null, pagamento: null, receitasAnteriores: [], folhasAnteriores: [],
  });
});

const REAL = documentoReal("PGDASD-EXTRATO-07202627851592322.pdf");
test("caso real: extrato de 09/2026 da empresa de referência", { skip: !REAL && "PDF do ../fiscal não encontrado" }, () => {
  const e = lerExtrato(textoDoPdf(fs.readFileSync(REAL!)));
  assert.equal(e.pa, "2026-09");
  assert.equal(e.receita, 23_000);
  assert.equal(e.rbt12, 352_998.85);
  assert.equal(e.atividades.length, 1);
  assert.equal(e.atividades[0].idAtividade, 30);
  assert.equal(e.atividades[0].valor, 1000.76);
  assert.equal(e.totalDebito, 1000.76);
  assert.equal(e.das?.total, 1000.76);
  assert.equal(e.das?.vencimento, "2026-10-20");
  assert.deepEqual(e.pagamento, { data: "2026-10-13", valor: 1000.76 });
  // Item 2.2: de 01/2025 a 08/2026, só mercado externo; os 12 meses antes do PA somam a RBT12 do extrato.
  assert.equal(e.receitasAnteriores.length, 20);
  assert.deepEqual(e.receitasAnteriores[0], { mes: "2025-01", interno: 0, externo: 19_878.04 });
  assert.deepEqual(e.receitasAnteriores.at(-1), { mes: "2026-08", interno: 0, externo: 26_908.25 });
  const doze = e.receitasAnteriores.filter((r) => r.mes >= "2025-09").reduce((s, r) => s + r.externo, 0);
  assert.equal(Math.round(doze * 100) / 100, 352_998.85);
  assert.deepEqual(e.folhasAnteriores, []); // "Nenhuma": a atividade 30 não usa o Fator R
});

test("receitas e folhas anteriores do extrato (itens 2.2 e 2.3), como o extrato de uma atividade com Fator R", () => {
  const e = lerExtrato(linhasDoExtrato({
    pa: "2026-09",
    receita: 20_000,
    fatorR: 0.27,
    atividade: ATIVIDADE_29,
    anteriores: { "2026-07": 18_000.5, "2026-08": 21_000 },
    folhas: { "2026-07": 5_000, "2026-08": 5_400.25 },
  }).join("\n"));
  assert.deepEqual(e.receitasAnteriores, [
    { mes: "2026-07", interno: 0, externo: 18_000.5 },
    { mes: "2026-08", interno: 0, externo: 21_000 },
  ]);
  assert.deepEqual(e.folhasAnteriores, [
    { mes: "2026-07", valor: 5_000 },
    { mes: "2026-08", valor: 5_400.25 },
  ]);
  assert.equal(e.fatorR, 0.27);
});
