// QA (Parte 4, ciclo 3 do termo): o prazo do aviso tem uma fonte só e a tela de assinatura não puxa situacao.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { AVISO_DIAS as deAviso } from "@/lib/termo/aviso";
import { AVISO_DIAS as deSituacao } from "@/lib/termo/situacao";

const raiz = join(import.meta.dirname, "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

describe("AVISO_DIAS (QA)", () => {
  it("situacao.ts reexporta o mesmo valor de aviso.ts", () => {
    assert.equal(deSituacao, deAviso);
    assert.equal(deAviso, 30);
  });

  it("aviso.ts não importa nada (seguro para o navegador)", () => {
    assert.doesNotMatch(ler("lib/termo/aviso.ts"), /^\s*import\b/m);
  });

  it("assinar-termo.tsx usa a constante, não um número fixo, e não importa situacao.ts nem termo-autorizacao por valor", () => {
    const fonte = ler("app/(painel)/autorizacao/assinar-termo.tsx");
    assert.match(fonte, /from "@\/lib\/termo\/aviso"/);
    assert.doesNotMatch(fonte, /faltar\s+30\s+dias/);
    assert.doesNotMatch(fonte, /from "@\/lib\/termo\/situacao"/);
    // Só import de tipo estático do núcleo do termo; o valor vem por import() sob demanda.
    for (const linha of fonte.split("\n").filter((l) => /^import .*termo-autorizacao/.test(l))) {
      assert.match(linha, /^import type /, linha);
    }
  });
});
