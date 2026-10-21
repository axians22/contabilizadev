// Histórico e conferência no desenho do ../fiscal (app/historico/page.tsx): a conferência mês a mês (lib/historico/
// conferencia.ts) e a tela renderizada (HTML do servidor, como o navegador recebe) nos estados principais: meses pagos, em
// aberto e vencidos, divergência do CNAE com a atividade declarada, sem importação, pró-labore e INSS abertos. Confere as
// colunas e a ordem do ../fiscal, as explicações só no tooltip e nada do fornecedor na tela.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { regraDoCnae } from "@contabilizadev/nucleo/cnae";
import { TelaDoHistorico, type DadosDaTela } from "@/app/(painel)/historico/tela-historico";
import { conferenciaDoHistorico } from "@/lib/historico/conferencia";
import type { MesDoHistorico } from "@/lib/historico/leitura";
import { explicacoes, paragrafosVisiveis, semExplicacoes, texto } from "./tela";

const APP = path.join(import.meta.dirname, "..", "app", "(painel)");
const FORNECEDOR = /serpro|integra\s*contador|brasil\s*api|PGDASD\b|SITFIS|PAGTOWEB|CONS[A-Z]+\d{2}/i;
const visivel = (html: string) => texto(semExplicacoes(html));

// O caso real de referência: 09/2026, receita 23.000, RBT12 352.998,85, Anexo III, DAS 1.000,76; pró-labore 1.621.
const RECEITAS: Record<string, number> = {
  "2025-09": 25_228.39, "2025-10": 19_224.3, "2025-11": 27_350.21, "2025-12": 24_655.48, "2026-01": 21_869.17, "2026-02": 25_798.12,
  "2026-03": 37_582, "2026-04": 24_985.4, "2026-05": 45_494.12, "2026-06": 47_400, "2026-07": 26_503.41, "2026-08": 26_908.25,
  "2026-09": 23_000,
};
const EMPRESA = { regra: regraDoCnae("6209100"), inicioAtividade: undefined };

const mes = (pa: string, extra: Partial<MesDoHistorico> = {}): MesDoHistorico => ({
  pa,
  situacao: "pago",
  declaracao: { numero: `0000000${pa.replace("-", "")}001`, tipo: "original", transmitidaEm: null, malha: null },
  receita: RECEITAS[pa] ?? null,
  valorDas: null,
  das: null,
  vencimento: `${pa}-20`,
  pagoEm: null,
  extrato: { id: `00000000-0000-0000-0000-0000000${pa.replace("-", "")}`, origem: "extrato", daDeclaracaoVigente: true, atividades: [16], fatorR: null },
  divergencia: null,
  ...extra,
});

const MESES: MesDoHistorico[] = [
  mes("2026-07", { valorDas: 1_200, situacao: "pago", pagoEm: "2026-08-18" }),
  mes("2026-08", { valorDas: 1_100, situacao: "vencido" }),
  mes("2026-09", { valorDas: 1_000.76, situacao: "em-aberto", vencimento: "2026-10-20" }),
];
const VALORES = {
  // Com 07 e 08/2025, os 12 meses anteriores de julho e agosto de 2026 também ficam completos.
  receitas: { "2025-07": 20_000, "2025-08": 20_000, ...RECEITAS },
  fontesReceita: Object.fromEntries(Object.keys(RECEITAS).map((m) => [m, "declarada" as const])),
  folhas: { "2026-09": 1_621 },
  fontesFolha: { "2026-09": "informada" as const },
};

const tela = (dados: Partial<DadosDaTela> = {}, meses = MESES) =>
  renderToStaticMarkup(
    createElement(TelaDoHistorico, {
      dados: { linhas: conferenciaDoHistorico(meses, VALORES, EMPRESA), mostrarProLabore: false, importado: true, autorizada: true, ...dados },
    }),
  );

// A tabela única desenha cada célula duas vezes (tabela no computador, cartões no celular): os rótulos repetidos que
// importam são os de fora dela.
const semTabela = (html: string) => html.replace(/<table[\s\S]*?<\/table>/, "").replace(/<ul[^>]*aria-label="Histórico mensal"[\s\S]*?<\/ul>/, "");

