// Fechado por padrão, conferido no código: toda página, route handler e server action fora da tela de entrada
// confere a sessão no servidor. Uma rota nova que esqueça a conferência faz este teste falhar.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const APP = path.join(import.meta.dirname, "..", "app");
const arquivos = (readdirSync(APP, { recursive: true }) as string[]).map((f) => path.join(APP, f));
const relativo = (f: string) => path.relative(APP, f).split(path.sep).join("/");
const publico = (f: string) => relativo(f).startsWith("entrar/");
// exigirConteudo (o portão das abas de empresa) e exigirAreaDoAdmin (a área do administrador, /admin) chamam exigirSessao
// antes de decidir (conferido abaixo).
const CONFERE = /\b(exigirSessao|exigirConteudo|exigirAreaDoAdmin)\(/;

describe("toda rota confere a sessão no servidor", () => {
  it("acha as páginas, rotas e ações (senão o resto mede o vazio)", () => {
    assert.ok(arquivos.some((f) => relativo(f) === "(painel)/page.tsx"));
    assert.ok(arquivos.some((f) => relativo(f) === "api/sessao/route.ts"));
  });

  it("o portão das abas (exigirConteudo) confere a sessão antes de tudo", () => {
    const portao = readFileSync(path.join(APP, "..", "lib", "empresas", "portao-servidor.ts"), "utf8");
    assert.match(portao, /export async function exigirConteudo\(\)[\s\S]*?\{\s*const sessao = await exigirSessao\(\);/);
  });

  it("exigirAreaDoAdmin confere a sessão e recusa (404) quem não vê a página da área (lib/admin.ts)", () => {
    const servidor = readFileSync(path.join(APP, "..", "lib", "autenticacao", "servidor.ts"), "utf8");
    assert.match(servidor, /export async function exigirAreaDoAdmin\(href: HrefDoAdmin\)[\s\S]*?\{\s*const sessao = await exigirSessao\(\);\s*const \{ papel \} = sessao\.usuario;\s*if \(!podeVerNoAdmin\(papel, href\)\) \{[^}]*notFound\(\);\s*\}/);
    // A única saída sem 404 é /admin para quem entra na área (MANAGER): vai para a primeira página que vê.
    assert.match(servidor, /if \(href === AREA_DO_ADMIN && inicio\) redirect\(inicio\);/);
    // O layout confere a entrada: COMMON_USER recebe 404.
    assert.match(servidor, /export async function exigirEntradaNaAreaDoAdmin\(\)[\s\S]*?\{\s*const sessao = await exigirSessao\(\);\s*if \(!entraNaAreaDoAdmin\(sessao\.usuario\.papel\)\) notFound\(\);/);
    // As antigas exigirGestao/exigirAdmin saíram: a área tem uma barreira só, com a lista de quem vê o quê.
    assert.doesNotMatch(servidor, /export async function (exigirGestao|exigirAdmin)\(/);
  });

  it("toda página fora de /entrar chama exigirSessao, exigirConteudo ou exigirAreaDoAdmin", () => {
    for (const f of arquivos.filter((f) => /[\\/]page\.tsx$/.test(f) && !publico(f))) {
      assert.match(readFileSync(f, "utf8"), CONFERE, relativo(f));
    }
  });

  it("toda página fica dentro do layout do painel ou do da área do administrador, que também conferem", () => {
    for (const f of arquivos.filter((f) => /[\\/]page\.tsx$/.test(f) && !publico(f))) assert.ok(/^(\(painel\)|admin)\//.test(relativo(f)) || relativo(f) === "admin/page.tsx", relativo(f));
    assert.match(readFileSync(path.join(APP, "(painel)", "layout.tsx"), "utf8"), CONFERE);
    assert.match(readFileSync(path.join(APP, "admin", "layout.tsx"), "utf8"), /await exigirEntradaNaAreaDoAdmin\(\)/);
  });

  it("todo route handler usa comSessao (menos o da sessão local, que só abre sessão com o login desligado)", () => {
    for (const f of arquivos.filter((f) => /[\\/]route\.ts$/.test(f))) {
      // A sessão local é quem cria a sessão (não pode exigir uma): ela tem de passar por abrirSessaoLocal, que
      // recusa em produção e com o login ligado (testes/sessao-local.test.ts).
      if (relativo(f) === "sessao-local/route.ts") assert.match(readFileSync(f, "utf8"), /\babrirSessaoLocal\(/, relativo(f));
      else assert.match(readFileSync(f, "utf8"), /\bcomSessao\(/, relativo(f));
    }
  });

  it("toda server action fora de /entrar confere a sessão (sair só apaga a do próprio cookie)", () => {
    const acoes = arquivos.filter((f) => /\.tsx?$/.test(f) && /^\s*["']use server["']/.test(readFileSync(f, "utf8")));
    assert.ok(acoes.length >= 2);
    for (const f of acoes.filter((f) => !publico(f))) {
      const blocos = readFileSync(f, "utf8").split(/export async function /).slice(1);
      for (const bloco of blocos) {
        const nome = bloco.slice(0, bloco.indexOf("("));
        if (nome === "sairAcao") continue;
        assert.match(bloco, CONFERE, `${relativo(f)}: ${nome}`);
      }
    }
  });
});
