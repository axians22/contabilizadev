import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MesDoHistorico } from "@/lib/historico/leitura";
import type { GuiaDoMes } from "@/lib/rotina/guias";
import type { Situacao } from "@/lib/termo/situacao";
import { juntarAvisos } from "./central";
import { avisoDaDctfweb, avisoDaDefis, avisoDasMensagens, avisoDoEsocial, avisoDoTermo, avisosDasGuias, avisosDoPgdasd, prazoDaDctfweb } from "./fontes";

const mes = (pa: string, situacao: MesDoHistorico["situacao"], vencimento: string): MesDoHistorico => ({
  pa,
  situacao,
  declaracao: null,
  receita: null,
  valorDas: null,
  das: null,
  vencimento,
  pagoEm: null,
  extrato: null,
  divergencia: null,
});

describe("PGDAS-D", () => {
  it("mês sem declaração com o prazo passado: vermelho, um por mês, com o link para a rotina", () => {
    const meses = [mes("2026-07", "nao-declarado", "2026-08-20"), mes("2026-08", "pago", "2026-09-21"), mes("2026-09", "no-prazo", "2026-10-20")];
    const avisos = avisosDoPgdasd(meses, "2026-10-01", "2026-09");
    assert.deepEqual(avisos.map((a) => [a.chave, a.nivel]), [["pgdasd:2026-07", "vencida"]]);
    assert.match(avisos[0].titulo, /PGDAS-D de julho de 2026 sem declaração/);
    assert.deepEqual(avisos[0].link, { href: "/roteiro?mes=2026-07", texto: "Declarar na rotina do mês" });
  });

  it("último mês ainda não declarado: amarelo só a partir de 5 dias antes do dia 20", () => {
    const meses = [mes("2026-09", "no-prazo", "2026-10-20")];
    assert.deepEqual(avisosDoPgdasd(meses, "2026-10-14", "2026-09"), []);
    const [a] = avisosDoPgdasd(meses, "2026-10-15", "2026-09");
    assert.equal(a.nivel, "vence");
    assert.match(a.titulo, /vence em 5 dias/);
    assert.match(avisosDoPgdasd(meses, "2026-10-20", "2026-09")[0].titulo, /vence hoje/);
    // Sem histórico importado (modo guiado): o lembrete vale igual.
    assert.equal(avisosDoPgdasd([mes("2026-09", "nao-importado", "2026-10-20")], "2026-10-19", "2026-09")[0].titulo, "PGDAS-D de setembro de 2026 vence amanhã");
    // Já declarado: nada.
    assert.deepEqual(avisosDoPgdasd([mes("2026-09", "em-aberto", "2026-10-20")], "2026-10-19", "2026-09"), []);
  });

  it("antes do início de atividade não há o que declarar", () => {
    const meses = [mes("2026-03", "nao-declarado", "2026-04-20"), mes("2026-04", "nao-declarado", "2026-05-20")];
    assert.deepEqual(avisosDoPgdasd(meses, "2026-10-01", "2026-09", "2026-04").map((a) => a.chave), ["pgdasd:2026-04"]);
    assert.deepEqual(avisosDoPgdasd([mes("2026-09", "no-prazo", "2026-10-20")], "2026-10-19", "2026-09", "2026-10"), []);
  });
});

describe("DCTFWeb e eSocial", () => {
  it("prazo: dia 15 do mês seguinte, ou o primeiro dia útil depois (IN RFB 2.005/2021, art. 10)", () => {
    assert.equal(prazoDaDctfweb("2026-09"), "2026-10-15");
    assert.equal(prazoDaDctfweb("2026-10"), "2026-11-16"); // 15/11/2026 é domingo e feriado
  });

  it("com pró-labore e sem transmitir: amarelo perto do prazo, vermelho depois só se dá para conferir", () => {
    const base = { mes: "2026-09", proLabore: 1621, feito: false, conferivel: true };
    assert.deepEqual(avisoDaDctfweb({ ...base, hoje: "2026-10-09" }), []);
    assert.equal(avisoDaDctfweb({ ...base, hoje: "2026-10-10" })[0].nivel, "vence");
    const [atrasada] = avisoDaDctfweb({ ...base, hoje: "2026-10-16" });
    assert.deepEqual([atrasada.chave, atrasada.nivel], ["dctfweb:2026-09", "vencida"]);
    assert.deepEqual(avisoDaDctfweb({ ...base, hoje: "2026-10-16", conferivel: false }), []);
    assert.deepEqual(avisoDaDctfweb({ ...base, hoje: "2026-10-16", feito: true }), []);
    assert.deepEqual(avisoDaDctfweb({ ...base, hoje: "2026-10-16", proLabore: 0 }), []);
    assert.deepEqual(avisoDaDctfweb({ ...base, hoje: "2026-10-16", proLabore: null }), []);
  });

  it("o aviso do eSocial do mês cobre o da DCTFWeb (o fechamento transmite a DCTFWeb): um aviso só", () => {
    const esocial = avisoDoEsocial({ mes: "2026-09", hoje: "2026-10-16", feito: false });
    const dctf = avisoDaDctfweb({ mes: "2026-09", hoje: "2026-10-16", proLabore: 1621, feito: false, conferivel: true });
    assert.deepEqual(juntarAvisos(esocial, dctf).map((a) => a.chave), ["esocial:2026-09"]);
  });
});

