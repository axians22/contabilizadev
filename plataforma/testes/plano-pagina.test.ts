// A página /admin/plano com as abas Plano e Segurança: o HTML desenhado (aba no endereço, aba inválida cai em Plano, a
// Segurança com os selos de gravidade, a contagem e o Feito; o Backlog como lista própria na aba Plano) e a barreira de
// verdade no servidor (só ADMIN), com sessão real no banco de TESTE. Nenhuma chamada externa.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConteudoDoPlano } from "@/app/admin/plano/conteudo";
import { interpretarPlano, lerPlano } from "@/lib/plano";
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

const EXEMPLO = interpretarPlano(`PLANO
PARTE 0 - PREPARAÇÃO  [FEITO em 16/10/2026: pronto]
 1. Passo.

PRIMEIRA VERSÃO (MVP) ATENDE SÓ
- Item do MVP.

BACKLOG (fora do plano por enquanto)
- Item do backlog.

SEGURANÇA
Parágrafo da auditoria.
- [Alta] Achado alto.
- [Média] Achado médio um.
- [Média] Achado médio dois.
- [Baixa] Achado baixo resolvido. [FEITO em 22/10/2026: corrigido]
- [Decisão] Decisão pendente.

DECISÕES TOMADAS
- Decisão tomada.
`);

const html = (aba: "plano" | "seguranca", plano = EXEMPLO) => renderToStaticMarkup(createElement(ConteudoDoPlano, { plano, aba }));
const abaAtual = (h: string) => h.match(/<a[^>]*aria-current="page"[^>]*>([^<]+)</)?.[1];

describe("página /admin/plano: as abas", () => {
  it("as duas abas com link próprio; a aba ativa marcada", () => {
    const h = html("plano");
    assert.match(h, /href="\/admin\/plano"[^>]*>Plano</);
    assert.match(h, /href="\/admin\/plano\?aba=seguranca"[^>]*>Segurança</);
    assert.equal(abaAtual(h), "Plano");
    assert.equal(abaAtual(html("seguranca")), "Segurança");
  });

  it("aba Plano: partes e listas, o Backlog como lista própria e sem a seção Segurança", () => {
    const h = html("plano");
    assert.match(h, /Preparação/);
    assert.match(h, /<h2[^>]*>Backlog \(fora do plano por enquanto\)<\/h2>/);
    assert.match(h, /<h2[^>]*>Primeira versão \(MVP\) atende só<\/h2>/);
    // O item do backlog fica depois do título do Backlog, não na lista do MVP.
    assert.ok(h.indexOf("Item do backlog") > h.indexOf("Backlog (fora"));
    assert.ok(h.indexOf("Item do MVP") < h.indexOf("Backlog (fora"));
    assert.doesNotMatch(h, /Achado alto|Parágrafo da auditoria|>Segurança<\/h2>/);
  });

  it("aba Segurança: contagem por gravidade no topo, o parágrafo e cada item com o selo, na ordem do arquivo", () => {
    const h = html("seguranca");
    const contagem = h.slice(h.indexOf('aria-label="Achados por gravidade"'), h.indexOf("Parágrafo da auditoria"));
    for (const [n, g] of [["1", "Alta"], ["2", "Média"], ["0", "Baixa"], ["1", "Decisão"], ["1", "Feito"]])
      assert.match(contagem, new RegExp(`>${n}</span> ${g}<`), g);
    assert.match(h, /Parágrafo da auditoria\./);
    const ordem = ["Achado alto", "Achado médio um", "Achado médio dois", "Achado baixo resolvido", "Decisão pendente"].map((t) => h.indexOf(t));
    assert.ok(ordem.every((p, i) => p > 0 && (i === 0 || p > ordem[i - 1])), String(ordem));
    // Alta é a mais forte (a cor de Urgente); Feito com o mesmo estilo de Feito das partes.
    assert.match(h, /class="[^"]*bg-bad text-white[^"]*">Alta</);
    assert.match(h, /class="[^"]*bg-warn-soft text-warn[^"]*">Média</);
    assert.match(h, /class="[^"]*bg-accent text-on-accent[^"]*">Feito</);
    assert.match(h, /Feito em 22\/10\/2026: corrigido · gravidade Baixa/);
    assert.doesNotMatch(h, /Item do MVP|Preparação/);
  });

  it("plano sem a seção Segurança: a aba diz isso em vez de quebrar", () => {
    assert.match(html("seguranca", interpretarPlano("P\nPARTE 0 - A\n 1. x\n")), /ainda não tem a seção Segurança/);
  });

  it("o plano.txt de verdade desenha as duas abas", () => {
    const real = lerPlano();
    assert.match(html("seguranca", real), /Sem limite de chamadas pagas por empresa/);
    assert.match(html("plano", real), /Backlog \(fora do plano por enquanto\)/);
  });
});

