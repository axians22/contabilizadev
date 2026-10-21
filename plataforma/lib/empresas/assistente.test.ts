import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { lerRespostaCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { respostaGravada, type Exemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { diagnosticar } from "@contabilizadev/nucleo/diagnostico";
import { tabelaVigente } from "@contabilizadev/nucleo/simples";
import {
  acaoPrincipal,
  autorizacaoDoPreparo,
  diaDaConsulta,
  ESTADO_INICIAL,
  ETAPAS,
  etapasDo,
  exemploFatorR,
  explicarNatureza,
  explicarSituacao,
  GRUPOS_ATENDIDOS,
  orientacoes,
  podeAvancar,
  podeVoltar,
  previaDoCnpjDigitado,
  previaVencida,
  precisaRepesquisar,
  progresso,
  reduzir,
  resumoSimples,
  tituloDaEtapa,
  vistaDaAutorizacao,
  type Autorizacao,
  type EstadoAssistente,
  type Explicacao,
  type EventoAssistente,
  type PreviaDoAssistente,
  FOLGA_DA_PREVIA_MS,
  VALIDADE_DA_PREVIA_MS,
} from "./assistente";
import { GLOSSARIO, verbeteAnexo } from "./glossario";

// Consulta feita agora (a prévia só vale 30 minutos); o diagnóstico usa o dia fixo abaixo.
const CONSULTADA_EM = new Date().toISOString();
// Hora (no relógio do navegador) em que a prévia chegou à tela; é dela que se mede a idade da prévia.
const RECEBIDA_EM = Date.parse(CONSULTADA_EM);
const HOJE = "2026-10-16";

function previa(exemplo: Exemplo, mexer?: (r: Record<string, unknown>) => void): PreviaDoAssistente {
  const r = respostaGravada(exemplo);
  mexer?.(r);
  const dados = lerRespostaCnpj(r);
  return { dados, diagnostico: diagnosticar(dados, HOJE), consultadaEm: CONSULTADA_EM, token: `token-${exemplo}` };
}

const aplicar = (estado: EstadoAssistente, ...eventos: EventoAssistente[]) => eventos.reduce(reduzir, estado);
const continuar: EventoAssistente = { tipo: "continuar" };
const voltar: EventoAssistente = { tipo: "voltar" };

// Até o diagnóstico de uma empresa: digita, consulta e continua três vezes.
function ateDiagnostico(exemplo: Exemplo, cnpj: string) {
  return aplicar(ESTADO_INICIAL, { tipo: "digitar", cnpj }, { tipo: "consultou", previa: previa(exemplo), agora: RECEBIDA_EM }, continuar, continuar, continuar);
}

describe("etapas do assistente", () => {
  it("são sete, na ordem pedida, com o progresso 'Passo N de 7'", () => {
    assert.deepEqual(
      ETAPAS.map((e) => e.nome),
      ["Pesquisar o CNPJ", "Conferir a empresa", "Atividades", "Simples Nacional", "Diagnóstico", "Empresa cadastrada", "Autorização"],
    );
    const ti = previa("ti-fator-r");
    assert.equal(progresso({ etapa: "cnpj", previa: null }), "Passo 1 de 7");
    assert.equal(progresso({ etapa: "diagnostico", previa: ti }), "Passo 5 de 7");
    assert.equal(progresso({ etapa: "proximos", previa: ti }), "Passo 6 de 7");
    assert.equal(progresso({ etapa: "autorizacao", previa: ti }), "Passo 7 de 7");
  });

  it("empresa não atendida: a partir do diagnóstico o caminho tem 6 etapas e termina em 'O que fazer', sem a autorização", () => {
    const mei = previa("mei");
    // Antes do diagnóstico ainda são sete (o motivo aparece no diagnóstico).
    assert.equal(progresso({ etapa: "simples", previa: mei }), "Passo 4 de 7");
    assert.equal(progresso({ etapa: "diagnostico", previa: mei }), "Passo 5 de 6");
    assert.equal(progresso({ etapa: "proximos", previa: mei }), "Passo 6 de 6");
    assert.deepEqual(
      etapasDo({ etapa: "proximos", previa: mei }).map((e) => e.nome),
      ["Pesquisar o CNPJ", "Conferir a empresa", "Atividades", "Simples Nacional", "Diagnóstico", "O que fazer"],
    );
    assert.equal(etapasDo({ etapa: "proximos", previa: previa("ti-fator-r") }), ETAPAS);
  });

  it("começa no CNPJ, sem prévia, sem Voltar, e o botão pesquisa", () => {
    assert.equal(ESTADO_INICIAL.etapa, "cnpj");
    assert.equal(acaoPrincipal(ESTADO_INICIAL), "consultar");
    assert.equal(podeAvancar(ESTADO_INICIAL), false);
    assert.equal(podeVoltar(ESTADO_INICIAL), false);
    // Continuar sem consulta não sai do lugar.
    assert.equal(reduzir(ESTADO_INICIAL, continuar), ESTADO_INICIAL);
  });

  it("empresa atendida: consulta, confere as etapas, cadastra no diagnóstico e termina nos próximos passos", () => {
    let e = aplicar(ESTADO_INICIAL, { tipo: "digitar", cnpj: "12.345.678/0001-95" });
    assert.equal(e.cnpj, "12.345.678/0001-95");
    e = reduzir(e, { tipo: "consultou", previa: previa("ti-fator-r"), agora: RECEBIDA_EM });
    assert.equal(e.etapa, "empresa");
    for (const etapa of ["atividades", "simples", "diagnostico"] as const) {
      assert.equal(acaoPrincipal(e), "continuar");
      e = reduzir(e, continuar);
      assert.equal(e.etapa, etapa);
    }
    // No diagnóstico, a empresa atendida só segue cadastrando.
    assert.equal(acaoPrincipal(e), "cadastrar");
    assert.equal(podeAvancar(e), false);
    assert.equal(reduzir(e, continuar), e);
    e = reduzir(e, { tipo: "cadastrou", empresaId: "emp-1" });
    assert.deepEqual([e.etapa, e.empresaId], ["proximos", "emp-1"]);
    assert.equal(tituloDaEtapa(e), "Empresa cadastrada");
    // 6 → 7: Continuar leva à autorização, a última etapa (as ações dela são assinar ou Fazer depois).
    assert.equal(acaoPrincipal(e), "continuar");
    e = reduzir(e, continuar);
    assert.equal(e.etapa, "autorizacao");
    assert.equal(acaoPrincipal(e), null);
    assert.equal(podeAvancar(e), false);
    assert.equal(reduzir(e, continuar), e);
    assert.equal(tituloDaEtapa(e), "Autorize a plataforma na Receita Federal");
  });

  it("voltar não perde nada: o CNPJ digitado e a consulta ficam, e Continuar no início não consulta de novo", () => {
    let e = ateDiagnostico("ti-fator-r", "12.345.678/0001-95");
    e = aplicar(e, voltar, voltar, voltar, voltar);
    assert.equal(e.etapa, "cnpj");
    assert.equal(e.cnpj, "12.345.678/0001-95");
    assert.equal(e.previa?.token, "token-ti-fator-r");
    assert.equal(acaoPrincipal(e), "continuar");
    assert.equal(podeVoltar(e), false);
    e = reduzir(e, continuar);
    assert.equal(e.etapa, "empresa");
    // O CNPJ sem pontuação ou em minúsculas é o mesmo da consulta.
    assert.equal(acaoPrincipal(aplicar(e, voltar, { tipo: "digitar", cnpj: "12345678000195" })), "continuar");
  });

  it("CNPJ trocado no início: o botão volta a pesquisar e Continuar não usa a consulta antiga", () => {
    let e = aplicar(ateDiagnostico("ti-fator-r", "12.345.678/0001-95"), voltar, voltar, voltar, voltar, { tipo: "digitar", cnpj: "98.765.432/0001-98" });
    assert.equal(acaoPrincipal(e), "consultar");
    assert.equal(podeAvancar(e), false);
    assert.equal(reduzir(e, continuar).etapa, "cnpj");
    e = reduzir(e, { tipo: "consultou", previa: previa("ti-anexo-iii"), agora: RECEBIDA_EM });
    assert.equal(e.previa?.dados.cnpj, "98765432000198");
    assert.equal(e.etapa, "empresa");
  });

  it("digitar fora da primeira etapa não muda o CNPJ (a consulta é a que vale)", () => {
    const e = ateDiagnostico("ti-fator-r", "12.345.678/0001-95");
    assert.equal(reduzir(e, { tipo: "digitar", cnpj: "1" }), e);
  });

  it("empresa não atendida: no diagnóstico não cadastra, Continuar leva à explicação final e dá para voltar", () => {
    let e = ateDiagnostico("mei", "24.681.357/0001-40");
    assert.equal(e.etapa, "diagnostico");
    assert.equal(acaoPrincipal(e), "continuar");
    assert.equal(tituloDaEtapa(e), "Ainda não atendemos esta empresa");
    // Um "cadastrou" que chegasse aqui é ignorado.
    assert.equal(reduzir(e, { tipo: "cadastrou", empresaId: "x" }), e);
    e = reduzir(e, continuar);
    assert.deepEqual([e.etapa, e.empresaId], ["proximos", null]);
    assert.equal(tituloDaEtapa(e), "Por que não cadastramos e o que fazer");
    // Termina aqui: sem cadastro, não há passo 7.
    assert.equal(acaoPrincipal(e), null);
    assert.equal(podeAvancar(e), false);
    assert.equal(reduzir(e, continuar), e);
    assert.equal(podeVoltar(e), true);
    assert.equal(reduzir(e, voltar).etapa, "diagnostico");
  });

  it("depois de cadastrada dá para voltar só para conferir: nada muda, nada é pesquisado nem cadastrado de novo; recomeçar zera tudo", () => {
    const cadastrada = reduzir(ateDiagnostico("ti-fator-r", "12.345.678/0001-95"), { tipo: "cadastrou", empresaId: "emp-1" });
    let e = aplicar(cadastrada, continuar); // no passo 7
    assert.equal(e.etapa, "autorizacao");
    // Volta até o início, passo a passo.
    for (const etapa of ["proximos", "diagnostico", "simples", "atividades", "empresa", "cnpj"] as const) {
      assert.equal(podeVoltar(e), true);
      e = reduzir(e, voltar);
      assert.equal(e.etapa, etapa);
      // Em nenhum passo o botão cadastra ou pesquisa de novo.
      assert.ok(acaoPrincipal(e) !== "cadastrar" && acaoPrincipal(e) !== "consultar", etapa);
    }
    assert.equal(podeVoltar(e), false);
    // No passo 1, o CNPJ não muda, a resposta de uma consulta é ignorada e o botão só segue adiante.
    assert.equal(reduzir(e, { tipo: "digitar", cnpj: "98.765.432/0001-98" }), e);
    assert.equal(reduzir(e, { tipo: "consultou", previa: previa("ti-anexo-iii"), agora: RECEBIDA_EM }), e);
    assert.equal(acaoPrincipal(e), "continuar");
    // Mesmo com a prévia já vencida (mais de 30 minutos lendo), o cadastrado segue sem pesquisar de novo.
    const depois = RECEBIDA_EM + VALIDADE_DA_PREVIA_MS + 60_000;
    assert.equal(acaoPrincipal(e, depois), "continuar");
    // No diagnóstico, nem cadastrar de novo nem repesquisar: Continuar. Um segundo "cadastrou" é ignorado.
    e = aplicar(e, continuar, continuar, continuar, continuar);
    assert.equal(e.etapa, "diagnostico");
    assert.equal(acaoPrincipal(e, depois), "continuar");
    assert.equal(precisaRepesquisar(e, depois), false);
    assert.equal(reduzir(e, { tipo: "cadastrou", empresaId: "emp-2" }), e);
    e = aplicar(e, continuar, continuar);
    assert.deepEqual([e.etapa, e.empresaId], ["autorizacao", "emp-1"]);
    assert.deepEqual(reduzir(e, { tipo: "recomecar" }), ESTADO_INICIAL);
  });

  it("consulta de outro CNPJ que chega fora da primeira etapa é ignorada (resposta atrasada)", () => {
    const e = ateDiagnostico("ti-fator-r", "12.345.678/0001-95");
    assert.equal(reduzir(e, { tipo: "consultou", previa: previa("mei"), agora: RECEBIDA_EM }), e);
  });

  it("prévia vencida: o prazo da tela vence um minuto antes do servidor", () => {
    const t0 = Date.parse(CONSULTADA_EM);
    assert.equal(previaVencida(t0, t0), false);
    assert.equal(previaVencida(t0, t0 + VALIDADE_DA_PREVIA_MS - FOLGA_DA_PREVIA_MS), false);
    assert.equal(previaVencida(t0, t0 + VALIDADE_DA_PREVIA_MS - FOLGA_DA_PREVIA_MS + 1), true);
    assert.equal(previaVencida(t0, t0 + VALIDADE_DA_PREVIA_MS), true);
    assert.equal(previaVencida(null, t0), true);
  });

  it("prévia vencida no passo 1 com o mesmo CNPJ: pesquisa de novo, Continuar não reaproveita, e a nova consulta segue", () => {
    const t0 = Date.parse(CONSULTADA_EM);
    const depois = t0 + VALIDADE_DA_PREVIA_MS + 60_000;
    const e = aplicar(ateDiagnostico("ti-fator-r", "12.345.678/0001-95"), voltar, voltar, voltar, voltar);
    assert.equal(e.etapa, "cnpj");
    assert.equal(acaoPrincipal(e, t0), "continuar");
    assert.equal(previaDoCnpjDigitado(e, depois), false);
    assert.equal(acaoPrincipal(e, depois), "consultar");
    assert.equal(podeAvancar(e, depois), false);
    assert.equal(reduzir(e, { tipo: "continuar", agora: depois }).etapa, "cnpj");
    const nova = { ...previa("ti-fator-r"), consultadaEm: new Date(depois).toISOString(), token: "token-novo" };
    const f = reduzir(e, { tipo: "consultou", previa: nova, agora: depois });
    assert.deepEqual([f.etapa, f.previa?.token, f.cnpj], ["empresa", "token-novo", "12.345.678/0001-95"]);
  });

  it("prévia vencida no diagnóstico: o clique em cadastrar pesquisa de novo ali mesmo e, com a prévia nova, cadastra", () => {
    const t0 = Date.parse(CONSULTADA_EM);
    const depois = t0 + VALIDADE_DA_PREVIA_MS + 60_000;
    const e = ateDiagnostico("ti-fator-r", "12.345.678/0001-95");
    assert.equal(acaoPrincipal(e, depois), "cadastrar");
    assert.equal(precisaRepesquisar(e, t0), false);
    assert.equal(precisaRepesquisar(e, depois), true);
    const nova = { ...previa("ti-fator-r"), consultadaEm: new Date(depois).toISOString(), token: "token-novo" };
    const f = reduzir(e, { tipo: "consultou", previa: nova, agora: depois });
    assert.deepEqual([f.etapa, f.previa?.token], ["diagnostico", "token-novo"]);
    assert.equal(precisaRepesquisar(f, depois), false);
    assert.equal(reduzir(f, { tipo: "cadastrou", empresaId: "emp-1" }).etapa, "proximos");
    // Resposta atrasada de outro CNPJ não troca a prévia do diagnóstico.
    assert.equal(reduzir(e, { tipo: "consultou", previa: previa("ti-anexo-iii"), agora: RECEBIDA_EM }), e);
  });

  it("prévia vencida de empresa não atendida: não precisa pesquisar de novo para ver o que fazer", () => {
    const depois = Date.parse(CONSULTADA_EM) + VALIDADE_DA_PREVIA_MS + 60_000;
    const e = ateDiagnostico("mei", "24.681.357/0001-40");
    assert.equal(acaoPrincipal(e, depois), "continuar");
    assert.equal(precisaRepesquisar(e, depois), false);
    assert.equal(reduzir(e, { tipo: "continuar", agora: depois }).etapa, "proximos");
  });

  for (const [nome, diferenca] of [
    ["adiantado", 3 * 60 * 60 * 1000],
    ["atrasado", -3 * 60 * 60 * 1000],
  ] as const) {
    it(`relógio do navegador ${nome} 3 h em relação ao servidor: a idade da prévia é medida só no relógio do navegador`, () => {
      const servidor = Date.parse("2026-10-17T12:00:00.000Z");
      const navegador = servidor + diferenca;
      const fresca = { ...previa("ti-fator-r"), consultadaEm: new Date(servidor).toISOString() };
      let e = aplicar(ESTADO_INICIAL, { tipo: "digitar", cnpj: "12.345.678/0001-95" }, { tipo: "consultou", previa: fresca, agora: navegador });
      assert.equal(e.recebidaEm, navegador);
      for (let i = 0; i < 3; i++) e = reduzir(e, { tipo: "continuar", agora: navegador + 1000 });
      assert.equal(e.etapa, "diagnostico");
      // Recém-chegada: o clique cadastra direto, sem pesquisar de novo.
      assert.equal(acaoPrincipal(e, navegador + 1000), "cadastrar");
      assert.equal(precisaRepesquisar(e, navegador + 1000), false);
      // Mas o prazo continua valendo, contado da chegada (com atraso, o relógio "atrasado" não deixa a prévia eterna).
      const vencida = navegador + VALIDADE_DA_PREVIA_MS;
      assert.equal(precisaRepesquisar(e, vencida), true);
      // A pesquisa refeita no diagnóstico renova a hora de chegada, e o clique seguinte cadastra.
      const f = reduzir(e, { tipo: "consultou", previa: { ...fresca, token: "token-novo" }, agora: vencida });
      assert.deepEqual([f.recebidaEm, f.previa?.token, precisaRepesquisar(f, vencida + 5000)], [vencida, "token-novo", false]);
      // Recomeçar apaga a hora de chegada junto com a prévia.
      assert.equal(reduzir(f, { tipo: "recomecar" }).recebidaEm, null);
    });
  }

  it("título de cada etapa", () => {
    const e = ateDiagnostico("ti-fator-r", "12.345.678/0001-95");
    assert.equal(tituloDaEtapa(ESTADO_INICIAL), "Qual é o CNPJ da empresa?");
    assert.equal(tituloDaEtapa({ ...e, etapa: "empresa" }), "Confira os dados da empresa");
    assert.equal(tituloDaEtapa({ ...e, etapa: "atividades" }), "O que a empresa faz (atividades)");
    assert.equal(tituloDaEtapa({ ...e, etapa: "simples" }), "A empresa está no Simples Nacional?");
    assert.equal(tituloDaEtapa(e), "Em que anexo a empresa fica");
  });

  it("dia da consulta é o do Brasil (23h de Brasília ainda é o mesmo dia)", () => {
    assert.equal(diaDaConsulta("2026-10-17T02:30:00.000Z"), "2026-10-16");
    assert.equal(diaDaConsulta("2026-10-17T03:30:00.000Z"), "2026-10-17");
  });
});

// Detalhe do tooltip: só existe quando há problema (ok: false); em ordem, a tela mostra só o curto.
const detalhe = (e: Explicacao) => (e.ok ? "" : e.texto);

describe("textos das etapas", () => {
  it("situação cadastral: só ATIVA está ok; as outras dizem o que fazer", () => {
    assert.deepEqual(explicarSituacao("ATIVA"), { ok: true, curto: "CNPJ ativo." });
    for (const s of ["INAPTA", "SUSPENSA", "BAIXADA", "NULA", "OUTRA"]) {
      const e = explicarSituacao(s);
      assert.equal(e.ok, false, s);
      assert.ok(detalhe(e).length > 20, s);
    }
    assert.match(detalhe(explicarSituacao("INAPTA")), /e-CAC/);
    assert.match(detalhe(explicarSituacao("BAIXADA")), /abrir outra/);
  });

  it("natureza jurídica atendida ou não", () => {
    assert.deepEqual(explicarNatureza("2062"), { ok: true, curto: "Tipo de empresa atendido." });
    assert.equal(explicarNatureza("2135").ok, true);
    assert.equal(explicarNatureza("2054").ok, false);
    assert.equal(explicarNatureza("").ok, false);
    // EIRELI não existe mais (Lei 14.195/2021, art. 41): os códigos antigos seguem atendidos, mas o texto fala da limitada unipessoal.
    assert.equal(explicarNatureza("2305").ok, true);
    assert.match(detalhe(explicarNatureza("2054")), /sociedade limitada \(inclusive a unipessoal, antiga EIRELI\)/);
    assert.doesNotMatch(detalhe(explicarNatureza("2054")), /e EIRELI/);
  });

  it("Simples e MEI: optante com data, não optante, excluída, não informado e MEI", () => {
    const ti = resumoSimples(previa("ti-fator-r").dados, HOJE);
    assert.deepEqual(ti, { simples: { ok: true, curto: "Optante do Simples Nacional desde 10/03/2022." }, mei: { ok: true, curto: "Não é MEI." } });

    const mei = resumoSimples(previa("mei").dados, HOJE);
    assert.equal(mei.mei.ok, false);
    assert.match(detalhe(mei.mei), /DAS-MEI/);

    const fora = resumoSimples({ simples: { optante: false, dataOpcao: null, dataExclusao: "2025-12-31" }, mei: { optante: false, dataOpcao: null, dataExclusao: null } }, HOJE);
    assert.equal(fora.simples.ok, false);
    assert.match(detalhe(fora.simples), /saiu do Simples em 31\/12\/2025/);
    assert.match(detalhe(fora.simples), /Lucro Presumido/);

    // Saída marcada para depois: segue ok, sem "Atenção" junto do ✓ (o aviso fica nas observações do diagnóstico).
    const saindo = resumoSimples({ simples: { optante: true, dataOpcao: "2022-01-01", dataExclusao: "2026-12-31" }, mei: { optante: false, dataOpcao: null, dataExclusao: null } }, HOJE);
    assert.deepEqual(saindo.simples, { ok: true, curto: "Optante do Simples Nacional desde 01/01/2022." });

    const semInfo = resumoSimples({ simples: { optante: null, dataOpcao: null, dataExclusao: null }, mei: { optante: null, dataOpcao: null, dataExclusao: null } }, HOJE);
    assert.equal(semInfo.simples.ok, false);
    // O balão acrescenta ao curto (que já diz que a Receita não informa): onde conferir.
    assert.match(detalhe(semInfo.simples), /Portal do Simples Nacional, em "Consulta Optantes"/);
    assert.doesNotMatch(detalhe(semInfo.simples), /não informa/);
  });

  it("MEI nos três casos: é MEI (impede), não é MEI (ok) e não informado (neutro, sem ✓ nem alerta)", () => {
    const comMei = (optante: boolean | null) => resumoSimples({ simples: { optante: true, dataOpcao: null, dataExclusao: null }, mei: { optante, dataOpcao: null, dataExclusao: null } }, HOJE).mei;
    assert.deepEqual(comMei(true), {
      ok: false,
      curto: "É MEI: ainda não atendemos MEI.",
      titulo: "Por que ser MEI impede o cadastro?",
      texto:
        "O MEI paga um valor fixo por mês (o DAS-MEI), e não o Simples por anexo, que é o que esta plataforma calcula. O que fazer: enquanto for MEI, o DAS-MEI sai no Portal do Empreendedor. Se a empresa deixar de ser MEI e ficar no Simples Nacional, é só pesquisar de novo.",
    });
    assert.deepEqual(comMei(false), { ok: true, curto: "Não é MEI." });
    assert.deepEqual(comMei(null), { ok: true, neutro: true, curto: "A Receita Federal não informa se a empresa é MEI." });
  });

  it("exemplo do Fator R: 28% de R$ 120 mil é R$ 33.600, pró-labore de R$ 2.800 por mês fica no Anexo III", () => {
    const ex = exemploFatorR();
    assert.deepEqual([ex.receita12, ex.minimo12, ex.minimoMensal, ex.abaixoMensal], [120_000, 33_600, 2_800, 1_500]);
    const texto = ex.textos.join(" ").replace(/ /g, " ");
    assert.match(texto, /R\$ 120\.000,00 em 12 meses/);
    assert.match(texto, /R\$ 33\.600,00/);
    assert.match(texto, /R\$ 2\.800,00 por mês: Fator R de 28%, a receita fica no Anexo III/);
    assert.match(texto, /R\$ 1\.500,00 por mês: Fator R de 15%, a receita vai para o Anexo V/);
    assert.equal(exemploFatorR(5_000).minimoMensal, 1_400);
  });

  it("orientações: uma por motivo, e nenhuma quando a empresa é atendida", () => {
    const atendida = previa("ti-fator-r");
    assert.deepEqual(orientacoes(atendida.dados, atendida.diagnostico, HOJE), []);

    const mei = previa("mei");
    assert.deepEqual(orientacoes(mei.dados, mei.diagnostico, HOJE).map((o) => o.titulo), ["Sair do MEI, se for o caso"]);

    const fora = previa("fora-do-escopo");
    const tFora = orientacoes(fora.dados, fora.diagnostico, HOJE);
    assert.ok(tFora.some((o) => o.titulo === "Atividades fora de TI" && /6201, 6202, 6203, 6204, 6209, 6311 e 6319/.test(o.texto)));

    const baixada = previa("baixada");
    assert.ok(orientacoes(baixada.dados, baixada.diagnostico, HOJE).some((o) => o.titulo === "CNPJ encerrado" && o.curto === "Para cadastrar, é preciso abrir uma nova empresa." && /abrir outra/.test(o.texto)));

    // Baixado ou anulado não volta a valer: só a orientação da situação, nada de regularizar o mesmo CNPJ (mesmo que
    // ele esteja fora do Simples, seja MEI, de outro tipo ou com atividades fora de TI).
    for (const situacao of ["BAIXADA", "NULA"]) {
      for (const nome of ["baixada", "banco-do-brasil", "mei", "fora-do-escopo"] as const) {
        const p = previa(nome, (r) => (r.descricao_situacao_cadastral = situacao));
        assert.deepEqual(orientacoes(p.dados, p.diagnostico, HOJE).map((o) => o.titulo), [situacao === "BAIXADA" ? "CNPJ encerrado" : "CNPJ anulado"], `${nome}/${situacao}`);
      }
    }
    // Inapta ou suspensa se regulariza: as outras orientações continuam.
    const inaptaBB = previa("banco-do-brasil", (r) => (r.descricao_situacao_cadastral = "INAPTA"));
    assert.ok(orientacoes(inaptaBB.dados, inaptaBB.diagnostico, HOJE).length > 1);

    const bb = previa("banco-do-brasil");
    const tBB = orientacoes(bb.dados, bb.diagnostico, HOJE).map((o) => o.titulo);
    assert.ok(tBB.includes("Entrar no Simples Nacional"));
    assert.ok(tBB.includes("Tipo de empresa"));
    assert.ok(tBB.includes("Atividades fora de TI"));

    const semInfo = previa("ti-fator-r", (r) => (r.opcao_pelo_simples = null));
    assert.deepEqual(orientacoes(semInfo.dados, semInfo.diagnostico, HOJE).map((o) => o.titulo), ["Conferir a opção pelo Simples"]);

    // Toda empresa não atendida dos exemplos recebe pelo menos uma orientação.
    for (const nome of ["mei", "fora-do-escopo", "baixada", "banco-do-brasil"] as const) {
      const p = previa(nome);
      assert.equal(p.diagnostico.atendido, false, nome);
      assert.ok(orientacoes(p.dados, p.diagnostico, HOJE).length >= 1, nome);
    }
  });

  it("CNPJ não ativo: título e frase dizem o que fazer, sem prometer regularizar o que não se regulariza", () => {
    const da = (situacao: string) => {
      const p = previa("ti-fator-r", (r) => (r.descricao_situacao_cadastral = situacao));
      return orientacoes(p.dados, p.diagnostico, HOJE)[0];
    };
    assert.deepEqual([da("BAIXADA").titulo, da("BAIXADA").curto], ["CNPJ encerrado", "Para cadastrar, é preciso abrir uma nova empresa."]);
    assert.equal(da("NULA").titulo, "CNPJ anulado");
    assert.match(da("INAPTA").curto, /e-CAC/);
    assert.equal(da("SUSPENSA").titulo, "Regularizar o CNPJ");
    for (const s of ["BAIXADA", "NULA", "INAPTA", "SUSPENSA", "OUTRA"]) {
      const o = da(s);
      assert.doesNotMatch(o.curto, /não dá para cadastrar/, s); // a frase é o que fazer, não o motivo
      assert.ok(o.texto.length > o.curto.length, s);
    }
  });

  it("grupos de CNAE atendidos vêm da tabela de regras do núcleo", () => {
    assert.deepEqual(GRUPOS_ATENDIDOS, ["6201", "6202", "6203", "6204", "6209", "6311", "6319"]);
  });
});

describe("glossário", () => {
  it("tem todos os termos pedidos, cada um com título e texto", () => {
    for (const termo of ["cnpj", "cnae", "simples", "mei", "anexo", "fatorR", "proLabore", "situacao", "natureza", "termo"] as const) {
      assert.ok(GLOSSARIO[termo].titulo.endsWith("?"), termo);
      assert.ok(GLOSSARIO[termo].texto.join(" ").length > 60, termo);
    }
  });

  it("alíquotas iniciais dos Anexos III e V citadas batem com a tabela vigente", () => {
    const pct = (x: number) => `${(x * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
    const texto = GLOSSARIO.anexo.texto.join(" ");
    assert.ok(texto.includes(pct(tabelaVigente("III", "2026-10").faixas[0].aliquota)), texto);
    assert.ok(texto.includes(pct(tabelaVigente("V", "2026-10").faixas[0].aliquota)), texto);
    assert.match(GLOSSARIO.fatorR.texto.join(" "), /28%/);
  });

  it("anexo fixo: o verbete não diz que o Fator R decide, cita a alíquota do Anexo III e reusa a frase do 'Como o CNAE define o anexo?'", () => {
    const fixo = verbeteAnexo("2026-10", true);
    assert.equal(fixo.titulo, verbeteAnexo("2026-10").titulo);
    const t = fixo.texto.join(" ");
    assert.doesNotMatch(t, /Fator R|Anexo V/);
    assert.match(t, /Suporte técnico, hospedagem e portais ficam sempre no Anexo III, com alíquota inicial de 6%\./);
    assert.ok(GLOSSARIO.cnaeEAnexo.texto[0].includes("Suporte técnico, hospedagem e portais ficam sempre no Anexo III."));
    assert.deepEqual(GLOSSARIO.anexoFixo.texto.length, 2);
    // Mês sem tabela: sem número e sem pontuação quebrada.
    const semTabela = verbeteAnexo("2029-01", true).texto.join(" ");
    assert.doesNotMatch(semTabela, /\d+(,\d+)?%|,,|\s,|undefined|null/);
    assert.match(semTabela, /sempre no Anexo III\. Quando/);
  });

  it("pró-labore x lucros: regra da Lei 15.270/2025 (retenção de 10% acima de R$ 50 mil por mês de cada empresa)", () => {
    assert.deepEqual(GLOSSARIO.proLabore.texto, [
      "É a remuneração mensal do sócio que trabalha na empresa, como um salário. Tem INSS de 11%, descontado do sócio, e entra no Fator R.",
      "É diferente da distribuição de lucros, que não conta para o Fator R. Até R$ 50 mil por mês de cada empresa, o lucro não tem imposto para o sócio; acima disso, a empresa retém 10% de imposto de renda sobre o total do mês.",
      "Quem recebe mais de R$ 600 mil no ano, somando tudo, pode ainda pagar um imposto mínimo na declaração anual.",
    ]);
    assert.doesNotMatch(GLOSSARIO.proLabore.texto.join(" "), /lucros, que não tem imposto/);
  });

  it("verbetes do DAS e do DARF existem e são usados no cartão das guias", () => {
    assert.ok("das" in GLOSSARIO && "darf" in GLOSSARIO);
    const cartao = readFileSync(path.join(import.meta.dirname, "..", "..", "app", "(painel)", "guias-do-mes.tsx"), "utf8");
    assert.match(cartao, /termo=\{props\.guia\.tipo === "DAS" \? "das" : "darf"\}/);
  });
});

describe("passo 7 do assistente (Autorização)", () => {
  const PARAMETROS = {
    contratante: { numero: "11444777000161", nome: "PLATAFORMA DE TESTE LTDA" },
    empresa: { cnpj: "12345678000195", razaoSocial: "EXEMPLO SOFTWARE LTDA" },
    dataAssinatura: "20261018",
    vigenciaMaxima: "20271018",
  };
  const ASSINAR: Autorizacao = { tipo: "assinar", parametros: PARAMETROS };
  const ausente = { estado: "ausente" as const };
  const noPasso7 = (autorizacao: Autorizacao | null) =>
    aplicar(ateDiagnostico("ti-fator-r", "12.345.678/0001-95"), { tipo: "cadastrou", empresaId: "emp-1" }, ...(autorizacao ? [{ tipo: "preparou", autorizacao } as const] : []), continuar);

  it("o preparo do servidor vira o passo 7: própria, assinar ou indisponível (com a mensagem própria)", () => {
    assert.deepEqual(autorizacaoDoPreparo({ situacao: { estado: "propria" }, parametros: null, bloqueio: null }), { tipo: "propria" });
    assert.deepEqual(autorizacaoDoPreparo({ situacao: ausente, parametros: PARAMETROS, bloqueio: null }), ASSINAR);
    assert.deepEqual(autorizacaoDoPreparo({ situacao: ausente, parametros: null, bloqueio: "Só o dono." }), { tipo: "indisponivel", mensagem: "Só o dono." });
    const semMotivo = autorizacaoDoPreparo({ situacao: ausente, parametros: null, bloqueio: null });
    assert.equal(semMotivo.tipo, "indisponivel");
    assert.ok(semMotivo.tipo === "indisponivel" && /modo guiado/.test(semMotivo.mensagem));
  });

  it("antes do cadastro, um 'preparou' é ignorado; depois, guarda a autorização", () => {
    const antes = ateDiagnostico("ti-fator-r", "12.345.678/0001-95");
    assert.equal(reduzir(antes, { tipo: "preparou", autorizacao: ASSINAR }), antes);
    const e = noPasso7(ASSINAR);
    assert.deepEqual([e.etapa, e.autorizacao], ["autorizacao", ASSINAR]);
    assert.equal(vistaDaAutorizacao(e), "assinar");
  });

  it("assinar com sucesso: autorização concluída com a validade, título 'Tudo pronto'; um 'preparou' atrasado não desfaz", () => {
    let e = noPasso7(ASSINAR);
    e = reduzir(e, { tipo: "autorizou", validaAte: "2027-10-18" });
    assert.equal(e.autorizadaAte, "2027-10-18");
    assert.equal(vistaDaAutorizacao(e), "concluida");
    assert.equal(tituloDaEtapa(e), "Tudo pronto");
    assert.equal(reduzir(e, { tipo: "preparou", autorizacao: ASSINAR }), e);
    assert.equal(reduzir(e, { tipo: "autorizou", validaAte: "2028-01-01" }), e);
    // Voltar e vir de novo mantém concluída (não pede para assinar outra vez).
    e = aplicar(e, voltar, continuar);
    assert.equal(vistaDaAutorizacao(e), "concluida");
  });

  it("'autorizou' só vale depois do cadastro e quando há o que assinar; o envio que termina fora do passo 7 não se perde", () => {
    const antes = ateDiagnostico("ti-fator-r", "12.345.678/0001-95");
    assert.equal(reduzir(antes, { tipo: "autorizou", validaAte: "2027-10-18" }), antes);
    const no6 = reduzir(reduzir(antes, { tipo: "cadastrou", empresaId: "emp-1" }), { tipo: "preparou", autorizacao: ASSINAR });
    assert.equal(no6.etapa, "proximos");
    // O cliente voltou ao 6 enquanto o termo era enviado: a confirmação chega ali e o passo 7 mostra a conclusão.
    const voltou = reduzir(no6, { tipo: "autorizou", validaAte: "2027-10-18" });
    assert.equal(voltou.autorizadaAte, "2027-10-18");
    assert.equal(voltou.etapa, "proximos");
    assert.equal(vistaDaAutorizacao(reduzir(voltou, continuar)), "concluida");
    const semPreparo = reduzir(antes, { tipo: "cadastrou", empresaId: "emp-1" });
    assert.equal(reduzir(semPreparo, { tipo: "autorizou", validaAte: "2027-10-18" }), semPreparo);
    const propria = noPasso7({ tipo: "propria" });
    assert.equal(reduzir(propria, { tipo: "autorizou", validaAte: "2027-10-18" }), propria);
  });

  it("pular (Fazer depois): o passo 7 é o último e não exige assinar; a empresa segue cadastrada", () => {
    const e = noPasso7(ASSINAR);
    assert.equal(acaoPrincipal(e), null);
    assert.equal(podeAvancar(e), false);
    assert.equal(e.empresaId, "emp-1");
    assert.equal(e.autorizadaAte, null);
  });

  it("empresa da própria plataforma: o passo 7 diz que já está autorizada", () => {
    const e = noPasso7({ tipo: "propria" });
    assert.equal(vistaDaAutorizacao(e), "propria");
    assert.equal(tituloDaEtapa(e), "A empresa já está autorizada");
  });

  it("sem o preparo (ainda chegando): 'carregando'; indisponível: a mensagem", () => {
    assert.equal(vistaDaAutorizacao(noPasso7(null)), "carregando");
    assert.equal(vistaDaAutorizacao(noPasso7({ tipo: "indisponivel", mensagem: "x" })), "indisponivel");
  });
});
