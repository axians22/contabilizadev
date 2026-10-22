// Valor PAGO da guia paga fora da plataforma: o valorTotal do documento da consulta de pagamentos (PAGTOWEB/PAGAMENTOS71),
// que inclui multa e juros de quem pagou atrasado. O principal (pagamentos.valor) continua sendo o valor do DAS ou do INSS
// do mês no histórico e na base; o cartão do painel e o comprovante guardado mostram o total efetivamente pago.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import type { Resposta } from "@contabilizadev/nucleo/serpro/cliente";
import { pdfComTexto } from "@contabilizadev/nucleo/serpro/dctf-exemplo";
import { respostaDeclaracoes, respostaExtrato } from "@contabilizadev/nucleo/serpro/historico-exemplo";
import { eq } from "drizzle-orm";
import { GuiasDoMes } from "@/app/(painel)/guias-do-mes";
import { guias, pagamentos } from "@/banco/esquema";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { importar } from "@/lib/historico/importacao";
import type { DependenciasRotina } from "@/lib/rotina/dependencias";
import { valorDaGuia } from "@/lib/rotina/botoes-guia";
import { buscarGuiaDoMes, guiaDoMes } from "@/lib/rotina/guias";
import { contextoSerpro, type DependenciasTermo } from "@/lib/termo/termo";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";
import { semExplicacoes, texto } from "./tela";
import { cadastrarComprovada, consultarComDados } from "./apoio-empresa";

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
const ok = (dados: unknown): Resposta => ({ status: 200, dados, mensagens: [{ codigo: "Sucesso", texto: "ok" }] });
// DARF do INSS de 08/2026 pago em 25/09/2026, depois do vencimento (18/09): principal 100,00, total pago 112,50.
const PAGAMENTOS: Resposta = {
  status: 200,
  dados: [
    { numeroDocumento: "7202608000000001", tipo: { codigo: 9, descricao: "DAS" }, periodoApuracao: "2026-08-01", dataArrecadacao: "2026-09-18T00:00:00", valorPrincipal: 1213.55, valorTotal: 1213.55 },
    { numeroDocumento: "7162608000000002", tipo: { codigo: 1, descricao: "DARF" }, receitaPrincipal: { codigo: "1099" }, periodoApuracao: "2026-08-01", dataArrecadacao: "2026-09-25T00:00:00", valorPrincipal: 100, valorTotal: 112.5 },
  ],
  mensagens: [],
};

const termo = (): DependenciasTermo => ({ banco: t.banco, chave: Buffer.alloc(32, 7), cliente: clienteFalso(), contratante: { numero: PLATAFORMA, nome: "SUPORTE TI LTDA" }, adminEmails: [ADMIN], agora: () => AGORA });
const rotina = (acesso: AcessoEmpresa, cliente: DependenciasRotina["cliente"]): DependenciasRotina => ({
  banco: t.banco, cliente, contexto: () => contextoSerpro(termo(), acesso), agora: () => AGORA, log: () => {},
});

async function comHistorico() {
  const usuario = (await entrarComGoogle(depsLogin(t.banco, { admin: perfil(ADMIN, "sub-admin") }, { adminEmails: [ADMIN] }), "admin")).usuario;
  const r = await consultarComDados(t.banco, usuario, "98.765.432/0001-98", { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-anexo-iii"), cnpjReservado: PLATAFORMA });
  assert.equal(r.tipo, "previa");
  const empresaId = await cadastrarComprovada(t.banco, usuario, r.previa.token, { segredo: SEGREDO, agora: AGORA, cnpjReservado: PLATAFORMA });
  const acesso = await exigirAcessoEmpresa(t.banco, usuario, empresaId);
  const cliente = clienteFalso(
    respostaDeclaracoes(2025, []),
    respostaDeclaracoes(2026, [
      { pa: "2026-08", declaracoes: [{ numero: "98765432202608001", quando: "20260905100000" }], das: [{ numero: "07202608000000001", quando: "20260905100100", pago: true }] },
    ]),
    respostaExtrato("07202608000000001", { pa: "2026-08", receita: 26_908.25, anteriores: ANTERIORES }),
    PAGAMENTOS,
  );
  const d = { ...rotina(acesso, cliente), autorizada: true, esperar: async () => {} };
  assert.equal((await importar(d as Parameters<typeof importar>[0], acesso, { grupos: ["historico"], manual: false })).estado, "iniciada");
  return { acesso };
}

describe("valor pago da guia paga com atraso", () => {
  it("o pagamento guarda o principal (histórico e base) e o documento com o total pago", async () => {
    await comHistorico();
    const [p] = await t.banco.select().from(pagamentos).where(eq(pagamentos.numero, "7162608000000002"));
    assert.equal(p.valor, 100);
    assert.equal(p.documento.valorTotal, 112.5);
  });

  it("a guia do mês e o cartão do painel mostram o total pago (112,50), com 'valor pago', não o principal", async () => {
    const { acesso } = await comHistorico();
    const inss = await guiaDoMes(t.banco, acesso, "2026-08", "INSS", AGORA);
    assert.equal(inss.paga, true);
    assert.deepEqual(inss.pagamento, { numero: "7162608000000002", valor: 112.5 });
    assert.deepEqual(valorDaGuia(inss, null), { valor: 112.5, origem: "pago" });
    const das = await guiaDoMes(t.banco, acesso, "2026-08", "DAS", AGORA);
    const html = renderToStaticMarkup(
      createElement(GuiasDoMes, { das, inss, dasCalculado: null, inssCalculado: null, hoje: "2026-10-18", receitaLancada: false, autorizada: true, empresaId: acesso.empresaId, gerar: async () => undefined }),
    );
    const visivel = texto(semExplicacoes(html));
    assert.match(visivel, /DARF INSS do pró-labore Pago R\$\s112,50 Pago em 25\/09\/2026 · valor pago/);
    assert.doesNotMatch(visivel, /R\$\s100,00/);
  });

  it("o comprovante guardado grava o total pago, não o principal", async () => {
    const { acesso } = await comHistorico();
    const cliente = clienteFalso(ok({ pdf: pdfComTexto("Comprovante de Arrecadacao").toString("base64") }));
    const r = await buscarGuiaDoMes(rotina(acesso, cliente), acesso, "2026-08", "INSS");
    assert.ok(r.ok);
    assert.equal(r.guia.total, 112.5);
    assert.equal(r.guia.principal, null);
    const [guardada] = await t.banco.select({ total: guias.total }).from(guias);
    assert.equal(guardada.total, 112.5);
  });
});
