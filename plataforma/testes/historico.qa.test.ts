// QA, Parte 5 (passo 17): banco primeiro com mês declarado sem DAS (mês sem receita, valor zero).
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { buscarExemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import { cnpj } from "@contabilizadev/nucleo/serpro/cliente";
import { pdfComTexto } from "@contabilizadev/nucleo/serpro/dctf-exemplo";
import { respostaDeclaracaoRecibo, respostaDeclaracoes, respostaDefis, respostaExtrato, respostaPagamentos, respostaProtocolo, respostaRelatorio } from "@contabilizadev/nucleo/serpro/historico-exemplo";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa } from "@/lib/empresas/acesso";
import { importar, type DependenciasImportacao } from "@/lib/historico/importacao";
import { historicoDaEmpresa, importacaoDaEmpresa } from "@/lib/historico/leitura";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";
import { cadastrarComprovada, consultarComDados } from "./apoio-empresa";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const em = (iso: string) => new Date(`${iso}-03:00`);
const AGORA = em("2026-10-18T10:00:00");
const SUPORTE = "98765432000198";
const PERFIS = { ana: perfil("ana@a.com", "sub-ana") };
const contexto = async () => ({ contribuinte: cnpj(SUPORTE), autorPedidoDados: cnpj(SUPORTE), tokenProcurador: "b06feea3-1ca8-49f4-bdb4-211ab006cb92" });
const dependencias = (cliente: DependenciasImportacao["cliente"], agora: Date): DependenciasImportacao => ({
  banco: t.banco,
  cliente,
  contexto,
  agora: () => agora,
  esperar: async () => {},
  log: () => {},
});

async function empresa() {
  const usuario = (await entrarComGoogle(depsLogin(t.banco, PERFIS), "ana")).usuario;
  const r = await consultarComDados(t.banco, usuario, "98.765.432/0001-98", { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-anexo-iii") });
  assert.equal(r.tipo, "previa");
  const empresaId = await cadastrarComprovada(t.banco, usuario, r.previa.token, { segredo: SEGREDO, agora: AGORA });
  return exigirAcessoEmpresa(t.banco, usuario, empresaId);
}

describe("QA: mês declarado sem DAS (sem receita)", () => {
  it("tudo pago e um mês sem receita: no dia seguinte, a consulta de pagamentos (cobrada) não roda sozinha de novo", async () => {
    const acesso = await empresa();
    const declaracoes2026 = respostaDeclaracoes(2026, [
      // 07/2026 sem receita: declaração transmitida, nenhum DAS (não há valor a pagar).
      { pa: "2026-07", declaracoes: [{ numero: "98765432202607001", quando: "20260805100000" }], das: [] },
      { pa: "2026-09", declaracoes: [{ numero: "98765432202609001", quando: "20261005133543" }], das: [{ numero: "07202609000000001", quando: "20261005133600", pago: true }] },
    ]);
    await importar(
      dependencias(
        clienteFalso(
          respostaDeclaracoes(2025, []),
          declaracoes2026,
          // Engenharia: o mês sem DAS tem o débito lido da própria declaração (CONSDECREC15), buscada uma vez.
          respostaDeclaracaoRecibo("98765432202607001", { pa: "2026-07", receita: 0, tributos: { irpj: 0, csll: 0, cpp: 0 } }),
          respostaExtrato("07202609000000001", { pa: "2026-09", receita: 23_000 }),
          respostaPagamentos([{ numero: "07202609000000001", pa: "2026-09", data: "2026-10-13", valor: 1000.76 }]),
          respostaDefis(pdfComTexto("DEFIS 2025").toString("base64")),
          respostaProtocolo,
          respostaRelatorio(),
        ),
        AGORA,
      ),
      acesso,
      { grupos: ["historico", "defis", "situacao"], manual: false },
    );
    const julho = (await historicoDaEmpresa(t.banco, acesso, AGORA, null)).find((m) => m.pa === "2026-07")!;
    // Sem receita não há guia: o mês não deveria aparecer como alerta ("Sem guia", amarelo) — o certo é "Sem valor a pagar".
    const problemas: string[] = [];
    if (julho.situacao !== "sem-valor") problemas.push(`mês sem receita aparece como "${julho.situacao}"`);

    const amanha = em("2026-10-19T11:00:00");
    const cliente = clienteFalso(declaracoes2026, respostaPagamentos([]));
    await importar(dependencias(cliente, amanha), acesso, { grupos: ["historico"], manual: false });
    const imp = await importacaoDaEmpresa(t.banco, acesso, amanha);
    if (imp?.etapas.some((e) => e.id === "pagamentos")) {
      problemas.push(`pagamentos consultados de novo sozinhos sem nenhum DAS em aberto: ${cliente.chamadas.map((c) => c.pedido.idServico).join(", ")}`);
    }
    assert.deepEqual(problemas, []);
  });
});
