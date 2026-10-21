// Gestão de usuários (portada do horizons/backend/src/usuarios): lista, troca de papel e ativação.
// As regras de quem pode o quê ficam em lib/autenticacao/papeis.ts e valem igual para a lista e para a ação.
// O papel de cada usuário aqui é sempre o efetivo (papelPara com ADMIN_EMAILS), nunca a coluna crua: a coluna só
// é corrigida quando o próprio usuário faz uma requisição, e até lá pode estar atrasada em relação à lista.
import { count, desc, eq, ilike, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Banco } from "@/banco";
import { sessoes, usuarios, type Papel } from "@/banco/esquema";
import { ehGestao, papelPara, podeMudarAtivo, podeMudarPapel } from "@/lib/autenticacao/papeis";

export const POR_PAGINA = 25;

type Ator = { id: string; papel: Papel };

// Erro com o status HTTP equivalente (400 pedido inválido, 403 sem permissão, 404 não existe).
export class ErroDeGestao extends Error {
  constructor(
    mensagem: string,
    readonly status: 400 | 403 | 404,
  ) {
    super(mensagem);
  }
}

export type UsuarioDaLista = {
  id: string;
  email: string;
  nome: string;
  papel: Papel;
  ativo: boolean;
  criadoEm: string;
  ultimoLoginEm: string | null;
  desativadoEm: string | null;
  desativadoPor: string | null;
  euMesmo: boolean;
  podeMudarAtivo: boolean;
  podeMudarPapel: boolean;
};

const quemDesativou = alias(usuarios, "quem_desativou");

// Só o necessário para gerir papel: nada de dado de empresa.
const CAMPOS = {
  id: usuarios.id,
  email: usuarios.email,
  nome: usuarios.nome,
  papel: usuarios.papel,
  ativo: usuarios.ativo,
  criadoEm: usuarios.criadoEm,
  ultimoLoginEm: usuarios.ultimoLoginEm,
  desativadoEm: usuarios.desativadoEm,
  desativadoPor: quemDesativou.nome,
};

const consulta = (banco: Banco) => banco.select(CAMPOS).from(usuarios).leftJoin(quemDesativou, eq(quemDesativou.id, usuarios.desativadoPorId));
type Linha = Awaited<ReturnType<typeof consulta>>[number];

function paraLista(ator: Ator, l: Linha, adminEmails: string[]): UsuarioDaLista {
  const papel = papelPara(l.email, l.papel, adminEmails);
  return {
    ...l,
    papel,
    criadoEm: l.criadoEm.toISOString(),
    ultimoLoginEm: l.ultimoLoginEm?.toISOString() ?? null,
    desativadoEm: l.desativadoEm?.toISOString() ?? null,
    euMesmo: l.id === ator.id,
    podeMudarAtivo: podeMudarAtivo(ator, { id: l.id, papel }),
    podeMudarPapel: podeMudarPapel(ator, { id: l.id, papel }),
  };
}

function exigirGestao(ator: Ator) {
  if (!ehGestao(ator.papel)) throw new ErroDeGestao("Esta área é restrita a quem gerencia a plataforma.", 403);
}

export async function listarUsuarios(banco: Banco, ator: Ator, busca: string | undefined, pagina: number, adminEmails: string[]) {
  exigirGestao(ator);
  const texto = (busca ?? "").trim();
  // % e _ digitados valem como texto, não como curinga.
  const padrao = `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const filtro = texto ? or(ilike(usuarios.email, padrao), ilike(usuarios.nome, padrao)) : undefined;

  const [{ total }] = await banco.select({ total: count() }).from(usuarios).where(filtro);
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  // Página além do fim (ex.: a busca encolheu a lista) vai para a última, e não para uma lista vazia.
  const atual = Math.min(Math.max(1, Math.trunc(pagina) || 1), paginas);
  const linhas = await consulta(banco)
    .where(filtro)
    .orderBy(desc(usuarios.criadoEm), desc(usuarios.id))
    .limit(POR_PAGINA)
    .offset((atual - 1) * POR_PAGINA);
  return { itens: linhas.map((l) => paraLista(ator, l, adminEmails)), total, pagina: atual, paginas, porPagina: POR_PAGINA };
}

// O alvo com o papel efetivo: quem entrou em ADMIN_EMAILS já é ADMIN, e quem saiu já não é.
async function buscar(banco: Banco, id: string, adminEmails: string[]) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const [alvo] = uuid.test(id)
    ? await banco.select({ id: usuarios.id, email: usuarios.email, papel: usuarios.papel }).from(usuarios).where(eq(usuarios.id, id))
    : [];
  if (!alvo) throw new ErroDeGestao("Usuário não encontrado.", 404);
  return { id: alvo.id, papel: papelPara(alvo.email, alvo.papel, adminEmails) };
}

async function linhaDaLista(banco: Banco, ator: Ator, id: string, adminEmails: string[]) {
  const [l] = await consulta(banco).where(eq(usuarios.id, id));
  return paraLista(ator, l, adminEmails);
}

// Promove a MANAGER ou rebaixa a COMMON_USER. ADMIN não se dá nem se tira pela tela: é a variável ADMIN_EMAILS.
export async function mudarPapel(banco: Banco, ator: Ator, alvoId: string, papel: string, adminEmails: string[]) {
  if (papel !== "MANAGER" && papel !== "COMMON_USER") {
    throw new ErroDeGestao(papel === "ADMIN" ? "O papel de admin vem da variável ADMIN_EMAILS, e não da tela." : "Papel inválido.", 400);
  }
  exigirGestao(ator);
  const alvo = await buscar(banco, alvoId, adminEmails);
  if (alvo.papel === "ADMIN" && ator.papel === "ADMIN" && ator.id !== alvo.id) {
    throw new ErroDeGestao("Esta conta é admin pela variável ADMIN_EMAILS. Tire o e-mail de lá para mudar o papel.", 400);
  }
  if (!podeMudarPapel(ator, alvo)) {
    throw new ErroDeGestao(ator.id === alvo.id ? "Você não pode mudar o próprio papel." : "Só o administrador muda o papel de alguém.", 403);
  }
  await banco.update(usuarios).set({ papel }).where(eq(usuarios.id, alvoId));
  return linhaDaLista(banco, ator, alvoId, adminEmails);
}

// Desativar derruba a conta na hora: as sessões são apagadas e o usuário é relido a cada requisição.
export async function mudarAtivo(banco: Banco, ator: Ator, alvoId: string, ativo: boolean, adminEmails: string[]) {
  exigirGestao(ator);
  const alvo = await buscar(banco, alvoId, adminEmails);
  if (!podeMudarAtivo(ator, alvo)) {
    throw new ErroDeGestao(ator.id === alvo.id ? "Você não pode desativar a própria conta." : "Você não pode mudar esta conta.", 403);
  }
  await banco.transaction(async (tx) => {
    await tx
      .update(usuarios)
      .set(ativo ? { ativo: true, desativadoEm: null, desativadoPorId: null } : { ativo: false, desativadoEm: new Date(), desativadoPorId: ator.id })
      .where(eq(usuarios.id, alvoId));
    if (!ativo) await tx.delete(sessoes).where(eq(sessoes.usuarioId, alvoId));
  });
  return linhaDaLista(banco, ator, alvoId, adminEmails);
}
