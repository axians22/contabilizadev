// Login desligado (AUTH_DISABLED=true, só fora de produção): abre a sessão da conta de desenvolvimento sem tela
// nem botão. Roda num route handler (o Next 16 só grava cookie em route handler, server action ou proxy) e
// devolve um redirecionamento para o destino, já com o cookie. Em produção (ou com o login ligado) não abre
// nada e manda para /entrar.
import { NextResponse } from "next/server";
import { destinoSeguro, nomeDoCookie, opcoesDoCookie } from "./cookie";
import { ROTA_DA_SESSAO_LOCAL, rotaPublica } from "./rotas";
import { entrarSemLogin, ErroDeLogin, type Dependencias } from "./servico";

// O destino depois de entrar: só caminho do próprio site, e nunca a própria sessão local ou /entrar (não há
// por que voltar para lá, e evita ida e volta).
export function destinoDaSessaoLocal(de: string | null): string {
  const destino = destinoSeguro(de);
  const caminho = destino.split(/[?#]/)[0];
  if (caminho === ROTA_DA_SESSAO_LOCAL || caminho.startsWith(`${ROTA_DA_SESSAO_LOCAL}/`) || rotaPublica(caminho)) return "/";
  return destino;
}

const escapar = (texto: string) => texto.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function abrirSessaoLocal(deps: Dependencias, requisicao: Request): Promise<Response> {
  const url = new URL(requisicao.url);
  if (!deps.config.loginDesligado || deps.config.producao) return NextResponse.redirect(new URL("/entrar", url));
  let sessao;
  try {
    sessao = await entrarSemLogin(deps);
  } catch (erro) {
    if (!(erro instanceof ErroDeLogin)) throw erro;
    // Sem tela de login para onde mandar: a explicação aparece aqui (ex.: a conta de desenvolvimento foi desativada).
    const corpo = `<!doctype html><meta charset="utf-8"><title>Sem acesso</title><p>${escapar(erro.message)}</p><p>Conta de desenvolvimento: ${escapar(deps.config.emailDesenvolvimento)}. Reative-a no banco (usuarios.ativo) ou troque DEV_USER_EMAIL no plataforma/.env.local.</p>`;
    return new Response(corpo, { status: 403, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  const resposta = NextResponse.redirect(new URL(destinoDaSessaoLocal(url.searchParams.get("de")), url));
  resposta.cookies.set(nomeDoCookie(deps.config.producao), sessao.cookie, opcoesDoCookie(deps.config.producao, sessao.expiraEm));
  return resposta;
}
