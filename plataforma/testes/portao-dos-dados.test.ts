// Portão do primeiro login, DE VERDADE no servidor (não a cópia da regra): sessão real gravada no banco de TESTE, cookie
// assinado, e as páginas, o layout, as server actions e os route handlers de app/ chamados como o Next chama. O usuário
// comum sem "Seus dados" vai para /meus-dados em tudo (403 nas rotas), menos na própria tela, nos termos e em sair; ADMIN e
// MANAGER entram direto. Só o banco contabilizadev_teste; nenhuma chamada externa (a sessão é barrada antes de qualquer
// leitura).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
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
  exports: { cookies: async () => ({ get: () => (cookieAtual ? { value: cookieAtual } : undefined), set() {}, delete() {} }), headers: async () => new Headers() },
} as never;

const SEGREDO = "portao-dos-dados-segredo-de-sessao-com-mais-de-32-caracteres";
const ADMIN = "admin@portao-dos-dados.teste";
const APP = path.join(import.meta.dirname, "..", "app");
const arquivos = (readdirSync(APP, { recursive: true }) as string[]).map((f) => path.join(APP, f));
const relativo = (f: string) => path.relative(APP, f).split(path.sep).join("/");

async function desfecho(fn: () => Promise<unknown>): Promise<string> {
  try {
    const r = await fn();
    return r instanceof Response ? `status ${r.status}` : "ok";
  } catch (e) {
    const d = String((e as { digest?: string }).digest ?? (e as Error).message);
    if (d.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return "404";
    if (d.startsWith("NEXT_REDIRECT")) return `redirect ${d.split(";")[2]}`;
    return `erro ${(e as Error).message}`;
  }
}

const PROPS = { searchParams: Promise.resolve({}), params: Promise.resolve({ tipo: "guia", id: "00000000-0000-0000-0000-000000000000", pa: "2026-09" }) };

describe("portão do primeiro login no servidor", async () => {
  let t: BancoDeTeste;
  const cookies: Record<string, string> = {};
  before(async () => {
    t = await prepararBancoDeTeste();
    const url = urlDoBancoDeTeste();
    assert.ok(nomeDoBanco(url).endsWith("_teste"));
    Object.assign(process.env, { DATABASE_URL: url, SESSAO_SEGREDO: SEGREDO, ADMIN_EMAILS: ADMIN, AUTH_DISABLED: "false" });
    await t.limpar();
    const { usuarios, sessoes, dadosPessoais } = await import("@/banco/esquema");
    const { novoToken, assinarToken, hashDoToken } = await import("@/lib/autenticacao/cookie");
    const { VERSAO_DOS_TERMOS } = await import("@/lib/usuarios/validacao");
    const contas = [
      ["COMUM", "COMMON_USER", "comum@portao.teste"],
      ["COMUM_ANTIGO", "COMMON_USER", "antigo@portao.teste"],
      ["COMUM_COMPLETO", "COMMON_USER", "completo@portao.teste"],
      ["MANAGER", "MANAGER", "gestor@portao.teste"],
      ["ADMIN", "ADMIN", ADMIN],
    ] as const;
    for (const [nome, papel, email] of contas) {
      const [u] = await t.banco.insert(usuarios).values({ email, nome, provedor: "GOOGLE", provedorId: email, papel }).returning({ id: usuarios.id });
      const token = novoToken();
      await t.banco.insert(sessoes).values({ usuarioId: u.id, tokenHash: hashDoToken(token), expiraEm: new Date(Date.now() + 3_600_000) });
      cookies[nome] = assinarToken(token, SEGREDO);
      const dados = {
        usuarioId: u.id,
        nomeCompleto: "Pessoa de Teste",
        dataNascimento: "1990-01-01",
        whatsapp: "+5548999990000",
        cep: "88010000",
        logradouro: "Rua",
        numero: "1",
        bairro: "Centro",
        cidade: "Florianópolis",
        uf: "SC",
        termosAceitosEm: new Date(),
      };
      if (nome === "COMUM_COMPLETO") await t.banco.insert(dadosPessoais).values({ ...dados, cpf: "52912345634", termosVersao: VERSAO_DOS_TERMOS });
      // Aceitou uma versão antiga dos termos: passa pela tela de novo no próximo acesso.
      if (nome === "COMUM_ANTIGO") await t.banco.insert(dadosPessoais).values({ ...dados, cpf: "11112345663", termosVersao: "versao-antiga" });
    }
  });
  after(async () => {
    await t.limpar();
    await t.fechar();
    const g = globalThis as unknown as { __conexao?: { end: () => Promise<void> } };
    await g.__conexao?.end();
  });

  const como = (conta: string) => (cookieAtual = cookies[conta]);

  it("exigirSessao: o usuário comum sem os dados (ou com o aceite antigo) vai para /meus-dados; ADMIN e MANAGER entram direto", async () => {
    const { exigirSessao, exigirSessaoSemDados } = await import("@/lib/autenticacao/servidor");
    for (const conta of ["COMUM", "COMUM_ANTIGO"]) {
      como(conta);
      assert.equal(await desfecho(exigirSessao), "redirect /meus-dados", conta);
      assert.equal(await desfecho(exigirSessaoSemDados), "ok", conta);
    }
    for (const conta of ["COMUM_COMPLETO", "MANAGER", "ADMIN"]) {
      como(conta);
      assert.equal(await desfecho(exigirSessao), "ok", conta);
    }
  });

  it("todas as páginas e o layout do painel mandam o usuário comum sem dados para /meus-dados", async () => {
    como("COMUM");
    const paginas = arquivos.filter((f) => /(^|\/)(page|layout)\.tsx$/.test(relativo(f)) && relativo(f).startsWith("(painel)/"));
    assert.ok(paginas.length >= 15);
    for (const f of paginas) {
      const mod = await import(f);
      assert.equal(await desfecho(() => mod.default({ ...PROPS, children: null })), "redirect /meus-dados", relativo(f));
    }
  });

  it("todas as server actions do painel também (a ação não roda)", async () => {
    como("COMUM");
    const acoes = arquivos.filter((f) => /\.tsx?$/.test(f) && relativo(f).startsWith("(painel)/") && /^\s*["']use server["']/.test(readFileSync(f, "utf8")));
    assert.ok(acoes.length >= 8);
    let contadas = 0;
    for (const f of acoes) {
      const mod = (await import(f)) as Record<string, unknown>;
      for (const [nome, fn] of Object.entries(mod)) {
        if (typeof fn !== "function" || nome === "sairAcao") continue;
        contadas++;
        assert.equal(await desfecho(() => (fn as (...a: unknown[]) => Promise<unknown>)(new FormData(), new FormData())), "redirect /meus-dados", `${relativo(f)}: ${nome}`);
      }
    }
    assert.ok(contadas >= 30, `${contadas} ações`);
  });

  it("os route handlers respondem 403 (preencha seus dados) ao usuário comum sem dados", async () => {
    como("COMUM");
    // A rota de saúde (health check do Coolify) é pública e não tem sessão nem dado: fica fora (testes/producao.test.ts).
    for (const f of arquivos.filter((f) => /route\.ts$/.test(f) && !relativo(f).startsWith("sessao-local/") && relativo(f) !== "api/saude/route.ts")) {
      const mod = await import(f);
      assert.equal(await desfecho(() => mod.GET(new Request("http://localhost/x"), PROPS)), "status 403", relativo(f));
    }
    // ADMIN sem dados: a rota da sessão responde normalmente.
    como("ADMIN");
    const sessao = await import(path.join(APP, "api", "sessao", "route.ts"));
    assert.equal(await desfecho(() => sessao.GET(new Request("http://localhost/api/sessao"), {})), "status 200");
  });

  it("ficam livres só a tela Seus dados, os termos (com o layout deles) e as ações deles", async () => {
    como("COMUM");
    for (const rel of ["(conta)/layout.tsx", "(conta)/meus-dados/page.tsx", "(conta)/termos/page.tsx"]) {
      const mod = await import(path.join(APP, rel));
      assert.equal(await desfecho(() => mod.default({ ...PROPS, children: null })), "ok", rel);
    }
    const { buscarCepAcao, salvarDadosAcao } = await import(path.join(APP, "(conta)", "meus-dados", "acoes.ts"));
    // Formulário vazio: volta com os erros (a ação rodou, sem redirecionar e sem gravar).
    const r = await salvarDadosAcao(undefined, new FormData());
    assert.ok(r?.erros?.cpf && r.erros.aceite);
    assert.deepEqual(await buscarCepAcao("123"), { erro: "CEP inválido: são 8 números." });
  });

  it("a área do administrador continua 404 para o usuário comum (não manda para Seus dados, que diria que a página existe)", async () => {
    const { exigirAreaDoAdmin, exigirEntradaNaAreaDoAdmin } = await import("@/lib/autenticacao/servidor");
    como("COMUM");
    assert.equal(await desfecho(exigirEntradaNaAreaDoAdmin), "404");
    assert.equal(await desfecho(() => exigirAreaDoAdmin("/admin/usuarios")), "404");
    como("ADMIN");
    assert.equal(await desfecho(() => exigirAreaDoAdmin("/admin/plataforma")), "ok");
  });
});
