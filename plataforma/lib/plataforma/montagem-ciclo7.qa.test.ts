// QA (Parte 4, ciclo 7): o mesmo critério de titular no ambiente, no guardado e no envio pela tela.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { certificadoDeTeste, certificadoIcpDeTeste } from "@contabilizadev/nucleo/certificado-teste";
import { cnpjValido } from "@contabilizadev/nucleo/formato";
import { converterParaPem } from "@contabilizadev/nucleo/serpro/termo-autorizacao";
import { avisoDoCertificadoDaPlataforma, estadoDoCertificado } from "./aviso";
import { montarPlataforma } from "./montagem";
import { conferirCertificadoDaPlataforma, ErroDaPlataforma, type Guardado } from "./segredos";

const PLATAFORMA = "11444777000161";
const AGORA = new Date();
const chaves = { SERPRO_CONSUMER_KEY: "k", SERPRO_CONSUMER_SECRET: "s" };
const envCom = (senha: string, cnpj = PLATAFORMA) => ({ PLATAFORMA_CNPJ: cnpj, CERT_PFX_PATH: "/drive/x.pfx", CERT_PFX_SENHA: senha, ...chaves });

function guardadoDe(c: { pfx: Uint8Array; senha: string }): Guardado {
  const { chave, certificado } = converterParaPem(c.pfx, c.senha);
  return {
    certificado: { atualizadoEm: AGORA, atualizadoPor: "adm", info: { titular: "X", cnpj: PLATAFORMA, validoDe: AGORA.toISOString(), validoAte: AGORA.toISOString(), emissor: "AC" }, legivel: true, pem: { chave, certificado } },
    chaves: null,
  };
}

