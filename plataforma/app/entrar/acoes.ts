"use server";

import { redirect } from "next/navigation";
import { destinoSeguro } from "@/lib/autenticacao/cookie";
import { entrarComGoogle, ErroDeLogin } from "@/lib/autenticacao/servico";
import { dependenciasDeLogin, gravarCookieDeSessao } from "@/lib/autenticacao/servidor";

type Resultado = { erro: string } | undefined;

// Recebe o ID token do Google Identity Services e confere no servidor (assinatura, audience e e-mail verificado).
export async function entrarComGoogleAcao(credencial: string, de: string): Promise<Resultado> {
  try {
    const { cookie, expiraEm } = await entrarComGoogle(dependenciasDeLogin(), String(credencial ?? ""));
    await gravarCookieDeSessao(cookie, expiraEm);
  } catch (erro) {
    if (erro instanceof ErroDeLogin) return { erro: erro.message };
    throw erro;
  }
  // Fora do try: o redirect do Next funciona lançando uma exceção própria.
  redirect(destinoSeguro(typeof de === "string" ? de : null));
}
