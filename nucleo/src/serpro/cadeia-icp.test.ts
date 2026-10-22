// Cadeia até a raiz da ICP-Brasil: com as raízes de teste (certificado-teste.ts) para os casos, e as oficiais guardadas
// no repositório (nucleo/certificados/icp-brasil) conferidas pela impressão digital publicada no ORIGEM.md.
import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import forge from "node-forge";
import { certificadoIcpDeTeste, confiancaDeTeste, type OpcoesCertificadoIcp } from "../certificado-teste.ts";
import { conferirCadeia, confiancaDe, confiancaIcpBrasil, ErroCadeia } from "./cadeia-icp.ts";
import { abrirCertificado } from "./termo-autorizacao.ts";

const EMPRESA = "12345678000195";
const AGORA = new Date();
const base64Do = (o: Partial<OpcoesCertificadoIcp> = {}) => {
  const c = certificadoIcpDeTeste({ tipo: "PJ", numero: EMPRESA, nome: "EMPRESA DE TESTE LTDA", ...o });
  return abrirCertificado(new Uint8Array(c.pfx), c.senha).certificadoBase64;
};
const recusa = (padrao: RegExp) => (e: unknown) => e instanceof ErroCadeia && padrao.test(e.message);

test("cadeia válida: emitido direto pela raiz ou por uma AC intermediária", () => {
  assert.deepEqual(conferirCadeia(base64Do(), confiancaDeTeste(), AGORA), { raiz: "AC DE TESTE CONTABILIZADEV", caminho: [] });
  assert.deepEqual(conferirCadeia(base64Do({ cadeia: "intermediaria" }), confiancaDeTeste(), AGORA), { raiz: "AC DE TESTE CONTABILIZADEV", caminho: ["AC INTERMEDIARIA DE TESTE"] });
});

test("cadeia forjada: AC com o mesmo nome da raiz, mas outra chave, não passa", () => {
  assert.throws(() => conferirCadeia(base64Do({ cadeia: "forjada" }), confiancaDeTeste(), AGORA), recusa(/não chega a uma AC raiz oficial/));
});

test("autoassinado não passa, mesmo com os OIDs da ICP-Brasil", () => {
  assert.throws(() => conferirCadeia(base64Do({ autoassinado: true }), confiancaDeTeste(), AGORA), recusa(/autoassinado/));
});

test("vencido: o próprio certificado ou a AC intermediária fora da validade", () => {
  const venceu = base64Do({ validoDe: new Date(AGORA.getTime() - 400 * 864e5), validoAte: new Date(AGORA.getTime() - 864e5) });
  assert.throws(() => conferirCadeia(venceu, confiancaDeTeste(), AGORA), recusa(/fora da validade/));
  assert.throws(() => conferirCadeia(base64Do({ cadeia: "intermediaria-vencida" }), confiancaDeTeste(), AGORA), recusa(/AC INTERMEDIARIA VENCIDA DE TESTE.*fora da validade/));
});

test("sem a intermediária no repositório, a cadeia não fecha (o termo traz só o certificado de quem assina)", () => {
  const soRaiz = confiancaDe(confiancaDeTeste().raizes.map((r) => r.toString()));
  assert.throws(() => conferirCadeia(base64Do({ cadeia: "intermediaria" }), soRaiz, AGORA), recusa(/não chega/));
});

test("um autoassinado no meio das intermediárias não vira ponto de confiança", () => {
  // A raiz de teste passada como "intermediária": não serve de raiz.
  const invertida = confiancaDe([], confiancaDeTeste().raizes.map((r) => r.toString()));
  assert.equal(invertida.intermediarias.length, 0);
  assert.throws(() => conferirCadeia(base64Do(), invertida, AGORA), recusa(/não chega/));
});

test("certificado de teste não passa pelas raízes oficiais da ICP-Brasil", () => {
  assert.throws(() => conferirCadeia(base64Do(), confiancaIcpBrasil(), AGORA), recusa(/não chega a uma AC raiz oficial/));
});

test("ilegível vira ErroCadeia", () => {
  assert.throws(() => conferirCadeia("bm9wZQ==", confiancaDeTeste(), AGORA), recusa(/ilegível/));
});

