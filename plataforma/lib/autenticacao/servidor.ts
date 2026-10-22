// Ligação das regras de login com o Next: cookie, redirecionamento e a sessão da requisição atual.
// Toda página, layout, route handler e server action que mostra ou muda dado chama exigirSessao (ou
// comSessao, nos route handlers): o proxy só barra cedo quem não tem cookie; a conferência é aqui.
import "server-only";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { banco } from "@/banco";
import { AREA_DO_ADMIN, entraNaAreaDoAdmin, inicioDoAdmin, podeVerNoAdmin, type HrefDoAdmin } from "@/lib/admin";
import { empresasDaSessao, type EmpresaDoUsuario } from "@/lib/empresas/servico";
import { exigeSeusDados, PREENCHA_SEUS_DADOS, ROTA_SEUS_DADOS } from "@/lib/usuarios/portao-dos-dados";
import { lerConfigAutenticacao, type ConfigAutenticacao } from "./config";
import { nomeDoCookie, opcoesDoCookie } from "./cookie";
import { criarVerificadorGoogle } from "./google";
import { enderecoSemSessao } from "./rotas";
import { resolverSessao, type Dependencias, type SessaoValida } from "./servico";

let config: ConfigAutenticacao | undefined;
let dependencias: Dependencias | undefined;

export function configAutenticacao(): ConfigAutenticacao {
  return (config ??= lerConfigAutenticacao());
}

export function dependenciasDeLogin(): Dependencias {
  const c = configAutenticacao();
  return (dependencias ??= { banco: banco(), config: c, verificarGoogle: c.googleClientId ? criarVerificadorGoogle(c.googleClientId) : null });
}

export type SessaoAtual = SessaoValida & { empresas: EmpresaDoUsuario[]; empresaAtiva: EmpresaDoUsuario | null };

// cookies() vem antes da configuração: no build, é ele que marca a página como dinâmica (sem sessão não há o
// que pré-renderizar), e a configuração só é exigida quando o servidor atende de verdade.
export async function lerCookieDeSessao(): Promise<string | undefined> {
  const jarra = await cookies();
  return jarra.get(nomeDoCookie(configAutenticacao().producao))?.value;
}

export async function gravarCookieDeSessao(valor: string, expiraEm: Date) {
  const producao = configAutenticacao().producao;
  (await cookies()).set(nomeDoCookie(producao), valor, opcoesDoCookie(producao, expiraEm));
}

export async function apagarCookieDeSessao() {
  (await cookies()).delete(nomeDoCookie(configAutenticacao().producao));
}

// Uma leitura do banco por requisição (o cache do React vale só durante a requisição): usuário e empresas
// sempre atuais, então desativar a conta ou tirar o vínculo vale na hora.
export const sessaoAtual = cache(async (): Promise<SessaoAtual | null> => {
  const cookie = await lerCookieDeSessao();
  const deps = dependenciasDeLogin();
  const sessao = await resolverSessao(deps, cookie);
  if (!sessao) return null;
  return { ...sessao, ...(await empresasDaSessao(deps.banco, sessao)) };
});

// A sessão, sem o portão do primeiro login: só para a tela "Seus dados" (e os termos), as ações dela e sair.
export async function exigirSessaoSemDados(): Promise<SessaoAtual> {
  const sessao = await sessaoAtual();
  // Com o login desligado (desenvolvimento) não há tela de login: um cookie que não vale mais (banco recriado,
  // sessão apagada) vai para a sessão local, que grava um cookie novo e volta.
  if (!sessao) redirect(enderecoSemSessao(configAutenticacao().loginDesligado));
  return sessao;
}

// A sessão de toda página, layout e ação. Usuário comum sem "Seus dados" vai para a tela de dados antes de qualquer coisa
// (lib/usuarios/portao-dos-dados.ts); em server action, o redirect também vale (a ação não roda).
export async function exigirSessao(): Promise<SessaoAtual> {
  const sessao = await exigirSessaoSemDados();
  if (exigeSeusDados(sessao.usuario)) redirect(ROTA_SEUS_DADOS);
  return sessao;
}

// Área do administrador (/admin, lib/admin.ts): confere a sessão e se o papel vê a página `href` (MANAGER só os
// usuários; ADMIN tudo; COMMON_USER nada). Para quem não vê, a página simplesmente não existe (404, sem dizer o que há).
// Exceção: quem entra na área mas não vê a visão geral (MANAGER) e abre /admin vai para a primeira página que vê.
// Cada página e ação chama com o próprio endereço: o layout não roda de novo em toda navegação, então não pode ser a
// única barreira. Sem o portão do primeiro login: a área é só de MANAGER e ADMIN, que não passam por ele, e o
// COMMON_USER recebe 404 (não é mandado para "Seus dados", que diria que a página existe).
export async function exigirAreaDoAdmin(href: HrefDoAdmin): Promise<SessaoAtual> {
  const sessao = await exigirSessaoSemDados();
  const { papel } = sessao.usuario;
  if (!podeVerNoAdmin(papel, href)) {
    const inicio = inicioDoAdmin(papel);
    if (href === AREA_DO_ADMIN && inicio) redirect(inicio);
    notFound();
  }
  return sessao;
}

// O layout da área: só confere a entrada (MANAGER e ADMIN); COMMON_USER recebe 404. Cada página confere a sua.
export async function exigirEntradaNaAreaDoAdmin(): Promise<SessaoAtual> {
  const sessao = await exigirSessaoSemDados();
  if (!entraNaAreaDoAdmin(sessao.usuario.papel)) notFound();
  return sessao;
}

// Route handlers: 401 em JSON sem sessão, em vez do redirecionamento das páginas; 403 para o usuário comum sem
// "Seus dados" (o portão do primeiro login).
export function comSessao<C>(tratar: (sessao: SessaoAtual, requisicao: Request, contexto: C) => Promise<Response>) {
  return async (requisicao: Request, contexto: C) => {
    const sessao = await sessaoAtual();
    if (!sessao) return Response.json({ erro: "Entre para continuar." }, { status: 401 });
    if (exigeSeusDados(sessao.usuario)) return Response.json({ erro: PREENCHA_SEUS_DADOS, destino: ROTA_SEUS_DADOS }, { status: 403 });
    return tratar(sessao, requisicao, contexto);
  };
}
