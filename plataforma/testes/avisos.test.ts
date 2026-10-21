// Parte 8, passo 22 (b, c e d): a central de avisos de ponta a ponta no banco de teste (situação fiscal irregular, guia
// vencida, PGDAS-D sem declaração, mensagens não lidas, autorização perto de vencer), sem aviso repetido; e a declaração anual
// no modo guiado (o resumo do ano e o que só o cliente sabe). O histórico entra pela importação da Parte 5 com o cliente
// falso e respostas gravadas; nada sai da máquina e nada é consultado para montar um aviso.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { apurar } from "@contabilizadev/nucleo/apuracao";
import { regraDoCnae } from "@contabilizadev/nucleo/cnae";
import { INTIMACAO, respostaListaCaixa } from "@contabilizadev/nucleo/serpro/caixa-postal-exemplo";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import { cnpj } from "@contabilizadev/nucleo/serpro/cliente";
import { pdfComTexto } from "@contabilizadev/nucleo/serpro/dctf-exemplo";
import { respostaDeclaracoes, respostaDefis, respostaExtrato, respostaPagamentos, respostaProtocolo, respostaRelatorio } from "@contabilizadev/nucleo/serpro/historico-exemplo";
import { defisDados, receitasLancadas } from "@/banco/esquema";
import { entrarComGoogle, resolverSessao } from "@/lib/autenticacao/servico";
import { avisosDaEmpresa } from "@/lib/avisos/coleta";
import { atualizarCaixaPostal } from "@/lib/caixa-postal/caixa-postal";
import { dadosDoCliente, ErroDosDados, resumoDaDeclaracaoAnual, salvarDadosDoCliente } from "@/lib/defis/resumo";
import { dadosDaEmpresa, exigirAcessoEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro } from "@/lib/empresas/cadastro";
import { ultimaConsulta } from "@/lib/empresas/receita";
import { removerEmpresa } from "@/lib/empresas/remocao";
import { situacaoFiscalDaEmpresa } from "@/lib/historico/leitura";
import { importar, type DependenciasImportacao } from "@/lib/historico/importacao";
import { baseDoMes, ultimoMesApuravel } from "@/lib/rotina/base";
import { avisoFatorR } from "@/lib/rotina/fator-r";
import { guiasVencidas } from "@/lib/rotina/guias";
import { debitosComGuia, explicarPendencias } from "@/lib/situacao/pendencias";
import type { Situacao } from "@/lib/termo/situacao";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const em = (iso: string) => new Date(`${iso}-03:00`);
const AGORA = em("2026-10-20T10:00:00"); // histórico de 10/2025 a 09/2026
const SUPORTE = "98765432000198";
const PERFIS = { ana: perfil("ana@a.com", "sub-ana"), beto: perfil("beto@b.com", "sub-beto") };
const AUSENTE: Situacao = { estado: "ausente" };

async function empresa(quem: "ana" | "beto" = "ana", exemplo: "ti-anexo-iii" | "ti-fator-r" = "ti-anexo-iii") {
  const usuario = (await entrarComGoogle(depsLogin(t.banco, PERFIS), quem)).usuario;
  const numero = exemplo === "ti-anexo-iii" ? "98.765.432/0001-98" : "12.345.678/0001-95";
  const r = await consultarParaCadastro(t.banco, usuario, numero, { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo(exemplo) });
  assert.equal(r.tipo, "previa");
  const empresaId = await cadastrarPelaPrevia(t.banco, usuario, r.previa.token, { segredo: SEGREDO, agora: AGORA });
  return { usuario, empresaId, acesso: await exigirAcessoEmpresa(t.banco, usuario, empresaId) };
}

const contexto = async () => ({ contribuinte: cnpj(SUPORTE), autorPedidoDados: cnpj(SUPORTE) });
const dependencias = (cliente: DependenciasImportacao["cliente"]): DependenciasImportacao => ({ banco: t.banco, cliente, contexto, agora: () => AGORA, esperar: async () => {}, log: () => {} });

