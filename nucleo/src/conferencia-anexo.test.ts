import { test } from "node:test";
import assert from "node:assert/strict";
import { lerRespostaCnpj } from "./brasilapi/cnpj.ts";
import { respostaGravada } from "./brasilapi/exemplos.ts";
import {
  anexoDaAtividadePgdasd,
  atividadesEsperadas,
  conferirAtividades,
  ehExportacao,
  nomeCurtoDaAtividade,
  regraDaAtividade,
} from "./conferencia-anexo.ts";
import { diagnosticar, type AtividadeDiagnosticada, type Diagnostico } from "./diagnostico.ts";

const atividade = (cnae: string, tributacao: AtividadeDiagnosticada["tributacao"], principal = true): AtividadeDiagnosticada => ({
  cnae,
  descricao: "",
  principal,
  tributacao,
  anexo: tributacao === "fator-r" ? "III ou V" : tributacao === "anexo-fixo" ? "III" : null,
  fundamento: "",
});
const so = (...a: AtividadeDiagnosticada[]): Pick<Diagnostico, "atividades" | "anexo"> => ({
  atividades: a,
  anexo: a.every((x) => x.anexo) ? (a.some((x) => x.tributacao === "fator-r") ? "III ou V" : "III") : null,
});
const DEV = so(atividade("6201501", "fator-r")); // desenvolvimento sob encomenda: Fator R
const SUPORTE = so(atividade("6209100", "anexo-fixo")); // suporte: Anexo III fixo
const MISTA = so(atividade("6201501", "fator-r"), atividade("6209100", "anexo-fixo", false));

test("regra e anexo de cada atividade do catálogo", () => {
  assert.equal(regraDaAtividade(29), "fator-r");
  assert.equal(regraDaAtividade(11), "fator-r");
  assert.equal(regraDaAtividade(30), "anexo-iii");
  assert.equal(regraDaAtividade(15), "anexo-iii");
  assert.equal(regraDaAtividade(31), "outra");
  assert.equal(anexoDaAtividadePgdasd(30), "III");
  assert.equal(anexoDaAtividadePgdasd(29), "III ou V");
  assert.equal(anexoDaAtividadePgdasd(29, 0.28), "III"); // 28% em diante: Anexo III
  assert.equal(anexoDaAtividadePgdasd(29, 0.2799), "V");
  assert.equal(anexoDaAtividadePgdasd(31), "IV");
  assert.equal(anexoDaAtividadePgdasd(1), "I");
  assert.equal(anexoDaAtividadePgdasd(5), "II");
  assert.equal(anexoDaAtividadePgdasd(42), "II");
  assert.equal(anexoDaAtividadePgdasd(15), "III");
  for (const id of [7, 9, 28, 19, 32, 25, 26, 27, 34, 39]) assert.equal(anexoDaAtividadePgdasd(id), "III", String(id));
  for (const id of [17, 22, 33]) assert.equal(anexoDaAtividadePgdasd(id), "IV", String(id));
  assert.equal(anexoDaAtividadePgdasd(99), null);
});

test("mercado de cada atividade: exportação x Brasil", () => {
  for (const id of [28, 29, 30, 31, 3, 6, 8, 43]) assert.equal(ehExportacao(id), true, String(id));
  for (const id of [1, 7, 10, 11, 12, 13, 14, 15, 17, 34]) assert.equal(ehExportacao(id), false, String(id));
  assert.equal(ehExportacao(999), false);
});

test("atividades esperadas pelo diagnóstico: a de exportação de cada CNAE; empresa não atendida não é conferida", () => {
  assert.deepEqual(atividadesEsperadas(DEV), [29]);
  assert.deepEqual(atividadesEsperadas(SUPORTE), [30]);
  assert.deepEqual(atividadesEsperadas(MISTA).sort(), [29, 30]);
  assert.deepEqual(atividadesEsperadas(so(atividade("4751201", "nao-atendido"))), []);
  // Diagnóstico de verdade (BrasilAPI gravada): 6201 principal com 6209 secundário.
  const d = diagnosticar(lerRespostaCnpj(respostaGravada("ti-fator-r")), "2026-10-16");
  assert.deepEqual(atividadesEsperadas(d).sort(), [29, 30]);
});

