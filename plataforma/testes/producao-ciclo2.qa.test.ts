// QA (Parte 2, rodada da página /admin/producao, ciclo 2): bordas que faltavam na conferência e na rota de saúde, e a
// fidelidade de dois detalhes do guia à documentação oficial do Coolify (conferida pelo QA em 22/10/2026).
// Nenhum serviço externo é chamado.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { conferirAmbiente, type FatosDoServidor, type ItemDaConferencia } from "@/lib/producao/conferencia";
import { GUIA } from "@/lib/producao/guia";
import { respostaDaSaude } from "@/lib/producao/saude";

const DIA = 24 * 60 * 60 * 1000;
const AGORA = new Date("2026-10-22T12:00:00Z");
const PRODUCAO = {
  NODE_ENV: "production",
  SESSAO_SEGREDO: "qa2-segredo-de-sessao-com-bem-mais-de-32-caracteres",
  TOKEN_CHAVE: Buffer.alloc(32, 3).toString("base64"),
  PLATAFORMA_CHAVE: Buffer.alloc(32, 4).toString("base64"),
  GOOGLE_CLIENT_ID: "qa2.apps.googleusercontent.com",
  ADMIN_EMAILS: "admin@qa2.teste",
  PLATAFORMA_CNPJ: "11.222.333/0001-81",
  PLATAFORMA_RAZAO_SOCIAL: "Plataforma QA2 Ltda",
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
const detalhe = (secao: string, passo: string) => (GUIA.find((s) => s.id === secao)?.passos.find((p) => p.id === passo)?.detalhe ?? []).join(" ");

describe("QA ciclo 2: conferência do ambiente", () => {
  it("PLATAFORMA_CNPJ com dígito errado é Inválido, sem mostrar o CNPJ", () => {
    const i = item(conferir({ PLATAFORMA_CNPJ: "11.222.333/0001-82" }), "plataforma-cnpj");
    assert.equal(i.ok, false);
    assert.equal(i.situacao, "Inválido");
  });

  it("outra conta @contabilizadev.local no ADMIN_EMAILS também é Falta", () => {
    assert.equal(item(conferir({ ADMIN_EMAILS: "admin@qa2.teste,teste@contabilizadev.local" }), "admin-emails").ok, false);
  });

  it("banco com mais migrações que o código (rollback do código) não acusa atraso", () => {
    assert.equal(item(conferir({}, { banco: { ok: true, aplicadas: 18, ultimaAplicada: 2000 } }), "migracoes").ok, true);
  });

  it("certificado vencendo hoje (0 dias) e 29,9 dias: Falta, sem número negativo", () => {
    const hoje = item(conferir({}, { certificado: { pronto: true, origem: "banco", validoAte: new Date(AGORA.getTime() + 3600_000) } }), "certificado");
    assert.equal(hoje.ok, false);
    assert.match(hoje.situacao, /vence em 0 dias/);
    assert.equal(item(conferir({}, { certificado: { pronto: true, origem: "banco", validoAte: new Date(AGORA.getTime() + 29.9 * DIA) } }), "certificado").ok, false);
  });

  it("produção completa: 15 itens, todos OK", () => {
    const itens = conferir({});
    assert.equal(itens.length, 15);
    assert.deepEqual(itens.filter((i) => !i.ok).map((i) => i.chave), []);
  });
});

describe("QA ciclo 2: rota de saúde", () => {
  it("banco que rejeita depois do limite não gera rejeição sem tratamento", async () => {
    const soltas: unknown[] = [];
    const ouvir = (e: unknown) => soltas.push(e);
    process.on("unhandledRejection", ouvir);
    try {
      const r = await respostaDaSaude(() => new Promise((_, nao) => setTimeout(() => nao(new Error("tarde")), 80)), 20);
      assert.equal(r.status, 503);
      await new Promise((ok) => setTimeout(ok, 150));
      assert.deepEqual(soltas, []);
    } finally {
      process.off("unhandledRejection", ouvir);
    }
  });
});

describe("QA ciclo 2: detalhes do guia fiéis à documentação do Coolify", () => {
  it("backups: o Timeout padrão do job é 3600 s; 60 s é o mínimo recomendado para dumps maiores (não o limite atual)", () => {
    // Documentação (coolify.io/docs/databases/backups): "Use a Timeout of at least 60 seconds when a database dump needs
    // more time." e "The timeout ... defaults to 3600 seconds in the job when no value is set."
    const d = detalhe("backups", "agendar");
    assert.doesNotMatch(d, /se o dump passar de 60 s/);
  });

  it("Ubuntu fora de LTS: a documentação manda usar a instalação manual só se o instalador der problema", () => {
    // Documentação (coolify.io/docs/start-with-self-hosted): "Non-LTS Ubuntu releases can behave differently" ... use o
    // método manual se tiver problema com o instalador. Não diz que fora de LTS "pede" instalação manual.
    const d = detalhe("servidor", "requisitos");
    assert.doesNotMatch(d, /fora de LTS pede instalação manual/);
  });
});
