// QA (Parte 2, rodada da página /admin/producao, ciclo 3): bordas restantes da conferência do ambiente e da rota de saúde.
// Nenhum serviço externo é chamado.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { conferirAmbiente, type FatosDoServidor, type ItemDaConferencia } from "@/lib/producao/conferencia";
import { TAMANHO_MINIMO_DO_SEGREDO } from "@/lib/autenticacao/config";
import { respostaDaSaude } from "@/lib/producao/saude";
import { decidirAcesso } from "@/lib/autenticacao/rotas";

const DIA = 24 * 60 * 60 * 1000;
const AGORA = new Date("2026-10-22T12:00:00Z");
const PRODUCAO = {
  NODE_ENV: "production",
  SESSAO_SEGREDO: "qa3-segredo-de-sessao-com-bem-mais-de-32-caracteres",
  TOKEN_CHAVE: Buffer.alloc(32, 5).toString("base64"),
  PLATAFORMA_CHAVE: Buffer.alloc(32, 6).toString("base64"),
  GOOGLE_CLIENT_ID: "qa3.apps.googleusercontent.com",
  ADMIN_EMAILS: "admin@qa3.teste",
  PLATAFORMA_CNPJ: "11.222.333/0001-81",
  PLATAFORMA_RAZAO_SOCIAL: "Plataforma QA3 Ltda",
};
const FATOS: FatosDoServidor = {
  banco: { ok: true, aplicadas: 17, ultimaAplicada: 1000 },
  migracoesDoCodigo: { total: 17, ultima: 1000 },
  certificado: { pronto: true, origem: "banco", validoAte: new Date(AGORA.getTime() + 300 * DIA) },
  chaves: "guardadas",
  protocolo: "https",
  agora: AGORA,
};
const item = (itens: ItemDaConferencia[], chave: string) => {
  const i = itens.find((x) => x.chave === chave);
  assert.ok(i, chave);
  return i;
};
const conferir = (env: Record<string, string | undefined>, fatos: Partial<FatosDoServidor> = {}) => conferirAmbiente({ ...PRODUCAO, ...env }, { ...FATOS, ...fatos });

describe("QA ciclo 3: conferência do ambiente", () => {
  it("SESSAO_SEGREDO exatamente no mínimo é OK; um caractere a menos é Falta", () => {
    assert.equal(item(conferir({ SESSAO_SEGREDO: "s".repeat(TAMANHO_MINIMO_DO_SEGREDO) }), "sessao-segredo").ok, true);
    const curto = item(conferir({ SESSAO_SEGREDO: "s".repeat(TAMANHO_MINIMO_DO_SEGREDO - 1) }), "sessao-segredo");
    assert.equal(curto.ok, false);
    assert.match(curto.situacao, /curto/);
  });

  it("AUTH_DISABLED vazia ou false ainda é Falta (a variável não deve existir)", () => {
    for (const v of ["", "false"]) assert.equal(item(conferir({ AUTH_DISABLED: v }), "login-desligado").ok, false, v);
  });

  it("x-forwarded-proto vazio é Protocolo desconhecido e Falta", () => {
    const i = item(conferir({}, { protocolo: "" }), "https");
    assert.equal(i.ok, false);
    assert.match(i.situacao, /desconhecido/);
  });

  it("e-mail parecido com a conta de desenvolvimento, mas de outro domínio, não é Falta", () => {
    assert.equal(item(conferir({ ADMIN_EMAILS: "dev@contabilizadev.local.com.br" }), "admin-emails").ok, true);
  });

  it("a lista sempre tem os 15 itens pedidos, com chaves únicas, em produção e em desenvolvimento", () => {
    for (const env of [{}, { NODE_ENV: "development", AUTH_DISABLED: "true" }]) {
      const itens = conferir(env);
      assert.equal(itens.length, 15);
      assert.equal(new Set(itens.map((i) => i.chave)).size, 15);
      for (const i of itens) assert.ok(i.explicacao.length > 0, i.chave);
    }
  });
});

describe("QA ciclo 3: rota de saúde", () => {
  it("503 também não traz o erro do banco no corpo nem em cabeçalho", async () => {
    const r = await respostaDaSaude(async () => {
      throw new Error("password authentication failed for user contabilizadev senha-secreta");
    });
    assert.equal(r.status, 503);
    const corpo = await r.text();
    assert.equal(corpo, '{"ok":false}');
    for (const [, v] of r.headers) assert.doesNotMatch(v, /senha|password/);
  });

  it("proxy: /api/saude sem cookie segue; /api/saude-x e /api/saudes não", () => {
    assert.equal(decidirAcesso("/api/saude", false, false), "seguir");
    assert.equal(decidirAcesso("/api/saude-x", false, false), "401");
    assert.equal(decidirAcesso("/api/saudes", false, false), "401");
  });
});
