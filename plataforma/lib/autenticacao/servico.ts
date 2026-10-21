// Login e sessão (portado do horizons/backend/src/auth/auth.service.ts, com sessão em cookie e no banco no
// lugar do JWT em localStorage). Sem nada do Next: o banco, a configuração e o verificador do Google entram por
// parâmetro, para os testes rodarem com o banco de teste e um verificador falso.
import { and, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Banco } from "@/banco";
import { sessoes, usuarios, type Papel } from "@/banco/esquema";
import type { ConfigAutenticacao } from "./config";
import { assinarToken, hashDoToken, lerTokenAssinado, novoToken, VALIDADE_DA_SESSAO_MS } from "./cookie";
import type { VerificadorGoogle } from "./google";
import { papelPara } from "./papeis";

export type Dependencias = {
  banco: Banco;
  config: ConfigAutenticacao;
  // null quando GOOGLE_CLIENT_ID não está definido.
  verificarGoogle: VerificadorGoogle | null;
  agora?: () => Date;
};

// O usuário que circula pelo site. Só estes campos saem do banco, nunca o registro inteiro.
export type UsuarioDaSessao = { id: string; email: string; nome: string; avatarUrl: string | null; papel: Papel };

export type SessaoValida = { sessaoId: string; empresaAtivaId: string | null; usuario: UsuarioDaSessao };

// Erro que pode ser mostrado ao usuário (a mensagem é a da tela).
export class ErroDeLogin extends Error {}

const CAMPOS = { id: usuarios.id, email: usuarios.email, nome: usuarios.nome, avatarUrl: usuarios.avatarUrl, papel: usuarios.papel, ativo: usuarios.ativo };

const agoraDe = (deps: Dependencias) => (deps.agora ?? (() => new Date()))();

function paraSessao({ id, email, nome, avatarUrl, papel }: UsuarioDaSessao & { ativo: boolean }): UsuarioDaSessao {
  return { id, email, nome, avatarUrl, papel };
}

// Cria a sessão no banco e devolve o valor do cookie (o token só existe no cookie; o banco guarda o hash).
async function abrirSessao(deps: Dependencias, usuarioId: string) {
  const token = novoToken();
  const expiraEm = new Date(agoraDe(deps).getTime() + VALIDADE_DA_SESSAO_MS);
  await deps.banco.insert(sessoes).values({ usuarioId, tokenHash: hashDoToken(token), expiraEm });
  // Faxina: sessões vencidas deste usuário não servem para nada.
  await deps.banco.delete(sessoes).where(and(eq(sessoes.usuarioId, usuarioId), lt(sessoes.expiraEm, agoraDe(deps))));
  return { cookie: assinarToken(token, deps.config.segredo), expiraEm };
}

export async function entrarComGoogle(deps: Dependencias, idToken: string) {
  if (!deps.verificarGoogle) throw new ErroDeLogin("O login com Google não está configurado neste servidor.");
  if (!idToken?.trim()) throw new ErroDeLogin("Token do Google ausente.");

  let perfil;
  try {
    perfil = await deps.verificarGoogle(idToken);
  } catch (erro) {
    console.warn(`Token do Google recusado: ${String(erro)}`);
    throw new ErroDeLogin("Não foi possível validar sua conta Google.");
  }
  if (!perfil.email || !perfil.sub) throw new ErroDeLogin("A conta Google não devolveu um e-mail válido.");
  // `!== true` e não `=== false`: token sem a informação também não passa.
  if (perfil.emailVerificado !== true) throw new ErroDeLogin("Confirme o e-mail da sua conta Google antes de entrar.");

  const email = perfil.email.trim().toLowerCase();
  const nome = perfil.nome?.trim() || email.split("@")[0];
  // Upsert por e-mail, sem leitura prévia: tudo o que depende da linha existente é decidido no próprio comando.
  // As duas recusas ficam no setWhere, sem intervalo entre ler e gravar (duas entradas simultâneas ou uma mudança
  // no meio não abrem brecha): conta desativada não entra, e outra conta Google com o mesmo e-mail (ex.: e-mail
  // reciclado) não herda a conta de quem já entrou. A tentativa recusada não grava nada (nem "último login",
  // nome, foto, papel ou provedorId), para quem audita em /admin/usuarios não ver uma entrada que não aconteceu.
  const dados = { nome, avatarUrl: perfil.foto ?? null, provedor: "GOOGLE", provedorId: perfil.sub, ultimoLoginEm: agoraDe(deps) };
  // O papel segue papelPara, mas no conflito o MANAGER vem da linha que está no banco na hora da gravação (e não de
  // uma leitura anterior): um rebaixamento ou promoção feito na tela durante o login não é desfeito por ele.
  const papelNovo = papelPara(email, null, deps.config.adminEmails);
  const papelNoConflito = papelNovo === "ADMIN"
    ? sql<Papel>`'ADMIN'`
    : sql<Papel>`case when ${usuarios.papel} = 'MANAGER' then 'MANAGER' else 'COMMON_USER' end`;
  const mesmoDono = or(ne(usuarios.provedor, "GOOGLE"), isNull(usuarios.provedorId), eq(usuarios.provedorId, perfil.sub));
  const [usuario] = await deps.banco
    .insert(usuarios)
    .values({ email, ...dados, papel: papelNovo })
    .onConflictDoUpdate({ target: usuarios.email, set: { ...dados, papel: papelNoConflito }, setWhere: and(eq(usuarios.ativo, true), mesmoDono) })
    .returning(CAMPOS);

  if (!usuario) {
    // Sem linha de volta: a conta existe e foi recusada. Relê só para escolher a mensagem.
    const [atual] = await deps.banco.select({ ativo: usuarios.ativo }).from(usuarios).where(eq(usuarios.email, email));
    if (atual && !atual.ativo) throw new ErroDeLogin("Esta conta foi desativada.");
    throw new ErroDeLogin("Esta conta Google não é a mesma que criou o acesso com este e-mail.");
  }
  return { usuario: paraSessao(usuario), ...(await abrirSessao(deps, usuario.id)) };
}

