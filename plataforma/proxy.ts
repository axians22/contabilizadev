// Primeira barreira: sem cookie de sessão com assinatura válida, página vai para /entrar (ou, com o login
// desligado em desenvolvimento, para a sessão local, que entra sozinha) e API recebe 401.
// Não consulta o banco (roda em toda requisição, inclusive nos prefetch); a conferência completa é no servidor.
import { NextResponse, type NextRequest } from "next/server";
import { lerConfigAutenticacao } from "@/lib/autenticacao/config";
import { lerTokenAssinado, nomeDoCookie } from "@/lib/autenticacao/cookie";
import { decidirAcesso, enderecoSemSessao } from "@/lib/autenticacao/rotas";

export function proxy(requisicao: NextRequest) {
  const login = lerConfigAutenticacao();
  const caminho = requisicao.nextUrl.pathname;
  const cookie = requisicao.cookies.get(nomeDoCookie(login.producao))?.value;
  const decisao = decidirAcesso(caminho, lerTokenAssinado(cookie, login.segredo) !== null, login.loginDesligado);
  if (decisao === "seguir") return NextResponse.next();
  if (decisao === "401") return NextResponse.json({ erro: "Entre para continuar." }, { status: 401 });
  const destino = enderecoSemSessao(decisao === "sessao-local", caminho + requisicao.nextUrl.search);
  return NextResponse.redirect(new URL(destino, requisicao.url));
}

export const config = {
  // Tudo, menos os arquivos do próprio Next e o ícone (CSS e JS da tela de entrada precisam carregar).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
