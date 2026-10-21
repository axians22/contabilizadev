import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lerRespostaCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { respostaGravada } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { assinarPrevia, lerPrevia, PreviaInvalida, VALIDADE_DA_PREVIA_MS } from "./cadastro";
import { ErroDeEmpresa } from "./servico";

const SEGREDO = "segredo-dos-testes-com-mais-de-32-caracteres";
const AGORA = new Date("2026-10-16T15:00:00Z");
const conteudo = { usuarioId: "u1", consultadaEm: AGORA.toISOString(), dados: lerRespostaCnpj(respostaGravada("ti-fator-r")) };
const recusa = /expirou ou não confere/;

describe("prévia assinada do cadastro", () => {
  it("volta igual para o mesmo usuário dentro do prazo", () => {
    const token = assinarPrevia(conteudo, SEGREDO);
    assert.deepEqual(lerPrevia(token, "u1", SEGREDO, new Date(AGORA.getTime() + VALIDADE_DA_PREVIA_MS)), conteudo);
  });
  it("outro usuário, outro segredo ou depois do prazo: recusada", () => {
    const token = assinarPrevia(conteudo, SEGREDO);
    assert.throws(() => lerPrevia(token, "u2", SEGREDO, AGORA), recusa);
    assert.throws(() => lerPrevia(token, "u1", `${SEGREDO}x`, AGORA), recusa);
    assert.throws(() => lerPrevia(token, "u1", SEGREDO, new Date(AGORA.getTime() + VALIDADE_DA_PREVIA_MS + 1)), recusa);
    // Data da consulta no futuro também não vale.
    assert.throws(() => lerPrevia(token, "u1", SEGREDO, new Date(AGORA.getTime() - 1000)), recusa);
    // É o erro próprio da prévia (a tela usa para pesquisar de novo) e continua sendo um ErroDeEmpresa.
    assert.throws(() => lerPrevia(token, "u1", SEGREDO, new Date(AGORA.getTime() + VALIDADE_DA_PREVIA_MS + 1)), PreviaInvalida);
    assert.throws(() => lerPrevia(token, "u1", SEGREDO, new Date(AGORA.getTime() + VALIDADE_DA_PREVIA_MS + 1)), ErroDeEmpresa);
  });
  it("dados alterados no navegador (outra razão social ou CNPJ) quebram a assinatura", () => {
    const token = assinarPrevia(conteudo, SEGREDO);
    const [corpo, assinatura] = token.split(".");
    const mexido = JSON.parse(Buffer.from(corpo, "base64url").toString());
    mexido.dados.razaoSocial = "OUTRA";
    assert.throws(() => lerPrevia(`${Buffer.from(JSON.stringify(mexido)).toString("base64url")}.${assinatura}`, "u1", SEGREDO, AGORA), recusa);
  });
  it("lixo é recusado com ErroDeEmpresa (nunca erro de parse)", () => {
    for (const lixo of ["", ".", "abc", "abc.def", `${Buffer.from("{").toString("base64url")}.x`, undefined as unknown as string]) {
      assert.throws(() => lerPrevia(lixo, "u1", SEGREDO, AGORA), ErroDeEmpresa, String(lixo));
    }
  });
});
