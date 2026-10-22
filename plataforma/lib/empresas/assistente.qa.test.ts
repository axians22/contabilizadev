// QA do assistente de cadastro (/empresas/nova): casos que os testes do engenheiro não cobrem.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lerRespostaCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { respostaGravada, type Exemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { diagnosticar } from "@contabilizadev/nucleo/diagnostico";
import { acaoPrincipal, ESTADO_INICIAL, exemploFatorR, reduzir, type EstadoAssistente, type EventoAssistente, type PreviaDoAssistente } from "./assistente";
import { VALIDADE_DA_PREVIA_MS } from "./cadastro";

function previa(exemplo: Exemplo, consultadaEm: string): PreviaDoAssistente {
  const dados = lerRespostaCnpj(respostaGravada(exemplo));
  return { dados, diagnostico: diagnosticar(dados, consultadaEm.slice(0, 10)), consultadaEm, token: "t", qsa: "confere" as const };
}
const aplicar = (estado: EstadoAssistente, ...eventos: EventoAssistente[]) => eventos.reduce(reduzir, estado);
const continuar: EventoAssistente = { tipo: "continuar" };
const voltar: EventoAssistente = { tipo: "voltar" };

describe("QA: assistente de cadastro", () => {
  // O assistente é didático: ler as etapas e as explicações pode levar mais de 30 minutos. Passado esse prazo,
  // "Confirmar e cadastrar" devolve "A consulta expirou ou não confere. Consulte o CNPJ de novo." Mas, ao voltar ao
  // passo 1 com o mesmo CNPJ, o botão é "Continuar" (reaproveita a prévia vencida) e nunca consulta de novo: o
  // cliente fica preso até trocar o CNPJ ou recarregar a página.
  it("prévia vencida (mais de 30 min): voltar ao passo 1 com o mesmo CNPJ permite pesquisar de novo", () => {
    const antiga = new Date(Date.now() - VALIDADE_DA_PREVIA_MS - 60_000).toISOString();
    const cnpj = "12.345.678/0001-95";
    let e = aplicar(ESTADO_INICIAL, { tipo: "digitar", cnpj }, { tipo: "consultou", previa: previa("ti-fator-r", antiga), agora: Date.parse(antiga) }, continuar, continuar, continuar);
    assert.equal(e.etapa, "diagnostico");
    assert.equal(acaoPrincipal(e), "cadastrar"); // aqui o servidor recusa por prazo vencido
    e = aplicar(e, voltar, voltar, voltar, voltar);
    assert.equal(e.etapa, "cnpj");
    assert.equal(e.cnpj, cnpj);
    assert.equal(acaoPrincipal(e), "consultar", "com a prévia vencida, o passo 1 precisa consultar de novo, não reaproveitar");
  });

  it("exemplo do Fator R: valores com centavos arredondam certo e 28% exato fica no Anexo III", () => {
    const ex = exemploFatorR(3333.33);
    assert.equal(ex.receita12, 39999.96);
    assert.equal(ex.minimoMensal, 933.33);
    assert.equal(ex.minimo12, 11199.99);
    assert.match(ex.textos[2], /28%.*Anexo III/);
    assert.match(ex.textos[3], /15%.*Anexo V/);
  });
});
