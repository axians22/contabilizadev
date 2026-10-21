import { test } from "node:test";
import assert from "node:assert/strict";
import { lerRespostaCnpj, type DadosCnpj } from "./brasilapi/cnpj.ts";
import { respostaGravada, type Exemplo } from "./brasilapi/exemplos.ts";
import { completarDiagnostico, diagnosticar } from "./diagnostico.ts";

const HOJE = "2026-10-16";
const dados = (nome: Exemplo, mudar: (d: DadosCnpj) => void = () => {}) => {
  const d = lerRespostaCnpj(respostaGravada(nome));
  mudar(d);
  return d;
};

test("TI com desenvolvimento e consultoria: atendida, Anexo III ou V pelo Fator R, com a explicação", () => {
  const d = diagnosticar(dados("ti-fator-r"), HOJE);
  assert.equal(d.atendido, true);
  assert.deepEqual(d.impedimentos.map((n) => n.detalhe), []);
  assert.equal(d.anexo, "III ou V");
  assert.equal(d.dependeFatorR, true);
  assert.deepEqual(
    d.atividades.map((a) => [a.cnae, a.principal, a.tributacao, a.anexo]),
    [
      ["6201501", true, "fator-r", "III ou V"],
      ["6202300", false, "fator-r", "III ou V"],
      ["6204000", false, "fator-r", "III ou V"],
      ["6209100", false, "anexo-fixo", "III"],
    ],
  );
  // Mistura de Anexo III fixo com Fator R: aviso, não impedimento.
  assert.equal(d.observacoes.map((n) => n.detalhe).length, 1);
  assert.match(d.observacoes.map((n) => n.detalhe)[0], /cada receita é declarada na atividade/);
});

test("só suporte (6209-1/00): Anexo III fixo, sem Fator R", () => {
  const d = diagnosticar(dados("ti-anexo-iii"), HOJE);
  assert.equal(d.atendido, true);
  assert.equal(d.anexo, "III");
  assert.equal(d.dependeFatorR, false);
  assert.equal(d.dependeFatorR, false);
  assert.deepEqual(d.observacoes.map((n) => n.detalhe), []);
  assert.equal(d.atividades.length, 1);
});

test("CNPJ alfanumérico com hospedagem (6311-9/00): Anexo III fixo", () => {
  const dadosAlfa = dados("alfanumerico");
  assert.equal(dadosAlfa.cnpj, "12ABC34501DE35");
  const d = diagnosticar(dadosAlfa, HOJE);
  assert.equal(d.atendido, true);
  assert.equal(d.anexo, "III");
  assert.equal(d.dependeFatorR, false);
  assert.equal(d.dependeFatorR, false);
  assert.deepEqual(
    d.atividades.map((a) => [a.cnae, a.principal, a.tributacao, a.anexo]),
    [["6311900", true, "anexo-fixo", "III"]],
  );
});

test("CNAE secundário fora do escopo: ainda não atendemos, com o CNAE e o motivo (inclusive 7490-1/04)", () => {
  const d = diagnosticar(dados("fora-do-escopo"), HOJE);
  assert.equal(d.atendido, false);
  assert.equal(d.impedimentos.map((n) => n.detalhe).length, 2);
  assert.match(d.impedimentos.map((n) => n.detalhe)[0], /^CNAE 4751-2\/01 \(Comércio varejista.*\) não é atendido: Fora dos CNAEs de TI/);
  assert.match(d.impedimentos.map((n) => n.detalhe)[1], /^CNAE 7490-1\/04 .*Intermediação de negócios .*V, s\) não é atividade de TI/);
  // Sem a tributação de todas as atividades (4751-2/01 é Anexo I), a empresa fica sem anexo e sem Fator R.
  assert.equal(d.anexo, null);
  assert.equal(d.dependeFatorR, false);
  assert.equal(d.dependeFatorR, false);
  assert.deepEqual(d.observacoes.map((n) => n.detalhe), []);
  // Cada CNAE de TI segue com a sua tributação, como referência.
  assert.equal(d.atividades.find((a) => a.cnae === "6204000")!.anexo, "III ou V");
  assert.equal(d.atividades.find((a) => a.cnae === "4751201")!.anexo, null);
});