test("caso real: suporte (6209) declarado como atividade 30 confere", () => {
  assert.equal(conferirAtividades("2026-09", [30], SUPORTE), null);
  assert.equal(conferirAtividades("2026-09", [29], DEV), null);
});

test("receita lançada no mercado interno por quem só exporta: avisa e explica ISS, PIS e COFINS", () => {
  const d = conferirAtividades("2026-08", [14], SUPORTE);
  assert.equal(d?.esperada, 30);
  assert.equal(d!.texto, "Em 08/2026 a declaração usou serviço no Brasil, Anexo III fixo; pelo seu CNAE seria serviço para o exterior, Anexo III fixo.");
  const e = d!.explicacao.join(" ");
  assert.match(e, /ISS, PIS nem COFINS/);
  assert.doesNotMatch(e, /Anexo V/); // mesma regra: só o mercado está errado
  // Mesma regra no Brasil (11 -> 29), com retenção (12 -> 29), outro município (13 -> 30).
  assert.equal(conferirAtividades("2026-08", [11], DEV)?.esperada, 29);
  assert.equal(conferirAtividades("2026-08", [12], DEV)?.esperada, 29);
  assert.equal(conferirAtividades("2026-08", [13], SUPORTE)?.esperada, 30);
  // Mista: no Brasil, a de exportação da mesma regra (14 -> 30 mesmo com o principal no Fator R).
  assert.equal(conferirAtividades("2026-08", [14], MISTA)?.esperada, 30);
  assert.equal(conferirAtividades("2026-08", [11], MISTA)?.esperada, 29);
});

test("mercado e regra errados juntos (13 numa empresa de desenvolvimento): as duas explicações", () => {
  const d = conferirAtividades("2026-08", [13], DEV);
  assert.equal(d?.esperada, 29);
  const e = d!.explicacao.join(" ");
  assert.match(e, /ISS, PIS nem COFINS/);
  assert.match(e, /sempre pelo Anexo III/);
});

test("atividade de outro anexo: a explicação fala do anexo declarado", () => {
  const iv = conferirAtividades("2026-08", [31], DEV)!;
  assert.equal(iv.esperada, 29);
  const e = iv.explicacao.join(" ");
  assert.match(e, /tributado pelo Anexo IV/);
  assert.doesNotMatch(e, /sempre no Anexo III|sempre pelo Anexo III/);
  assert.doesNotMatch(e, /ISS, PIS nem COFINS/); // 31 já é exportação
  const ivBrasil = conferirAtividades("2026-08", [17], SUPORTE)!.explicacao.join(" ");
  assert.match(ivBrasil, /ISS, PIS nem COFINS/);
  assert.match(ivBrasil, /Anexo IV/);
  // Comércio: sem anexo de serviço no catálogo.
  const comercio = conferirAtividades("2026-08", [1], DEV)!;
  assert.equal(comercio.esperada, 29);
  assert.match(comercio.explicacao.join(" "), /revenda de mercadorias, não de prestação de serviço/);
  assert.match(comercio.explicacao.join(" "), /Anexo I, com ICMS/);
  assert.doesNotMatch(comercio.explicacao.join(" "), /como se o serviço fosse prestado no Brasil/);
});

