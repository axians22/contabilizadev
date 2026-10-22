// Porta única para o dado de cliente. Toda leitura e gravação em tabela com empresa_id passa por aqui:
// 1. exigirAcessoEmpresa confere no banco o vínculo do usuário com a empresa (e o papel, se pedido) e devolve
//    um AcessoEmpresa, que só este arquivo sabe criar (cada acesso emitido fica registrado num WeakSet; cópia
//    com spread, objeto montado à mão ou acesso "reaproveitado" com outro empresaId não estão lá e são recusados);
// 2. dadosDaEmpresa(banco, acesso) lê, insere, altera e apaga sempre com `empresa_id = acesso.empresaId`
//    (na inserção o empresa_id vem do acesso, nunca do formulário).
// Empresa que não existe e empresa de outro dão o mesmo erro, para não revelar quais empresas existem.
//
// Cadastro provisório (papel PROVISORIO, 21/10/2026): quem bateu com o quadro de sócios mas ainda não provou a posse
// (termo assinado com o e-CNPJ em nome dele). Vários usuários podem ter o provisório do mesmo CNPJ, e nenhum pode ver
// nada da empresa: exigirAcessoEmpresa recusa o provisório (AguardandoComprovacao), e o único acesso que ele recebe é o
// AcessoProvisorio de exigirAcessoAoTermo, que é outro tipo (não serve onde se pede AcessoEmpresa) e fica registrado em
// outro WeakSet (dadosDaEmpresa e daEmpresa o recusam também em tempo de execução). Com ele só dá para ler a própria
// empresa (CNPJ e razão social) e contar/registrar os envios do termo (enviosDoTermo), para assinar o termo.
import { and, count, eq, getTableColumns, gte, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { Banco } from "@/banco";
import { empresaUsuarios, enviosTermo, type PapelComprovado } from "@/banco/esquema";

// A marca só existe no tipo (impede montar o objeto sem cast); quem garante de verdade é o registro abaixo,
// que confere a identidade do objeto, coisa que um spread não copia.
declare const MARCA: unique symbol;
declare const MARCA_PROVISORIA: unique symbol;
const emitidos = new WeakSet<object>();
const emitidosProvisorios = new WeakSet<object>();

export type AcessoEmpresa = {
  readonly empresaId: string;
  readonly usuarioId: string;
  readonly papel: PapelComprovado;
  readonly [MARCA]: true;
};

// O vínculo de quem ainda aguarda comprovação: não abre dado nenhum da empresa, só o termo.
export type AcessoProvisorio = {
  readonly empresaId: string;
  readonly usuarioId: string;
  readonly papel: "PROVISORIO";
  readonly [MARCA_PROVISORIA]: true;
};

export type AcessoAoTermo = AcessoEmpresa | AcessoProvisorio;

export class SemAcessoEmpresa extends Error {
  constructor(mensagem = "Empresa não encontrada.") {
    super(mensagem);
  }
}

// A empresa existe e o usuário tem o cadastro provisório dela, mas ainda não comprovou: o conteúdo fica fechado.
export const AGUARDANDO_COMPROVACAO = "Esta empresa aguarda comprovação: assine o termo de autorização com o e-CNPJ dela para liberar o conteúdo.";
export class AguardandoComprovacao extends SemAcessoEmpresa {
  constructor() {
    super(AGUARDANDO_COMPROVACAO);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function vinculo(banco: Banco, usuario: { id: string }, empresaId: string | null | undefined) {
  // Id malformado (vindo de formulário ou URL) é só "não encontrada", não um erro do Postgres.
  if (!empresaId || !UUID.test(empresaId)) throw new SemAcessoEmpresa();
  const [linha] = await banco
    .select({ papel: empresaUsuarios.papel })
    .from(empresaUsuarios)
    .where(and(eq(empresaUsuarios.empresaId, empresaId), eq(empresaUsuarios.usuarioId, usuario.id)));
  if (!linha) throw new SemAcessoEmpresa();
  return { empresaId, papel: linha.papel };
}

function emitir(empresaId: string, usuarioId: string, papel: PapelComprovado): AcessoEmpresa {
  const acesso = Object.freeze({ empresaId, usuarioId, papel }) as AcessoEmpresa;
  emitidos.add(acesso);
  return acesso;
}

export async function exigirAcessoEmpresa(
  banco: Banco,
  usuario: { id: string },
  empresaId: string | null | undefined,
  opcoes: { papel?: "DONO" } = {},
): Promise<AcessoEmpresa> {
  const v = await vinculo(banco, usuario, empresaId);
  if (v.papel === "PROVISORIO") throw new AguardandoComprovacao();
  if (opcoes.papel === "DONO" && v.papel !== "DONO") throw new SemAcessoEmpresa("Só o dono da empresa pode fazer isso.");
  return emitir(v.empresaId, usuario.id, v.papel);
}

// Para o termo de autorização (e para escolher a empresa ativa): qualquer vínculo. O comprovado recebe o AcessoEmpresa de
// sempre; o provisório, o AcessoProvisorio.
export async function exigirAcessoAoTermo(banco: Banco, usuario: { id: string }, empresaId: string | null | undefined): Promise<AcessoAoTermo> {
  const v = await vinculo(banco, usuario, empresaId);
  if (v.papel !== "PROVISORIO") return emitir(v.empresaId, usuario.id, v.papel);
  const acesso = Object.freeze({ empresaId: v.empresaId, usuarioId: usuario.id, papel: "PROVISORIO" }) as AcessoProvisorio;
  emitidosProvisorios.add(acesso);
  return acesso;
}

export const ehProvisorio = (acesso: AcessoAoTermo): acesso is AcessoProvisorio => acesso.papel === "PROVISORIO";

// Confere um acesso ao termo (comprovado ou provisório) emitido aqui. Não abre dado da empresa: é só para quem precisa da
// própria linha de empresas (CNPJ e razão social) no fluxo do termo.
export function conferirAcessoAoTermo(acesso: AcessoAoTermo): void {
  if (!acesso || typeof acesso !== "object") throw new SemAcessoEmpresa();
  if (acesso.papel === "PROVISORIO" ? !emitidosProvisorios.has(acesso) : !emitidos.has(acesso)) throw new SemAcessoEmpresa();
}

// Envios do termo que foram para a Receita, por empresa (o limite de envios em lib/termo/termo.ts). Aceita o provisório:
// assinar o termo é justamente o que ele pode fazer. A contagem é da empresa inteira (o limite protege o custo), mas só
// devolve o número, nunca quem enviou.
export function enviosDoTermo(banco: Banco, acesso: AcessoAoTermo) {
  conferirAcessoAoTermo(acesso);
  return {
    async contarDesde(desde: Date): Promise<number> {
      const [r] = await banco.select({ n: count() }).from(enviosTermo).where(and(eq(enviosTermo.empresaId, acesso.empresaId), gte(enviosTermo.enviadoEm, desde)));
      return Number(r?.n ?? 0);
    },
    async registrar(enviadoEm: Date): Promise<void> {
      await banco.insert(enviosTermo).values({ empresaId: acesso.empresaId, usuarioId: acesso.usuarioId, enviadoEm });
    },
  };
}

// Lança SemAcessoEmpresa se o acesso não foi emitido por exigirAcessoEmpresa (o objeto é congelado, então o
// empresaId de um acesso registrado não muda). O AcessoProvisorio não está neste registro: é recusado aqui.
function conferir(acesso: AcessoEmpresa): void {
  if (!acesso || typeof acesso !== "object" || !emitidos.has(acesso)) throw new SemAcessoEmpresa();
}

// Tabela de dado de cliente: qualquer tabela com a coluna empresaId.
export type TabelaDeEmpresa = PgTable & { empresaId: PgColumn };

// Condição "desta empresa" (mais as condições extras), para consultas que precisem ir além do básico abaixo.
export function daEmpresa(acesso: AcessoEmpresa, tabela: TabelaDeEmpresa, ...condicoes: (SQL | undefined)[]): SQL {
  conferir(acesso);
  return and(eq(tabela.empresaId, acesso.empresaId), ...condicoes) as SQL;
}

// Tira o empresa_id dos valores: quem decide a empresa é o acesso, não quem chama.
function semEmpresaId<T extends object>(valores: T): T {
  const copia = { ...valores } as Record<string, unknown>;
  delete copia.empresaId;
  return copia as T;
}

export function dadosDaEmpresa(banco: Banco, acesso: AcessoEmpresa) {
  conferir(acesso);
  return {
    listar<T extends TabelaDeEmpresa>(tabela: T, onde?: SQL) {
      return banco.select().from(tabela as PgTable).where(daEmpresa(acesso, tabela, onde)) as Promise<T["$inferSelect"][]>;
    },
    inserir<T extends TabelaDeEmpresa>(tabela: T, valores: Omit<T["$inferInsert"], "empresaId">) {
      const linha = { ...semEmpresaId(valores), empresaId: acesso.empresaId } as T["$inferInsert"];
      return banco.insert(tabela).values(linha).returning() as unknown as Promise<T["$inferSelect"][]>;
    },
    alterar<T extends TabelaDeEmpresa>(tabela: T, valores: Partial<Omit<T["$inferInsert"], "empresaId">>, onde: SQL) {
      return banco
        .update(tabela)
        .set(semEmpresaId(valores) as PgUpdateSetSource<T>)
        .where(daEmpresa(acesso, tabela, onde))
        .returning() as unknown as Promise<T["$inferSelect"][]>;
    },
    // Upsert: insere as linhas (empresa_id do acesso) e, se a chave única já existir, atualiza só os campos pedidos. A
    // chave tem de incluir empresa_id, então o conflito nunca alcança a linha de outra empresa.
    inserirOuAtualizar<T extends TabelaDeEmpresa>(
      tabela: T,
      valores: Omit<T["$inferInsert"], "empresaId">[],
      chave: PgColumn[],
      atualizar: (keyof Omit<T["$inferInsert"], "empresaId">)[],
      // Só atualiza a linha existente que atende a condição (troca condicional: sem linha devolvida, a condição não valia).
      seAtual?: SQL,
    ) {
      if (valores.length === 0) return Promise.resolve([] as T["$inferSelect"][]);
      if (!chave.some((c) => c.name === "empresa_id")) throw new Error("A chave do upsert precisa incluir empresa_id.");
      const colunas = getTableColumns(tabela as PgTable) as Record<string, PgColumn>;
      const linhas = valores.map((v) => ({ ...semEmpresaId(v), empresaId: acesso.empresaId }) as T["$inferInsert"]);
      const set = Object.fromEntries(atualizar.map((campo) => [campo, sql.raw(`excluded."${colunas[campo as string].name}"`)]));
      return banco
        .insert(tabela)
        .values(linhas)
        .onConflictDoUpdate({ target: chave, set: set as PgUpdateSetSource<T>, ...(seAtual ? { setWhere: seAtual } : {}) })
        .returning() as unknown as Promise<T["$inferSelect"][]>;
    },
    apagar<T extends TabelaDeEmpresa>(tabela: T, onde: SQL) {
      return banco.delete(tabela).where(daEmpresa(acesso, tabela, onde)).returning() as unknown as Promise<T["$inferSelect"][]>;
    },
  };
}
