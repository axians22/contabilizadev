// QA (ciclo 4): bordas do "valor pago" do cartão da guia do mês (valorTotal do documento PAGTOWEB/PAGAMENTOS71).
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import type { Resposta } from "@contabilizadev/nucleo/serpro/cliente";
import { respostaDeclaracoes, respostaExtrato } from "@contabilizadev/nucleo/serpro/historico-exemplo";
import { valorPago } from "@contabilizadev/nucleo/serpro/pagamentos";
import { eq } from "drizzle-orm";
import { GuiasDoMes } from "@/app/(painel)/guias-do-mes";
import { pagamentos } from "@/banco/esquema";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro } from "@/lib/empresas/cadastro";
import { importar } from "@/lib/historico/importacao";
import { valorDaGuia } from "@/lib/rotina/botoes-guia";
import { guiaDoMes } from "@/lib/rotina/guias";
import { contextoSerpro, type DependenciasTermo } from "@/lib/termo/termo";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";
import { semExplicacoes, texto } from "./tela";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const em = (iso: string) => new Date(`${iso}-03:00`);
const AGORA = em("2026-10-18T10:00:00");
const PLATAFORMA = "98765432000198";
const ADMIN = "admin@plataforma.com";
const ANTERIORES = {
  "2025-09": 25_228.39, "2025-10": 19_224.3, "2025-11": 27_350.21, "2025-12": 24_655.48, "2026-01": 21_869.17, "2026-02": 25_798.12,
  "2026-03": 37_582, "2026-04": 24_985.4, "2026-05": 45_494.12, "2026-06": 47_400, "2026-07": 26_503.41,
};

