// QA da Parte 4, ciclo 2 dos botões da guia: o que os testes do engenheiro não cobrem na busca da guia na Receita
// (cliques juntos, DARF pago, falha da Receita, resposta que não é PDF) e bordas da decisão dos botões.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import type { Resposta } from "@contabilizadev/nucleo/serpro/cliente";
import { pdfComTexto } from "@contabilizadev/nucleo/serpro/dctf-exemplo";
import { respostaDeclaracoes, respostaExtrato } from "@contabilizadev/nucleo/serpro/historico-exemplo";
import { guias } from "@/banco/esquema";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { importar } from "@/lib/historico/importacao";
import type { DependenciasRotina } from "@/lib/rotina/dependencias";
import { respostaDaGuiaDoMes } from "@/lib/rotina/documento-da-guia";
import { botoesDaGuia, valorDaGuia, type EntradaDosBotoes } from "@/lib/rotina/botoes-guia";
import { buscarGuiaDoMes, type GuiaDoMes } from "@/lib/rotina/guias";
import { contextoSerpro, type DependenciasTermo } from "@/lib/termo/termo";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";
import { cadastrarComprovada, consultarComDados } from "./apoio-empresa";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const em = (iso: string) => new Date(`${iso}-03:00`);
const AGORA = em("2026-10-18T10:00:00");
const PLATAFORMA = "98765432000198";
const ADMIN = "admin@plataforma.com";
const PERFIS = { admin: perfil(ADMIN, "sub-admin") };
const ANTERIORES = {
  "2025-09": 25_228.39, "2025-10": 19_224.3, "2025-11": 27_350.21, "2025-12": 24_655.48, "2026-01": 21_869.17, "2026-02": 25_798.12,
  "2026-03": 37_582, "2026-04": 24_985.4, "2026-05": 45_494.12, "2026-06": 47_400, "2026-07": 26_503.41,
};
const ok = (dados: unknown): Resposta => ({ status: 200, dados, mensagens: [{ codigo: "Sucesso", texto: "ok" }] });
const COMPROVANTE = ok({ pdf: pdfComTexto("Comprovante de Arrecadacao").toString("base64") });
const PAGAMENTOS: Resposta = {
  status: 200,
  dados: [
    { numeroDocumento: "7202608000000001", tipo: { codigo: 9, descricao: "DAS" }, periodoApuracao: "2026-08-01", dataArrecadacao: "2026-09-18T00:00:00", valorPrincipal: 1213.55, valorTotal: 1213.55 },
    { numeroDocumento: "7162608000000002", tipo: { codigo: 1, descricao: "DARF" }, receitaPrincipal: { codigo: "1099" }, periodoApuracao: "2026-08-01", dataArrecadacao: "2026-09-08T00:00:00", valorPrincipal: 178.31, valorTotal: 178.31 },
  ],
  mensagens: [],
};

const termo = (): DependenciasTermo => ({ banco: t.banco, chave: Buffer.alloc(32, 7), cliente: clienteFalso(), contratante: { numero: PLATAFORMA, nome: "SUPORTE TI LTDA" }, adminEmails: [ADMIN], agora: () => AGORA });
const rotina = (acesso: AcessoEmpresa, cliente: DependenciasRotina["cliente"]): DependenciasRotina & { autorizada: boolean } => ({
  banco: t.banco, cliente, contexto: () => contextoSerpro(termo(), acesso), agora: () => AGORA, log: () => {}, autorizada: true,
});

async function comHistorico() {
  const usuario = (await entrarComGoogle(depsLogin(t.banco, PERFIS, { adminEmails: [ADMIN] }), "admin")).usuario;
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
  const d = { ...rotina(acesso, cliente), esperar: async () => {} };
  assert.equal((await importar(d as Parameters<typeof importar>[0], acesso, { grupos: ["historico"], manual: false })).estado, "iniciada");
  return { acesso, usuario };
}

