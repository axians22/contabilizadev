import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolverCertificadoDaPlataforma, type CertificadoDaPlataforma } from "@/lib/serpro/config";
import { AVISO_DIAS_PLATAFORMA, avisoDoCertificadoDaPlataforma, estadoDoCertificado } from "./aviso";
import { NADA_GUARDADO, type CertificadoGuardado } from "./segredos";

const AGORA = new Date("2026-10-20T15:00:00Z");
const DIA = 24 * 60 * 60 * 1000;
const em = (dias: number) => new Date(AGORA.getTime() + dias * DIA);

describe("aviso do certificado da plataforma (sino do ADMIN)", () => {
  it("mais de 30 dias: nada", () => {
    assert.deepEqual(avisoDoCertificadoDaPlataforma({ estado: "ok", validoAte: em(AVISO_DIAS_PLATAFORMA + 1) }, AGORA), []);
  });

  it("30 dias ou menos: amarelo, com os dias e o link para trocar", () => {
    const [a] = avisoDoCertificadoDaPlataforma({ estado: "ok", validoAte: em(30) }, AGORA);
    assert.equal(a.nivel, "vence");
    assert.equal(a.titulo, "Certificado da plataforma vence em 30 dias");
    assert.deepEqual(a.link, { href: "/admin/plataforma", texto: "Trocar o certificado da plataforma" });
    assert.equal(avisoDoCertificadoDaPlataforma({ estado: "ok", validoAte: em(0.5) }, AGORA)[0].titulo, "Certificado da plataforma vence amanhã"); // 12h de Brasília + 12 h = meia-noite do dia 21
  });

  it("venceu (inclusive no instante exato), ilegível ou faltando: vermelho", () => {
    for (const validoAte of [AGORA, em(-3)]) {
      const [a] = avisoDoCertificadoDaPlataforma({ estado: "ok", validoAte }, AGORA);
      assert.equal(a.nivel, "vencida");
      assert.equal(a.titulo, "O certificado da plataforma venceu");
    }
    assert.match(avisoDoCertificadoDaPlataforma({ estado: "ilegivel" }, AGORA)[0].titulo, /Envie de novo/);
    assert.equal(avisoDoCertificadoDaPlataforma({ estado: "indisponivel" }, AGORA)[0].nivel, "vencida");
  });

  it("uma chave só (o sino mostra um aviso) e nenhum fornecedor no texto", () => {
    const todos = [
      ...avisoDoCertificadoDaPlataforma({ estado: "ok", validoAte: em(10) }, AGORA),
      ...avisoDoCertificadoDaPlataforma({ estado: "ok", validoAte: em(-1) }, AGORA),
      ...avisoDoCertificadoDaPlataforma({ estado: "ilegivel" }, AGORA),
      ...avisoDoCertificadoDaPlataforma({ estado: "recusado" }, AGORA),
      ...avisoDoCertificadoDaPlataforma({ estado: "indisponivel" }, AGORA),
    ];
    assert.equal(new Set(todos.map((a) => a.chave)).size, 1);
    for (const a of todos) assert.doesNotMatch(`${a.titulo} ${a.texto} ${a.link.texto}`, /serpro|integra|PLATAFORMA_/i);
  });

  it("dias de calendário em Brasília: vence hoje, amanhã ou em N dias (sem arredondar horas)", () => {
    const titulo = (agora: string, validoAte: string) => avisoDoCertificadoDaPlataforma({ estado: "ok", validoAte: new Date(validoAte) }, new Date(agora))[0]?.titulo;
    assert.equal(titulo("2026-10-20T09:00:00-03:00", "2026-10-20T21:00:00-03:00"), "Certificado da plataforma vence hoje");
    assert.equal(titulo("2026-10-20T00:01:00-03:00", "2026-10-20T23:59:00-03:00"), "Certificado da plataforma vence hoje");
    // 2h da manhã de amanhã (menos de 24 h): é amanhã, não hoje.
    assert.equal(titulo("2026-10-20T23:00:00-03:00", "2026-10-21T02:00:00-03:00"), "Certificado da plataforma vence amanhã");
    // 30 h depois, mas dois dias de calendário.
    assert.equal(titulo("2026-10-20T20:00:00-03:00", "2026-10-22T02:00:00-03:00"), "Certificado da plataforma vence em 2 dias");
    // Meia-noite UTC já é o dia seguinte em UTC, mas ainda é hoje em Brasília.
    assert.equal(titulo("2026-10-20T10:00:00-03:00", "2026-10-21T01:00:00Z"), "Certificado da plataforma vence hoje");
    // Limite: 30 dias de calendário avisa, 31 não.
    assert.equal(titulo("2026-10-20T23:00:00-03:00", "2026-11-19T01:00:00-03:00"), "Certificado da plataforma vence em 30 dias");
    assert.equal(titulo("2026-10-20T23:00:00-03:00", "2026-11-20T01:00:00-03:00"), undefined);
  });
});

