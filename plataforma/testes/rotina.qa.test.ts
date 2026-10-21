// QA da Parte 6 (rotina do mês), ciclo 1: casos que os testes do engenheiro não cobrem. Nada sai da máquina: cliente
// falso do núcleo e banco de teste.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import { cnpj } from "@contabilizadev/nucleo/serpro/cliente";
import { respostaDeclaracoes, respostaExtrato, respostaPagamentos } from "@contabilizadev/nucleo/serpro/historico-exemplo";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro } from "@/lib/empresas/cadastro";
import { importar } from "@/lib/historico/importacao";
import { situacaoDctf } from "@/lib/rotina/dctfweb";
import { guiaDoMes } from "@/lib/rotina/guias";
import { informarProLabore } from "@/lib/rotina/receitas";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const em = (iso: string) => new Date(`${iso}-03:00`);
const SUPORTE = "98765432000198";
const TOKEN = "b06feea3-1ca8-49f4-bdb4-211ab006cb92";

async function empresa(agora: Date) {
  const usuario = (await entrarComGoogle(depsLogin(t.banco, { ana: perfil("ana@a.com", "sub-ana") }), "ana")).usuario;
  const r = await consultarParaCadastro(t.banco, usuario, "98.765.432/0001-98", { segredo: SEGREDO, agora, buscar: buscarExemplo("ti-anexo-iii") });
  assert.equal(r.tipo, "previa");
  const empresaId = await cadastrarPelaPrevia(t.banco, usuario, r.previa.token, { segredo: SEGREDO, agora });
  return { usuario, empresaId, acesso: await exigirAcessoEmpresa(t.banco, usuario, empresaId) };
}

// O campo de valor é texto livre (inputMode="decimal", placeholder "0,00"): quem digita no formato brasileiro com
// separador de milhar e sem centavos ("23.000") tem de lançar R$ 23.000,00, não R$ 23,00.
describe("QA: leitura do valor digitado na rotina do mês (acoes.ts)", () => {
  const fonte = fs.readFileSync(path.join(import.meta.dirname, "..", "app", "(painel)", "roteiro", "acoes.ts"), "utf8");
  const corpo = /function numero\(v: string\): number \{([\s\S]*?)\n\}/.exec(fonte)?.[1];
  const numero = new Function("v", corpo ?? "throw new Error('numero() não encontrada')") as (v: string) => number;

  it("\"23.000\" (milhar brasileiro, sem centavos) vale 23 mil", () => assert.equal(numero("23.000"), 23_000));
  it("\"R$ 5.000\" vale 5 mil", () => assert.equal(numero("R$ 5.000"), 5_000));
  it("\"1.234.567\" vale 1.234.567 (não NaN)", () => assert.equal(numero("1.234.567"), 1_234_567));
  it("\"23.000,00\" e \"23000\" continuam valendo 23 mil", () => {
    assert.equal(numero("23.000,00"), 23_000);
    assert.equal(numero("23000"), 23_000);
  });
});

describe("QA: vencimento do DAS quando o dia 20 não é dia útil", () => {
  // 20/09/2026 é domingo. O DAS do Simples é prorrogado para o primeiro dia útil seguinte (21/09); só o DARF do INSS
  // é antecipado. Em 21/09 o DAS de 08/2026 ainda está no prazo: não pode aparecer vencido nem pedir multa e juros.
  it("DAS de 08/2026 não pago vence em 21/09/2026 e não está vencido nesse dia", async () => {
    const agora = em("2026-09-21T10:00:00");
    const { acesso } = await empresa(agora);
    const cliente = clienteFalso(
      respostaDeclaracoes(2025, []),
      respostaDeclaracoes(2026, [
        { pa: "2026-08", declaracoes: [{ numero: "98765432202608001", quando: "20260905100000" }], das: [{ numero: "07202608000000001", quando: "20260905100100", pago: false }] },
      ]),
      respostaExtrato("07202608000000001", { pa: "2026-08", receita: 26_908.25 }),
      respostaPagamentos([]),
    );
    const contexto = async () => ({ contribuinte: cnpj(SUPORTE), autorPedidoDados: cnpj(SUPORTE), tokenProcurador: TOKEN });
    await importar({ banco: t.banco, cliente, contexto, agora: () => agora, esperar: async () => {}, log: () => {} }, acesso, { grupos: ["historico"], manual: false });
    const g = await guiaDoMes(t.banco, acesso, "2026-08", "DAS", agora);
    assert.equal(g.vencimento, "2026-09-21");
    assert.equal(g.vencida, false);
  });
});

describe("QA: INSS do pró-labore acima do teto do INSS", () => {
  // O INSS do contribuinte individual é limitado ao teto do salário de contribuição (R$ 8.475,55 em 2026 → 932,31).
  // Com pró-labore de R$ 20.000, a DCTFWeb (montada pelo eSocial) cobra o INSS no teto; o esperado da plataforma não
  // pode ser 11% de 20.000 (2.200), senão a transmissão fica bloqueada com "não bate".
  it("INSS esperado da DCTFWeb respeita o teto", async () => {
    const agora = em("2026-10-18T10:00:00");
    const { acesso } = await empresa(agora);
    await informarProLabore({ banco: t.banco, agora: () => agora }, acesso, { mes: "2026-09", valor: 20_000 });
    const s = await situacaoDctf(t.banco, acesso, "2026-09", agora);
    assert.ok(s.inssEsperado !== null && s.inssEsperado < 1_000, `INSS esperado ${s.inssEsperado} acima do teto`);
  });
});