test("desenvolvimento (6201, Fator R) declarado como 30: avisa com o mês, o que usou e o que seria", () => {
  const d = conferirAtividades("2026-09", [30], DEV);
  assert.ok(d);
  assert.equal(d.declarada, 30);
  assert.equal(d.esperada, 29);
  assert.equal(d.texto, "Em 09/2026 a declaração usou serviço para o exterior, Anexo III fixo; pelo seu CNAE seria serviço para o exterior, Anexo III ou V pelo Fator R.");
  assert.match(d.titulo, /09\/2026/);
  assert.ok(d.explicacao.some((t) => /retifique/i.test(t)));
  assert.ok(d.explicacao.some((t) => /Anexo V/.test(t)));
});

test("suporte (6209, Anexo III fixo) declarado como 29: avisa (pode cair no Anexo V)", () => {
  const d = conferirAtividades("2026-01", [29], SUPORTE);
  assert.equal(d?.esperada, 30);
  assert.match(d!.texto, /^Em 01\/2026 a declaração usou serviço para o exterior, Anexo III ou V pelo Fator R; pelo seu CNAE seria serviço para o exterior, Anexo III fixo\.$/);
});

test("bordas: CNAEs dos dois tipos aceitam as duas; atividade de outro anexo; não identificada; sem receita", () => {
  assert.equal(conferirAtividades("2026-09", [29], MISTA), null);
  assert.equal(conferirAtividades("2026-09", [30], MISTA), null);
  assert.equal(conferirAtividades("2026-09", [29, 30], MISTA), null);
  // Anexo IV numa empresa de TI mista: a do CNAE principal (6201, Fator R).
  assert.equal(conferirAtividades("2026-09", [31], MISTA)?.esperada, 29);
  // Atividade que o extrato não deixou identificar, ou código fora do catálogo: não acusa.
  assert.equal(conferirAtividades("2026-09", [null], DEV), null);
  assert.equal(conferirAtividades("2026-09", [999], DEV), null);
  // Mês sem receita (sem atividade declarada): nada a conferir.
  assert.equal(conferirAtividades("2026-09", [], DEV), null);
  // Empresa não atendida: não conferimos.
  assert.equal(conferirAtividades("2026-09", [30], so(atividade("4751201", "nao-atendido"))), null);
  // Duas atividades no mês, a segunda errada: acusa a errada.
  assert.equal(conferirAtividades("2026-09", [29, 30], DEV)?.declarada, 30);
});

test("nomes curtos para a tela", () => {
  assert.equal(nomeCurtoDaAtividade(30), "serviço para o exterior, Anexo III fixo");
  assert.equal(nomeCurtoDaAtividade(11), "serviço no Brasil, Anexo III ou V pelo Fator R");
  assert.match(nomeCurtoDaAtividade(31), /Anexo IV/);
});

test("atividade de outra natureza no mesmo Anexo III (construção, contábil, transporte): explica a regra própria, não um anexo diferente", () => {
  // 32 (construção civil Anexo III, exterior) numa empresa de suporte (Anexo III fixo).
  const cc = conferirAtividades("2026-08", [32], SUPORTE)!;
  assert.equal(cc.esperada, 30);
  const tcc = cc.explicacao.join(" ");
  assert.match(tcc, /construção civil/);
  assert.match(tcc, /mesmo Anexo III da empresa/);
  assert.doesNotMatch(tcc, /que não é o das atividades da empresa/);
  assert.doesNotMatch(tcc, /ISS, PIS nem COFINS/); // já é exportação
  // 28 (escritório contábil, exterior): serviço do Anexo III com ISS fixo.
  const contabil = conferirAtividades("2026-08", [28], SUPORTE)!.explicacao.join(" ");
  assert.match(contabil, /escritório de serviços contábeis/);
  assert.match(contabil, /mesmo Anexo III/);
  assert.doesNotMatch(contabil, /não é de prestação de serviço|não de prestação de serviço/);
  // 26 (transporte coletivo municipal): serviço no Brasil, Anexo III.
  const transporte = conferirAtividades("2026-08", [26], SUPORTE)!.explicacao.join(" ");
  assert.match(transporte, /mercado interno, como transporte coletivo municipal de passageiros no Brasil/);
  assert.match(transporte, /ISS, PIS nem COFINS/);
  assert.match(transporte, /mesmo Anexo III/);
  assert.doesNotMatch(transporte, /não é de prestação de serviço|não de prestação de serviço/);
});