// Histórico com todos os meses declarados (11/2025 a 09/2026, e 10/2025 também) e pagos, menos 08/2026: declarado, com o
// DAS gerado e sem pagamento (vencido em 21/09/2026). Situação fiscal irregular por esse DAS.
const MESES = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const declaracao = (pa: string) => ({ numero: `98765432${pa.replace("-", "")}001`, quando: `${pa.replace("-", "")}25100000` });
const das = (pa: string, pago: boolean) => ({ numero: `0720${pa.slice(2, 4)}${pa.slice(5)}000000001`, quando: `${pa.replace("-", "")}25100100`, pago });
async function historicoIrregular(acesso: AcessoEmpresa, semDeclaracao: string[] = []) {
  const periodo = (pa: string) => ({ pa, declaracoes: [declaracao(pa)], das: [das(pa, pa !== "2026-08" && pa !== "2026-09")] });
  const declarados = MESES.filter((m) => !semDeclaracao.includes(m));
  const cliente = clienteFalso(
    respostaDeclaracoes(2025, declarados.filter((m) => m < "2026").map(periodo)),
    respostaDeclaracoes(2026, declarados.filter((m) => m >= "2026").map(periodo)),
    ...declarados.map((pa) => respostaExtrato(das(pa, false).numero, { pa, receita: 20_000, pago: null })),
    respostaPagamentos([]),
    respostaDefis(pdfComTexto("DEFIS 2025").toString("base64")),
    respostaProtocolo,
    // Uma célula por Tj, como no PDF real.
    respostaRelatorio(["Pendência - Débito (SIMPLES NACIONAL)", "PA", "Dt. Vcto", "Vl.Original", "Sdo.Devedor", "08/2026", "21/09/2026", "1.170,84", "1.170,84"]),
  );
  const r = await importar(dependencias(cliente), acesso, { grupos: ["historico", "defis", "situacao"], manual: false });
  assert.equal(r.estado, "iniciada");
  assert.equal(cliente.chamadas.length, declarados.length + 6, "todas as respostas gravadas foram usadas");
}

// Uma leitura que aceita qualquer encadeamento (where, orderBy, limit...) e falha ao ser aguardada.
function leituraQueCai(): unknown {
  const leitura: object = new Proxy({}, { get: (_, k) => (k === "then" ? (_ok: unknown, falha: (e: Error) => void) => falha(new Error("caiu")) : () => leitura) });
  return leitura;
}

// Banco que anota a tabela de cada leitura (select ... from) e faz falhar as leituras da tabela pedida.
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

