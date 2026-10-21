// QA: abas abertas juntas no primeiro acesso local (banco vazio) abrem a sessão local ao mesmo tempo. Nenhuma pode
// falhar com erro cru do Postgres, e todas devem cair na mesma conta de desenvolvimento.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { usuarios } from "@/banco/esquema";
import { abrirSessaoLocal } from "@/lib/autenticacao/sessao-local";
import { resolverSessao } from "@/lib/autenticacao/servico";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const cookieDe = (r: Response) => /^sessao=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1];

describe("abrirSessaoLocal (QA)", () => {
  it("10 aberturas simultâneas com o banco vazio: todas 307 com cookie, uma única conta", async () => {
    for (let rodada = 0; rodada < 5; rodada++) {
      await t.limpar();
      const d = deps(t.banco, {}, { loginDesligado: true });
      const respostas = await Promise.all(Array.from({ length: 10 }, () => abrirSessaoLocal(d, new Request("http://localhost:3001/sessao-local?de=/plano"))));
      for (const r of respostas) {
        assert.equal(r.status, 307);
        assert.equal(r.headers.get("location"), "http://localhost:3001/plano");
        const s = await resolverSessao(d, decodeURIComponent(cookieDe(r)!));
        assert.equal(s?.usuario.email, "dev@contabilizadev.local");
      }
      assert.equal((await t.banco.select().from(usuarios)).length, 1);
    }
  });

  it("de com esquema embutido ou barra invertida não sai do site", async () => {
    const d = deps(t.banco, {}, { loginDesligado: true });
    for (const de of ["/\\evil.com", "https://evil.com", "//evil.com/x", "javascript:alert(1)", "%2F%2Fevil.com"]) {
      const r = await abrirSessaoLocal(d, new Request(`http://localhost:3001/sessao-local?de=${encodeURIComponent(de)}`));
      assert.equal(new URL(r.headers.get("location")!).origin, "http://localhost:3001", de);
    }
  });
});