const SEGREDO = "teste-plano-pagina-segredo-de-sessao-com-mais-de-32-caracteres";
const ADMIN = "admin@plano-pagina.teste";

async function desfecho(fn: () => Promise<unknown>): Promise<{ r: string; valor?: unknown }> {
  try {
    return { r: "ok", valor: await fn() };
  } catch (e) {
    const d = String((e as { digest?: string }).digest ?? (e as Error).message);
    if (d.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return { r: "404" };
    if (d.startsWith("NEXT_REDIRECT")) return { r: `redirect ${d.split(";")[2]}` };
    throw e;
  }
}

describe("página /admin/plano: só ADMIN, com sessão real no banco de teste", async () => {
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
    for (const [papel, email] of [["COMMON_USER", "comum@plano-pagina.teste"], ["MANAGER", "gestor@plano-pagina.teste"], ["ADMIN", ADMIN]] as const) {
      const [u] = await t.banco.insert(usuarios).values({ email, nome: papel, provedor: "GOOGLE", provedorId: email, papel }).returning({ id: usuarios.id });
      const token = novoToken();
      await t.banco.insert(sessoes).values({ usuarioId: u.id, tokenHash: hashDoToken(token), expiraEm: new Date(Date.now() + 3_600_000) });
      cookies[papel] = assinarToken(token, SEGREDO);
    }
  });
  after(async () => {
    await t.limpar();
    await t.fechar();
    const g = globalThis as unknown as { __conexao?: { end: () => Promise<void> } };
    await g.__conexao?.end();
  });

  const pagina = async (papel: string | undefined, aba?: string) => {
    cookieAtual = papel ? cookies[papel] : undefined;
    const PaginaPlano = (await import("@/app/admin/plano/page")).default;
    return desfecho(() => PaginaPlano({ searchParams: Promise.resolve(aba === undefined ? {} : { aba }) }));
  };

  it("COMMON_USER e MANAGER recebem 404 nas duas abas; sem sessão vai para o login", async () => {
    for (const papel of ["COMMON_USER", "MANAGER"])
      for (const aba of [undefined, "seguranca"]) assert.equal((await pagina(papel, aba)).r, "404", `${papel} ${aba}`);
    assert.match((await pagina(undefined, "seguranca")).r, /^redirect \/entrar/);
  });

  it("ADMIN abre: ?aba=seguranca mostra Segurança; aba inválida cai em Plano", async () => {
    const desenhar = async (aba?: string) => {
      const { r, valor } = await pagina("ADMIN", aba);
      assert.equal(r, "ok");
      return renderToStaticMarkup(valor as React.ReactElement);
    };
    assert.equal(abaAtual(await desenhar("seguranca")), "Segurança");
    for (const aba of [undefined, "x", "SEGURANCA"]) {
      const h = await desenhar(aba);
      assert.equal(abaAtual(h), "Plano", String(aba));
      assert.match(h, /Plano do projeto/);
    }
  });
});