// A conta do login desligado (só fora de produção). Vem do banco, e não é inventada, porque os dados gravados
// apontam para o id do usuário. Não mexe em quem já existe, só cria se faltar.
export async function entrarSemLogin(deps: Dependencias) {
  if (!deps.config.loginDesligado) throw new ErroDeLogin("O login desligado só funciona em desenvolvimento, com AUTH_DISABLED=true.");
  const email = deps.config.emailDesenvolvimento;
  await deps.banco
    .insert(usuarios)
    .values({ email, nome: email.split("@")[0], provedor: "DEV", papel: papelPara(email, null, deps.config.adminEmails) })
    .onConflictDoNothing({ target: usuarios.email });
  // Só grava o último login de conta ativa (no mesmo comando, sem janela entre ler e gravar): a tentativa recusada
  // de uma conta desativada não pode aparecer em /admin/usuarios como entrada, igual a entrarComGoogle.
  const [usuario] = await deps.banco
    .update(usuarios)
    .set({ ultimoLoginEm: agoraDe(deps) })
    .where(and(eq(usuarios.email, email), eq(usuarios.ativo, true)))
    .returning(CAMPOS);
  if (!usuario) throw new ErroDeLogin("Esta conta foi desativada.");
  return { usuario: paraSessao(usuario), ...(await abrirSessao(deps, usuario.id)) };
}

// Resolve o cookie na sessão e no usuário, relendo o banco a cada requisição: desativar a conta, mudar o papel ou
// mudar ADMIN_EMAILS vale na hora, sem esperar a sessão vencer. null = sem sessão válida.
export async function resolverSessao(deps: Dependencias, valorDoCookie: string | undefined | null): Promise<SessaoValida | null> {
  const token = lerTokenAssinado(valorDoCookie, deps.config.segredo);
  if (!token) return null;
  const [linha] = await deps.banco
    .select({ sessaoId: sessoes.id, empresaAtivaId: sessoes.empresaAtivaId, provedor: usuarios.provedor, ...CAMPOS })
    .from(sessoes)
    .innerJoin(usuarios, eq(usuarios.id, sessoes.usuarioId))
    .where(and(eq(sessoes.tokenHash, hashDoToken(token)), gt(sessoes.expiraEm, agoraDe(deps))));
  if (!linha || !linha.ativo) return null;
  // Sessão da conta do login desligado não vale depois que o login é religado (nem nunca em produção).
  if (linha.provedor === "DEV" && !deps.config.loginDesligado) return null;
  // ADMIN_EMAILS é reavaliada a cada requisição, não só no login: sair da lista tira o ADMIN na hora, e um ADMIN
  // gravado direto na coluna não vale. A gravação abaixo só mantém a coluna em dia com o papel efetivo; ninguém
  // deve ler a coluna crua para decidir permissão (ela pode estar atrasada): use sempre papelPara.
  const papel = papelPara(linha.email, linha.papel, deps.config.adminEmails);
  if (papel !== linha.papel) await deps.banco.update(usuarios).set({ papel }).where(eq(usuarios.id, linha.id));
  return { sessaoId: linha.sessaoId, empresaAtivaId: linha.empresaAtivaId, usuario: paraSessao({ ...linha, papel }) };
}

export async function encerrarSessao(deps: Dependencias, valorDoCookie: string | undefined | null) {
  const token = lerTokenAssinado(valorDoCookie, deps.config.segredo);
  if (token) await deps.banco.delete(sessoes).where(eq(sessoes.tokenHash, hashDoToken(token)));
}
