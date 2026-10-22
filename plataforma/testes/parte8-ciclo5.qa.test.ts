// QA da Parte 8, ciclo 5: casos de borda das correções (DEFIS do ano que fechou no sino e na virada do ano em Brasília,
// leitura sem os PDFs, consulta do CNPJ lida uma vez também quando a empresa é do Fator R, falha isolada no Fator R).
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { defis } from "@/banco/esquema";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { avisosDaEmpresa } from "@/lib/avisos/coleta";
import { exigirAcessoEmpresa } from "@/lib/empresas/acesso";
import { defisDaEmpresa, defisDoAno } from "@/lib/historico/leitura";
import type { Situacao } from "@/lib/termo/situacao";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";
import { cadastrarComprovada, consultarComDados } from "./apoio-empresa";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const em = (iso: string) => new Date(`${iso}-03:00`);
const AGORA = em("2026-10-20T10:00:00");
const PERFIS = { ana: perfil("ana@a.com", "sub-ana"), beto: perfil("beto@b.com", "sub-beto") };
const AUSENTE: Situacao = { estado: "ausente" };

async function empresa(quem: "ana" | "beto" = "ana", exemplo: "ti-anexo-iii" | "ti-fator-r" = "ti-anexo-iii") {
  const usuario = (await entrarComGoogle(depsLogin(t.banco, PERFIS), quem)).usuario;
  const numero = exemplo === "ti-anexo-iii" ? "98.765.432/0001-98" : "12.345.678/0001-95";
  const r = await consultarComDados(t.banco, usuario, numero, { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo(exemplo) });
  assert.equal(r.tipo, "previa");
  const empresaId = await cadastrarComprovada(t.banco, usuario, r.previa.token, { segredo: SEGREDO, agora: AGORA });
  return { usuario, empresaId, acesso: await exigirAcessoEmpresa(t.banco, usuario, empresaId) };
}

function leituraQueCai(): unknown {
  const leitura: object = new Proxy({}, { get: (_, k) => (k === "then" ? (_ok: unknown, falha: (e: Error) => void) => falha(new Error("caiu")) : () => leitura) });
  return leitura;
}

function bancoEspiao(falhar?: string, lidas: string[] = []): BancoDeTeste["banco"] {
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
                const nome = String((tabela as { [k: symbol]: string })[Symbol.for("drizzle:Name")]);
                lidas.push(nome);
                return nome === falhar ? leituraQueCai() : v.call(c, tabela);
              };
            return typeof v === "function" ? v.bind(c) : v;
          },
        });
      };
    },
  });
}

const PDF = Buffer.from("%PDF-1.4 teste");

describe("QA ciclo 5: leitura da DEFIS sem os PDFs", () => {
  it("registro sem PDFs: declaracao e recibo são false (não null, não Buffer)", async () => {
    const { empresaId, acesso } = await empresa();
    await t.banco.insert(defis).values([
      { empresaId, ano: 2024, situacao: "nao-encontrada", consultadaEm: AGORA },
      { empresaId, ano: 2025, situacao: "entregue", idDefis: "X", declaracaoPdf: PDF, reciboPdf: null, consultadaEm: AGORA },
    ]);
    const lista = await defisDaEmpresa(t.banco, acesso);
    assert.deepEqual(
      lista.map((d) => [d.ano, d.declaracao, d.recibo]),
      [
        [2025, true, false],
        [2024, false, false],
      ],
    );
  });

  it("defisDoAno com vários anos devolve exatamente o pedido", async () => {
    const { empresaId, acesso } = await empresa();
    await t.banco.insert(defis).values([
      { empresaId, ano: 2024, situacao: "nao-encontrada", consultadaEm: em("2025-05-01T10:00:00") },
      { empresaId, ano: 2025, situacao: "entregue", consultadaEm: AGORA },
    ]);
    assert.equal((await defisDoAno(t.banco, acesso, 2024))?.situacao, "nao-encontrada");
    assert.equal((await defisDoAno(t.banco, acesso, 2025))?.situacao, "entregue");
    assert.equal(await defisDoAno(t.banco, acesso, 2026), null);
  });
});