describe("QA ciclo 7: titular do certificado da plataforma", () => {
  it("ambiente: e-CNPJ só pelo CN, com o CNPJ pontuado (sem a barra, que o openssl -subj não aceita), é aceito", () => {
    const c = certificadoDeTeste({ titular: "PLAT LTDA:11.444.777.0001-61", dias: 30 });
    const m = montarPlataforma(envCom(c.senha), undefined, AGORA, () => Buffer.from(c.pfx));
    assert.ok(m.certificado.pronto, m.certificado.pronto ? "" : m.certificado.motivo);
    assert.ok(m.serpro.pronto && m.esocial.pronto);
  });

  it("ambiente: e-CPF só pelo CN (CPF pontuado) é recusado como outro-cnpj, Serpro e eSocial desligados, sino avisa", () => {
    const c = certificadoDeTeste({ titular: "FULANO DE TAL:123.456.789-09", dias: 30 });
    const m = montarPlataforma(envCom(c.senha), undefined, AGORA, () => Buffer.from(c.pfx));
    assert.equal(m.certificado.pronto, false);
    if (!m.certificado.pronto) {
      assert.equal(m.certificado.falha.tipo, "outro-cnpj");
      assert.match(m.certificado.motivo, /não é um e-CNPJ/);
    }
    assert.equal(m.serpro.pronto, false);
    assert.equal(m.esocial.pronto, false);
    assert.equal(avisoDoCertificadoDaPlataforma(estadoDoCertificado(m), AGORA).length, 1);
  });

  it("guardado: e-CPF ICP-Brasil (a coluna info diz o CNPJ da plataforma) é recusado pelo certificado decifrado", () => {
    const c = certificadoIcpDeTeste({ tipo: "PF", numero: "12345678909", nome: "FULANO" });
    const m = montarPlataforma({ PLATAFORMA_CNPJ: PLATAFORMA, ...chaves }, guardadoDe(c), AGORA);
    assert.equal(m.certificado.pronto, false);
    if (!m.certificado.pronto) {
      assert.equal(m.certificado.falha.tipo, "outro-cnpj");
      assert.match(m.certificado.motivo, /não é um e-CNPJ/);
    }
    assert.equal(m.esocial.pronto, false);
  });

  it("guardado ilegível + ambiente com e-CPF: falha 'ilegivel' e o motivo cita a alternativa recusada", () => {
    const c = certificadoIcpDeTeste({ tipo: "PF", numero: "12345678909", nome: "FULANO" });
    const g: Guardado = { certificado: { atualizadoEm: AGORA, atualizadoPor: null, info: { titular: "X", cnpj: PLATAFORMA, validoDe: "", validoAte: AGORA.toISOString(), emissor: "" }, legivel: false }, chaves: null };
    const m = montarPlataforma(envCom(c.senha), g, AGORA, () => Buffer.from(c.pfx));
    assert.equal(m.certificado.pronto, false);
    if (!m.certificado.pronto) {
      assert.equal(m.certificado.falha.tipo, "ilegivel");
      assert.match(m.certificado.motivo, /PLATAFORMA_CHAVE/);
      assert.match(m.certificado.motivo, /não é um e-CNPJ/);
    }
  });

  it("envio pela tela: e-CPF ICP-Brasil A1 é recusado com 400", () => {
    const c = certificadoIcpDeTeste({ tipo: "PF", numero: "12345678909", nome: "FULANO" });
    assert.throws(() => conferirCertificadoDaPlataforma(c.pfx, c.senha, PLATAFORMA, AGORA), (e) => e instanceof ErroDaPlataforma && e.status === 400);
  });

  it("CNPJ alfanumérico: PLATAFORMA_CNPJ pontuado/minúsculo e o e-CNPJ ICP-Brasil do mesmo CNPJ ficam prontos (ambiente, guardado e tela)", () => {
    const alfa = "12ABC34501DE35";
    assert.ok(cnpjValido(alfa), "exemplo da RFB precisa ser válido");
    const c = certificadoIcpDeTeste({ tipo: "PJ", numero: alfa, nome: "ALFA LTDA" });
    const pelaTela = conferirCertificadoDaPlataforma(c.pfx, c.senha, alfa, AGORA);
    assert.equal(pelaTela.info.titular.numero, alfa);
    const env = envCom(c.senha, "12.abc.345/01de-35");
    const amb = montarPlataforma(env, undefined, AGORA, () => Buffer.from(c.pfx));
    assert.ok(amb.certificado.pronto && amb.serpro.pronto && amb.esocial.pronto, amb.certificado.pronto ? "" : amb.certificado.motivo);
    const banco = montarPlataforma(env, guardadoDe(c), AGORA, () => assert.fail("não lê o ambiente"));
    assert.ok(banco.certificado.pronto && banco.esocial.pronto);
  });

  it("ambiente: e-CNPJ ICP-Brasil de outro CNPJ (alfanumérico) é outro-cnpj com os dois CNPJs no motivo", () => {
    const c = certificadoIcpDeTeste({ tipo: "PJ", numero: "12ABC34501DE35", nome: "OUTRA" });
    const m = montarPlataforma(envCom(c.senha), undefined, AGORA, () => Buffer.from(c.pfx));
    assert.equal(m.certificado.pronto, false);
    if (!m.certificado.pronto) {
      assert.equal(m.certificado.falha.tipo, "outro-cnpj");
      assert.match(m.certificado.motivo, /12ABC34501DE35/);
      assert.match(m.certificado.motivo, new RegExp(PLATAFORMA));
    }
  });

  it("ambiente: certificado sem número no CN é 'invalido' e o sino diz 'não está em uso'", () => {
    const c = certificadoDeTeste({ titular: "SEM NUMERO", dias: 30 });
    const m = montarPlataforma(envCom(c.senha), undefined, AGORA, () => Buffer.from(c.pfx));
    assert.equal(m.certificado.pronto, false);
    if (!m.certificado.pronto) assert.equal(m.certificado.falha.tipo, "invalido");
    const sino = avisoDoCertificadoDaPlataforma(estadoDoCertificado(m), AGORA);
    assert.equal(sino.length, 1);
    assert.match(sino[0].titulo, /não está em uso/);
    assert.doesNotMatch(JSON.stringify(sino), /Serpro/i);
  });
});
