// QA (Parte 2, área do administrador, ciclo 5): a barreira da área DE VERDADE, no servidor (não a cópia da regra nem o
// texto do arquivo): sessão real gravada no banco de TESTE, cookie assinado, e o layout e as páginas de app/admin chamados
// como o Next chama. COMMON_USER recebe 404 em tudo; MANAGER só abre Usuários (/admin o leva para lá); ADMIN abre tudo.
// Só o banco contabilizadev_teste; nenhuma chamada externa.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, it } from "node:test";
import { prepararBancoDeTeste, nomeDoBanco, urlDoBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";

const exigir = createRequire(import.meta.url);
// "server-only" recusa ser carregado fora do Next; next/headers precisa da requisição: os dois trocados só aqui.
const so = exigir.resolve("server-only");
exigir.cache[so] = { id: so, filename: so, loaded: true, exports: {} } as never;
let cookieAtual: string | undefined;
const cabecalhos = exigir.resolve("next/headers");
exigir.cache[cabecalhos] = {
  id: cabecalhos,
  filename: cabecalhos,
  loaded: true,
  exports: { cookies: async () => ({ get: () => (cookieAtual ? { value: cookieAtual } : undefined), set() {}, delete() {} }) },
} as never;

const SEGREDO = "qa-ciclo5-segredo-de-sessao-com-mais-de-32-caracteres";
const ADMIN = "admin@qa-ciclo5.teste";

// O que o Next faz com o erro lançado: 404 (notFound) ou redirecionamento (redirect).
async function desfecho(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (e) {
    const d = String((e as { digest?: string }).digest ?? (e as Error).message);
    if (d.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return "404";
    if (d.startsWith("NEXT_REDIRECT")) return `redirect ${d.split(";")[2]}`;
    throw e;
  }
}

describe("QA ciclo 5: a barreira de /admin no servidor, com sessão real no banco de teste", async () => {
  let t: BancoDeTeste;
  const cookies: Record<string, string> = {};
  before(async () => {
    t = await prepararBancoDeTeste();
    const url = urlDoBancoDeTeste();
    assert.ok(nomeDoBanco(url).endsWith("_teste"));
    Object.assign(process.env, { DATABASE_URL: url, SESSAO_SEGREDO: SEGREDO, ADMIN_EMAILS: ADMIN, AUTH_DISABLED: "false" });
    await t.limpar();
    const { usuarios, sessoes } = await import("@/banco/esquema");
    const { novoToken, assinarToken, hashDoToken } = await import("@/lib/autenticacao/cookie");
    for (const [papel, email] of [["COMMON_USER", "comum@qa-ciclo5.teste"], ["MANAGER", "gestor@qa-ciclo5.teste"], ["ADMIN", ADMIN]] as const) {
      const [u] = await t.banco.insert(usuarios).values({ email, nome: papel, provedor: "GOOGLE", provedorId: email, papel }).returning({ id: usuarios.id });
      const token = novoToken();
      await t.banco.insert(sessoes).values({ usuarioId: u.id, tokenHash: hashDoToken(token), expiraEm: new Date(Date.now() + 3_600_000) });
      cookies[papel] = assinarToken(token, SEGREDO);
    }
  });
  after(async () => {
    await t.limpar();
    await t.fechar();
    const { banco } = await import("@/banco");
    void banco;
    const g = globalThis as unknown as { __conexao?: { end: () => Promise<void> } };
    await g.__conexao?.end();
  });

  const como = (papel: string | undefined) => (cookieAtual = papel ? cookies[papel] : undefined);

  it("exigirEntradaNaAreaDoAdmin (o layout): COMMON_USER 404; MANAGER e ADMIN entram; sem sessão vai para o login", async () => {
    const { exigirEntradaNaAreaDoAdmin } = await import("@/lib/autenticacao/servidor");
    como("COMMON_USER");
    assert.equal(await desfecho(exigirEntradaNaAreaDoAdmin), "404");
    como("MANAGER");
    assert.equal(await desfecho(exigirEntradaNaAreaDoAdmin), "ok");
    como("ADMIN");
    assert.equal(await desfecho(exigirEntradaNaAreaDoAdmin), "ok");
    como(undefined);
    assert.match(await desfecho(exigirEntradaNaAreaDoAdmin), /^redirect \/entrar/);
  });

  it("exigirAreaDoAdmin em cada endereço: a tabela papel × página", async () => {
    const { exigirAreaDoAdmin } = await import("@/lib/autenticacao/servidor");
    const esperado = {
      COMMON_USER: { "/admin": "404", "/admin/usuarios": "404", "/admin/plataforma": "404", "/admin/custos": "404", "/admin/plano": "404" },
      MANAGER: { "/admin": "redirect /admin/usuarios", "/admin/usuarios": "ok", "/admin/plataforma": "404", "/admin/custos": "404", "/admin/plano": "404" },
      ADMIN: { "/admin": "ok", "/admin/usuarios": "ok", "/admin/plataforma": "ok", "/admin/custos": "ok", "/admin/plano": "ok" },
    } as const;
    for (const [papel, paginas] of Object.entries(esperado))
      for (const [href, r] of Object.entries(paginas)) {
        como(papel);
        assert.equal(await desfecho(() => exigirAreaDoAdmin(href as never)), r, `${papel} ${href}`);
      }
  });

  it("o layout e as páginas de verdade recusam quem não vê, antes de desenhar qualquer coisa", async () => {
    const layout = (await import("@/app/admin/layout")).default;
    como("COMMON_USER");
    assert.equal(await desfecho(() => layout({ children: null })), "404");
    const paginas = {
      "/admin": (await import("@/app/admin/page")).default as (p?: unknown) => Promise<unknown>,
      "/admin/usuarios": (await import("@/app/admin/usuarios/page")).default as (p?: unknown) => Promise<unknown>,
      "/admin/plataforma": (await import("@/app/admin/plataforma/page")).default as (p?: unknown) => Promise<unknown>,
      "/admin/plano": (await import("@/app/admin/plano/page")).default as (p?: unknown) => Promise<unknown>,
    };
    const props = { searchParams: Promise.resolve({}) };
    for (const [href, pagina] of Object.entries(paginas)) {
      como("COMMON_USER");
      assert.equal(await desfecho(() => pagina(props)), "404", `COMMON_USER ${href}`);
    }
    como("MANAGER");
    assert.equal(await desfecho(() => paginas["/admin"](props)), "redirect /admin/usuarios");
    assert.equal(await desfecho(() => paginas["/admin/plataforma"](props)), "404");
    assert.equal(await desfecho(() => paginas["/admin/plano"](props)), "404");
  });

  it("as server actions da área recusam COMMON_USER e MANAGER onde não podem (sem gravar nada)", async () => {
    const plataforma = await import("@/app/admin/plataforma/acoes");
    const usuarios = await import("@/app/admin/usuarios/acoes");
    const form = new FormData();
    for (const papel of ["COMMON_USER", "MANAGER"]) {
      como(papel);
      for (const [nome, fn] of Object.entries(plataforma))
        if (typeof fn === "function") assert.equal(await desfecho(() => (fn as (a: unknown, b: unknown) => Promise<unknown>)(undefined, form)), "404", `${papel} ${nome}`);
    }
    como("COMMON_USER");
    for (const [nome, fn] of Object.entries(usuarios))
      if (typeof fn === "function") assert.equal(await desfecho(() => (fn as (a: unknown, b: unknown) => Promise<unknown>)(undefined, form)), "404", `COMMON_USER ${nome}`);
  });
});
