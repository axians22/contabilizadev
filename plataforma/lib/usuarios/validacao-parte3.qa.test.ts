// QA da Parte 3, ciclo 1: bordas das regras de "Seus dados" e da conferência com o quadro de sócios.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Socio } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { conferirQsa } from "@/lib/empresas/qsa";
import { nomeParaComparar, normalizarNome, normalizarWhatsapp, validarDadosPessoais, validarNascimento } from "./validacao";

const HOJE = "2026-10-21";

describe("QA parte 3: data de nascimento", () => {
  it("hoje e o futuro não valem; ontem vale; 29/02 só em ano bissexto; 1900 é o limite", () => {
    assert.equal(validarNascimento(HOJE, HOJE), null);
    assert.equal(validarNascimento("2026-10-22", HOJE), null);
    assert.equal(validarNascimento("2026-10-20", HOJE), "2026-10-20");
    assert.equal(validarNascimento("2024-02-29", HOJE), "2024-02-29");
    assert.equal(validarNascimento("2023-02-29", HOJE), null);
    assert.equal(validarNascimento("1899-12-31", HOJE), null);
    assert.equal(validarNascimento("1900-01-01", HOJE), "1900-01-01");
    assert.equal(validarNascimento("21/10/1990", HOJE), null);
    assert.equal(validarNascimento("1990-13-01", HOJE), null);
  });
});

describe("QA parte 3: WhatsApp", () => {
  it("formatos brasileiros normalizados; outro país, 0800 e fixo que não começa de 2 a 5 recusados", () => {
    assert.equal(normalizarWhatsapp("+55 (48) 99999-0000"), "+5548999990000");
    assert.equal(normalizarWhatsapp("48 99999 0000"), "+5548999990000");
    assert.equal(normalizarWhatsapp("(11) 2345-6789"), "+551123456789");
    assert.equal(normalizarWhatsapp("+1 202 555 0100"), null);
    assert.equal(normalizarWhatsapp("0800 123 4567"), null);
    assert.equal(normalizarWhatsapp("(11) 6345-6789"), null);
    assert.equal(normalizarWhatsapp("(20) 99999-0000"), null);
    assert.equal(normalizarWhatsapp(""), null);
  });
});

describe("QA parte 3: nome completo", () => {
  it("uma palavra, números ou símbolos não valem; espaços e acentos arrumados", () => {
    assert.equal(normalizarNome("Fulana"), null);
    assert.equal(normalizarNome("Fulana 2 Silva"), null);
    assert.equal(normalizarNome("Fulana @ Silva"), null);
    assert.equal(normalizarNome("  Ana   Souza  "), "Ana Souza");
    assert.equal(nomeParaComparar("Conceição Gonçalves-Lima"), "CONCEICAO GONCALVES LIMA");
  });
});

describe("QA parte 3: formulário inteiro", () => {
  const base = {
    nomeCompleto: "Fulana de Tal",
    cpf: "529.982.247-25",
    dataNascimento: "1990-05-10",
    whatsapp: "(48) 99999-0000",
    cep: "88010-000",
    logradouro: "Rua X",
    numero: "s/n",
    complemento: "  ",
    bairro: "Centro",
    cidade: "Florianópolis",
    uf: "sc",
    aceite: "on",
  };
  it("S/N, UF em minúsculas e complemento só com espaços viram a forma de guardar", () => {
    const r = validarDadosPessoais(base, HOJE);
    assert.ok(r.ok);
    assert.equal(r.dados.numero, "S/N");
    assert.equal(r.dados.uf, "SC");
    assert.equal(r.dados.complemento, null);
    assert.equal(r.dados.cep, "88010000");
    assert.equal(r.dados.cpf, "52998224725");
  });
  it("complemento longo, UF que não existe e aceite 'false' são erros no campo", () => {
    const r = validarDadosPessoais({ ...base, complemento: "x".repeat(81), uf: "XX", aceite: "false" }, HOJE);
    assert.ok(!r.ok);
    assert.ok(r.erros.complemento && r.erros.uf && r.erros.aceite);
  });
});

const socio = (nome: string, documento: string | null): Socio => ({ nome, qualificacao: "Sócio", dataEntrada: null, faixaEtaria: null, documento, representante: null });

describe("QA parte 3: quadro de sócios, bordas", () => {
  const FULANA = { nomeCompleto: "Fulana de Tal Exemplo", cpf: "52912345634" };
  it("CPF mascarado com pontuação e nome do quadro com espaços sobrando ainda batem", () => {
    assert.equal(conferirQsa([socio("  FULANA  DE TAL EXEMPLO ", "***.123.456-**")], FULANA), "confere");
  });
  it("hífen no nome do usuário e espaço no do quadro batem", () => {
    assert.equal(conferirQsa([socio("ANA MARIA SOUZA", "***123456**")], { nomeCompleto: "Ana-Maria Souza", cpf: "52912345634" }), "confere");
  });
  it("um único dígito visível diferente não bate", () => {
    for (const d of ["***023456**", "***123450**", "***124456**"]) assert.equal(conferirQsa([socio("FULANA DE TAL EXEMPLO", d)], FULANA), "nao-confere", d);
  });
  it("sócio pessoa física junto com pessoa jurídica: quem não está entre os físicos é recusado", () => {
    assert.equal(conferirQsa([socio("EMPRESA SOCIA LTDA", "11222333000181"), socio("BELTRANO", "***654321**")], FULANA), "nao-confere");
  });
});
