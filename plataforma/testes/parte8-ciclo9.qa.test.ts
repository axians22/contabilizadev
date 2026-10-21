// QA, Parte 8 (ciclo 9): o componente AbaEmConstrucao saiu; toda aba de empresa continua passando pelo portão e
// nenhuma mostra "em construção"/"Em breve".
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { ABAS_DA_EMPRESA } from "@/lib/abas";

const RAIZ = path.join(import.meta.dirname, "..");
const PAINEL = path.join(RAIZ, "app", "(painel)");
const pagina = (href: string) => path.join(PAINEL, href === "/" ? "" : href, "page.tsx");

describe("QA: sem AbaEmConstrucao, todas as abas pelo portão", () => {
  it("nenhum arquivo de app, lib ou testes cita AbaEmConstrucao", () => {
    for (const pasta of ["app", "lib", "testes"]) {
      const arquivos = (readdirSync(path.join(RAIZ, pasta), { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f) && !f.endsWith("ciclo9.qa.test.ts"));
      for (const f of arquivos) assert.doesNotMatch(readFileSync(path.join(RAIZ, pasta, f), "utf8"), /AbaEmConstrucao/, `${pasta}/${f}`);
    }
  });

  it("portao.tsx exporta só PortaoFechado", () => {
    const codigo = readFileSync(path.join(PAINEL, "portao.tsx"), "utf8");
    assert.deepEqual([...codigo.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]), ["PortaoFechado"]);
  });

  it("cada aba da lista tem página, usa exigirConteudo e PortaoFechado e não diz 'em construção' nem 'Em breve'", () => {
    for (const a of ABAS_DA_EMPRESA) {
      assert.ok(existsSync(pagina(a.href)), a.href);
      const codigo = readFileSync(pagina(a.href), "utf8");
      assert.match(codigo, /exigirConteudo\(/, a.href);
      assert.match(codigo, /PortaoFechado/, a.href);
      assert.doesNotMatch(codigo, /em constru[cç][aã]o|Em breve/i, a.href);
    }
  });
});
