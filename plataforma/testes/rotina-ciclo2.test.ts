// Rotina do mês (Parte 6), correções do ciclo 2 do QA: valor digitado com milhar brasileiro, "sem receita no mês"
// separado de "ainda não lancei", vencimento do DAS (dia útil seguinte) x DARF (anterior), INSS no teto e o pró-labore
// do mês corrente para a sugestão do Fator R. Nada sai da máquina: cliente falso do núcleo e banco de teste.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import { cnpj } from "@contabilizadev/nucleo/serpro/cliente";
import { ATIVIDADE_29, respostaDeclaracoes, respostaExtrato, respostaPagamentos } from "@contabilizadev/nucleo/serpro/historico-exemplo";
import { mesesSemReceita, pagamentos } from "@/banco/esquema";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { dadosDaEmpresa, exigirAcessoEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro } from "@/lib/empresas/cadastro";
import { importar } from "@/lib/historico/importacao";
import { baseDoMes } from "@/lib/rotina/base";
import { situacaoDctf } from "@/lib/rotina/dctfweb";
import type { DependenciasRotina } from "@/lib/rotina/dependencias";
import { avisoFatorR, LINK_PROLABORE_DO_MES_ATUAL } from "@/lib/rotina/fator-r";
import { guiaDoMes } from "@/lib/rotina/guias";
import { MENSAGENS_DA_ROTINA } from "@/lib/rotina/mensagens";
import { motivoParaNaoTransmitirMes, simularMes } from "@/lib/rotina/pgdasd";
import { informarProLabore, lancarReceita, marcarSemReceita } from "@/lib/rotina/receitas";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const em = (iso: string) => new Date(`${iso}-03:00`);
const AGORA = em("2026-10-18T10:00:00");
const TOKEN = "b06feea3-1ca8-49f4-bdb4-211ab006cb92";

async function empresa(exemplo: "ti-anexo-iii" | "ti-fator-r" = "ti-anexo-iii", agora = AGORA) {
  const usuario = (await entrarComGoogle(depsLogin(t.banco, { ana: perfil("ana@a.com", "sub-ana") }), "ana")).usuario;
  const numero = exemplo === "ti-anexo-iii" ? "98.765.432/0001-98" : "12.345.678/0001-95";
  const r = await consultarParaCadastro(t.banco, usuario, numero, { segredo: SEGREDO, agora, buscar: buscarExemplo(exemplo) });
  assert.equal(r.tipo, "previa");
  const empresaId = await cadastrarPelaPrevia(t.banco, usuario, r.previa.token, { segredo: SEGREDO, agora });
  return { usuario, acesso: await exigirAcessoEmpresa(t.banco, usuario, empresaId), cnpj: numero.replace(/\D/g, "") };
}

function dependencias(cliente: DependenciasRotina["cliente"], numero: string, agora = AGORA): DependenciasRotina {
  return {
    banco: t.banco,
    cliente,
    contexto: async () => ({ contribuinte: cnpj(numero), autorPedidoDados: cnpj(numero), tokenProcurador: TOKEN }),
    agora: () => agora,
    log: () => {},
  };
}

// Receitas de 09/2025 a 07/2026 da empresa de referência (item 2.2 do extrato real de 09/2026): com a de 08/2026, RBT12
// de R$ 352.998,85 e DAS de 09/2026 de R$ 1.000,76 sobre R$ 23.000.
const ANTERIORES = {
  "2025-09": 25_228.39, "2025-10": 19_224.3, "2025-11": 27_350.21, "2025-12": 24_655.48, "2026-01": 21_869.17, "2026-02": 25_798.12,
  "2026-03": 37_582, "2026-04": 24_985.4, "2026-05": 45_494.12, "2026-06": 47_400, "2026-07": 26_503.41,
};

