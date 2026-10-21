// QA (Parte 8, passo 22): casos que os testes do engenheiro não cobrem. Banco de teste, cliente Serpro falso e respostas
// gravadas; nada sai da máquina.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { INTIMACAO, respostaListaCaixa } from "@contabilizadev/nucleo/serpro/caixa-postal-exemplo";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import { cnpj } from "@contabilizadev/nucleo/serpro/cliente";
import { defis } from "@/banco/esquema";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { avisosDaEmpresa } from "@/lib/avisos/coleta";
import { atualizarCaixaPostal, marcarComoVistas, resumoDaCaixa } from "@/lib/caixa-postal/caixa-postal";
import { dadosDaEmpresa, exigirAcessoEmpresa } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro } from "@/lib/empresas/cadastro";
import type { Situacao } from "@/lib/termo/situacao";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const em = (iso: string) => new Date(`${iso}-03:00`);
const AGORA = em("2026-10-20T10:00:00");
const SUPORTE = "98765432000198";
const PERFIS = { ana: perfil("ana@a.com", "sub-ana") };
const AUSENTE: Situacao = { estado: "ausente" };
const contexto = async () => ({ contribuinte: cnpj(SUPORTE), autorPedidoDados: cnpj(SUPORTE) });

async function empresa() {
  const usuario = (await entrarComGoogle(depsLogin(t.banco, PERFIS), "ana")).usuario;
  const r = await consultarParaCadastro(t.banco, usuario, "98.765.432/0001-98", { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-anexo-iii") });
  assert.equal(r.tipo, "previa");
  const empresaId = await cadastrarPelaPrevia(t.banco, usuario, r.previa.token, { segredo: SEGREDO, agora: AGORA });
  return { usuario, empresaId, acesso: await exigirAcessoEmpresa(t.banco, usuario, empresaId) };
}

describe("QA: mensagens não lidas no sino", () => {
  it("intimação importante ainda não lida continua no sino depois de só ver a lista (nada foi aberto)", async () => {
    const { acesso } = await empresa();
    await atualizarCaixaPostal({ banco: t.banco, cliente: clienteFalso(respostaListaCaixa([INTIMACAO])), contexto, agora: () => AGORA }, acesso, { manual: false });
    await marcarComoVistas(t.banco, acesso, AGORA);
    const resumo = await resumoDaCaixa(t.banco, acesso);
    assert.equal(resumo.naoLidas, 1, "a intimação continua não lida");
    const avisos = await avisosDaEmpresa(t.banco, acesso, AGORA, { termo: AUSENTE, log: () => {} });
    assert.ok(
      avisos.some((a) => a.chave === "mensagens"),
      "o passo 22a pede o contador de não lidas no sino; ver a lista não dá ciência nem lê a intimação",
    );
  });
});

describe("QA: declaração anual atrasada só com consulta depois do prazo", () => {
  it("consulta 'não encontrada' de fevereiro não vira 'atrasada' (vermelho) em 1º de abril sem consultar de novo", async () => {
    const { acesso } = await empresa();
    await dadosDaEmpresa(t.banco, acesso).inserirOuAtualizar(
      defis,
      [{ ano: 2026, situacao: "nao-encontrada", idDefis: null, declaracaoPdf: null, reciboPdf: null, consultadaEm: em("2027-02-10T10:00:00") }],
      [defis.empresaId, defis.ano],
      ["situacao", "consultadaEm"],
    );
    // O cliente entregou em março pelo portal (modo guiado); a consulta de depois do prazo ainda não rodou.
    const avisos = await avisosDaEmpresa(t.banco, acesso, em("2027-04-01T09:00:00"), { termo: AUSENTE, log: () => {} });
    const anual = avisos.find((a) => a.chave === "defis:2026");
    assert.notEqual(anual?.nivel, "vencida", `aviso falso: ${anual?.titulo} — ${anual?.texto}`);
  });
});
