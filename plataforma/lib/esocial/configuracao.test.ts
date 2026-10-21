import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { errosDaConfig, mesParaImportar, quantidadeDoFormulario, type DadosDaConfig } from "./configuracao";
import { mensagemDaFalhaEsocial, MENSAGENS_DO_ESOCIAL } from "./mensagens";
import { ErroConsultaEsocial } from "@contabilizadev/nucleo/esocial/leitura";
import { ErroLoteRecusado } from "@contabilizadev/nucleo/esocial/lote";

const OK: DadosDaConfig = { cpf: "52998224725", categoria: "723", matricula: "1", lotacao: "1", tabRubrica: "0001", rubricaProLabore: "100", rubricaInss: "843", qtdProLabore: "220.00", diaPagamento: 5, pagamentoNoMes: "seguinte" };

describe("formulário dos cadastros do eSocial", () => {
  it("aceita o cadastro típico e confere cada campo", () => {
    assert.deepEqual(errosDaConfig(OK), {});
    assert.deepEqual(errosDaConfig({ ...OK, qtdProLabore: null, matricula: "MAT-0001", lotacao: "LOT_1", tabRubrica: "TAB.1" }), {});
    const erros = errosDaConfig({ ...OK, cpf: "11111111111", categoria: "7230", matricula: " ", lotacao: "com espaço", tabRubrica: "123456789", rubricaInss: "100", qtdProLabore: "1,5", diaPagamento: 0 });
    assert.deepEqual(Object.keys(erros).sort(), ["categoria", "cpf", "diaPagamento", "lotacao", "matricula", "qtdProLabore", "rubricaInss", "tabRubrica"]);
    assert.match(erros.rubricaInss!, /diferente/);
  });

  it("quantidade digitada vira o formato do leiaute", () => {
    assert.equal(quantidadeDoFormulario("220"), "220.00");
    assert.equal(quantidadeDoFormulario("220,5"), "220.50");
    assert.equal(quantidadeDoFormulario("220,00"), "220.00");
    assert.equal(quantidadeDoFormulario("  "), null);
  });

  it("mês para importar: o último cujo prazo (dia 15 do mês seguinte) passou", () => {
    assert.equal(mesParaImportar(new Date("2026-10-16T12:00:00-03:00")), "2026-09");
    assert.equal(mesParaImportar(new Date("2026-10-15T12:00:00-03:00")), "2026-08");
    assert.equal(mesParaImportar(new Date("2027-01-20T12:00:00-03:00")), "2026-12");
  });

  it("falhas do eSocial viram mensagem própria (limite, dias 1 a 7, sem permissão, recusa, fora do ar)", () => {
    assert.equal(mensagemDaFalhaEsocial(new ErroConsultaEsocial("405", "x")), MENSAGENS_DO_ESOCIAL.limiteDoDia);
    assert.equal(mensagemDaFalhaEsocial(new ErroConsultaEsocial("403", "x")), MENSAGENS_DO_ESOCIAL.diasUmASete);
    assert.equal(mensagemDaFalhaEsocial(new ErroConsultaEsocial("411", "x")), MENSAGENS_DO_ESOCIAL.semPermissao);
    assert.equal(mensagemDaFalhaEsocial(new ErroConsultaEsocial("308", "x")), MENSAGENS_DO_ESOCIAL.falhou);
    assert.equal(mensagemDaFalhaEsocial(new ErroLoteRecusado("401", [], "x")), MENSAGENS_DO_ESOCIAL.recusado);
    assert.equal(mensagemDaFalhaEsocial(new Error("O eSocial não aceita consultas de identificadores e downloads nos dias 1 a 7 do mês.")), MENSAGENS_DO_ESOCIAL.diasUmASete);
    assert.equal(mensagemDaFalhaEsocial(new Error("Limite de 10 consultas por dia ao eSocial atingido.")), MENSAGENS_DO_ESOCIAL.limiteDoDia);
    assert.equal(mensagemDaFalhaEsocial(new Error("sem rede")), MENSAGENS_DO_ESOCIAL.falhou);
  });
});