// Um CNAE fora do escopo tira o anexo da empresa, seja o principal ou só um secundário (e com Simples ativo).
test("CNAE fora do escopo, principal ou só secundário, numa empresa do Simples: sem anexo da empresa", () => {
  const casos: [string, DadosCnpj][] = [
    [
      "principal",
      dados("ti-fator-r", (x) => {
        x.cnaePrincipal = { codigo: "4751201", descricao: "Comércio varejista especializado de equipamentos e suprimentos de informática" };
      }),
    ],
    ["secundário", dados("ti-fator-r", (x) => x.cnaesSecundarios.push({ codigo: "4751201", descricao: "Comércio varejista" }))],
    ["secundário com Anexo III fixo", dados("ti-anexo-iii", (x) => x.cnaesSecundarios.push({ codigo: "4751201", descricao: "Comércio varejista" }))],
  ];
  for (const [nome, d] of casos) {
    const diag = diagnosticar(d, HOJE);
    assert.equal(diag.atendido, false, nome);
    assert.equal(diag.impedimentos.map((n) => n.detalhe).length, 1, nome);
    assert.match(diag.impedimentos.map((n) => n.detalhe)[0], nome === "principal" ? /^CNAE 4751-2\/01 .*, o principal, não é atendido/ : /^CNAE 4751-2\/01 \(Comércio varejista\) não é atendido/, nome);
    assert.equal(diag.anexo, null, nome);
    assert.equal(diag.dependeFatorR, false, nome);
    assert.equal(diag.dependeFatorR, false, nome);
    assert.deepEqual(diag.observacoes.map((n) => n.detalhe), [], nome);
    assert.ok(diag.atividades.some((a) => a.anexo !== null), nome);
  }
});

test("CNAE principal fora do escopo é marcado como o principal", () => {
  const d = diagnosticar(dados("banco-do-brasil"), HOJE);
  assert.equal(d.atendido, false);
  assert.ok(d.impedimentos.map((n) => n.detalhe).some((m) => /^CNAE 6422-1\/00 .*, o principal, não é atendido/.test(m)));
  assert.equal(d.anexo, null);
  assert.equal(d.dependeFatorR, false);
});

test("Banco do Brasil (resposta real): não optante, natureza não atendida e CNAEs fora; MEI excluído não conta", () => {
  const d = diagnosticar(dados("banco-do-brasil"), HOJE);
  assert.ok(d.impedimentos.map((n) => n.detalhe).some((m) => m === "A empresa não é optante do Simples Nacional (excluída em 01/07/2007). Atendemos só empresas do Simples."));
  assert.ok(d.impedimentos.map((n) => n.detalhe).some((m) => /Natureza jurídica Sociedade de Economia Mista \(203-8\) não é atendida/.test(m)));
  assert.ok(!d.impedimentos.map((n) => n.detalhe).some((m) => /MEI/.test(m)));
});

test("MEI: ainda não atendemos (SIMEI)", () => {
  const d = diagnosticar(dados("mei"), HOJE);
  assert.equal(d.atendido, false);
  assert.deepEqual(d.impedimentos.map((n) => n.detalhe), ["A empresa é MEI: o imposto é o valor fixo mensal do SIMEI (DAS-MEI), que esta plataforma ainda não atende."]);
  // Ex-MEI (exclusão já valendo) com Simples: atendida.
  const exMei = diagnosticar(dados("mei", (x) => (x.mei.dataExclusao = "2025-12-31")), HOJE);
  assert.equal(exMei.atendido, true);
});

test("CNPJ baixado e fora do Simples: os dois motivos", () => {
  const d = diagnosticar(dados("baixada"), HOJE);
  assert.equal(d.atendido, false);
  assert.deepEqual(d.impedimentos.map((n) => n.detalhe), [
    "A situação do CNPJ na Receita é BAIXADA. Só atendemos empresa com CNPJ ativo.",
    "A empresa não é optante do Simples Nacional (excluída em 30/04/2025). Atendemos só empresas do Simples.",
  ]);
  for (const situacao of ["INAPTA", "SUSPENSA", "NULA"]) {
    assert.match(diagnosticar(dados("ti-fator-r", (x) => (x.situacaoCadastral = situacao)), HOJE).impedimentos[0].detalhe, new RegExp(situacao));
  }
});

