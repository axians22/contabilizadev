import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { cifrar, decifrar, ErroDeChave, ErroDeCifra, lerChave, lerChavePlataforma, lerChaveToken } from "./cifra";

const chave = randomBytes(32);

describe("TOKEN_CHAVE", () => {
  it("aceita 32 bytes em base64 ou em hexadecimal", () => {
    assert.deepEqual(lerChaveToken(chave.toString("base64")), chave);
    assert.deepEqual(lerChaveToken(` ${chave.toString("hex")}\n`), chave);
  });
  it("ausente, curta, longa ou em outro formato derruba com a instrução de como gerar", () => {
    assert.throws(() => lerChaveToken(undefined), (e: Error) => e instanceof ErroDeChave && /openssl rand -base64 32/.test(e.message));
    assert.throws(() => lerChaveToken(""), ErroDeChave);
    assert.throws(() => lerChaveToken(randomBytes(16).toString("base64")), /32 bytes/);
    assert.throws(() => lerChaveToken(randomBytes(48).toString("base64")), /32 bytes/);
    assert.throws(() => lerChaveToken("uma senha qualquer com mais de trinta e dois caracteres"), /32 bytes/);
  });
});

describe("PLATAFORMA_CHAVE (a mesma regra, outra chave)", () => {
  it("aceita 32 bytes e diz o nome certo da variável quando falta ou é inválida", () => {
    const outra = randomBytes(32);
    assert.deepEqual(lerChavePlataforma(outra.toString("base64"), chave.toString("base64")), outra);
    assert.deepEqual(lerChavePlataforma(outra.toString("hex"), undefined), outra);
    assert.throws(() => lerChavePlataforma(undefined, chave.toString("base64")), (e: Error) => e instanceof ErroDeChave && /^PLATAFORMA_CHAVE ausente/.test(e.message));
    assert.throws(() => lerChavePlataforma("curta", undefined), /PLATAFORMA_CHAVE inválida: precisa ter 32 bytes/);
    assert.throws(() => lerChave("", "OUTRA"), /OUTRA ausente/);
  });
  it("igual à TOKEN_CHAVE (mesmo em outro formato) é recusada: uma chave não pode abrir o que a outra guarda", () => {
    assert.throws(() => lerChavePlataforma(chave.toString("base64"), chave.toString("base64")), /igual à TOKEN_CHAVE/);
    assert.throws(() => lerChavePlataforma(chave.toString("hex"), chave.toString("base64")), /igual à TOKEN_CHAVE/);
  });
});

describe("cifra AES-256-GCM", () => {
  it("cifra e decifra; o texto em claro não aparece e o IV muda a cada vez", () => {
    const a = cifrar("b06feea3-1ca8-49f4-bdb4-211ab006cb92", chave, "empresa-1:token");
    const b = cifrar("b06feea3-1ca8-49f4-bdb4-211ab006cb92", chave, "empresa-1:token");
    assert.notEqual(a, b);
    assert.match(a, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    assert.doesNotMatch(a, /b06feea3/);
    assert.equal(decifrar(a, chave, "empresa-1:token"), "b06feea3-1ca8-49f4-bdb4-211ab006cb92");
    assert.equal(decifrar(cifrar("", chave, "x"), chave, "x"), "");
    assert.equal(decifrar(cifrar("ação ✓", chave, "x"), chave, "x"), "ação ✓");
  });
  it("outra chave, outro contexto (outra empresa ou registro) ou valor alterado não abrem", () => {
    const valor = cifrar("token", chave, "empresa-1:token");
    assert.throws(() => decifrar(valor, randomBytes(32), "empresa-1:token"), ErroDeCifra);
    assert.throws(() => decifrar(valor, chave, "empresa-2:token"), ErroDeCifra);
    const partes = valor.split(".");
    partes[3] = Buffer.from("tokem").toString("base64url");
    assert.throws(() => decifrar(partes.join("."), chave, "empresa-1:token"), ErroDeCifra);
    assert.throws(() => decifrar("token-em-claro", chave, "empresa-1:token"), /formato/);
  });
});