test("atividade do Anexo III sem Fator R numa empresa de desenvolvimento: explica que pode ser o Anexo V", () => {
  const t = conferirAtividades("2026-08", [32], DEV)!.explicacao.join(" ");
  assert.match(t, /construção civil/);
  assert.match(t, /sempre pelo Anexo III, sem o Fator R/);
  assert.match(t, /Anexo V/);
  const comunicacao = conferirAtividades("2026-08", [34], DEV)!.explicacao.join(" ");
  assert.match(comunicacao, /ICMS no lugar do ISS/);
  assert.match(comunicacao, /mercado interno/);
});

test("construção civil do Anexo IV: anexo diferente, com o certo de cada empresa", () => {
  const s = conferirAtividades("2026-08", [33], SUPORTE)!.explicacao.join(" ");
  assert.match(s, /tributado pelo Anexo IV, que não é o das atividades da empresa \(o certo é o Anexo III\)/);
  const d = conferirAtividades("2026-08", [22], DEV)!.explicacao.join(" ");
  assert.match(d, /Anexo IV.+o certo é o Anexo III ou o V, conforme o Fator R/);
  assert.match(d, /mercado interno/);
});

test("industrialização com IPI e ISS (40 a 43): regra própria do Anexo II com ISS no lugar do ICMS, não venda de mercadoria", () => {
  // LC 123/2006, art. 18, § 4º, VI; Resolução CGSN 140/2018, art. 25, § 1º, VII.
  for (const id of [40, 41, 42, 43]) {
    for (const [diag, certo] of [[SUPORTE, "o Anexo III"], [DEV, "o Anexo III ou o V, conforme o Fator R"]] as const) {
      const t = conferirAtividades("2026-08", [id], diag)!.explicacao.join(" ");
      assert.match(t, /Essa atividade é de industrialização com IPI e ISS ao mesmo tempo, tributada pelo Anexo II, com o ISS no lugar do ICMS\./, `${id}: ${t}`);
      assert.ok(t.includes(`Não é a atividade da empresa (o certo é ${certo})`), `${id}: ${t}`);
      assert.doesNotMatch(t, /não de prestação de serviço/, `${id}: ${t}`);
      assert.doesNotMatch(t, /venda de mercadoria/, `${id}: ${t}`);
      if (id === 43) assert.doesNotMatch(t, /mercado interno/, `${id}: ${t}`);
      else {
        assert.match(t, /mercado interno, como industrialização com IPI e ISS ao mesmo tempo no Brasil/, `${id}: ${t}`);
        assert.match(t, /ISS, PIS nem COFINS/, `${id}: ${t}`);
      }
    }
  }
});

test("revenda e indústria: texto de mercadoria (anexo I ou II), nunca 'serviço prestado no Brasil'", () => {
  for (const [id, anexo, tributos] of [[1, "I", "com ICMS"], [2, "I", "com ICMS"], [4, "II", "com ICMS"], [5, "II", "com ICMS"]] as const) {
    const t = conferirAtividades("2026-08", [id], SUPORTE)!.explicacao.join(" ");
    assert.match(t, new RegExp(`venda de mercadoria \\(Anexo ${anexo}, ${tributos}\\)`), `${id}: ${t}`);
    assert.doesNotMatch(t, /como se o serviço fosse prestado no Brasil|serviço no Brasil/, `${id}: ${t}`);
  }
  // Revenda para o exterior: mercadoria, sem ICMS.
  const exterior = conferirAtividades("2026-08", [3], DEV)!.explicacao.join(" ");
  assert.match(exterior, /venda de mercadoria \(Anexo I\)/);
  assert.doesNotMatch(exterior, /mercado interno/);
});
