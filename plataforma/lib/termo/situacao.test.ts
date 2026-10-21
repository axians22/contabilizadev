// Situação do termo de autorização, aviso do sino, liberação das funções, motivo do modo guiado e mensagens próprias
// (funções puras, sem banco).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { motivoGuiado, FUNCOES, CAMINHOS } from "./guiado";
import { MENSAGEM_GENERICA, MENSAGENS_DA_PLATAFORMA, mensagemDoEnvio } from "./mensagens";
import { AVISO_DIAS, avisoDaSituacao, liberada, situacaoDa, type Linha } from "./situacao";

const AGORA = new Date("2026-10-18T15:00:00Z"); // 18/10/2026, meio-dia em Brasília
const linha = (extra: Partial<Linha> = {}): Linha => ({
  id: "00000000-0000-4000-8000-000000000001",
  empresaId: "00000000-0000-4000-8000-000000000002",
  contratante: "11444777000161",
  enviadoPorId: null,
  enviadoEm: new Date("2026-10-18T14:00:00Z"),
  dataAssinatura: "2026-10-18",
  vigencia: "2027-10-18",
  certificadoValidoAte: new Date("2028-01-01T12:00:00Z"),
  signatarioCnpj: "11222333000181",
  signatarioNome: "EMPRESA DE TESTE LTDA",
  xmlHash: "h",
  termoCifrado: "v1.a.b.c",
  tokenCifrado: "v1.a.b.c",
  tokenExpiraEm: new Date("2026-10-20T02:59:59Z"),
  tokenObtidoEm: AGORA,
  recusadoEm: null,
  recusaMotivo: null,
  substituidoEm: null,
  ...extra,
});
const em = (iso: string) => new Date(iso);