// Histórico com 08/2026 declarado e as receitas anteriores (a mesma base do caso real de referência).
async function importarHistorico(acesso: AcessoEmpresa, numero: string) {
  const cliente = clienteFalso(
    respostaDeclaracoes(2025, []),
    respostaDeclaracoes(2026, [
      { pa: "2026-08", declaracoes: [{ numero: `${numero.slice(0, 8)}202608001`, quando: "20260905100000" }], das: [{ numero: "07202608000000001", quando: "20260905100100", pago: true }] },
    ]),
    respostaExtrato("07202608000000001", { pa: "2026-08", receita: 26_908.25, anteriores: ANTERIORES }),
    respostaPagamentos([]),
  );
  const contexto = async () => ({ contribuinte: cnpj(numero), autorPedidoDados: cnpj(numero), tokenProcurador: TOKEN });
  await importar({ banco: t.banco, cliente, contexto, agora: () => AGORA, esperar: async () => {}, log: () => {} }, acesso, { grupos: ["historico"], manual: false });
}

describe("valor digitado (acoes.ts): milhar brasileiro, centavos e ponto decimal", () => {
  const fonte = fs.readFileSync(path.join(import.meta.dirname, "..", "app", "(painel)", "roteiro", "acoes.ts"), "utf8");
  const corpo = /function numero\(v: string\): number \{([\s\S]*?)\n\}/.exec(fonte)?.[1];
  const numero = new Function("v", corpo ?? "throw new Error('numero() não encontrada')") as (v: string) => number;

  it("lê os formatos que o cliente digita", () => {
    const casos: [string, number][] = [
      ["23.000", 23_000],
      ["R$ 5.000", 5_000],
      ["R$ 23.000,50", 23_000.5],
      ["1.234.567", 1_234_567],
      ["1.234.567,89", 1_234_567.89],
      ["23000", 23_000],
      ["23000,5", 23_000.5],
      ["1234.56", 1_234.56], // ponto decimal (não é grupo de 3 dígitos)
      ["1,234.56", 1_234.56], // formato americano completo
      ["0,00", 0],
      ["8.475,55", 8_475.55],
      ["  1.621,00 ", 1_621],
    ];
    for (const [v, esperado] of casos) assert.equal(numero(v), esperado, v);
  });

  it("o que não é número vira NaN (e a regra recusa)", () => {
    for (const v of ["", "abc", "1.23.4", "12,34,56", "R$"]) assert.ok(Number.isNaN(numero(v)), v);
  });

  // Number() aceitaria estes formatos: "1e5" seria lançado como R$ 100.000,00 em vez de recusado.
  it("notação científica, hexadecimal, binária, octal, Infinity e sinais viram NaN", () => {
    for (const v of ["1e5", "2E3", "1.5e2", "0x10", "0b11", "0o7", "Infinity", "-100", "+100", ".5", "5."]) assert.ok(Number.isNaN(numero(v)), v);
  });
});

