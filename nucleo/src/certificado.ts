// Chave privada e certificado de um .pfx (e-CNPJ), extraídos só em memória: o arquivo entra pela entrada padrão do
// openssl e a senha por variável de ambiente do processo filho. Nada é gravado em disco.
import { execFileSync } from "node:child_process";
import type { Certificado } from "./http.ts";

export type Pem = { chave: string; certificado: string; certificadoBase64: string };

function extrair({ pfx, senha }: Certificado, args: string[]): string {
  const rodar = (extra: string[]) =>
    execFileSync("openssl", ["pkcs12", "-passin", "env:SENHA_PFX", ...extra, ...args], {
      input: pfx,
      // Só o PATH e a senha (o tipo do Next exige NODE_ENV em ProcessEnv; o processo filho não precisa dele).
      env: { PATH: process.env.PATH, SENHA_PFX: senha } as unknown as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
    }).toString();
  try {
    return rodar([]);
  } catch {
    // Certificados antigos (RC2/3DES) só abrem com o provedor legado do OpenSSL 3.
    return rodar(["-legacy"]);
  }
}

export function lerPfx(certificado: Certificado): Pem {
  if (!certificado.pfx?.length) throw new Error("Arquivo do certificado vazio.");
  if (!certificado.senha) throw new Error("Informe a senha do certificado.");
  let chave: string | undefined;
  let pem: string | undefined;
  try {
    chave = extrair(certificado, ["-nocerts", "-noenc"]).match(
      /-----BEGIN (?:RSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |ENCRYPTED )?PRIVATE KEY-----/,
    )?.[0];
    pem = extrair(certificado, ["-nokeys", "-clcerts"]).match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0];
  } catch {
    throw new Error("Não foi possível abrir o certificado: confira o arquivo e a senha.");
  }
  if (!chave || !pem) throw new Error("Não foi possível ler a chave ou o certificado do arquivo .pfx.");
  return { chave, certificado: pem, certificadoBase64: pem.replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g, "") };
}