describe("central de avisos: todas as fontes, sem repetir", () => {
  it("situação irregular, guia vencida, PGDAS-D sem declaração, mensagem importante e autorização: cada um uma vez", async () => {
    const { acesso } = await empresa();
    await historicoIrregular(acesso, ["2026-07"]);
    await atualizarCaixaPostal({ banco: t.banco, cliente: clienteFalso(respostaListaCaixa([INTIMACAO])), contexto, agora: () => AGORA }, acesso, { manual: false });
    const termo = { estado: "vencendo", validaAte: "2026-11-04", motivo: "vigencia", diasRestantes: 15, signatario: { cnpj: SUPORTE, nome: "X" }, enviadoEm: AGORA } as Situacao;

    const avisos = await avisosDaEmpresa(t.banco, acesso, AGORA, { termo });
    const chaves = avisos.map((a) => a.chave);
    assert.equal(new Set(chaves).size, chaves.length, "nenhum aviso repetido");
    assert.deepEqual(chaves, ["situacao-fiscal", "pgdasd:2026-07", "guia:DAS:2026-08", "mensagens", "autorizacao"]);
    assert.deepEqual(avisos.map((a) => a.nivel), ["vencida", "vencida", "vencida", "vencida", "vence"]);
    assert.deepEqual(avisos.find((a) => a.chave === "guia:DAS:2026-08")!.link, { href: "/guias#guia-DAS-2026-08", texto: "Gerar a guia com juros" });
    // A declaração anual de 2025 foi entregue (DEFIS importada): nada sobre ela.
    assert.ok(!chaves.some((c) => c?.startsWith("defis")));
  });

  it("a pendência do relatório casa com a guia vencida da rotina do mês (o botão de gerar com juros)", async () => {
    const { acesso } = await empresa();
    await historicoIrregular(acesso);
    const s = await situacaoFiscalDaEmpresa(t.banco, acesso);
    assert.equal(s.atual?.regular, false);
    const debitos = debitosComGuia(explicarPendencias(s.atual?.pendencias));
    assert.deepEqual(debitos, [{ tributo: "DAS", pa: "2026-08" }]);
    const vencidas = await guiasVencidas(t.banco, acesso, AGORA);
    assert.deepEqual(vencidas.map((g) => [g.tipo, g.pa, g.vencida, g.referencia]), [["DAS", "2026-08", true, declaracao("2026-08").numero]]);
  });

  it("empresa nova, sem nada importado: nenhum aviso falso (nem de prazo passado sem como saber)", async () => {
    const { acesso } = await empresa();
    assert.deepEqual(await avisosDaEmpresa(t.banco, acesso, em("2026-10-05T10:00:00"), { termo: AUSENTE }), []);
    // Perto do dia 20, o lembrete do PGDAS-D do mês anterior (não dá para saber se já foi declarado no portal).
    const perto = await avisosDaEmpresa(t.banco, acesso, em("2026-10-16T10:00:00"), { termo: AUSENTE });
    assert.deepEqual(perto.map((a) => [a.chave, a.nivel]), [["pgdasd:2026-09", "vence"]]);
  });

  it("isolamento: os avisos de uma empresa não aparecem na outra", async () => {
    const ana = await empresa();
    await historicoIrregular(ana.acesso);
    const beto = await empresa("beto", "ti-fator-r");
    assert.ok((await avisosDaEmpresa(t.banco, ana.acesso, AGORA, { termo: AUSENTE })).some((a) => a.chave === "situacao-fiscal"));
    assert.deepEqual(await avisosDaEmpresa(t.banco, beto.acesso, em("2026-10-05T10:00:00"), { termo: AUSENTE }), []);
  });

  it("uma fonte que falha não derruba as outras (vai para o log)", async () => {
    const { acesso } = await empresa();
    await historicoIrregular(acesso);
    const log: string[] = [];
    // Banco que falha só na leitura das mensagens.
    const quebrado = bancoEspiao("caixa_postal");
    const avisos = await avisosDaEmpresa(quebrado, acesso, AGORA, { termo: AUSENTE, log: (m) => void log.push(m) });
    assert.ok(avisos.some((a) => a.chave === "situacao-fiscal"));
    assert.ok(log.some((l) => /mensagens/.test(l) && /caiu/.test(l)));
  });

  it("a consulta do CNPJ é lida uma vez só por montagem, e a falha nela fica isolada nas fontes que a usam", async () => {
    const { acesso } = await empresa();
    await historicoIrregular(acesso);
    const lidas: string[] = [];
    await avisosDaEmpresa(bancoEspiao(undefined, lidas), acesso, AGORA, { termo: AUSENTE });
    assert.equal(lidas.filter((n) => n === "consultas_cnpj").length, 1);

    const log: string[] = [];
    const avisos = await avisosDaEmpresa(bancoEspiao("consultas_cnpj"), acesso, AGORA, { termo: AUSENTE, log: (m) => void log.push(m) });
    // Histórico, declaração anual e Fator R dependem dela e caem (no log); as guias vencidas continuam.
    assert.ok(avisos.some((a) => a.chave === "guia:DAS:2026-08"));
    assert.ok(log.some((l) => /"histórico"/.test(l) && /caiu/.test(l)));
    assert.ok(log.some((l) => /"declaração anual"/.test(l) && /caiu/.test(l)));
  });

  it("painel: o Fator R e a rotina do mês usam a consulta do CNPJ já lida (uma leitura só)", async () => {
    const { acesso } = await empresa("ana", "ti-fator-r");
    const lidas: string[] = [];
    const espiao = bancoEspiao(undefined, lidas);
    // Como no painel: a página lê a consulta uma vez e repassa às duas.
    const consulta = await ultimaConsulta(espiao, acesso);
    assert.ok(consulta);
    await avisoFatorR(espiao, acesso, AGORA, Promise.resolve(consulta));
    const base = await baseDoMes(espiao, acesso, ultimoMesApuravel(AGORA), AGORA, Promise.resolve(consulta));
    assert.equal(base.regra?.tributacao, "fator-r", "a consulta repassada é a que vale");
    assert.equal(lidas.filter((n) => n === "consultas_cnpj").length, 1);
    // Sem repassar, cada uma lê de novo (o que o painel evita).
    lidas.length = 0;
    await avisoFatorR(espiao, acesso, AGORA);
    await baseDoMes(espiao, acesso, ultimoMesApuravel(AGORA), AGORA);
    assert.equal(lidas.filter((n) => n === "consultas_cnpj").length, 2);
  });
});

