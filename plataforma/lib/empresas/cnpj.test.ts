import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cnpjConfere, formatarCnpj, mascararCnpj, normalizarCnpj, validarCnpj } from "./cnpj";

describe("CNPJ numérico e alfanumérico", () => {
  it("normaliza tirando pontuação e espaços", () => {
    assert.equal(normalizarCnpj("11.222.333/0001-81"), "11222333000181");
    assert.equal(normalizarCnpj(" 11222333000181 "), "11222333000181");
  });
  it("aceita o alfanumérico e passa para maiúsculas", () => {
    assert.equal(normalizarCnpj("12.abc.345/01de-35"), "12ABC34501DE35");
  });
  it("recusa tamanho errado, letra nos dígitos verificadores e caracteres estranhos", () => {
    for (const v of ["", "123", "1122233300018", "112223330001811", "12ABC34501DEA5", "11222333000l8!"]) assert.equal(normalizarCnpj(v), null, v);
  });
  it("formata os dois tipos", () => {
    assert.equal(formatarCnpj("11222333000181"), "11.222.333/0001-81");
    assert.equal(formatarCnpj("12ABC34501DE35"), "12.ABC.345/01DE-35");
    assert.equal(formatarCnpj("123"), "123");
  });
});

describe("dígitos verificadores e máscara", () => {
  it("validarCnpj confere os dígitos do numérico e do alfanumérico", () => {
    assert.equal(validarCnpj("11.222.333/0001-81"), "11222333000181");
    assert.equal(validarCnpj("12.abc.345/01de-35"), "12ABC34501DE35");
    for (const v of ["11.222.333/0001-82", "12ABC34501DE36", "00000000000000", "123", ""]) assert.equal(validarCnpj(v), null, v);
  });
  it("mascararCnpj põe a pontuação enquanto digita, em maiúsculas, e corta no 14º caractere", () => {
    assert.equal(mascararCnpj(""), "");
    assert.equal(mascararCnpj("1"), "1");
    assert.equal(mascararCnpj("112"), "11.2");
    assert.equal(mascararCnpj("11222333"), "11.222.333");
    assert.equal(mascararCnpj("112223330001"), "11.222.333/0001");
    assert.equal(mascararCnpj("11222333000181999"), "11.222.333/0001-81");
    assert.equal(mascararCnpj("12abc34501de35"), "12.ABC.345/01DE-35");
    assert.equal(mascararCnpj("11.222.333/0001-81"), "11.222.333/0001-81");
    assert.equal(mascararCnpj("ç11#222"), "11.222");
  });
});

describe("cnpjConfere (confirmação da remoção da empresa)", () => {
  it("aceita o CNPJ com ou sem pontuação, com espaços e em minúsculas", () => {
    for (const v of ["11.222.333/0001-81", "11222333000181", " 11 222 333 0001 81 "]) assert.equal(cnpjConfere(v, "11222333000181"), true, v);
    assert.equal(cnpjConfere("12.abc.345/01de-35", "12ABC34501DE35"), true);
  });
  it("recusa outro CNPJ, CNPJ incompleto, vazio e lixo", () => {
    for (const v of ["11.222.333/0001-82", "1122233300018", "", "   ", "11222333000181x", "abc"]) assert.equal(cnpjConfere(v, "11222333000181"), false, v);
  });
  it("tolera valor nulo vindo do formulário", () => {
    assert.equal(cnpjConfere(null as unknown as string, "11222333000181"), false);
  });
});
