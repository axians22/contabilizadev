// Cifra dos segredos guardados no banco: AES-256-GCM com uma chave mestra do ambiente (TOKEN_CHAVE para o token e o termo
// de cada empresa; PLATAFORMA_CHAVE para o certificado e as chaves do contrato da plataforma),
// IV aleatório por registro e o contexto (empresa e registro) como dado autenticado. Um valor copiado para outra
// empresa ou outro registro não abre; alteração no banco também não (a tag do GCM não confere).
// Formato guardado: "v1.<iv>.<tag>.<cifrado>" em base64url. Nunca o texto em claro.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class ErroDeChave extends Error {}
export class ErroDeCifra extends Error {}

// Chave mestra do ambiente: 32 bytes em base64 (openssl rand -base64 32) ou em hexadecimal (64 caracteres). A mesma regra
// vale para a TOKEN_CHAVE (termo e token de cada empresa) e para a PLATAFORMA_CHAVE (certificado e chaves da plataforma).
export function lerChave(valor: string | undefined, nome: string): Buffer {
  const texto = (valor ?? "").trim();
  if (!texto) {
    throw new ErroDeChave(`${nome} ausente: gere com \`openssl rand -base64 32\` e coloque no plataforma/.env.local (veja .env.exemplo).`);
  }
  const chave = /^[0-9a-f]{64}$/i.test(texto) ? Buffer.from(texto, "hex") : /^[A-Za-z0-9+/]{43}=$/.test(texto) ? Buffer.from(texto, "base64") : null;
  if (!chave || chave.length !== 32) {
    throw new ErroDeChave(`${nome} inválida: precisa ter 32 bytes, em base64 (openssl rand -base64 32) ou em hexadecimal (64 caracteres).`);
  }
  return chave;
}

export const lerChaveToken = (valor: string | undefined) => lerChave(valor, "TOKEN_CHAVE");

// A PLATAFORMA_CHAVE tem de ser outra chave, nunca a TOKEN_CHAVE: quem tiver uma não abre o que a outra guarda.
export function lerChavePlataforma(valor: string | undefined, tokenChave: string | undefined): Buffer {
  const chave = lerChave(valor, "PLATAFORMA_CHAVE");
  let token: Buffer | null = null;
  try {
    token = lerChaveToken(tokenChave);
  } catch {
    // TOKEN_CHAVE ausente ou inválida: quem confere é a subida (instrumentation.ts).
  }
  if (token && token.equals(chave)) throw new ErroDeChave("PLATAFORMA_CHAVE igual à TOKEN_CHAVE: gere outra com `openssl rand -base64 32`.");
  return chave;
}

export function cifrar(texto: string, chave: Buffer, contexto: string): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chave, iv);
  cifra.setAAD(Buffer.from(contexto, "utf8"));
  const cifrado = Buffer.concat([cifra.update(texto, "utf8"), cifra.final()]);
  return ["v1", iv, cifra.getAuthTag(), cifrado].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decifrar(valor: string, chave: Buffer, contexto: string): string {
  const [versao, iv, tag, cifrado] = valor.split(".");
  if (versao !== "v1" || !iv || !tag || cifrado === undefined) throw new ErroDeCifra("Valor cifrado em formato desconhecido.");
  try {
    const decifra = createDecipheriv("aes-256-gcm", chave, Buffer.from(iv, "base64url"));
    decifra.setAAD(Buffer.from(contexto, "utf8"));
    decifra.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decifra.update(Buffer.from(cifrado, "base64url")), decifra.final()]).toString("utf8");
  } catch {
    throw new ErroDeCifra("Não foi possível abrir o valor cifrado (chave trocada ou dado alterado).");
  }
}