async function comHistorico(docs: Record<string, unknown>[]) {
  const usuario = (await entrarComGoogle(depsLogin(t.banco, { admin: perfil(ADMIN, "sub-admin") }, { adminEmails: [ADMIN] }), "admin")).usuario;
  const r = await consultarParaCadastro(t.banco, usuario, "98.765.432/0001-98", { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-anexo-iii"), cnpjReservado: PLATAFORMA });
  assert.equal(r.tipo, "previa");
  const empresaId = await cadastrarPelaPrevia(t.banco, usuario, r.previa.token, { segredo: SEGREDO, agora: AGORA, cnpjReservado: PLATAFORMA });
  const acesso = await exigirAcessoEmpresa(t.banco, usuario, empresaId);
  const PAG: Resposta = {
    status: 200,
    dados: [
      { numeroDocumento: "7202608000000001", tipo: { codigo: 9, descricao: "DAS" }, periodoApuracao: "2026-08-01", dataArrecadacao: "2026-09-18T00:00:00", valorPrincipal: 1213.55, valorTotal: 1213.55 },
      ...docs,
    ],
    mensagens: [],
  };
  const cliente = clienteFalso(
    respostaDeclaracoes(2025, []),
    respostaDeclaracoes(2026, [
      { pa: "2026-08", declaracoes: [{ numero: "98765432202608001", quando: "20260905100000" }], das: [{ numero: "07202608000000001", quando: "20260905100100", pago: true }] },
    ]),
    respostaExtrato("07202608000000001", { pa: "2026-08", receita: 26_908.25, anteriores: ANTERIORES }),
    PAG,
  );
  const termo = (): DependenciasTermo => ({ banco: t.banco, chave: Buffer.alloc(32, 7), cliente: clienteFalso(), contratante: { numero: PLATAFORMA, nome: "SUPORTE TI LTDA" }, adminEmails: [ADMIN], agora: () => AGORA });
  const d = { banco: t.banco, cliente, contexto: () => contextoSerpro(termo(), acesso), agora: () => AGORA, log: () => {}, autorizada: true, esperar: async () => {} };
  assert.equal((await importar(d as Parameters<typeof importar>[0], acesso, { grupos: ["historico"], manual: false })).estado, "iniciada");
  return { acesso };
}

const cartao = async (acesso: Awaited<ReturnType<typeof comHistorico>>["acesso"]) => {
  const das = await guiaDoMes(t.banco, acesso, "2026-08", "DAS", AGORA);
  const inss = await guiaDoMes(t.banco, acesso, "2026-08", "INSS", AGORA);
  const html = renderToStaticMarkup(
    createElement(GuiasDoMes, { das, inss, dasCalculado: null, inssCalculado: null, hoje: "2026-10-18", receitaLancada: false, autorizada: true, empresaId: acesso.empresaId, gerar: async () => undefined }),
  );
  return { inss, visivel: texto(semExplicacoes(html)) };
};

describe("QA ciclo 4: valor pago", () => {
  it("núcleo: valores com centavos sem arredondar e campos não numéricos ignorados", () => {
    assert.equal(valorPago({ valorPrincipal: 178.31, valorTotal: 178.31 }), 178.31);
    assert.equal(valorPago({ valorPrincipal: 0.01, valorTotal: 0.02 }), 0.02);
    assert.equal(valorPago({ valorTotal: Number.NaN, valorPrincipal: 10 } as never), 10);
    assert.equal(valorPago({ valorTotal: "112.50" as never, valorPrincipal: 100 }), 100);
  });

  it("documento real (formato da importação de 20/10, com valorJuros/valorMulta nulos no topo): mostra o total", async () => {
    const { acesso } = await comHistorico([
      {
        numeroDocumento: "7162627851517448", tipo: { codigo: "4", descricao: "DOCUMENTO DE ARRECADAÇÃO DE RECEITAS FEDERAIS" }, valorJuros: null, valorMulta: null,
        valorTotal: 178.31, valorPrincipal: 178.31, dataArrecadacao: "2026-09-08T00:00:00-03:00", periodoApuracao: "2026-08-31T00:00:00-03:00",
        receitaPrincipal: { codigo: "1410" }, desmembramentos: [{ receitaPrincipal: { codigo: "1099" } }],
      },
    ]);
    const { inss, visivel } = await cartao(acesso);
    assert.deepEqual(valorDaGuia(inss, null), { valor: 178.31, origem: "pago" });
    assert.match(visivel, /DARF INSS do pró-labore Pago R\$\s178,31 Pago em 08\/09\/2026 · valor pago/);
  });

  it("documento sem valorTotal: cai para o principal do documento; documento sem valor nenhum: cai para pagamentos.valor", async () => {
    const { acesso } = await comHistorico([
      { numeroDocumento: "7162608000000002", tipo: { codigo: 1, descricao: "DARF" }, receitaPrincipal: { codigo: "1099" }, periodoApuracao: "2026-08-01", dataArrecadacao: "2026-09-10T00:00:00", valorPrincipal: 99.99 },
    ]);
    assert.deepEqual((await guiaDoMes(t.banco, acesso, "2026-08", "INSS", AGORA)).pagamento, { numero: "7162608000000002", valor: 99.99 });
    await t.banco.update(pagamentos).set({ documento: {} }).where(eq(pagamentos.numero, "7162608000000002"));
    assert.deepEqual((await guiaDoMes(t.banco, acesso, "2026-08", "INSS", AGORA)).pagamento, { numero: "7162608000000002", valor: 99.99 });
  });

  it("DAS pago com atraso e declaração conhecida: o cartão continua mostrando o valor declarado (não o total pago)", async () => {
    const { acesso } = await comHistorico([]);
    await t.banco.update(pagamentos).set({ documento: { numeroDocumento: "7202608000000001", valorPrincipal: 1213.55, valorTotal: 1300 } }).where(eq(pagamentos.numero, "7202608000000001"));
    const das = await guiaDoMes(t.banco, acesso, "2026-08", "DAS", AGORA);
    assert.equal(das.pagamento?.valor, 1300);
    assert.equal(valorDaGuia(das, null).origem, "declarado");
  });
});