test("Simples: sem informação não atende; exclusão futura é aviso; exclusão hoje já vale", () => {
  const semInfo = diagnosticar(dados("ti-fator-r", (x) => (x.simples = { optante: null, dataOpcao: null, dataExclusao: null })), HOJE);
  assert.deepEqual(semInfo.impedimentos.map((n) => n.detalhe), ["A Receita não informa se a empresa é optante do Simples Nacional. Atendemos só empresas do Simples."]);

  const futura = diagnosticar(dados("ti-anexo-iii", (x) => (x.simples.dataExclusao = "2027-01-01")), HOJE);
  assert.equal(futura.atendido, true);
  assert.deepEqual(futura.observacoes.map((n) => n.detalhe), ["A Receita registra a exclusão do Simples Nacional a partir de 01/01/2027."]);

  const hoje = diagnosticar(dados("ti-anexo-iii", (x) => (x.simples.dataExclusao = HOJE)), HOJE);
  assert.equal(hoje.atendido, false);
  assert.match(hoje.impedimentos.map((n) => n.detalhe)[0], /não é optante .*excluída em 16\/10\/2026/);
});

test("natureza jurídica: atendidas, impedidas por lei e fora desta versão", () => {
  for (const codigo of ["2062", "2135", "2232", "2240", "2305", "2313"]) {
    assert.equal(diagnosticar(dados("ti-anexo-iii", (x) => (x.naturezaJuridica.codigo = codigo)), HOJE).atendido, true, codigo);
  }
  const sa = diagnosticar(dados("ti-anexo-iii", (x) => (x.naturezaJuridica = { codigo: "2054", descricao: "Sociedade Anônima Fechada" })), HOJE);
  assert.deepEqual(sa.impedimentos.map((n) => n.detalhe), ["Natureza jurídica Sociedade Anônima Fechada (205-4): sociedade por ações não pode optar pelo Simples (LC 123/2006, art. 3º, § 4º, X)."]);
  const coop = diagnosticar(dados("ti-anexo-iii", (x) => (x.naturezaJuridica = { codigo: "2143", descricao: "Cooperativa" })), HOJE);
  assert.match(coop.impedimentos.map((n) => n.detalhe)[0], /cooperativa .*art\. 3º, § 4º, VI/);
  const vazia = diagnosticar(dados("ti-anexo-iii", (x) => (x.naturezaJuridica = { codigo: "", descricao: "" })), HOJE);
  assert.match(vazia.impedimentos.map((n) => n.detalhe)[0], /^Natureza jurídica não informada não é atendida/);
});

test("data inválida é recusada", () => {
  assert.throws(() => diagnosticar(dados("ti-fator-r"), "16/10/2026"), /Data inválida/);
});

// MEI e quem está fora do Simples não são tributados por anexo: o diagnóstico não dá anexo nem fala de Fator R, mas
// as atividades seguem com a tributação de cada CNAE no Simples, como referência.
test("Fora do Simples ou MEI: sem anexo, sem Fator R e sem aviso de atividades mistas; atividades ficam de referência", () => {
  const casos: [string, DadosCnpj][] = [
    ["MEI", dados("mei")],
    ["não optante", dados("ti-fator-r", (x) => (x.simples = { optante: false, dataOpcao: null, dataExclusao: null }))],
    ["excluída hoje", dados("ti-fator-r", (x) => (x.simples.dataExclusao = HOJE))],
    ["sem informação", dados("ti-fator-r", (x) => (x.simples = { optante: null, dataOpcao: null, dataExclusao: null }))],
  ];
  for (const [nome, d] of casos) {
    const diag = diagnosticar(d, HOJE);
    assert.equal(diag.atendido, false, nome);
    assert.equal(diag.anexo, null, nome);
    assert.equal(diag.dependeFatorR, false, nome);
    assert.equal(diag.dependeFatorR, false, nome);
    assert.ok(!diag.observacoes.map((n) => n.detalhe).some((a) => /Fator R/.test(a)), nome);
    assert.ok(diag.atividades.some((a) => a.tributacao === "fator-r" && a.anexo === "III ou V"), nome);
  }
  // Ex-MEI no Simples e optante com exclusão futura continuam com anexo.
  assert.equal(diagnosticar(dados("mei", (x) => (x.mei.dataExclusao = "2025-12-31")), HOJE).anexo !== null, true);
  const futura = diagnosticar(dados("ti-fator-r", (x) => (x.simples.dataExclusao = "2027-01-01")), HOJE);
  assert.equal(futura.anexo, "III ou V");
  assert.equal(futura.dependeFatorR, true);
});

