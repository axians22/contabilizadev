// QA (Parte 6, ciclo 2): remover a empresa com o cofre real do navegador (IndexedDB falso): só a chave do CNPJ removido
// sai; a de outra empresa do mesmo usuário continua; com { erro } nada sai.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { acaoDeRemover } from "@/app/(painel)/empresa/remover-empresa";
import { apagarGuardados, cnpjsGuardados } from "@/app/assinador/guardados";
import { cofreDoNavegador } from "@/lib/assinador/cofre";

const A = "12345678000195";
const B = "11222333000181";

async function guardar(cnpj: string) {
  const par = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  await cofreDoNavegador().guardar({
    cnpj,
    chave: par.privateKey,
    certificado: "-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----",
    info: { cnpj, titular: "X", validoDe: new Date(2026, 0, 1), validoAte: new Date(2027, 0, 1) } as never,
    guardadoEm: new Date(),
  });
}

function formulario(marcada: boolean) {
  const d = new FormData();
  d.set("empresaId", "00000000-0000-4000-8000-000000000001");
  d.set("cnpj", A);
  if (marcada) d.set("apagarCertificado", "on");
  return d;
}

describe("QA: remover empresa com o cofre real", () => {
  beforeEach(async () => {
    (globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory();
    await guardar(A);
    await guardar(B);
  });

  it("com { ok } e a caixa marcada, apaga só a chave da empresa removida", async () => {
    const urls: string[] = [];
    const acao = acaoDeRemover(async () => ({ ok: true }), A, { apagar: apagarGuardados, navegar: (u) => void urls.push(u) });
    await acao(undefined, formulario(true));
    assert.deepEqual((await cnpjsGuardados()).sort(), [B]);
    assert.deepEqual(urls, ["/empresa?removida=1"]);
  });

  it("com { erro }, as duas chaves continuam", async () => {
    const acao = acaoDeRemover(async () => ({ erro: "Sem acesso." }), A, { apagar: apagarGuardados, navegar: () => assert.fail("navegou") });
    await acao(undefined, formulario(true));
    assert.deepEqual((await cnpjsGuardados()).sort(), [B, A].sort());
  });

  it("com a caixa desmarcada, as duas chaves continuam", async () => {
    const acao = acaoDeRemover(async () => ({ ok: true }), A, { apagar: apagarGuardados, navegar: () => {} });
    await acao(undefined, formulario(false));
    assert.deepEqual((await cnpjsGuardados()).sort(), [B, A].sort());
  });

  it("sem IndexedDB (navegação privada), remover não quebra e ainda navega", async () => {
    delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    const urls: string[] = [];
    const acao = acaoDeRemover(async () => ({ ok: true }), A, { apagar: apagarGuardados, navegar: (u) => void urls.push(u) });
    assert.deepEqual(await acao(undefined, formulario(true)), { ok: true });
    assert.deepEqual(urls, ["/empresa?removida=1"]);
  });
});
