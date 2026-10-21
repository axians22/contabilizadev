// QA da Parte 7, ciclo 3: o resumo da confirmação depois da retirada do ramo falso de transDctf, e nenhuma sobra do
// texto antigo ("o S-1299 vai sem o pedido", "não vai neste envio", dctfJaTransmitida) no código nem no README.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { linhasDoResumo, type ResumoParaTela } from "@/lib/esocial/resumo";
import { MENSAGENS_DA_ROTINA } from "@/lib/rotina/mensagens";

const BASE: ResumoParaTela = { mes: "2026-09", cpf: "52998224725", proLabore: 1518, inss: 166.98, liquido: 1351.02, pagamento: null, eventos: [] };
const dctf = (r: ResumoParaTela) => linhasDoResumo(r).filter(([n]) => n === "DCTFWeb");

describe("QA Parte 7 ciclo 3: linha da DCTFWeb no resumo", () => {
  it("só aparece quando o S-1299 vai, em qualquer combinação (mensal, só fechamento, retificação)", () => {
    assert.deepEqual(dctf({ ...BASE, eventos: ["S-1200", "S-1210", "S-1299"] }), [["DCTFWeb", "transmitida pelo eSocial no fechamento"]]);
    assert.deepEqual(dctf({ ...BASE, eventos: ["S-1299"] }), [["DCTFWeb", "transmitida pelo eSocial no fechamento"]]);
    assert.deepEqual(dctf({ ...BASE, eventos: ["S-1298", "S-1200", "S-1299"] }), [["DCTFWeb", "transmitida pelo eSocial no fechamento"]]);
    assert.deepEqual(dctf({ ...BASE, eventos: ["S-1200", "S-1210"] }), []);
    assert.deepEqual(dctf({ ...BASE, eventos: [] }), []);
  });

  it("nenhuma linha diz que a DCTFWeb não vai; pagamento e 'sem pagamento anterior' convivem", () => {
    const linhas = linhasDoResumo({
      ...BASE,
      eventos: ["S-1200", "S-1299"],
      pagamento: { perRef: "2026-08", dtPgto: "2026-09-05", liquido: 1351.02 },
      semPagamentoDe: null,
    });
    assert.ok(linhas.every(([, v]) => !/não vai neste envio|sem o pedido/i.test(v)));
    const sem = linhasDoResumo({ ...BASE, eventos: ["S-1200", "S-1299"], semPagamentoDe: "2026-08" });
    assert.deepEqual(sem.find(([n]) => n === "Pagamento"), ["Pagamento", "o do pró-labore de agosto de 2026 não vai"]);
  });

  it("chaves de linha únicas (a tela usa o nome como key do React)", () => {
    const linhas = linhasDoResumo({ ...BASE, eventos: ["S-1200", "S-1210", "S-1299"], pagamento: { perRef: "2026-08", dtPgto: "2026-09-05", liquido: 1 }, semPagamentoDe: "2026-07" });
    const nomes = linhas.map(([n]) => n);
    assert.equal(new Set(nomes).size, nomes.length, `nomes repetidos: ${nomes.join(", ")}`);
  });
});

describe("QA Parte 7 ciclo 3: sobras do texto antigo", () => {
  it("dctfJaTransmitida saiu das mensagens", () => {
    assert.equal((MENSAGENS_DA_ROTINA as Record<string, unknown>).dctfJaTransmitida, undefined);
  });

  it("nenhum arquivo do código ou o README fala em S-1299 sem o pedido da DCTFWeb", () => {
    const raiz = join(import.meta.dirname, "..", "..");
    const arquivos: string[] = [join(raiz, "README.md")];
    const andar = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        if (nome === "node_modules" || nome.startsWith(".")) continue;
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) andar(caminho);
        else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.ts$/.test(nome)) arquivos.push(caminho);
      }
    };
    for (const d of ["plataforma/lib", "plataforma/app", "nucleo/src"]) andar(join(raiz, d));
    const ruins = arquivos.filter((a) => /vai sem o pedido|não vai neste envio|dctfJaTransmitida/.test(readFileSync(a, "utf8")));
    assert.deepEqual(ruins, []);
  });
});