function conferir(html: string) {
  assert.doesNotMatch(texto(html), FORNECEDOR);
  const rotulos = explicacoes(semTabela(html)).map((e) => e.rotulo);
  assert.equal(new Set(rotulos).size, rotulos.length, `rótulos repetidos: ${rotulos.join(" | ")}`);
  for (const p of paragrafosVisiveis(html)) assert.ok(p.length <= 140, `parágrafo longo aberto na tela: ${p}`);
}

// Os títulos das colunas da tabela do computador, na ordem.
const titulos = (html: string) => [...(/<thead>([\s\S]*?)<\/thead>/.exec(html)?.[1] ?? "").matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => texto(m[1]).trim());
// A linha da tabela do computador de um mês (pelo rótulo).
const linhaDe = (html: string, rotulo: string) => {
  const corpo = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
  return visivel([...corpo.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]).find((tr) => tr.includes(`>${rotulo}<`)) ?? "").trim();
};

describe("conferência do histórico (lib/historico/conferencia.ts)", () => {
  it("caso real: 09/2026 com RBT12 de R$ 352.998,85, alíquota de 4,35% e DAS calculado igual ao emitido", () => {
    const [, , set] = conferenciaDoHistorico(MESES, VALORES, EMPRESA);
    assert.equal(set.receitaTotal, 23_000);
    assert.equal(set.fonteReceita, "declarada");
    assert.equal(set.rbt12, 352_998.85);
    assert.equal(set.rbt12Incompleta, false);
    assert.equal(Math.round(set.aliquotaPaga! * 10_000) / 100, 4.35);
    assert.equal(set.dasCalculado, 1000.76);
    assert.equal(set.diferenca, 0);
    assert.equal(set.prolabore, 1_621);
    assert.equal(set.fonteProlabore, "informada");
    assert.equal(set.inss, 178.31);
  });

  it("receita lançada aqui (sem declaração) entra no cálculo; mês sem receita: alíquota sim, DAS calculado não", () => {
    const valores = { ...VALORES, receitas: { ...VALORES.receitas, "2026-09": 20_000 }, fontesReceita: { ...VALORES.fontesReceita, "2026-09": "lancada" as const } };
    const [l] = conferenciaDoHistorico([mes("2026-09", { receita: null, declaracao: null, situacao: "no-prazo" })], valores, EMPRESA);
    assert.equal(l.receitaTotal, 20_000);
    assert.equal(l.fonteReceita, "lancada");
    assert.ok(l.dasCalculado! > 0);
    assert.equal(l.diferenca, null); // sem DAS emitido, sem diferença
    const semReceita = { ...VALORES, receitas: Object.fromEntries(Object.entries(VALORES.receitas).filter(([m]) => m !== "2026-09")) };
    const [s] = conferenciaDoHistorico([mes("2026-09", { receita: null })], semReceita, EMPRESA);
    assert.equal(s.receitaTotal, null);
    assert.equal(s.dasCalculado, null);
    assert.ok(s.aliquotaPaga !== null);
  });

  it("meses sem receita entre os 12 anteriores marcam a RBT12 incompleta; empresa fora do escopo: sem cálculo", () => {
    const receitas = { ...VALORES.receitas } as Record<string, number>;
    delete receitas["2025-10"];
    const [l] = conferenciaDoHistorico([mes("2026-09")], { ...VALORES, receitas }, EMPRESA);
    assert.equal(l.rbt12Incompleta, true);
    const [fora] = conferenciaDoHistorico([mes("2026-09", { valorDas: 1000.76 })], VALORES, { regra: null, inicioAtividade: undefined });
    assert.equal(fora.rbt12, null);
    assert.equal(fora.aliquotaPaga, null);
    assert.equal(fora.dasCalculado, null);
    assert.equal(fora.diferenca, null);
    // Mês antes do início de atividade: sem cálculo, sem erro.
    const [antes] = conferenciaDoHistorico([mes("2026-09")], VALORES, { ...EMPRESA, inicioAtividade: "2026-10" });
    assert.equal(antes.dasCalculado, null);
  });
});

