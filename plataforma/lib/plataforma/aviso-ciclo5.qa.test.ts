// QA (Parte 4, ciclo 5): o texto do sino do ADMIN em todos os estados; nenhum cita fornecedor nem a origem errada.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { certificadoIcpDeTeste } from "@contabilizadev/nucleo/certificado-teste";
import { converterParaPem } from "@contabilizadev/nucleo/serpro/termo-autorizacao";
import { resolverCertificadoDaPlataforma, type CertificadoDaPlataforma } from "@/lib/serpro/config";
import { avisoDoCertificadoDaPlataforma, estadoDoCertificado } from "./aviso";
import { NADA_GUARDADO, type Guardado } from "./segredos";

const PLATAFORMA = "11444777000161";
const AGORA = new Date("2026-10-20T15:00:00Z");
const DIA = 24 * 60 * 60 * 1000;
const env = { CERT_PFX_PATH: "/drive/plataforma.pfx", CERT_PFX_SENHA: "s" };
const ler = () => Buffer.from("pfx");
const sino = (certificado: CertificadoDaPlataforma) => avisoDoCertificadoDaPlataforma(estadoDoCertificado({ certificado }), AGORA);

// O PEM é de um e-CNPJ de teste do próprio CNPJ (a validade e o CNPJ que valem são os do certificado decifrado).
const pemDe = (cnpj: string) => {
  const c = certificadoIcpDeTeste({ tipo: "PJ", numero: cnpj, nome: "X", validoDe: new Date(AGORA.getTime() - 10 * DIA), validoAte: new Date(AGORA.getTime() + 300 * DIA) });
  const { chave, certificado } = converterParaPem(c.pfx, c.senha);
  return { chave, certificado };
};
const guardado = (cnpj: string, legivel: boolean): Guardado => ({
  certificado: {
    atualizadoEm: AGORA,
    atualizadoPor: "adm",
    info: { titular: "X", cnpj, validoDe: new Date(AGORA.getTime() - 10 * DIA).toISOString(), validoAte: new Date(AGORA.getTime() + 300 * DIA).toISOString(), emissor: "AC" },
    ...(legivel
      ? { legivel: true as const, pem: pemDe(cnpj) }
      : { legivel: false as const }),
  },
  chaves: null,
});

describe("QA ciclo 5: sino do ADMIN em cada causa", () => {
  it("PLATAFORMA_CNPJ faltando (como o servidor monta): vermelho, texto neutro, sem 'guardado'", () => {
    const [a] = sino({ pronto: false, motivo: "Falta PLATAFORMA_CNPJ", falha: { tipo: "invalido" } });
    assert.equal(a.nivel, "vencida");
    assert.doesNotMatch(a.texto, /guardado/i);
    assert.equal(a.link?.href, "/admin/plataforma");
  });

  it("guardado legível de outro CNPJ: recusado com o mesmo texto neutro", () => {
    const [a] = sino(resolverCertificadoDaPlataforma(PLATAFORMA, {}, guardado("11222333000181", true), ler, AGORA));
    assert.equal(a.titulo, "O certificado da plataforma não está em uso");
  });

  it("guardado ilegível e ambiente sem nada: pede para enviar de novo (aqui 'guardado' é correto)", () => {
    const [a] = sino(resolverCertificadoDaPlataforma(PLATAFORMA, {}, guardado(PLATAFORMA, false), ler, AGORA));
    assert.equal(a.titulo, "Envie de novo o certificado da plataforma");
  });

  it("guardado ilegível com ambiente válido: o ambiente vale e não há aviso vermelho", () => {
    const c = resolverCertificadoDaPlataforma(PLATAFORMA, env, guardado(PLATAFORMA, false), ler, AGORA, () => ({ cnpj: PLATAFORMA, validoAte: new Date(AGORA.getTime() + 200 * DIA) }));
    assert.equal(c.pronto, true);
    assert.deepEqual(sino(c), []);
  });

  it("nenhum texto do sino cita fornecedor", () => {
    const casos: CertificadoDaPlataforma[] = [
      resolverCertificadoDaPlataforma(PLATAFORMA, {}, NADA_GUARDADO, ler, AGORA),
      resolverCertificadoDaPlataforma(PLATAFORMA, env, NADA_GUARDADO, ler, AGORA, () => { throw new Error("senha"); }),
      resolverCertificadoDaPlataforma(PLATAFORMA, {}, guardado(PLATAFORMA, false), ler, AGORA),
      resolverCertificadoDaPlataforma(PLATAFORMA, env, NADA_GUARDADO, ler, AGORA, () => ({ cnpj: PLATAFORMA, validoAte: new Date(AGORA.getTime() + 5 * DIA) })),
      resolverCertificadoDaPlataforma(PLATAFORMA, env, NADA_GUARDADO, ler, AGORA, () => ({ cnpj: PLATAFORMA, validoAte: new Date(AGORA.getTime() - DIA) })),
    ];
    for (const c of casos) for (const a of sino(c)) assert.doesNotMatch(`${a.titulo} ${a.texto} ${a.link?.texto ?? ""}`, /serpro|integra contador/i);
  });
});
