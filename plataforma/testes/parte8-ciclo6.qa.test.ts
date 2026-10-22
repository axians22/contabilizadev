// QA da Parte 8, ciclo 6: a consulta do CNPJ repassada pelo painel também quando ela não existe (null) e o instante
// único da página do painel.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa } from "@/lib/empresas/acesso";
import { ultimaConsulta } from "@/lib/empresas/receita";
import { baseDoMes, ultimoMesApuravel } from "@/lib/rotina/base";
import { avisoFatorR } from "@/lib/rotina/fator-r";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";
import { cadastrarComprovada, consultarComDados } from "./apoio-empresa";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const em = (iso: string) => new Date(`${iso}-03:00`);
const AGORA = em("2026-10-20T10:00:00");
const PERFIS = { ana: perfil("ana@a.com", "sub-ana") };

async function empresa(exemplo: "ti-anexo-iii" | "ti-fator-r") {
  const usuario = (await entrarComGoogle(depsLogin(t.banco, PERFIS), "ana")).usuario;
  const numero = exemplo === "ti-anexo-iii" ? "98.765.432/0001-98" : "12.345.678/0001-95";
  const r = await consultarComDados(t.banco, usuario, numero, { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo(exemplo) });
  assert.equal(r.tipo, "previa");
  const empresaId = await cadastrarComprovada(t.banco, usuario, r.previa.token, { segredo: SEGREDO, agora: AGORA });
  return exigirAcessoEmpresa(t.banco, usuario, empresaId);
}

function bancoEspiao(lidas: string[]): BancoDeTeste["banco"] {
  return new Proxy(t.banco, {
    get(alvo, chave) {
      const valor = Reflect.get(alvo, chave, alvo);
      if (chave !== "select") return typeof valor === "function" ? valor.bind(alvo) : valor;
      return (...args: unknown[]) => {
        const consulta = (alvo.select as (...a: unknown[]) => { from: (t: unknown) => unknown })(...args);
        return new Proxy(consulta, {
          get(c, k) {
            const v = Reflect.get(c, k, c);
            if (k === "from")
              return (tabela: unknown) => {
                lidas.push(String((tabela as { [k: symbol]: string })[Symbol.for("drizzle:Name")]));
                return v.call(c, tabela);
              };
            return typeof v === "function" ? v.bind(c) : v;
          },
        });
      };
    },
  });
}

describe("QA ciclo 6: consulta do CNPJ repassada", () => {
  it("consulta repassada como null: não lê de novo, sem regra e sem aviso do Fator R", async () => {
    const acesso = await empresa("ti-fator-r");
    const lidas: string[] = [];
    const espiao = bancoEspiao(lidas);
    assert.equal(await avisoFatorR(espiao, acesso, AGORA, Promise.resolve(null)), null);
    const base = await baseDoMes(espiao, acesso, ultimoMesApuravel(AGORA), AGORA, Promise.resolve(null));
    assert.equal(base.regra, null);
    assert.equal(lidas.filter((n) => n === "consultas_cnpj").length, 0);
  });

  it("consulta repassada dá o mesmo resultado que a lida pela própria função (Anexo III e Fator R)", async () => {
    for (const exemplo of ["ti-anexo-iii", "ti-fator-r"] as const) {
      await t.limpar();
      const acesso = await empresa(exemplo);
      const consulta = await ultimaConsulta(t.banco, acesso);
      const pa = ultimoMesApuravel(AGORA);
      assert.deepEqual(await baseDoMes(t.banco, acesso, pa, AGORA, Promise.resolve(consulta)), await baseDoMes(t.banco, acesso, pa, AGORA));
      assert.deepEqual(await avisoFatorR(t.banco, acesso, AGORA, Promise.resolve(consulta)), await avisoFatorR(t.banco, acesso, AGORA));
    }
  });
});

describe("QA ciclo 6: página do painel com um instante só", () => {
  const fonte = readFileSync(join(import.meta.dirname, "..", "app", "(painel)", "page.tsx"), "utf8");
  it("um único new Date() e nenhum Date.now()", () => {
    assert.equal(fonte.match(/new Date\(/g)?.length ?? 0, 1);
    assert.equal(/Date\.now\(/.test(fonte), false);
  });
  // A declaração anual saiu do painel (o aviso defis:<ano> fica só no sino), então a página não calcula mais o ano que
  // fechou; segue valendo não usar o ano do relógio do servidor.
  it("sem ano do relógio do servidor e sem ler a declaração anual (ela fica só no sino)", () => {
    assert.equal(/getFullYear|getUTCFullYear/.test(fonte), false);
    assert.equal(/defisDoAno|avisoDaDeclaracaoAnual/.test(fonte), false);
  });
});