describe("declaração anual: os valores do ano e o que só o cliente sabe", () => {
  it("resumo com a receita lançada e o pró-labore: DAS calculado, IRPJ e o limite do lucro isento", async () => {
    const { acesso, usuario } = await empresa();
    const porta = dadosDaEmpresa(t.banco, acesso);
    for (const pa of ["2025-01", "2025-02", "2025-03"]) {
      await porta.inserir(receitasLancadas, { pa, recebidaEm: `${pa}-28`, moeda: "BRL", valorMoeda: 20_000, valorBrl: 20_000, origemValor: "reais", lancadaEm: AGORA, lancadaPorId: usuario.id });
    }
    const r = await resumoDaDeclaracaoAnual(t.banco, acesso, 2025);
    assert.equal(r.receita, 60_000);
    // O mesmo cálculo da rotina do mês (Anexo III, exportação) para cada mês.
    const regra = regraDoCnae("6209100");
    let receitas: Record<string, number> = {};
    let dasEsperado = 0;
    let irpj = 0;
    for (const pa of ["2025-01", "2025-02", "2025-03"]) {
      const a = apurar({ pa, receita: 20_000, receitas, folhas: {}, regra, inicioAtividade: "2021-06" });
      dasEsperado += a.das.total;
      irpj += a.das.tributos.irpj;
      receitas = { ...receitas, [pa]: 20_000 };
    }
    assert.ok(Math.abs(r.das - dasEsperado) < 0.005);
    assert.ok(Math.abs(r.limiteLucroIsento - (60_000 * 0.32 - irpj)) < 0.005);
    assert.equal(r.semReceita.length, 9);
    assert.equal(r.proLabore, 0);
  });

  it("guarda o que só o cliente sabe; recusa ano fora da lista e valor negativo; isolado por empresa; apagado com a empresa", async () => {
    const { acesso, usuario } = await empresa();
    assert.deepEqual(await dadosDoCliente(t.banco, acesso, 2025), { lucros: null, saldoInicial: null, saldoFinal: null, despesas: null });
    await salvarDadosDoCliente(t.banco, acesso, 2025, { lucros: 50_000, saldoInicial: 1_000.5, saldoFinal: null, despesas: 12_345.67 }, { agora: AGORA, usuarioId: usuario.id });
    await salvarDadosDoCliente(t.banco, acesso, 2025, { lucros: 60_000, saldoInicial: 1_000.5, saldoFinal: 3_000, despesas: 12_345.67 }, { agora: AGORA, usuarioId: usuario.id });
    assert.deepEqual(await dadosDoCliente(t.banco, acesso, 2025), { lucros: 60_000, saldoInicial: 1_000.5, saldoFinal: 3_000, despesas: 12_345.67 });
    await assert.rejects(salvarDadosDoCliente(t.banco, acesso, 2019, { lucros: 1, saldoInicial: null, saldoFinal: null, despesas: null }, { agora: AGORA }), ErroDosDados);
    await assert.rejects(salvarDadosDoCliente(t.banco, acesso, 2025, { lucros: -1, saldoInicial: null, saldoFinal: null, despesas: null }, { agora: AGORA }), ErroDosDados);
    await assert.rejects(salvarDadosDoCliente(t.banco, acesso, 2025, { lucros: Number.NaN, saldoInicial: null, saldoFinal: null, despesas: null }, { agora: AGORA }), ErroDosDados);
    const beto = await empresa("beto", "ti-fator-r");
    assert.deepEqual(await dadosDoCliente(t.banco, beto.acesso, 2025), { lucros: null, saldoInicial: null, saldoFinal: null, despesas: null });

    const d = depsLogin(t.banco, PERFIS);
    const sessao = await resolverSessao(d, (await entrarComGoogle(d, "ana")).cookie);
    await removerEmpresa(t.banco, sessao!, acesso.empresaId, SUPORTE);
    assert.equal((await t.banco.select().from(defisDados)).length, 0);
  });
});