describe("QA parte 4 ciclo 2: busca da guia na Receita", () => {
  it("dois cliques juntos (Ver guia e Baixar) fazem uma chamada só e devolvem a mesma guia", async () => {
    const { acesso } = await comHistorico();
    const cliente = clienteFalso(COMPROVANTE, COMPROVANTE);
    const d = rotina(acesso, cliente);
    const [a, b] = await Promise.all([buscarGuiaDoMes(d, acesso, "2026-08", "DAS"), buscarGuiaDoMes(d, acesso, "2026-08", "DAS")]);
    assert.ok(a.ok && b.ok);
    assert.equal(a.guia.id, b.guia.id);
    assert.equal(cliente.chamadas.length, 1);
  });

  it("DARF do INSS pago fora (sem DCTFWeb aqui): busca o comprovante do documento pago uma vez, nome do arquivo de DARF", async () => {
    const { acesso } = await comHistorico();
    const cliente = clienteFalso(COMPROVANTE);
    const d = rotina(acesso, cliente);
    const r = await respostaDaGuiaDoMes(d, acesso, { tipo: "INSS", pa: "2026-08", baixar: true, deOutroSite: false });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-disposition"), 'attachment; filename="comprovante-darf-inss-2026-08.pdf"');
    assert.equal(cliente.chamadas[0].pedido.idServico, "COMPARRECADACAO72");
    assert.deepEqual(cliente.chamadas[0].pedido.dados, { numeroDocumento: "7162608000000002" });
    const de_novo = await respostaDaGuiaDoMes(d, acesso, { tipo: "INSS", pa: "2026-08", baixar: false, deOutroSite: false });
    assert.equal(de_novo.status, 200);
    assert.equal(cliente.chamadas.length, 1, "a segunda abertura vem do banco");
  });

  it("falha da Receita: página em linguagem simples (sem o texto da API), nada guardado e o próximo clique tenta de novo", async () => {
    const { acesso } = await comHistorico();
    const cliente = clienteFalso({ status: 500, dados: null, mensagens: [{ codigo: "PAGTOWEB-ERRO-XYZ", texto: "java.lang.NullPointerException at br.gov" }] }, COMPROVANTE);
    const d = rotina(acesso, cliente);
    const r = await respostaDaGuiaDoMes(d, acesso, { tipo: "DAS", pa: "2026-08", baixar: false, deOutroSite: false });
    assert.equal(r.status, 409);
    const html = await r.text();
    assert.doesNotMatch(html, /NullPointer|PAGTOWEB|java\./);
    assert.equal((await t.banco.select({ id: guias.id }).from(guias)).length, 0);
    const r2 = await respostaDaGuiaDoMes(d, acesso, { tipo: "DAS", pa: "2026-08", baixar: false, deOutroSite: false });
    assert.equal(r2.status, 200);
    assert.equal(cliente.chamadas.length, 2);
  });

  it("resposta da Receita que não é PDF não fica guardada para sempre como a guia (o banco primeiro nunca mais buscaria)", async () => {
    const { acesso } = await comHistorico();
    const cliente = clienteFalso(ok({ pdf: Buffer.from("<html>erro interno</html>").toString("base64") }));
    const d = rotina(acesso, cliente);
    const r = await respostaDaGuiaDoMes(d, acesso, { tipo: "DAS", pa: "2026-08", baixar: false, deOutroSite: false });
    const guardadas = await t.banco.select({ id: guias.id }).from(guias);
    assert.notEqual(r.status, 200, "um HTML foi servido como application/pdf");
    assert.equal(guardadas.length, 0, "o conteúdo que não é PDF ficou guardado como o comprovante do mês");
    const html = await r.text();
    assert.match(html, /devolveu um arquivo que não abre/);
    assert.doesNotMatch(html, /erro interno|PAGTOWEB|COMPARRECADACAO/);
  });
});

describe("QA parte 4 ciclo 2: bordas da decisão dos botões", () => {
  const e = (extra: Partial<EntradaDosBotoes>): EntradaDosBotoes => ({
    pa: "2026-08", tipo: "DAS", situacao: "aberto", guardada: null, referencia: "98765432202608001", pagamento: null, autorizada: true, ...extra,
  });
  it("vencida com a original guardada: 'Guia original' pela rota protegida, com Baixar direto", () => {
    const b = botoesDaGuia(e({ situacao: "vencido", guardada: "id-1" }));
    assert.equal(b?.modo, "guardada");
    assert.equal(b?.rotulo, "Guia original");
  });
  it("vencida sem a original e sem autorização: continua 'Guia original' no portal (não some)", () => {
    const b = botoesDaGuia(e({ situacao: "vencido", autorizada: false }));
    assert.equal(b?.modo, "portal");
    assert.equal(b?.rotulo, "Guia original");
  });
  it("valor: pago com valor zero no PAGTOWEB não vira '—'; guia conhecida vence o valor pago", () => {
    const g = { pa: "2026-08", tipo: "INSS", referencia: null, vencimento: "2026-09-18", paga: true, pagaEm: "2026-09-08", vencida: false, original: null, atualizada: null, pagarEmSugerido: "2026-10-19" } as GuiaDoMes;
    assert.deepEqual(valorDaGuia({ ...g, pagamento: { numero: "1", valor: 0 } }, null), { valor: 0, origem: "pago" });
    assert.deepEqual(valorDaGuia({ ...g, original: { total: 178.31 } as never, pagamento: { numero: "1", valor: 180 } }, null), { valor: 178.31, origem: "" });
  });
});