// Tabela do ORIGEM.md: as raízes guardadas são as oficiais do ITI (impressão digital do DER).
const OFICIAIS: Record<string, string> = {
  "ICP-Brasilv4.crt": "F0:C1:5A:FD:25:8F:B6:74:E7:A9:6E:1A:50:FF:87:31:49:36:4B:9E:C7:0D:4D:93:C7:A9:F1:EB:60:60:D0:20",
  "ICP-Brasilv5.crt": "CA:A5:3F:C6:09:1C:69:51:88:7C:97:6E:37:8F:6E:F8:9A:A6:37:7C:55:D9:7B:64:75:42:2B:71:ED:7E:9B:17",
  "ICP-Brasilv6.crt": "3B:DB:9B:50:93:52:F1:D3:D7:1C:2B:F6:4D:9A:38:A4:E6:CE:BD:A2:78:09:D7:7F:7A:C4:76:CB:DE:6E:31:4A",
  "ICP-Brasilv7.crt": "56:57:E7:05:80:EB:67:89:83:F3:ED:7D:FC:E0:91:D8:4C:AE:65:49:38:9A:47:FC:CD:A8:D0:E4:DC:2C:F5:76",
  "ICP-Brasilv12.crt": "D8:47:8E:37:CE:19:C6:90:CF:65:73:81:E6:8F:E6:00:E4:E1:A0:42:53:68:30:F0:68:47:E0:3E:55:4C:4B:01",
  "ICP-Brasilv13.crt": "2B:07:D0:BC:02:C4:A6:E0:47:8E:D2:2D:0D:99:E8:F9:7E:18:27:B2:69:09:76:96:A7:FE:B6:AA:D3:0C:3A:C8",
};

test("as raízes oficiais guardadas são as do ITI, autoassinadas, de AC e todas lidas", () => {
  const pasta = path.join(import.meta.dirname, "..", "..", "certificados", "icp-brasil", "raizes");
  assert.deepEqual(fs.readdirSync(pasta).sort(), Object.keys(OFICIAIS).sort());
  for (const [arquivo, impressao] of Object.entries(OFICIAIS)) {
    const c = new X509Certificate(fs.readFileSync(path.join(pasta, arquivo)));
    assert.equal(c.fingerprint256, impressao, arquivo);
    assert.ok(c.ca && c.subject === c.issuer, arquivo);
  }
  const oficial = confiancaIcpBrasil();
  assert.equal(oficial.raizes.length, 6);
  assert.ok(oficial.intermediarias.length > 150, "as ACs do pacote oficial");
  assert.ok(oficial.intermediarias.every((c) => c.ca));
});

test("toda AC intermediária guardada chega a uma raiz guardada, menos as de SSL (raiz v10, fora de propósito)", () => {
  const { raizes, intermediarias } = confiancaIcpBrasil();
  // As ACs de SSL ficam no pacote oficial, mas a raiz delas (v10, só SSL) não é ponto de confiança para o e-CNPJ.
  const ssl = intermediarias.filter((c) => /CN=Autoridade Certificadora Raiz Brasileira v10(\n|$)/.test(c.issuer));
  assert.ok(ssl.length > 0 && ssl.every((c) => /SSL/i.test(c.subject)));
  for (const ac of intermediarias.filter((c) => !ssl.includes(c))) {
    let atual = ac;
    let chegou = false;
    for (let i = 0; i < 6 && !chegou; i++) {
      const assinou = (e: X509Certificate) => {
        try {
          return atual.checkIssued(e) && atual.verify(e.publicKey);
        } catch {
          return false;
        }
      };
      if (raizes.some(assinou)) chegou = true;
      else {
        const acima = intermediarias.find((e) => e !== atual && assinou(e));
        if (!acima) break;
        atual = acima;
      }
    }
    assert.ok(chegou, ac.subject);
  }
});

test("confiancaDeTeste devolve a raiz e as intermediárias de teste", () => {
  const c = confiancaDeTeste();
  assert.equal(c.raizes.length, 1);
  assert.equal(c.intermediarias.length, 2);
  assert.ok(forge.pki.certificateFromPem(c.raizes[0].toString()));
});
