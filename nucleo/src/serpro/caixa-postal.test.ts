import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirMensagem, buscarListaDeNovo, dataHora, lerListaDeMensagens, listarMensagens, proximaPagina, SERVICO_DA_LISTA, SERVICO_DO_CONTEUDO } from "./caixa-postal.ts";
import { CONTRIBUINTE, clienteFalso } from "./cliente-falso.ts";

const LISTA = {
  conteudo: [
    {
      indicadorUltimaPagina: "S",
      listaMensagens: [
        {
          isn: "123",
          assuntoModelo: "Termo de Intimação ++NUM++",
          valorParametroAssunto: "100000067448720",
          dataEnvio: "20250408",
          horaEnvio: "092949",
          indicadorLeitura: "0",
          dataValidade: "20300101",
          relevancia: "2",
          descricaoOrigem: "RFB",
        },
        { assuntoModelo: "sem isn" },
      ],
    },
  ],
};

test("lê a lista de mensagens sem abrir o conteúdo", () => {
  assert.deepEqual(lerListaDeMensagens(LISTA), [
    {
      isn: "123",
      assunto: "Termo de Intimação 100000067448720",
      origem: "RFB",
      enviadaEm: "2025-04-08T09:29:49",
      lidaNaReceita: false,
      cienciaEm: null,
      validaAte: "2030-01-01",
      relevante: true,
    },
  ]);
  assert.deepEqual(lerListaDeMensagens(undefined), []);
  assert.equal(dataHora("2025"), null);
});

test("datas e números como a documentação descreve (Number): hora sem o zero da frente", () => {
  const [m] = lerListaDeMensagens({ conteudo: [{ listaMensagens: [{ isn: 82838, dataEnvio: 20260105, horaEnvio: 80102, indicadorLeitura: 1, relevancia: 1, dataCiencia: 20260110 }] }] });
  assert.deepEqual([m.isn, m.enviadaEm, m.lidaNaReceita, m.relevante, m.cienciaEm], ["82838", "2026-01-05T08:01:02", true, false, "2026-01-10"]);
});

test("abrir mensagem não lida exige confirmação (dá ciência na Receita)", async () => {
  const cliente = clienteFalso(
    { status: 200, dados: LISTA, mensagens: [] },
    { status: 200, dados: { conteudo: [{ corpoModelo: "<p>Intimação ++1++ de ++2++</p>", variaveis: ["X", "2026"] }] }, mensagens: [] },
    { status: 200, dados: { conteudo: [] }, mensagens: [] },
  );
  const [mensagem] = await listarMensagens(cliente, CONTRIBUINTE);
  await assert.rejects(abrirMensagem(cliente, CONTRIBUINTE, mensagem, false), /ciência/);
  assert.equal(cliente.chamadas.length, 1);
  assert.equal(await abrirMensagem(cliente, CONTRIBUINTE, mensagem, true), "<p>Intimação X de 2026</p>");
  assert.equal(cliente.chamadas[1].pedido.idServico, SERVICO_DO_CONTEUDO);
  await assert.rejects(abrirMensagem(cliente, CONTRIBUINTE, { isn: "1", lidaNaReceita: true }, false), /não devolveu/);
});

test("listar nunca chama o serviço que registra a ciência; segue as páginas até o limite", async () => {
  const pagina = (isns: string[], ultima: boolean, ponteiro?: string) => ({
    status: 200,
    dados: { conteudo: [{ indicadorUltimaPagina: ultima ? "S" : "N", ponteiroProximaPagina: ponteiro, listaMensagens: isns.map((isn) => ({ isn, assuntoModelo: `Mensagem ${isn}`, dataEnvio: "20261001" })) }] },
    mensagens: [],
  });
  const cliente = clienteFalso(pagina(["1", "2"], false, "20261001000002"), pagina(["2", "3"], false, "20260901000003"), pagina(["4"], true));
  const lista = await listarMensagens(cliente, CONTRIBUINTE, { paginas: 3 });
  assert.deepEqual(lista.map((m) => m.isn), ["1", "2", "3", "4"]);
  assert.ok(cliente.chamadas.every((c) => c.pedido.idSistema === "CAIXAPOSTAL" && c.pedido.idServico === SERVICO_DA_LISTA));
  assert.ok(cliente.chamadas.every((c) => c.pedido.idServico !== SERVICO_DO_CONTEUDO));
  assert.deepEqual(cliente.chamadas.map((c) => c.pedido.dados), [
    { statusLeitura: "0", indicadorPagina: "0" },
    { statusLeitura: "0", indicadorPagina: "1", ponteiroPagina: "20261001000002" },
    { statusLeitura: "0", indicadorPagina: "1", ponteiroPagina: "20260901000003" },
  ]);
  // Uma página só (a busca do dia): não segue o ponteiro.
  const umaSo = clienteFalso(pagina(["1"], false, "9"));
  assert.equal((await listarMensagens(umaSo, CONTRIBUINTE)).length, 1);
  assert.equal(umaSo.chamadas.length, 1);
  assert.equal(proximaPagina(undefined), null);
});

test("lista recusada vira erro (a plataforma registra a falha e não muda nada)", async () => {
  const cliente = clienteFalso({ status: 403, dados: null, mensagens: [{ codigo: "E", texto: "sem autorização" }] });
  await assert.rejects(listarMensagens(cliente, CONTRIBUINTE), /HTTP 403/);
});

test("busca a lista de novo uma vez por dia", () => {
  const agora = new Date(2026, 9, 16, 12);
  assert.equal(buscarListaDeNovo(null, agora), true);
  assert.equal(buscarListaDeNovo(new Date(2026, 9, 15, 13), agora), false);
  assert.equal(buscarListaDeNovo(new Date(2026, 9, 15, 12), agora), true);
});
