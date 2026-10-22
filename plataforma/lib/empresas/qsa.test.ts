import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Socio } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { conferirQsa, QSA_INDISPONIVEL, QSA_NAO_CONFERE } from "./qsa";

const socio = (nome: string, documento: string | null | undefined, representante: Socio["representante"] = null): Socio => ({
  nome,
  qualificacao: "Sócio-Administrador",
  dataEntrada: null,
  faixaEtaria: null,
  documento,
  representante,
});
const FULANA = { nomeCompleto: "Fulana de Tal Exemplo", cpf: "52912345634" };

describe("conferirQsa: nome normalizado e os dígitos visíveis do CPF", () => {
  it("bate: o mesmo nome (sem acento, maiúsculas) e o meio do CPF igual", () => {
    assert.equal(conferirQsa([socio("FULANA DE TAL EXEMPLO", "***123456**")], FULANA), "confere");
    assert.equal(conferirQsa([socio("JOSE DA CONCEICAO", "***123456**")], { nomeCompleto: "José da Conceição", cpf: "52912345634" }), "confere");
    // Outro sócio no quadro não atrapalha.
    assert.equal(conferirQsa([socio("BELTRANO EXEMPLO", "***654321**"), socio("FULANA DE TAL EXEMPLO", "***123456**")], FULANA), "confere");
  });

  it("não bate: nome diferente, CPF diferente ou o nome de um sócio com o CPF de outro", () => {
    assert.equal(conferirQsa([socio("FULANA DE TAL", "***123456**")], FULANA), "nao-confere");
    assert.equal(conferirQsa([socio("FULANA DE TAL EXEMPLO", "***123457**")], FULANA), "nao-confere");
    assert.equal(conferirQsa([socio("FULANA DE TAL EXEMPLO", "***654321**"), socio("BELTRANO EXEMPLO", "***123456**")], FULANA), "nao-confere");
  });

  it("representante legal no quadro também conta", () => {
    const quadro = [socio("EMPRESA SOCIA LTDA", "11222333000181", { nome: "FULANA DE TAL EXEMPLO", documento: "***123456**" })];
    assert.equal(conferirQsa(quadro, FULANA), "confere");
  });

  it("sem quadro (vazio, consulta antiga sem os CPFs, só sócio pessoa jurídica ou representante vazio): a comprovação fica só pelo termo", () => {
    assert.equal(conferirQsa([], FULANA), "sem-qsa");
    assert.equal(conferirQsa(undefined, FULANA), "sem-qsa");
    assert.equal(conferirQsa([socio("FULANA DE TAL EXEMPLO", undefined)], FULANA), "sem-qsa");
    assert.equal(conferirQsa([socio("EMPRESA SOCIA LTDA", "11222333000181", { nome: "X", documento: "***000000**" })], FULANA), "sem-qsa");
  });

  it("os textos da tela não citam o fornecedor e dizem o que fazer", () => {
    for (const t of [QSA_NAO_CONFERE, QSA_INDISPONIVEL]) assert.doesNotMatch(JSON.stringify(t), /brasil ?api|serpro/i);
    assert.match(QSA_NAO_CONFERE.texto, /O que fazer: confira em Seus dados/);
  });
});