describe("guias vencidas, mensagens, declaração anual e autorização", () => {
  it("uma guia vencida por mês e tipo, vermelha, com o link para gerar com juros", () => {
    const guia = (pa: string, tipo: "DAS" | "INSS") => ({ pa, tipo, vencimento: "2026-09-21" }) as GuiaDoMes;
    const avisos = avisosDasGuias([guia("2026-08", "DAS"), guia("2026-08", "INSS")]);
    assert.deepEqual(avisos.map((a) => [a.chave, a.nivel, a.titulo]), [
      ["guia:DAS:2026-08", "vencida", "DAS de agosto de 2026 vencido"],
      ["guia:INSS:2026-08", "vencida", "DARF do INSS de agosto de 2026 vencido"],
    ]);
    assert.deepEqual(avisos[0].link, { href: "/guias#guia-DAS-2026-08", texto: "Gerar a guia com juros" });
  });

  it("mensagens não lidas: importante em vermelho (mesmo já vista na lista), nova em amarelo, as demais informativas", () => {
    assert.deepEqual(avisoDasMensagens(null), []);
    assert.deepEqual(avisoDasMensagens({ naoLidas: 0, novas: 0, importantesNaoLidas: 0 }), []);
    const [uma] = avisoDasMensagens({ naoLidas: 1, novas: 1, importantesNaoLidas: 0 });
    assert.deepEqual([uma.nivel, uma.titulo, uma.link.href], ["vence", "1 mensagem não lida da Receita Federal", "/avisos?aba=mensagens"]);
    const [importante] = avisoDasMensagens({ naoLidas: 3, novas: 0, importantesNaoLidas: 1 });
    assert.deepEqual([importante.nivel, importante.titulo], ["vencida", "3 mensagens não lidas da Receita Federal"]);
    assert.equal(avisoDasMensagens({ naoLidas: 2, novas: 0, importantesNaoLidas: 0 })[0].nivel, "info");
  });

  it("declaração anual: a chave do ano e o link da aba", () => {
    const [a] = avisoDaDefis("2027-02-10", null);
    assert.deepEqual([a.chave, a.nivel, a.link.href], ["defis:2026", "vence", "/defis"]);
    assert.deepEqual(avisoDaDefis("2027-02-10", true), []);
    // Empresa que entrou no Simples em 2027 não deve a de 2026.
    assert.deepEqual(avisoDaDefis("2027-02-10", null, "2027-01-15"), []);
    assert.deepEqual(avisoDaDefis("2027-04-10", false, "2027-01-15"), []);
  });

  it("autorização: o certificado do termo que vence cobre o mesmo certificado guardado no navegador", () => {
    const situacao = { estado: "vencendo", validaAte: "2026-11-04", motivo: "certificado", diasRestantes: 15 } as Situacao;
    const [a] = avisoDoTermo({ nivel: "vence", titulo: "Autorização vence em 15 dias", texto: "x" }, situacao);
    assert.deepEqual([a.chave, a.cobre], ["autorizacao", ["certificado:2026-11-04"]]);
    const [b] = avisoDoTermo({ nivel: "vence", titulo: "Autorização vence em 15 dias", texto: "x" }, { ...situacao, motivo: "vigencia" } as Situacao);
    assert.equal(b.cobre, undefined);
    assert.deepEqual(avisoDoTermo(null), []);
  });
});
