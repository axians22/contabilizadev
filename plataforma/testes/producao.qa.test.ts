// QA (Parte 2, rodada da página /admin/producao): casos de borda da conferência do ambiente e da rota de saúde que os testes
// do engenheiro não cobrem. Nenhum serviço externo é chamado.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { conferirAmbiente, DIAS_PARA_TROCAR_O_CERTIFICADO, type FatosDoServidor, type ItemDaConferencia } from "@/lib/producao/conferencia";
import { respostaDaSaude } from "@/lib/producao/saude";
import { decidirAcesso } from "@/lib/autenticacao/rotas";

const DIA = 24 * 60 * 60 * 1000;
const AGORA = new Date("2026-10-22T12:00:00Z");
const PRODUCAO = {
  NODE_ENV: "production",
  SESSAO_SEGREDO: "qa-segredo-de-sessao-com-bem-mais-de-32-caracteres",
  TOKEN_CHAVE: Buffer.alloc(32, 7).toString("base64"),
  PLATAFORMA_CHAVE: Buffer.alloc(32, 8).toString("base64"),
  GOOGLE_CLIENT_ID: "qa.apps.googleusercontent.com",
  ADMIN_EMAILS: "admin@qa.teste",
  PLATAFORMA_CNPJ: "11.222.333/0001-81",
  PLATAFORMA_RAZAO_SOCIAL: "Plataforma QA Ltda",
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

describe("QA: conferência do ambiente, bordas", () => {
  it("conta de desenvolvimento em maiúsculas e com espaços no ADMIN_EMAILS ainda é Falta", () => {
    assert.equal(item(conferir({ ADMIN_EMAILS: "admin@qa.teste,  DEV@ContabilizaDev.LOCAL " }), "admin-emails").ok, false);
  });

  it("ADMIN_EMAILS só com vírgulas e espaços conta como vazio", () => {
    const i = item(conferir({ ADMIN_EMAILS: " , ," }), "admin-emails");
    assert.equal(i.ok, false);
    assert.match(i.situacao, /Vazio/);
  });

  it("certificado: exatamente no limite de dias é Falta; um dia acima é OK", () => {
    const no = item(conferir({}, { certificado: { pronto: true, origem: "banco", validoAte: new Date(AGORA.getTime() + DIAS_PARA_TROCAR_O_CERTIFICADO * DIA) } }), "certificado");
    assert.equal(no.ok, false);
    assert.match(no.situacao, new RegExp(`vence em ${DIAS_PARA_TROCAR_O_CERTIFICADO} dias`));
    const acima = item(conferir({}, { certificado: { pronto: true, origem: "banco", validoAte: new Date(AGORA.getTime() + (DIAS_PARA_TROCAR_O_CERTIFICADO + 1) * DIA) } }), "certificado");
    assert.equal(acima.ok, true);
  });

  it("certificado vencido mostra a data e o motivo vai só na explicação", () => {
    const i = item(conferir({}, { certificado: { pronto: false, vencidoEm: new Date("2026-01-10T12:00:00Z"), motivo: "vencido" } }), "certificado");
    assert.equal(i.ok, false);
    assert.equal(i.situacao, "Vencido em 10/01/2026");
  });

  it("x-forwarded-proto: maiúsculas e lista com vários proxies usam o primeiro valor", () => {
    assert.equal(item(conferir({}, { protocolo: "HTTPS" }), "https").ok, true);
    assert.equal(item(conferir({}, { protocolo: "https, http" }), "https").ok, true);
    assert.equal(item(conferir({}, { protocolo: "http, https" }), "https").ok, false);
    const vazio = item(conferir({}, { protocolo: "" }), "https");
    assert.equal(vazio.ok, false);
    assert.equal(vazio.situacao, "Protocolo desconhecido");
  });

  it("migrações: mesma contagem mas a última do código mais nova é Falta; sem banco também", () => {
    assert.equal(item(conferir({}, { banco: { ok: true, aplicadas: 17, ultimaAplicada: 999 } }), "migracoes").ok, false);
    assert.equal(item(conferir({}, { banco: { ok: true, aplicadas: 0, ultimaAplicada: null }, migracoesDoCodigo: { total: 0, ultima: 0 } }), "migracoes").ok, true);
    const sem = conferir({}, { banco: { ok: false } });
    assert.equal(item(sem, "banco").ok, false);
    assert.equal(item(sem, "migracoes").ok, false);
    assert.match(item(sem, "migracoes").situacao, /Sem banco/);
  });

  it("AUTH_DISABLED=true em produção: ignorada, mas Falta (a variável não deve existir)", () => {
    const i = item(conferir({ AUTH_DISABLED: "true" }), "login-desligado");
    assert.equal(i.ok, false);
    assert.match(i.situacao, /ignorada/);
  });

  it("NODE_ENV com outro valor (Production, vazio) não conta como produção", () => {
    assert.equal(item(conferir({ NODE_ENV: "Production" }), "node-env").ok, false);
    assert.equal(item(conferir({ NODE_ENV: "Production" }), "cookie-seguro").ok, false);
    assert.match(item(conferir({ NODE_ENV: undefined }), "node-env").situacao, /não definido/);
  });

  it("PLATAFORMA_CHAVE válida mas TOKEN_CHAVE inválida: só a TOKEN_CHAVE fica Falta", () => {
    const itens = conferir({ TOKEN_CHAVE: "curta" });
    assert.equal(item(itens, "token-chave").ok, false);
    assert.equal(item(itens, "plataforma-chave").ok, true);
  });

  it("razão social e Client ID só com espaços contam como ausentes", () => {
    const itens = conferir({ PLATAFORMA_RAZAO_SOCIAL: "   ", GOOGLE_CLIENT_ID: "  " });
    assert.equal(item(itens, "plataforma-razao").ok, false);
    assert.equal(item(itens, "google-client-id").ok, false);
  });

  it("nenhum valor de segredo, mesmo inválido, aparece na saída", () => {
    const env = { SESSAO_SEGREDO: "segredo-curto-QA", TOKEN_CHAVE: "token-invalido-QA", PLATAFORMA_CHAVE: "plataforma-invalida-QA", DATABASE_URL: "postgres://u:senha-QA@h/b" };
    const saida = JSON.stringify(conferir(env));
    for (const v of ["segredo-curto-QA", "token-invalido-QA", "plataforma-invalida-QA", "senha-QA"]) assert.ok(!saida.includes(v), v);
  });
});

describe("QA: rota de saúde, bordas", () => {
  it("rejeição que não é Error: 503 com só {ok:false}", async () => {
    const r = await respostaDaSaude(() => Promise.reject("texto qualquer"));
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { ok: false });
  });

  it("banco que responde depois do limite: 503 no limite, sem esperar o banco", async () => {
    const inicio = Date.now();
    const r = await respostaDaSaude(() => new Promise((ok) => setTimeout(ok, 500)), 50);
    assert.equal(r.status, 503);
    assert.ok(Date.now() - inicio < 400);
  });

  it("resposta 200 não traz cabeçalhos além do tipo e do no-store", async () => {
    const r = await respostaDaSaude(async () => [{ "?column?": 1 }]);
    assert.equal(r.status, 200);
    assert.deepEqual([...r.headers.keys()].sort(), ["cache-control", "content-type"]);
    assert.equal(await r.text(), '{"ok":true}');
  });

  it("proxy: /api/saude abre sem cookie mesmo com o login ligado; vizinhas continuam 401", () => {
    assert.equal(decidirAcesso("/api/saude", false, false), "seguir");
    assert.equal(decidirAcesso("/api/saude", false, true), "seguir");
    assert.equal(decidirAcesso("/api/saud", false, false), "401");
    assert.equal(decidirAcesso("/api/saude-detalhes", false, false), "401");
  });
});