describe("situação do termo", () => {
  it("sem termo: ausente, desligado, sem aviso", () => {
    const s = situacaoDa(null, AGORA);
    assert.deepEqual(s, { estado: "ausente" });
    assert.equal(liberada(s), false);
    assert.equal(avisoDaSituacao(s), null);
  });

  it("empresa da própria plataforma: ligado, sem aviso", () => {
    assert.equal(liberada({ estado: "propria" }), true);
    assert.equal(avisoDaSituacao({ estado: "propria" }), null);
  });

  it("vigente: vale até a vigência, com quem assinou; sem aviso", () => {
    const s = situacaoDa(linha(), AGORA);
    assert.equal(s.estado, "vigente");
    assert.ok(s.estado === "vigente");
    assert.equal(s.validaAte, "2027-10-18");
    assert.equal(s.motivo, "vigencia");
    assert.equal(s.diasRestantes, 365);
    assert.deepEqual(s.signatario, { cnpj: "11222333000181", nome: "EMPRESA DE TESTE LTDA" });
    assert.equal(liberada(s), true);
    assert.equal(avisoDaSituacao(s), null);
  });

  it(`vencendo com ${AVISO_DIAS} dias ou menos (dia de Brasília), vencida no dia seguinte ao último dia`, () => {
    const l = linha({ vigencia: "2026-11-17" });
    assert.equal(situacaoDa(l, em("2026-10-17T15:00:00Z")).estado, "vigente"); // 31 dias
    const s30 = situacaoDa(l, AGORA);
    assert.equal(s30.estado, "vencendo");
    assert.equal(liberada(s30), true);
    assert.deepEqual(avisoDaSituacao(s30), {
      nivel: "vence",
      titulo: "Autorização vence em 30 dias",
      texto: "A autorização vale até 17/11/2026. Assine de novo antes disso para não voltar ao modo guiado.",
    });
    assert.equal(avisoDaSituacao(situacaoDa(l, em("2026-11-16T15:00:00Z")))?.titulo, "Autorização vence amanhã");
    // 17/11 às 23h em Brasília (18/11 02h UTC): ainda é o último dia.
    const ultimo = situacaoDa(l, em("2026-11-18T02:00:00Z"));
    assert.equal(ultimo.estado, "vencendo");
    assert.equal(avisoDaSituacao(ultimo)?.titulo, "Autorização vence hoje");
    // 18/11 00h em Brasília: venceu.
    const vencida = situacaoDa(l, em("2026-11-18T03:00:00Z"));
    assert.equal(vencida.estado, "vencida");
    assert.ok(vencida.estado === "vencida" && vencida.diasRestantes < 0);
    assert.equal(liberada(vencida), false);
    assert.deepEqual(avisoDaSituacao(vencida), {
      nivel: "vencida",
      titulo: "A autorização venceu",
      texto: "A autorização venceu em 17/11/2026. Assine de novo; até lá, tudo fica no modo guiado.",
    });
  });

  it("o certificado vence antes da vigência: vale até o último dia dele, e o aviso pede para renovar o e-CNPJ", () => {
    const l = linha({ certificadoValidoAte: em("2026-11-01T18:00:00Z") });
    const s = situacaoDa(l, AGORA);
    assert.ok(s.estado === "vencendo");
    assert.equal(s.motivo, "certificado");
    assert.equal(s.validaAte, "2026-11-01");
    assert.match(avisoDaSituacao(s)!.texto, /^O certificado usado na autorização vale até 01\/11\/2026\. Renove o e-CNPJ A1 e assine de novo/);
    // Vencido o certificado (mesmo no meio do dia), o termo venceu.
    assert.equal(situacaoDa(l, em("2026-11-01T18:00:00Z")).estado, "vencida");
    assert.match(avisoDaSituacao(situacaoDa(l, em("2026-11-02T12:00:00Z")))!.texto, /Renove o e-CNPJ A1 e assine de novo; até lá/);
  });

  it("recusado pela Receita ao renovar: desligado, aviso vermelho com o motivo; vencido tem precedência", () => {
    const s = situacaoDa(linha({ recusadoEm: AGORA, recusaMotivo: "certificado-revogado" }), AGORA);
    assert.ok(s.estado === "recusada");
    assert.equal(s.recusa, "certificado-revogado");
    assert.equal(liberada(s), false);
    const aviso = avisoDaSituacao(s)!;
    assert.equal(aviso.nivel, "vencida");
    assert.match(aviso.texto, /\(o certificado foi revogado\)\. A autorização deixou de valer: assine de novo\./);
    assert.doesNotMatch(avisoDaSituacao(situacaoDa(linha({ recusadoEm: AGORA, recusaMotivo: "termo" }), AGORA))!.texto, /\(/);
    assert.equal(situacaoDa(linha({ recusadoEm: AGORA, vigencia: "2026-10-01" }), AGORA).estado, "vencida");
  });
});

describe("modo guiado", () => {
  it("o motivo por estado, numa frase", () => {
    assert.equal(motivoGuiado({ estado: "ausente" }), "Autorização pendente: a empresa ainda não assinou o termo de autorização.");
    assert.match(motivoGuiado(situacaoDa(linha({ vigencia: "2026-10-01" }), AGORA)), /^A autorização venceu em 01\/10\/2026/);
    assert.match(motivoGuiado(situacaoDa(linha({ recusadoEm: AGORA }), AGORA)), /recusou a autorização/);
    // Situação inesperada (as liberadas não chegam aqui): o texto do modo guiado.
    assert.equal(motivoGuiado({ estado: "propria" }), "Disponível depois da autorização: até lá, faça no portal.");
  });

  it("toda função tem caminho no portal oficial", () => {
    for (const f of FUNCOES) {
      assert.ok(CAMINHOS[f].passos.length > 0, f);
      // O eSocial (Parte 7) tem o portal dele, também do governo.
      assert.match(CAMINHOS[f].portal.url, /^https:\/\/[^/]*(receita\.fazenda\.gov\.br|receitafederal\.gov\.br|esocial\.gov\.br)/, f);
    }
  });
});

describe("mensagens próprias", () => {
  it("cada motivo do envio tem a sua; o desconhecido vira a genérica", () => {
    assert.match(mensagemDoEnvio("certificado-vencido"), /certificado está vencido/);
    assert.match(mensagemDoEnvio("certificado-revogado"), /revogado/);
    assert.match(mensagemDoEnvio("indisponivel"), /não respondeu/);
    assert.match(mensagemDoEnvio("configuracao"), /do nosso lado/);
    assert.equal(mensagemDoEnvio("qualquer-coisa"), MENSAGEM_GENERICA);
    assert.equal(mensagemDoEnvio(null), MENSAGEM_GENERICA);
    assert.equal(mensagemDoEnvio("toString"), MENSAGEM_GENERICA);
  });
  it("problemas da instalação não dão detalhe técnico ao cliente", () => {
    for (const m of Object.values(MENSAGENS_DA_PLATAFORMA)) assert.doesNotMatch(m, /PLATAFORMA_|TOKEN_CHAVE|SERPRO_|\.env/);
  });
});