describe("QA ciclo 5: o sino lê só o ano que fechou, no fuso de Brasília", () => {
  it("31/12/2026 às 23h30 em Brasília (já 01/01/2027 em UTC): ainda olha 2025, entregue, sem aviso", async () => {
    const { empresaId, acesso } = await empresa();
    await t.banco.insert(defis).values({ empresaId, ano: 2025, situacao: "entregue", consultadaEm: AGORA });
    const avisos = await avisosDaEmpresa(t.banco, acesso, em("2026-12-31T23:30:00"), { termo: AUSENTE, log: () => {} });
    assert.ok(!avisos.some((a) => a.chave?.startsWith("defis")), JSON.stringify(avisos.map((a) => a.chave)));
  });

  it("01/01/2027 em Brasília: passa a olhar 2026; a entrega de 2025 não esconde o aviso de 2026", async () => {
    const { empresaId, acesso } = await empresa();
    await t.banco.insert(defis).values({ empresaId, ano: 2025, situacao: "entregue", consultadaEm: AGORA });
    const avisos = await avisosDaEmpresa(t.banco, acesso, em("2027-01-01T00:30:00"), { termo: AUSENTE, log: () => {} });
    const d = avisos.find((a) => a.chave === "defis:2026");
    assert.ok(d, JSON.stringify(avisos.map((a) => a.chave)));
    assert.equal(d.nivel, "info");
  });

  it("depois do prazo, 'não encontrada' de 2026 consultada em abril dá vermelho; a de 2025 entregue não interfere", async () => {
    const { empresaId, acesso } = await empresa();
    await t.banco.insert(defis).values([
      { empresaId, ano: 2025, situacao: "entregue", consultadaEm: AGORA },
      { empresaId, ano: 2026, situacao: "nao-encontrada", consultadaEm: em("2027-04-02T10:00:00") },
    ]);
    const avisos = await avisosDaEmpresa(t.banco, acesso, em("2027-04-10T10:00:00"), { termo: AUSENTE, log: () => {} });
    assert.equal(avisos.find((a) => a.chave === "defis:2026")?.nivel, "vencida");
  });

  it("outra empresa com a DEFIS entregue não esconde o aviso desta", async () => {
    const ana = await empresa("ana");
    const beto = await empresa("beto", "ti-fator-r");
    await t.banco.insert(defis).values({ empresaId: beto.empresaId, ano: 2026, situacao: "entregue", consultadaEm: em("2027-02-01T10:00:00") });
    const avisos = await avisosDaEmpresa(t.banco, ana.acesso, em("2027-02-10T10:00:00"), { termo: AUSENTE, log: () => {} });
    assert.ok(avisos.some((a) => a.chave === "defis:2026"));
  });
});

describe("QA ciclo 5: consulta do CNPJ lida uma vez também na empresa do Fator R", () => {
  it("empresa do Fator R: 1 leitura de consultas_cnpj por montagem", async () => {
    const { acesso } = await empresa("beto", "ti-fator-r");
    const lidas: string[] = [];
    await avisosDaEmpresa(bancoEspiao(undefined, lidas), acesso, AGORA, { termo: AUSENTE, log: () => {} });
    assert.equal(lidas.filter((n) => n === "consultas_cnpj").length, 1);
  });

  it("com a consulta caindo, o Fator R vai para o log e não há rejeição sem tratamento", async () => {
    const { acesso } = await empresa("beto", "ti-fator-r");
    const soltas: unknown[] = [];
    const ouvir = (e: unknown) => void soltas.push(e);
    process.on("unhandledRejection", ouvir);
    try {
      const log: string[] = [];
      await avisosDaEmpresa(bancoEspiao("consultas_cnpj"), acesso, AGORA, { termo: AUSENTE, log: (m) => void log.push(m) });
      await new Promise((r) => setImmediate(r));
      assert.ok(log.some((l) => /"Fator R"/.test(l) && /caiu/.test(l)), log.join("\n"));
      assert.deepEqual(soltas, []);
    } finally {
      process.off("unhandledRejection", ouvir);
    }
  });
});
