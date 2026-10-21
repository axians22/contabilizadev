// Login desligado: a sessão local abre a sessão da conta de desenvolvimento sozinha (sem tela, sem botão) e volta
// ao painel com o cookie. Em produção ou com o login ligado, não abre nada.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { sessoes, usuarios } from "@/banco/esquema";
import { abrirSessaoLocal, destinoDaSessaoLocal } from "@/lib/autenticacao/sessao-local";
import { resolverSessao } from "@/lib/autenticacao/servico";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const pedir = (caminho: string) => new Request(`http://localhost:3001${caminho}`);
const cookieDe = (r: Response) => /^sessao=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1];

describe("abrirSessaoLocal", () => {
  it("login desligado: cria a conta de desenvolvimento, grava o cookie e volta ao painel", async () => {
    const d = deps(t.banco, {}, { loginDesligado: true });
    const r = await abrirSessaoLocal(d, pedir("/sessao-local"));
    assert.equal(r.status, 307);
    assert.equal(r.headers.get("location"), "http://localhost:3001/");
    const setCookie = r.headers.get("set-cookie")!;
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=lax/i);
    assert.match(setCookie, /Path=\//);
    const sessao = await resolverSessao(d, decodeURIComponent(cookieDe(r)!));
    assert.equal(sessao?.usuario.email, "dev@contabilizadev.local");
  });

  it("volta para o destino pedido, mas só se for do próprio site", async () => {
    const d = deps(t.banco, {}, { loginDesligado: true });
    assert.equal((await abrirSessaoLocal(d, pedir("/sessao-local?de=%2Fusuarios%3Fq%3Da"))).headers.get("location"), "http://localhost:3001/usuarios?q=a");
    assert.equal((await abrirSessaoLocal(d, pedir("/sessao-local?de=%2F%2Foutro.site"))).headers.get("location"), "http://localhost:3001/");
    assert.equal((await abrirSessaoLocal(d, pedir("/sessao-local?de=https%3A%2F%2Foutro.site"))).headers.get("location"), "http://localhost:3001/");
  });

  it("login ligado: não abre sessão nem cria conta, manda para /entrar", async () => {
    const r = await abrirSessaoLocal(deps(t.banco), pedir("/sessao-local"));
    assert.equal(r.headers.get("location"), "http://localhost:3001/entrar");
    assert.equal(r.headers.get("set-cookie"), null);
    assert.equal((await t.banco.select().from(usuarios)).length, 0);
    assert.equal((await t.banco.select().from(sessoes)).length, 0);
  });

  it("produção: mesmo com o login desligado na configuração, não abre nada (fail-closed)", async () => {
    const r = await abrirSessaoLocal(deps(t.banco, {}, { loginDesligado: true, producao: true }), pedir("/sessao-local"));
    assert.equal(r.headers.get("location"), "http://localhost:3001/entrar");
    assert.equal(r.headers.get("set-cookie"), null);
    assert.equal((await t.banco.select().from(sessoes)).length, 0);
  });

  it("conta de desenvolvimento desativada: explica na própria página (403), sem cookie nem volta para login", async () => {
    const d = deps(t.banco, {}, { loginDesligado: true });
    await abrirSessaoLocal(d, pedir("/sessao-local"));
    await t.banco.delete(sessoes);
    await t.banco.update(usuarios).set({ ativo: false }).where(eq(usuarios.email, d.config.emailDesenvolvimento));
    const r = await abrirSessaoLocal(d, pedir("/sessao-local"));
    assert.equal(r.status, 403);
    assert.equal(r.headers.get("set-cookie"), null);
    assert.match(await r.text(), /desativada/);
    assert.equal((await t.banco.select().from(sessoes)).length, 0);
  });
});

describe("destinoDaSessaoLocal", () => {
  it("não volta para a própria sessão local nem para /entrar", () => {
    assert.equal(destinoDaSessaoLocal("/sessao-local"), "/");
    assert.equal(destinoDaSessaoLocal("/sessao-local?de=/x"), "/");
    assert.equal(destinoDaSessaoLocal("/entrar"), "/");
    assert.equal(destinoDaSessaoLocal("/entrar?de=/plano"), "/");
    assert.equal(destinoDaSessaoLocal("/plano#a"), "/plano#a");
    assert.equal(destinoDaSessaoLocal(null), "/");
  });
});
