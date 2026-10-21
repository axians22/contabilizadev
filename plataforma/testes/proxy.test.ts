// O proxy de verdade (proxy.ts), chamado com requisições montadas: sem cookie assinado, página vai para /entrar
// e API recebe 401; com cookie assinado, segue.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { assinarToken, novoToken } from "@/lib/autenticacao/cookie";
import { SEGREDO } from "./apoio";

let proxy: (r: NextRequest) => Response;
before(async () => {
  process.env.SESSAO_SEGREDO = SEGREDO;
  ({ proxy } = await import("@/proxy"));
});

// Roda `f` com variáveis de ambiente trocadas e devolve as originais (o proxy lê o ambiente a cada requisição).
function comAmbiente(vars: Record<string, string>, f: () => void) {
  const env = process.env as Record<string, string | undefined>;
  const antes = Object.fromEntries(Object.keys(vars).map((k) => [k, env[k]]));
  Object.assign(env, vars);
  try {
    f();
  } finally {
    for (const [k, v] of Object.entries(antes)) if (v === undefined) delete env[k];
    else env[k] = v;
  }
}

const pedir = (url: string, cookie?: string) => proxy(new NextRequest(url, { headers: cookie ? { cookie } : {} }));

describe("proxy", () => {
  it("página sem cookie vai para /entrar, guardando de onde veio", () => {
    const r = pedir("http://localhost:3001/usuarios?q=ana");
    assert.equal(r.status, 307);
    const destino = new URL(r.headers.get("location")!);
    assert.equal(destino.pathname, "/entrar");
    assert.equal(destino.searchParams.get("de"), "/usuarios?q=ana");
  });
  it("a raiz sem cookie vai para /entrar sem parâmetro", () => {
    assert.equal(new URL(pedir("http://localhost:3001/").headers.get("location")!).search, "");
  });
  it("API sem cookie recebe 401", () => {
    assert.equal(pedir("http://localhost:3001/api/sessao").status, 401);
  });
  it("cookie com assinatura errada vale como sem cookie", () => {
    const falso = `sessao=${assinarToken(novoToken(), "outro-segredo-com-mais-de-32-caracteres!")}`;
    assert.equal(pedir("http://localhost:3001/plano", falso).status, 307);
  });
  it("cookie assinado segue adiante", () => {
    const r = pedir("http://localhost:3001/plano", `sessao=${assinarToken(novoToken(), SEGREDO)}`);
    assert.equal(r.headers.get("x-middleware-next"), "1");
  });
  it("/entrar abre sem cookie", () => {
    assert.equal(pedir("http://localhost:3001/entrar").headers.get("x-middleware-next"), "1");
  });
  it("login desligado em desenvolvimento: página sem cookie vai direto para a sessão local, nunca para /entrar", () => {
    comAmbiente({ AUTH_DISABLED: "true", NODE_ENV: "development" }, () => {
      const raiz = new URL(pedir("http://localhost:3001/").headers.get("location")!);
      assert.equal(raiz.pathname, "/sessao-local");
      assert.equal(raiz.search, "");
      const plano = new URL(pedir("http://localhost:3001/plano?x=1").headers.get("location")!);
      assert.equal(plano.pathname, "/sessao-local");
      assert.equal(plano.searchParams.get("de"), "/plano?x=1");
      assert.equal(pedir("http://localhost:3001/sessao-local").headers.get("x-middleware-next"), "1");
      assert.equal(pedir("http://localhost:3001/api/sessao").status, 401);
    });
  });
  it("em produção AUTH_DISABLED é ignorado: continua indo para /entrar, e a sessão local é fechada", () => {
    comAmbiente({ AUTH_DISABLED: "true", NODE_ENV: "production" }, () => {
      assert.equal(new URL(pedir("http://localhost:3001/").headers.get("location")!).pathname, "/entrar");
      assert.equal(new URL(pedir("http://localhost:3001/sessao-local").headers.get("location")!).pathname, "/entrar");
    });
  });
  it("o matcher deixa de fora só os arquivos do Next e o ícone", async () => {
    const { config } = await import("@/proxy");
    assert.deepEqual(config.matcher, ["/((?!_next/static|_next/image|favicon.ico).*)"]);
  });
});