describe("tela do histórico: o desenho do ../fiscal", () => {
  it("título, botão do pró-labore, tabela densa com as colunas do ../fiscal (mais situação e extrato), do mais recente ao mais antigo", () => {
    const html = tela();
    conferir(html);
    const t = visivel(html);
    assert.match(t, /^\s*Últimos 12 meses Histórico e conferência/);
    assert.match(html, /href="\/historico\?prolabore=1"[^>]*>\+ Mostrar pró-labore e INSS</);
    assert.deepEqual(titulos(html), ["Mês", "Receita declarada", "Receita total", "12 meses anteriores", "Alíquota paga", "DAS calculado", "DAS emitido", "Diferença", "Situação", "Extrato"]);
    assert.match(html, /aria-label="Histórico mensal"/);
    const ordem = ["Setembro de 2026", "Agosto de 2026", "Julho de 2026"].map((r) => html.indexOf(`>${r.toLowerCase()}<`));
    assert.ok(ordem.every((i, n) => i > 0 && (n === 0 || i > ordem[n - 1])), `ordem: ${ordem}`);
    // As explicações abertas do ../fiscal (Nota) ficam no tooltip.
    assert.ok(explicacoes(html).some((e) => e.rotulo === "O que aparece no Histórico?" && /A diferença mostra se o cálculo bate/.test(e.texto)));
    assert.doesNotMatch(t, /A diferença mostra se o cálculo bate/);
  });

  it("meses pagos, em aberto e vencidos: pílula de cada situação, data do pagamento, diferença em verde ou vermelho e o PDF", () => {
    const html = tela();
    assert.match(linhaDe(html, "setembro de 2026"), /setembro de 2026 R\$\s23\.000,00 R\$\s23\.000,00 R\$\s352\.998,85 4,35% R\$\s1\.000,76 R\$\s1\.000,76 R\$\s0,00 Em aberto PDF/);
    assert.match(linhaDe(html, "agosto de 2026"), /agosto de 2026 R\$\s26\.908,25 .* R\$\s1\.100,00 R\$\s-?[\d.,]+ Vencido PDF/);
    assert.match(linhaDe(html, "julho de 2026"), /julho de 2026 .* Pago em 18\/08\/2026 PDF/);
    assert.match(html, /bg-accent text-on-accent[^"]*">Pago</);
    assert.match(html, /bg-warn-soft text-warn[^"]*">Em aberto</);
    assert.match(html, /bg-bad\/15 text-bad[^"]*">Vencido</);
    assert.match(html, /<span class="text-accent-ink">R\$\s0,00<\/span>/);
    assert.match(html, /<span class="text-bad">R\$\s-?[\d.,]+<\/span>/);
    assert.match(html, /href="\/documentos\/extrato\/00000000-0000-0000-0000-0000000202609"[^>]*>PDF</);
    assert.ok(explicacoes(html).some((e) => e.rotulo === 'O que quer dizer "Vencido" em agosto de 2026?'));
    assert.doesNotMatch(html, /Atividade não bate/);
    assert.doesNotMatch(visivel(html), /Faltam receitas/);
  });

  it("divergência do CNAE: o aviso com o caminho de retificar e a marca no mês (linha em destaque de alerta)", () => {
    const divergencia = { pa: "2026-08", declarada: 17, esperada: 16, titulo: "Atividade declarada diferente do CNAE", texto: "Em 08/2026 a declaração usou outra atividade.", explicacao: ["Retifique a declaração no portal."] };
    const html = tela({}, [MESES[0], { ...MESES[1], divergencia }, MESES[2]]);
    conferir(html);
    const t = visivel(html);
    assert.match(t, /Atividade declarada diferente do CNAE Em 08\/2026 a declaração usou outra atividade\. Retificar no Portal do Simples Nacional ↗/);
    assert.match(linhaDe(html, "agosto de 2026"), /agosto de 2026 Atividade não bate com o CNAE/);
    assert.match(html, /<tr class="[^"]*bg-bad\/5/); // tom de alerta, nunca o verde de "tudo certo"
    assert.doesNotMatch(html, /bg-accent\/10/);
    assert.ok(t.indexOf("Atividade declarada diferente") < t.indexOf("Mostrar pró-labore")); // o aviso antes da tabela
  });

  it("pró-labore e INSS abertos: as duas colunas a mais, a fonte do pró-labore e o botão de ocultar", () => {
    const html = tela({ mostrarProLabore: true });
    conferir(html);
    assert.deepEqual(titulos(html).slice(-2), ["Pró-labore", "INSS (DARF)"]);
    assert.match(html, /href="\/historico"[^>]*>− Ocultar pró-labore e INSS</);
    assert.match(linhaDe(html, "setembro de 2026"), /R\$\s1\.621,00 informado aqui R\$\s178,31$/);
    assert.match(html, /px-1\.5! text-xs/); // colunas menores para caber, como no ../fiscal
  });

  it("asterisco: RBT12 incompleta marcada com * e a nota curta com o porquê no tooltip", () => {
    const receitas = { ...VALORES.receitas } as Record<string, number>;
    delete receitas["2025-10"];
    const html = renderToStaticMarkup(
      createElement(TelaDoHistorico, { dados: { linhas: conferenciaDoHistorico(MESES, { ...VALORES, receitas }, EMPRESA), mostrarProLabore: false, importado: true, autorizada: true } }),
    );
    conferir(html);
    assert.match(linhaDe(html, "setembro de 2026"), /R\$\s[\d.,]+ \*/);
    assert.match(visivel(html), /\* Faltam receitas nos 12 meses anteriores\./);
    assert.ok(explicacoes(html).some((e) => /alíquota desse mês está subestimada/.test(e.texto)));
  });

  it("sem importação e sem autorização: sem tabela, o estado vazio curto; autorizada (importando): a tabela com 'Não importado'", () => {
    const naoImportado = MESES.map((m) => ({ ...m, situacao: "nao-importado" as const, declaracao: null, receita: null, valorDas: null, extrato: null, pagoEm: null }));
    const vazio = { receitas: {}, fontesReceita: {}, folhas: {}, fontesFolha: {} };
    const sem = renderToStaticMarkup(
      createElement(TelaDoHistorico, { dados: { linhas: conferenciaDoHistorico(naoImportado, vazio, EMPRESA), mostrarProLabore: false, importado: false, autorizada: false } }),
    );
    conferir(sem);
    assert.match(visivel(sem), /Histórico e conferência Nada importado ainda\./);
    assert.doesNotMatch(sem, /<table/);
    assert.doesNotMatch(sem, /Mostrar pró-labore/);
    const importando = renderToStaticMarkup(
      createElement(TelaDoHistorico, { dados: { linhas: conferenciaDoHistorico(naoImportado, vazio, EMPRESA), mostrarProLabore: false, importado: false, autorizada: true } }),
    );
    assert.match(importando, /<table/);
    assert.match(linhaDe(importando, "setembro de 2026"), /setembro de 2026 — — R\$\s[\d.,]+ \* [\d,]+% — — — Não importado —/);
  });

  it("as partes do servidor ficam no lugar: Atualizar ao lado do título, modo guiado antes da tabela, gráficos e rodapé depois", () => {
    const html = renderToStaticMarkup(
      createElement(TelaDoHistorico, {
        dados: { linhas: conferenciaDoHistorico(MESES, VALORES, EMPRESA), mostrarProLabore: false, importado: true, autorizada: true },
        atualizar: createElement("button", { id: "atualizar" }),
        antes: createElement("div", { id: "antes" }),
        depois: createElement("div", { id: "depois" }),
      }),
    );
    const pos = ['id="atualizar"', 'id="antes"', "<table", 'id="depois"'].map((s) => html.indexOf(s));
    assert.ok(pos.every((i, n) => i > 0 && (n === 0 || i > pos[n - 1])), `ordem: ${pos}`);
  });
});

describe("página do histórico", () => {
  it("portão antes de ler dados, ?prolabore=1, conferência com a empresa ativa e nada fixo de empresa", () => {
    const pagina = readFileSync(path.join(APP, "historico", "page.tsx"), "utf8");
    assert.ok(pagina.indexOf("<PortaoFechado") < pagina.indexOf("historicoDaEmpresa("));
    assert.match(pagina, /\(await searchParams\)\.prolabore === "1"/);
    assert.match(pagina, /conferenciaDoHistorico\(meses, valores, daRotina\)/);
    assert.match(pagina, /<TelaDoHistorico/);
    assert.doesNotMatch(pagina, /\d{14}|43079489/);
  });
});