describe("estado do certificado da plataforma (o que o resolvedor aceitou)", () => {
  const info = (cnpj: string, validoAte: Date) => ({ titular: "PLATAFORMA LTDA", cnpj, validoDe: "2026-01-01T00:00:00Z", validoAte: validoAte.toISOString(), emissor: "AC TESTE" });
  const quem = { atualizadoEm: AGORA, atualizadoPor: "admin@teste" };
  const recusado: CertificadoDaPlataforma = { pronto: false, motivo: "O certificado da plataforma guardado é do CNPJ 11222333000181, mas PLATAFORMA_CNPJ é ...", falha: { tipo: "outro-cnpj" } };

  it("guardado legível de outro CNPJ (não aceito): recusado, e o sino avisa em vermelho sem citar fornecedor", () => {
    const e = estadoDoCertificado({ certificado: recusado });
    assert.deepEqual(e, { estado: "recusado" });
    const [a] = avisoDoCertificadoDaPlataforma(e, AGORA);
    assert.equal(a.nivel, "vencida");
    assert.equal(a.link.href, "/admin/plataforma");
    assert.doesNotMatch(`${a.titulo} ${a.texto}`, /serpro|integra|PLATAFORMA_|11222333/i);
  });

  it("guardado legível e vencido (recusado por isso): ok com a data, o sino diz que venceu", () => {
    const e = estadoDoCertificado({ certificado: { pronto: false, motivo: "venceu", falha: { tipo: "vencido", validoAte: em(-2) } } });
    assert.equal(avisoDoCertificadoDaPlataforma(e, AGORA)[0].titulo, "O certificado da plataforma venceu");
  });

  it("aceito pelo resolvedor (banco ou ambiente): ok com a validade do certificado em uso", () => {
    const validoAte = em(10);
    const aceito: CertificadoDaPlataforma = { pronto: true, origem: "ambiente", tls: { pfx: Buffer.from(""), senha: "" } as never, validoAte, pem: () => ({ chave: "", certificado: "", certificadoBase64: "" }) };
    assert.deepEqual(estadoDoCertificado({ certificado: aceito }), { estado: "ok", validoAte });
  });

  it("ilegível (a chave mudou) e nada guardado nem no ambiente", () => {
    const naoAbre: CertificadoDaPlataforma = { pronto: false, motivo: "não abre com a PLATAFORMA_CHAVE atual", falha: { tipo: "ilegivel" } };
    const falta: CertificadoDaPlataforma = { pronto: false, motivo: "Falta o certificado da plataforma", falha: { tipo: "falta" } };
    assert.deepEqual(estadoDoCertificado({ certificado: naoAbre }), { estado: "ilegivel" });
    assert.deepEqual(estadoDoCertificado({ certificado: falta }), { estado: "indisponivel" });
  });

  // O alternativo do ambiente (CERT_PFX_PATH), sem nada guardado: o estado sai do motivo do resolvedor, não do guardado.
  describe("certificado do ambiente, nada guardado", () => {
    const PLATAFORMA = "11444777000161";
    const env = { CERT_PFX_PATH: "/drive/plataforma.pfx", CERT_PFX_SENHA: "s" };
    const ler = () => Buffer.from("pfx");
    const estado = (abrir: Parameters<typeof resolverCertificadoDaPlataforma>[5], lerArquivo: (a: string) => Buffer = ler, e: Record<string, string> = env) =>
      estadoDoCertificado({ certificado: resolverCertificadoDaPlataforma(PLATAFORMA, e, NADA_GUARDADO, lerArquivo, AGORA, abrir) });
    const titulo = (s: ReturnType<typeof estado>) => avisoDoCertificadoDaPlataforma(s, AGORA)[0]?.titulo;

    it("vencido: ok com a data de vencimento, o sino diz que venceu e em que dia", () => {
      const validoAte = em(-2);
      const e = estado(() => ({ cnpj: PLATAFORMA, validoAte }));
      assert.deepEqual(e, { estado: "ok", validoAte });
      const [a] = avisoDoCertificadoDaPlataforma(e, AGORA);
      assert.equal(a.titulo, "O certificado da plataforma venceu");
      assert.match(a.texto, new RegExp(validoAte.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })));
    });
    it("de outro CNPJ: recusado (não está em uso)", () => {
      assert.equal(titulo(estado(() => ({ cnpj: "11222333000181", validoAte: em(200) }))), "O certificado da plataforma não está em uso");
    });
    it("senha errada ou arquivo corrompido: recusado, não 'falta'", () => {
      assert.equal(titulo(estado(() => { throw new Error("senha errada"); })), "O certificado da plataforma não está em uso");
    });
    // Sem nada guardado, o sino não pode dizer que existe um "certificado guardado" (levaria o ADMIN ao lugar errado).
    it("recusado sem nada guardado (outro CNPJ, não abre): o texto não fala de 'guardado'", () => {
      for (const abrir of [() => ({ cnpj: "11222333000181", validoAte: em(200) }), () => { throw new Error("senha errada"); }]) {
        const [a] = avisoDoCertificadoDaPlataforma(estado(abrir), AGORA);
        assert.doesNotMatch(a.texto, /guardado/i);
        assert.equal(a.texto, "O certificado configurado não pode ser usado pela plataforma. Até resolver, nada é consultado nem transmitido. O motivo está na tela do certificado.");
      }
    });
    it("arquivo fora do ar (drive desmontado) ou variáveis ausentes: falta", () => {
      const abrir = () => ({ cnpj: PLATAFORMA, validoAte: em(200) });
      assert.equal(titulo(estado(abrir, () => { throw new Error("ENOENT"); })), "Falta o certificado da plataforma");
      assert.equal(titulo(estado(abrir, ler, {})), "Falta o certificado da plataforma");
    });
    it("guardado ilegível e ambiente vencido: pede para enviar de novo (o guardado é o que vale)", () => {
      const ilegivel: CertificadoGuardado = { ...quem, info: info(PLATAFORMA, em(200)), legivel: false };
      const c = resolverCertificadoDaPlataforma(PLATAFORMA, env, { certificado: ilegivel, chaves: null }, ler, AGORA, () => ({ cnpj: PLATAFORMA, validoAte: em(-2) }));
      assert.deepEqual(estadoDoCertificado({ certificado: c }), { estado: "ilegivel" });
      assert.match(c.pronto ? "" : c.motivo, /PLATAFORMA_CHAVE atual.*Alternativa do ambiente: .*venceu/);
    });
  });
});
