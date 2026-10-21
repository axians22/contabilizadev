// QA (Parte 4, ciclo 1 do termo): casos de borda da montagem, da assinatura e da conferência do termo de autorização.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { certificadoIcpDeTeste } from "../certificado-teste.ts";
import { conferirTermo, ErroTermo } from "./conferir-termo.ts";
import { classificarRecusa, lerCache, lerDataHoraBrasilia } from "./autentica-procurador.ts";
import { abrirCertificado, assinarTermo, conferirAntesDeAssinar, dataEmBrasilia, montarTermo, vigenciaPadrao, vigenciaPara } from "./termo-autorizacao.ts";

const PLATAFORMA = { numero: "11444777000161", nome: "PLATAFORMA & CIA <QA> \"TESTE\" D'ÁGUA LTDA" };
const EMPRESA = "12345678000195";

function assinado(razaoEmpresa: string, contratante = PLATAFORMA, agora = new Date()) {
  const c = certificadoIcpDeTeste({ tipo: "PJ", numero: EMPRESA, nome: "EMPRESA QA" });
  const aberto = abrirCertificado(new Uint8Array(c.pfx), c.senha);
  conferirAntesDeAssinar(aberto, EMPRESA, agora);
  const hoje = dataEmBrasilia(agora);
  const xml = montarTermo({
    destinatario: contratante,
    assinadoPor: { numero: EMPRESA, nome: razaoEmpresa },
    dataAssinatura: hoje,
    vigencia: vigenciaPara(vigenciaPadrao(hoje), aberto),
  });
  return assinarTermo(xml, aberto);
}

describe("QA: termo com caracteres especiais na razão social", () => {
  it("&, <, >, aspas, apóstrofo e acentos: o termo é montado escapado, assinado e conferido no servidor", () => {
    const agora = new Date();
    const xml = assinado("SOFTWARE & SERVIÇOS <TI> \"ÁGUA\" D'OESTE LTDA", PLATAFORMA, agora);
    assert.match(xml, /nome="SOFTWARE &amp; SERVIÇOS &lt;TI> &quot;ÁGUA&quot; D'OESTE LTDA"/);
    const r = conferirTermo(xml, { contratante: PLATAFORMA, contribuinte: EMPRESA }, agora);
    assert.equal(r.assinadoPor.nome, "SOFTWARE & SERVIÇOS <TI> \"ÁGUA\" D'OESTE LTDA");
    assert.equal(r.destinatario.nome, PLATAFORMA.nome);
  });

  it("espaços duplos e quebra de linha na razão social são normalizados dos dois lados (navegador e servidor)", () => {
    const agora = new Date();
    const contratante = { numero: PLATAFORMA.numero, nome: "PLATAFORMA   QA\nLTDA" };
    const xml = assinado("EMPRESA\t QA   LTDA", contratante, agora);
    assert.match(xml, /nome="EMPRESA QA LTDA"/);
    assert.match(xml, /nome="PLATAFORMA QA LTDA"/);
    conferirTermo(xml, { contratante, contribuinte: EMPRESA }, agora);
  });

  it("razão social da plataforma diferente da configurada no servidor: recusado sem gastar chamada", () => {
    const agora = new Date();
    const xml = assinado("EMPRESA QA LTDA", PLATAFORMA, agora);
    assert.throws(() => conferirTermo(xml, { contratante: { ...PLATAFORMA, nome: "OUTRA" }, contribuinte: EMPRESA }, agora), ErroTermo);
  });
});

describe("QA: vigência", () => {
  it("1 ano a partir da assinatura, 29/02 vira 28/02, virada de ano", () => {
    assert.equal(vigenciaPadrao("20261018"), "20271018");
    assert.equal(vigenciaPadrao("20280229"), "20290228");
    assert.equal(vigenciaPadrao("20261231"), "20271231");
  });

  it("limitada ao último dia do certificado no dia de Brasília (certificado que vence 01:00 UTC = dia anterior em Brasília)", () => {
    const validoAte = new Date("2027-03-10T01:00:00Z"); // 09/03 22:00 em Brasília
    assert.equal(vigenciaPara("20271018", { validoAte }), "20270309");
    assert.equal(vigenciaPara("20270101", { validoAte }), "20270101");
  });
});

describe("QA: resposta do envio", () => {
  it("data_hora_expiracao inválida (hora 24, dia 31/02, com fuso) não vira data", () => {
    assert.equal(lerDataHoraBrasilia("2026-10-19T24:00:00"), null);
    assert.equal(lerDataHoraBrasilia("2026-02-31T10:00:00"), null);
    assert.equal(lerDataHoraBrasilia("2026-10-19T23:59:59Z"), null);
    assert.equal(lerDataHoraBrasilia("2026-10-19T23:59:59")?.toISOString(), "2026-10-20T02:59:59.000Z");
  });

  it("304 com etag entre aspas e expires RFC 7231; sem expires ou com expires inválido, nada", () => {
    const ok = lerCache({ etag: '"autenticar_procurador_token:abc-123"', expires: "Tue, 20 Oct 2026 02:59:59 GMT" });
    assert.equal(ok?.token, "abc-123");
    assert.equal(ok?.expiraEm.toISOString(), "2026-10-20T02:59:59.000Z");
    assert.equal(lerCache({ etag: '"autenticar_procurador_token:abc"' }), null);
    assert.equal(lerCache({ etag: '"autenticar_procurador_token:abc"', expires: "amanhã" }), null);
    assert.equal(lerCache({ etag: '"outra-coisa"', expires: "Tue, 20 Oct 2026 02:59:59 GMT" }), null);
  });

  it("código desconhecido da API vira 'desconhecido'; 500 sem código vira 'indisponivel'; 401 vira 'configuracao'", () => {
    assert.deepEqual(classificarRecusa(400, [{ codigo: "[Erro-AUTENTICAPROCURADOR-999]", texto: "x" }]), { motivo: "desconhecido", codigo: "999" });
    assert.deepEqual(classificarRecusa(503, []), { motivo: "indisponivel", codigo: null });
    assert.deepEqual(classificarRecusa(401, []), { motivo: "configuracao", codigo: null });
    assert.deepEqual(classificarRecusa(400, [{ codigo: "x", texto: "AUTENTICAPROCURADOR-037 revogado" }]), { motivo: "certificado-revogado", codigo: "037" });
  });
});
