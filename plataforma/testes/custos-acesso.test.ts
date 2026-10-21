// /admin/custos (custo por cliente das chamadas ao Serpro): só o ADMIN abre, conferido no servidor DE VERDADE (sessão
// gravada no banco de TESTE, cookie assinado, a página chamada como o Next chama). COMMON_USER e MANAGER recebem 404 antes
// de qualquer leitura; a tela não tem server action (o período vai no endereço) e lê só o banco. Nenhuma chamada externa.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
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

const SEGREDO = "custos-segredo-de-sessao-com-mais-de-32-caracteres";
const ADMIN = "admin@custos.teste";
const PASTA = path.join(import.meta.dirname, "..", "app", "admin", "custos");

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

describe("/admin/custos: só o ADMIN, conferido no servidor", async () => {
  let t: BancoDeTeste;
  const cookies: Record<string, string> = {};
  before(async () => {
    t = await prepararBancoDeTeste();
    const url = urlDoBancoDeTeste();
    assert.ok(nomeDoBanco(url).endsWith("_teste"));
    Object.assign(process.env, { DATABASE_URL: url, SESSAO_SEGREDO: SEGREDO, ADMIN_EMAILS: ADMIN, AUTH_DISABLED: "false" });
    await t.limpar();
    const { usuarios, sessoes, empresas, serproChamadas } = await import("@/banco/esquema");
    const { novoToken, assinarToken, hashDoToken } = await import("@/lib/autenticacao/cookie");
    for (const [papel, email] of [["COMMON_USER", "comum@custos.teste"], ["MANAGER", "gestor@custos.teste"], ["ADMIN", ADMIN]] as const) {
      const [u] = await t.banco.insert(usuarios).values({ email, nome: papel, provedor: "GOOGLE", provedorId: email, papel }).returning({ id: usuarios.id });
      const token = novoToken();
      await t.banco.insert(sessoes).values({ usuarioId: u.id, tokenHash: hashDoToken(token), expiraEm: new Date(Date.now() + 3_600_000) });
      cookies[papel] = assinarToken(token, SEGREDO);
    }
    const [e] = await t.banco.insert(empresas).values({ cnpj: "11222333000181", razaoSocial: "Alfa Serviços Ltda" }).returning({ id: empresas.id });
    // No período atual, para a página abrir nele sem ?periodo=.
    const quando = new Date();
    const linha = { quando, servico: "TESTE", finalidade: "teste", status: 200, mensagens: "", custo: 0 };
    await t.banco.insert(serproChamadas).values([
      { ...linha, acao: "Consultar", empresaId: e.id, contribuinte: "11222333000181" },
      { ...linha, acao: "Emitir", empresaId: e.id, contribuinte: "11222333000181" },
      { ...linha, acao: "Autenticar", semContribuinte: true },
    ]);
  });
  after(async () => {
    await t.limpar();
    await t.fechar();
    const g = globalThis as unknown as { __conexao?: { end: () => Promise<void> } };
    await g.__conexao?.end();
  });

  const como = (papel: string | undefined) => (cookieAtual = papel ? cookies[papel] : undefined);
  const pagina = async () => (await import("@/app/admin/custos/page")).default as (p: unknown) => Promise<ReactElement>;
  const props = (periodo?: string) => ({ searchParams: Promise.resolve(periodo ? { periodo } : {}) });

  it("COMMON_USER e MANAGER recebem 404 (a página não existe para eles); sem sessão vai para o login", async () => {
    const { exigirAreaDoAdmin } = await import("@/lib/autenticacao/servidor");
    const Custos = await pagina();
    for (const papel of ["COMMON_USER", "MANAGER"]) {
      como(papel);
      assert.equal(await desfecho(() => exigirAreaDoAdmin("/admin/custos")), "404", papel);
      assert.equal(await desfecho(() => Custos(props())), "404", papel);
      assert.equal(await desfecho(() => Custos(props("inicio"))), "404", `${papel} desde o início`);
    }
    como(undefined);
    assert.match(await desfecho(() => Custos(props())), /^redirect \/entrar/);
  });

  it("o ADMIN abre: uma linha por empresa (razão social, CNPJ formatado), quantidades por tipo, custo em R$ e a soma", async () => {
    como("ADMIN");
    const Custos = await pagina();
    const html = renderToStaticMarkup(await Custos(props()));
    assert.match(html, /Alfa Serviços Ltda/);
    assert.match(html, /11\.222\.333\/0001-81/);
    // 1 consulta (R$ 0,24) + 1 emissão (R$ 0,32) = R$ 0,56; a autenticação não entra.
    assert.match(html, /R\$\s0,56/);
    assert.match(html, /Soma do período/);
    assert.match(html, /<tfoot>/);
    assert.match(html, /Desde o início/);
    assert.doesNotMatch(html, /Autenticar/);
    const inicio = renderToStaticMarkup(await Custos(props("inicio")));
    assert.match(inicio, /Soma desde o início/);
    assert.match(inicio, /R\$\s0,56/);
    // Período sem chamadas (nem o atual) ou inválido: mostra o atual, não um erro.
    for (const p of ["2001-01-21", "2026-10-20", "lixo"]) assert.match(renderToStaticMarkup(await Custos(props(p))), /R\$\s0,56/, p);
  });

  it("a tela não tem server action: o período vai no endereço (formulário GET) e a página lê só o banco", () => {
    const arquivos = readdirSync(PASTA);
    for (const f of arquivos) assert.doesNotMatch(readFileSync(path.join(PASTA, f), "utf8"), /["']use server["']/, f);
    const fonte = readFileSync(path.join(PASTA, "page.tsx"), "utf8");
    assert.match(fonte, /<form [^>]*method="get"/);
    const lib = readFileSync(path.join(import.meta.dirname, "..", "lib", "serpro", "custos.ts"), "utf8");
    // Nada que chame a Receita, a BrasilAPI ou o eSocial: nem o cliente do servidor, nem os módulos deles, nem fetch.
    for (const f of [fonte, lib]) {
      const imports = [...f.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
      for (const i of imports) assert.doesNotMatch(i, /serpro\/servidor|brasilapi|esocial|\/http$/, i);
      assert.doesNotMatch(f, /serproDoServidor|fetch\(/);
    }
  });
});