describe("sem receita lançada: nada é simulado nem transmitido até lançar ou marcar que não houve receita", () => {
  it("pendente bloqueia a simulação (sem chamar a Receita); a marcação libera com receita zero; lançar desfaz a marcação", async () => {
    const { acesso, usuario, cnpj: numero } = await empresa();
    await importarHistorico(acesso, numero);
    const cliente = clienteFalso();
    const d = dependencias(cliente, numero);

    let base = await baseDoMes(t.banco, acesso, "2026-09", AGORA);
    assert.equal(base.receitaPendente, true);
    assert.equal(base.semReceita, false);
    assert.deepEqual(await simularMes(d, acesso, "2026-09", { retificar: false }), { ok: false, mensagem: MENSAGENS_DA_ROTINA.receitaPendente });
    assert.equal(await motivoParaNaoTransmitirMes(t.banco, acesso, base, false), MENSAGENS_DA_ROTINA.receitaPendente);
    assert.equal(cliente.chamadas.length, 0);

    // "Não houve receita": a base passa a ter receita zero e a próxima etapa é simular.
    assert.ok((await marcarSemReceita(d, acesso, { pa: "2026-09", marcar: true, usuarioId: usuario.id })).ok);
    assert.ok((await marcarSemReceita(d, acesso, { pa: "2026-09", marcar: true })).ok); // de novo: idempotente
    base = await baseDoMes(t.banco, acesso, "2026-09", AGORA);
    assert.deepEqual([base.receitaPendente, base.semReceita, base.receita], [false, true, 0]);
    assert.equal(await motivoParaNaoTransmitirMes(t.banco, acesso, base, false), MENSAGENS_DA_ROTINA.simuleAntes);

    // Mês que não terminou não é marcado.
    assert.deepEqual(await marcarSemReceita(d, acesso, { pa: "2026-10", marcar: true }), { ok: false, mensagem: MENSAGENS_DA_ROTINA.mesAberto });

    // Lançar uma receita apaga a marcação; com lançamento, marcar é recusado.
    assert.ok((await lancarReceita(d, acesso, { pa: "2026-09", recebidaEm: "2026-10-05", moeda: "BRL", valorMoeda: 23_000 })).ok);
    assert.equal((await t.banco.select().from(mesesSemReceita)).length, 0);
    base = await baseDoMes(t.banco, acesso, "2026-09", AGORA);
    assert.deepEqual([base.receitaPendente, base.semReceita, base.receita], [false, false, 23_000]);
    assert.equal(base.apuracao?.das.total, 1000.76); // caso real de referência
    assert.deepEqual(await marcarSemReceita(d, acesso, { pa: "2026-09", marcar: true }), { ok: false, mensagem: MENSAGENS_DA_ROTINA.semReceitaComLancamento });

    // Desfazer a marcação volta a "pendente" (sem lançamento).
    const outro = await empresa("ti-fator-r");
    assert.ok((await marcarSemReceita(d, outro.acesso, { pa: "2026-09", marcar: true })).ok);
    assert.ok((await marcarSemReceita(d, outro.acesso, { pa: "2026-09", marcar: false })).ok);
    assert.equal((await baseDoMes(t.banco, outro.acesso, "2026-09", AGORA)).receitaPendente, true);
    assert.equal(cliente.chamadas.length, 0);
  });
});

describe("vencimento: DAS no dia útil seguinte, DARF do INSS no anterior", () => {
  it("08/2026 (20/09 é domingo): DAS vence em 21/09 e DARF em 18/09", async () => {
    const agora = em("2026-09-21T10:00:00");
    const { acesso } = await empresa("ti-anexo-iii", agora);
    assert.equal((await guiaDoMes(t.banco, acesso, "2026-08", "DAS", agora)).vencimento, "2026-09-21");
    assert.equal((await guiaDoMes(t.banco, acesso, "2026-08", "INSS", agora)).vencimento, "2026-09-18");
    // Dia útil: os dois no dia 20.
    assert.equal((await guiaDoMes(t.banco, acesso, "2026-09", "DAS", AGORA)).vencimento, "2026-10-20");
    assert.equal((await guiaDoMes(t.banco, acesso, "2026-09", "INSS", AGORA)).vencimento, "2026-10-20");
  });
});

