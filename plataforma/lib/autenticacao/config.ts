// Configuração do login, lida do ambiente e validada na inicialização do servidor (instrumentation.ts) e no
// primeiro uso. Erro de configuração derruba a subida: subir sem segredo deixaria a sessão falsificável, e um
// erro só na hora do login pareceria problema do usuário.

export const TAMANHO_MINIMO_DO_SEGREDO = 32;

export type ConfigAutenticacao = {
  // Chave do HMAC que assina o cookie de sessão (SESSAO_SEGREDO).
  segredo: string;
  // Client ID do Google Identity Services; null = login com Google indisponível (a tela de entrada avisa).
  googleClientId: string | null;
  // Quem é ADMIN. Vazia = ninguém (o padrão seguro é "ninguém", não "eu").
  adminEmails: string[];
  // Login desligado: só fora de produção e só com AUTH_DISABLED=true exatamente.
  loginDesligado: boolean;
  // Conta usada com o login desligado.
  emailDesenvolvimento: string;
  producao: boolean;
  // Cookie de sessão com Secure e prefixo __Host-: em produção, salvo com SESSAO_HTTP_TESTE=true.
  cookieSeguro: boolean;
  // TEMPORÁRIO (teste no Coolify sem HTTPS): SESSAO_HTTP_TESTE=true deixa o cookie funcionar em HTTP. Desfazer quando o
  // domínio com DNS e HTTPS estiver pronto (item da seção SEGURANÇA do plano.txt).
  sessaoHttpTeste: boolean;
};

type Ambiente = Record<string, string | undefined>;

export class ErroDeConfiguracao extends Error {}

export const producao = (env: Ambiente = process.env) => env.NODE_ENV === "production";

// Só a string exata "true" desliga; em produção nunca desliga, nem com a variável ligada.
export function loginDesligado(env: Ambiente = process.env): boolean {
  return env.AUTH_DISABLED === "true" && !producao(env);
}

// TEMPORÁRIO: ver sessaoHttpTeste em ConfigAutenticacao. Só a string exata "true" liga.
export const sessaoHttpTeste = (env: Ambiente = process.env) => env.SESSAO_HTTP_TESTE === "true";

// O cookie só sai sem Secure fora de produção ou, em produção, com o teste em HTTP ligado.
export const cookieSeguro = (env: Ambiente = process.env) => producao(env) && !sessaoHttpTeste(env);

export function listaDeAdmins(valor: string | undefined): string[] {
  return (valor ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function lerConfigAutenticacao(env: Ambiente = process.env): ConfigAutenticacao {
  const segredo = env.SESSAO_SEGREDO ?? "";
  if (segredo.length < TAMANHO_MINIMO_DO_SEGREDO) {
    throw new ErroDeConfiguracao(
      `SESSAO_SEGREDO ausente ou curto demais (mínimo ${TAMANHO_MINIMO_DO_SEGREDO} caracteres). ` +
        "Gere com: openssl rand -base64 48 — e coloque no plataforma/.env.local (veja .env.exemplo).",
    );
  }
  const googleClientId = env.GOOGLE_CLIENT_ID?.trim() || null;
  return {
    segredo,
    googleClientId,
    adminEmails: listaDeAdmins(env.ADMIN_EMAILS),
    loginDesligado: loginDesligado(env),
    emailDesenvolvimento: (env.DEV_USER_EMAIL?.trim() || "dev@contabilizadev.local").toLowerCase(),
    producao: producao(env),
    cookieSeguro: cookieSeguro(env),
    sessaoHttpTeste: sessaoHttpTeste(env),
  };
}

// Avisos da subida: login desligado é uma decisão, não um detalhe, então aparece toda vez.
export function avisosDaConfig(config: ConfigAutenticacao, env: Ambiente = process.env): string[] {
  const avisos: string[] = [];
  if (config.loginDesligado) {
    avisos.push(`AUTH_DISABLED=true: login desligado (só desenvolvimento). O painel abre direto, sem tela de login, como ${config.emailDesenvolvimento}.`);
  } else if (env.AUTH_DISABLED === "true" && config.producao) {
    avisos.push("AUTH_DISABLED=true ignorado: em produção o login nunca é desligado.");
  }
  if (config.sessaoHttpTeste) {
    avisos.push(
      "SESSAO_HTTP_TESTE=true: cookie de sessão SEM Secure, para o teste em HTTP. Só para teste: tire a variável quando o domínio com HTTPS estiver pronto.",
    );
  }
  if (!config.googleClientId) avisos.push("GOOGLE_CLIENT_ID não definido: o login com Google fica indisponível (veja o README).");
  if (config.adminEmails.length === 0) avisos.push("ADMIN_EMAILS vazio: ninguém é administrador.");
  return avisos;
}
