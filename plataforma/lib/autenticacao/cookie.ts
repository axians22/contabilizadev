// Cookie de sessão: token aleatório + assinatura HMAC-SHA256 com SESSAO_SEGREDO ("token.assinatura").
// O proxy confere só a assinatura (sem banco) para barrar cedo quem não tem sessão; a conferência de verdade
// (sessão existe, não venceu, usuário ativo) é no servidor, pelo hash do token no banco.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const VALIDADE_DA_SESSAO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

// Em produção, o prefixo __Host- obriga Secure, Path=/ e nenhum Domain (o navegador recusa o cookie se faltar).
export const nomeDoCookie = (producao: boolean) => (producao ? "__Host-sessao" : "sessao");

export function opcoesDoCookie(producao: boolean, expiraEm: Date) {
  return { httpOnly: true, secure: producao, sameSite: "lax" as const, path: "/", expires: expiraEm };
}

const assinatura = (token: string, segredo: string) => createHmac("sha256", segredo).update(token).digest("base64url");

export function novoToken(): string {
  return randomBytes(32).toString("base64url");
}

export function assinarToken(token: string, segredo: string): string {
  return `${token}.${assinatura(token, segredo)}`;
}

// Devolve o token se a assinatura confere; null para qualquer outra coisa (vazio, sem ponto, adulterado).
export function lerTokenAssinado(valor: string | undefined | null, segredo: string): string | null {
  if (!valor) return null;
  const ponto = valor.lastIndexOf(".");
  if (ponto <= 0) return null;
  const token = valor.slice(0, ponto);
  const recebida = Buffer.from(valor.slice(ponto + 1));
  const esperada = Buffer.from(assinatura(token, segredo));
  // Comparação em tempo constante (o tamanho é comparado antes porque timingSafeEqual exige o mesmo tamanho).
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;
  return token;
}

// O banco guarda só o hash: quem lê a tabela de sessões não consegue montar um cookie válido.
export const hashDoToken = (token: string) => createHash("sha256").update(token).digest("hex");

// Destino depois do login: só caminhos do próprio site ("/x"), nunca "//outro.site" ou "/\outro.site".
// Qualquer caractere de controle é recusado: o parser de URL dos navegadores apaga TAB, CR e LF de qualquer
// lugar, então "/\t/outro.site" viraria "//outro.site". Por fim, o destino resolvido tem de ficar na mesma origem.
const BASE_DO_DESTINO = "http://site.invalid";
export function destinoSeguro(de: string | null | undefined): string {
  if (!de || !de.startsWith("/") || de.startsWith("//") || de.startsWith("/\\") || /[\x00-\x1f\x7f]/.test(de)) return "/";
  try {
    if (new URL(de, BASE_DO_DESTINO).origin !== BASE_DO_DESTINO) return "/";
  } catch {
    return "/";
  }
  return de;
}