test("cada motivo e aviso tem a versão curta (tela) e o texto completo (tooltip)", () => {
  for (const ex of ["banco-do-brasil", "fora-do-escopo", "mei", "baixada", "ti-fator-r", "ti-anexo-iii", "alfanumerico"] as const) {
    const d = diagnosticar(dados(ex), HOJE);
    const perguntas = [...d.impedimentos, ...d.observacoes].map((n) => n.pergunta);
    assert.equal(new Set(perguntas).size, perguntas.length, `${ex}: perguntas repetidas`);
    for (const n of [...d.impedimentos, ...d.observacoes]) {
      assert.match(n.pergunta, /^(Por que|O que|Como|Qual)\b.*\?$/, n.pergunta);
      assert.ok(n.curto.length <= 100, `${ex}: curto longo (${n.curto.length}): ${n.curto}`);
      assert.doesNotMatch(n.curto, /CGSN|LC 123|art\.|§|6201, 6202/, `${ex}: lei ou lista de códigos no curto: ${n.curto}`);
    }
  }
  const bb = diagnosticar(dados("banco-do-brasil"), HOJE);
  assert.ok(bb.impedimentos.some((n) => n.curto === "Tipo de empresa não atendido: Sociedade de Economia Mista."));
  assert.ok(bb.impedimentos.some((n) => n.curto === "Atividade 6422-1/00 (a principal) fora das atividades de TI atendidas."));
  const fora = diagnosticar(dados("fora-do-escopo"), HOJE);
  assert.ok(fora.impedimentos.some((n) => n.curto === "Atividade 7490-1/04 fora das atividades de TI atendidas." && /CGSN 140/.test(n.detalhe)));
  assert.deepEqual(diagnosticar(dados("baixada"), HOJE).impedimentos[0].curto, "CNPJ com situação baixada: só atendemos CNPJ ativo.");
  // Impedida por lei (sociedade anônima): o curto diz que não pode estar no Simples; a lei fica no detalhe.
  const sa = diagnosticar(dados("ti-fator-r", (x) => (x.naturezaJuridica = { codigo: "2054", descricao: "Sociedade Anônima Fechada" })), HOJE);
  assert.ok(sa.impedimentos.some((n) => n.curto === "Tipo de empresa que não pode estar no Simples: Sociedade Anônima Fechada." && /LC 123/.test(n.detalhe)));
  const misto = diagnosticar(dados("ti-fator-r"), HOJE).observacoes;
  assert.ok(misto.every((n) => !/cada receita/.test(n.curto)));
});

test("diagnóstico guardado sem as versões curtas (jsonb antigo): completarDiagnostico refaz com os dados da Receita", () => {
  const exemplos = ["banco-do-brasil", "ti-fator-r", "mei", "fora-do-escopo", "baixada", "ti-anexo-iii"] as const;
  for (const ex of exemplos) {
    const atual = diagnosticar(dados(ex), HOJE);
    const antigo: Partial<ReturnType<typeof diagnosticar>> & Omit<ReturnType<typeof diagnosticar>, "impedimentos" | "observacoes"> = { ...atual };
    delete antigo.impedimentos;
    delete antigo.observacoes;
    assert.deepEqual(completarDiagnostico(antigo, dados(ex), HOJE), atual, ex);
  }
  // Já com as notas: devolve o guardado (o que a empresa viu quando cadastrou), sem os campos que saíram do tipo.
  const atual = diagnosticar(dados("banco-do-brasil"), HOJE);
  assert.deepEqual(completarDiagnostico(atual, dados("ti-fator-r"), HOJE), atual);
  const comVelhos = { ...atual, motivos: ["x"], avisos: [], explicacaoFatorR: "texto antigo" };
  const lido = completarDiagnostico(comVelhos, dados("ti-fator-r"), HOJE);
  assert.deepEqual(lido, atual);
  for (const campo of ["motivos", "avisos", "explicacaoFatorR"]) assert.ok(!(campo in lido), campo);
});


test("natureza não atendida: cita a limitada unipessoal (antiga EIRELI), sem tratar a EIRELI como tipo atual", () => {
  const d = diagnosticar(dados("banco-do-brasil"), HOJE);
  const n = d.impedimentos.find((x) => x.pergunta === "Por que este tipo de empresa não é atendido?");
  assert.ok(n);
  assert.match(n.detalhe, /Atendemos sociedade limitada \(inclusive a unipessoal, antiga EIRELI\), empresário individual e sociedade simples\.$/);
  assert.doesNotMatch(n.detalhe, /e EIRELI/);
  // Os códigos antigos de EIRELI seguem atendidos (viraram limitada unipessoal pela Lei 14.195/2021, art. 41).
  for (const codigo of ["2305", "2313"]) {
    const eireli = diagnosticar(dados("ti-fator-r", (x) => (x.naturezaJuridica = { codigo, descricao: "EIRELI" })), HOJE);
    assert.ok(!eireli.impedimentos.some((x) => /tipo de empresa/i.test(x.curto)), codigo);
  }
});
