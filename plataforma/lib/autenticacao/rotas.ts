// Fechado por padrão: só as rotas desta lista abrem sem sessão. Rota nova nasce protegida.
// /api/saude é o health check do Coolify (sem cookie): responde só {ok}, sem dado nenhum (lib/producao/saude.ts).
export const ROTAS_PUBLICAS = ["/entrar", "/api/saude"] as const;

// Abre a sessão da conta de desenvolvimento e volta para o painel. Só existe com o login desligado (fora de
// produção); com o login ligado ela é uma rota fechada como as outras (e o handler recusa de novo).
export const ROTA_DA_SESSAO_LOCAL = "/sessao-local";

const abaixoDe = (caminho: string, rota: string) => caminho === rota || caminho.startsWith(`${rota}/`);

export function rotaPublica(caminho: string, loginDesligado = false): boolean {
  if (loginDesligado && abaixoDe(caminho, ROTA_DA_SESSAO_LOCAL)) return true;
  return ROTAS_PUBLICAS.some((r) => abaixoDe(caminho, r));
}

export type DecisaoDeAcesso = "seguir" | "entrar" | "sessao-local" | "401";

// O que o proxy faz com a requisição. Ele só olha a assinatura do cookie (sem banco): sessão vencida ou de
// usuário desativado passa daqui e é barrada no servidor (exigirSessao), que relê o banco.
// Com o login desligado (só desenvolvimento), página sem cookie não vê tela de login: vai para a sessão local,
// que entra sozinha com a conta de desenvolvimento. API continua com 401 (o navegador já terá o cookie).
export function decidirAcesso(caminho: string, cookieAssinadoValido: boolean, loginDesligado = false): DecisaoDeAcesso {
  if (rotaPublica(caminho, loginDesligado) || cookieAssinadoValido) return "seguir";
  if (caminho === "/api" || caminho.startsWith("/api/")) return "401";
  return loginDesligado ? "sessao-local" : "entrar";
}

// Para onde vai quem não tem sessão válida: a tela de login, ou (login desligado) a sessão local, guardando o
// destino. A raiz não precisa ir como destino.
export function enderecoSemSessao(loginDesligado: boolean, de?: string | null): string {
  const base = loginDesligado ? ROTA_DA_SESSAO_LOCAL : "/entrar";
  return de && de !== "/" ? `${base}?de=${encodeURIComponent(de)}` : base;
}

// Depois de sair: a tela de login; com o login desligado não há tela de login, então volta ao painel (que abre
// uma sessão nova da conta de desenvolvimento).
export const destinoAoSair = (loginDesligado: boolean) => (loginDesligado ? "/" : "/entrar");