describe("INSS do pró-labore no teto", () => {
  it("DCTFWeb espera 11% até o teto do ano; abaixo do teto, 11% do valor (caso real 1.621 → 178,31)", async () => {
    const { acesso } = await empresa();
    const d = dependencias(null, "98765432000198");
    await informarProLabore(d, acesso, { mes: "2026-09", valor: 20_000 });
    assert.equal((await situacaoDctf(t.banco, acesso, "2026-09", AGORA)).inssEsperado, 932.31);
    await informarProLabore(d, acesso, { mes: "2026-09", valor: 1_621 });
    assert.equal((await situacaoDctf(t.banco, acesso, "2026-09", AGORA)).inssEsperado, 178.31);
  });

  it("folha pelo DARF no teto: fica o teto (mínimo garantido) e a fonte pede o valor real", async () => {
    const { acesso } = await empresa();
    await dadosDaEmpresa(t.banco, acesso).inserir(pagamentos, { numero: "1", tipo: "INSS", pa: "2026-07", pagoEm: "2026-08-20", valor: 932.31, documento: {} as never, vistoEm: AGORA });
    await dadosDaEmpresa(t.banco, acesso).inserir(pagamentos, { numero: "2", tipo: "INSS", pa: "2026-08", pagoEm: "2026-09-18", valor: 178.31, documento: {} as never, vistoEm: AGORA });
    const base = await baseDoMes(t.banco, acesso, "2026-09", AGORA);
    assert.deepEqual([base.folhas["2026-07"], base.fontesFolha["2026-07"]], [8_475.55, "darf-teto"]);
    assert.deepEqual([base.folhas["2026-08"], base.fontesFolha["2026-08"]], [1_621, "darf"]);
  });
});

describe("Fator R: o pró-labore do mês corrente, separado do mês apurado", () => {
  it("só o pró-labore do mês corrente conta como informado; o link leva ao formulário dele", async () => {
    const { acesso, cnpj: numero } = await empresa("ti-fator-r");
    const meses = ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
    const cliente = clienteFalso(
      respostaDeclaracoes(2025, []),
      respostaDeclaracoes(2026, [{ pa: "2026-09", declaracoes: [{ numero: "12345678202609001", quando: "20261005100000" }], das: [{ numero: "07202609000000001", quando: "20261005100100" }] }]),
      respostaExtrato("07202609000000001", {
        pa: "2026-09", receita: 25_000, atividade: ATIVIDADE_29, fatorR: 0.27,
        anteriores: Object.fromEntries(meses.map((m) => [m, 25_000])),
        folhas: Object.fromEntries(meses.map((m) => [m, 6_750])),
      }),
      respostaPagamentos([]),
    );
    const contexto = async () => ({ contribuinte: cnpj(numero), autorPedidoDados: cnpj(numero), tokenProcurador: TOKEN });
    await importar({ banco: t.banco, cliente, contexto, agora: () => AGORA, esperar: async () => {}, log: () => {} }, acesso, { grupos: ["historico"], manual: false });
    const d = dependencias(null, numero);

    // Só setembro informado: é a previsão de outubro, mas outubro não está informado.
    await informarProLabore(d, acesso, { mes: "2026-09", valor: 6_750 });
    let aviso = (await avisoFatorR(t.banco, acesso, AGORA))!;
    assert.deepEqual([aviso.mes, aviso.proLaboreAtual, aviso.proLaboreInformado, aviso.anexo], ["2026-10", 6_750, false, "V"]);

    // Outubro informado com o sugerido: Anexo III em novembro, e setembro (mês apurado) não muda.
    await informarProLabore(d, acesso, { mes: "2026-10", valor: aviso.proLaboreSugerido });
    aviso = (await avisoFatorR(t.banco, acesso, AGORA))!;
    assert.deepEqual([aviso.proLaboreAtual, aviso.proLaboreInformado, aviso.anexo], [9_750, true, "III"]);
    const base = await baseDoMes(t.banco, acesso, "2026-09", AGORA);
    assert.deepEqual([base.prolabore, base.prolaboreDoMesAtual], [6_750, 9_750]);

    assert.equal(LINK_PROLABORE_DO_MES_ATUAL, "/roteiro#prolabore-do-mes-atual");
    const pagina = fs.readFileSync(path.join(import.meta.dirname, "..", "app", "(painel)", "roteiro", "page.tsx"), "utf8");
    assert.match(pagina, /id="prolabore-do-mes-atual"/);
    assert.match(pagina, /mes=\{base\.mesAtual\}/);
  });
});
