import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { criarVerificadorGoogle } from "./google";

// Cliente falso no lugar do OAuth2Client: o teste nunca chama o Google.
function clienteFalso(payload: Record<string, unknown> | undefined, chamadas: unknown[] = []) {
  return {
    verifyIdToken: async (opcoes: unknown) => {
      chamadas.push(opcoes);
      return { getPayload: () => payload };
    },
  } as never;
}

describe("criarVerificadorGoogle", () => {
  it("confere com audience = GOOGLE_CLIENT_ID", async () => {
    const chamadas: unknown[] = [];
    await criarVerificadorGoogle("meu-id.apps.googleusercontent.com", clienteFalso({}, chamadas))("token-x");
    assert.deepEqual(chamadas, [{ idToken: "token-x", audience: "meu-id.apps.googleusercontent.com" }]);
  });
  it("traduz o payload do Google para o perfil", async () => {
    const perfil = await criarVerificadorGoogle("id", clienteFalso({ sub: "123", email: "a@b.com", email_verified: true, name: "Ana", picture: "https://foto" }))("t");
    assert.deepEqual(perfil, { sub: "123", email: "a@b.com", emailVerificado: true, nome: "Ana", foto: "https://foto" });
  });
  it("payload vazio vira perfil vazio (o serviço recusa depois)", async () => {
    const perfil = await criarVerificadorGoogle("id", clienteFalso(undefined))("t");
    assert.equal(perfil.email, undefined);
    assert.equal(perfil.emailVerificado, undefined);
  });
  it("token recusado pela biblioteca propaga o erro", async () => {
    const cliente = { verifyIdToken: async () => Promise.reject(new Error("Wrong recipient")) } as never;
    await assert.rejects(criarVerificadorGoogle("id", cliente)("t"), /Wrong recipient/);
  });
});
