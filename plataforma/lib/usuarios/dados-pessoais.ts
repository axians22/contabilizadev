// Dados pessoais do usuário ("Seus dados"): lidos e gravados só aqui, e sempre do próprio usuário (o id vem da sessão,
// nunca do formulário). CPF, nascimento, telefone e endereço não aparecem para mais ninguém (nem na área do
// administrador) e nunca vão para o log: as mensagens de erro daqui não repetem o que foi digitado.
import { and, eq, inArray } from "drizzle-orm";
import type { Banco } from "@/banco";
import { dadosPessoais, empresaUsuarios } from "@/banco/esquema";
import { validarDadosPessoais, VERSAO_DOS_TERMOS, type Campo, type DadosPessoaisValidos } from "./validacao";

export type DadosPessoais = typeof dadosPessoais.$inferSelect;

export class ErroDadosPessoais extends Error {
  constructor(
    mensagem: string,
    readonly erros: Partial<Record<Campo | "aceite", string>> = {},
  ) {
    super(mensagem);
  }
}

export const CPF_EM_USO = "Este CPF já está em uso por outra conta. Se ele é seu, fale com o suporte.";
export const IDENTIDADE_TRAVADA = "O nome completo e o CPF não mudam depois de cadastrar uma empresa. Se precisar corrigir, fale com o suporte.";

// Completos = preenchidos e com o aceite da versão atual dos termos.
export const completos = (d: Pick<DadosPessoais, "termosVersao"> | null | undefined) => Boolean(d && d.termosVersao === VERSAO_DOS_TERMOS);

export async function lerDadosPessoais(banco: Banco, usuarioId: string): Promise<DadosPessoais | null> {
  const [linha] = await banco.select().from(dadosPessoais).where(eq(dadosPessoais.usuarioId, usuarioId));
  return linha ?? null;
}

// O que o cadastro da empresa e o termo usam: nome e CPF, só se os dados estiverem completos.
export async function identidadeDo(banco: Banco, usuarioId: string): Promise<{ nomeCompleto: string; cpf: string } | null> {
  const d = await lerDadosPessoais(banco, usuarioId);
  return completos(d) ? { nomeCompleto: d!.nomeCompleto, cpf: d!.cpf } : null;
}

// Nome e CPF ficam travados depois que o usuário tem algum vínculo com empresa (provisório ou comprovado): foram eles que
// bateram com o quadro de sócios e que o termo confere.
async function temEmpresa(banco: Banco, usuarioId: string) {
  const [v] = await banco
    .select({ empresaId: empresaUsuarios.empresaId })
    .from(empresaUsuarios)
    .where(and(eq(empresaUsuarios.usuarioId, usuarioId), inArray(empresaUsuarios.papel, ["DONO", "MEMBRO", "PROVISORIO"])))
    .limit(1);
  return Boolean(v);
}

export async function identidadeTravada(banco: Banco, usuarioId: string): Promise<boolean> {
  return temEmpresa(banco, usuarioId);
}

const ehCpfDuplicado = (erro: unknown) => {
  const e = erro as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
  const codigo = e?.code ?? e?.cause?.code;
  const restricao = e?.constraint_name ?? e?.cause?.constraint_name;
  return codigo === "23505" && (!restricao || restricao === "dados_pessoais_cpf_unique");
};

// Confere e grava (cria ou atualiza) os dados do usuário, com o aceite da versão atual dos termos. `hoje` é o dia de
// Brasília (AAAA-MM-DD), para a data de nascimento.
export async function salvarDadosPessoais(banco: Banco, usuarioId: string, formulario: Record<string, string>, agora: Date, hoje: string): Promise<DadosPessoaisValidos> {
  const r = validarDadosPessoais(formulario, hoje);
  if (!r.ok) throw new ErroDadosPessoais("Confira os campos marcados.", r.erros);
  const dados = r.dados;
  const atual = await lerDadosPessoais(banco, usuarioId);
  if (atual && (atual.cpf !== dados.cpf || atual.nomeCompleto !== dados.nomeCompleto) && (await temEmpresa(banco, usuarioId))) {
    throw new ErroDadosPessoais(IDENTIDADE_TRAVADA, atual.cpf !== dados.cpf ? { cpf: IDENTIDADE_TRAVADA } : { nomeCompleto: IDENTIDADE_TRAVADA });
  }
  const valores = { ...dados, termosVersao: VERSAO_DOS_TERMOS, termosAceitosEm: agora, atualizadoEm: agora };
  try {
    await banco
      .insert(dadosPessoais)
      .values({ usuarioId, ...valores, criadoEm: agora })
      .onConflictDoUpdate({ target: dadosPessoais.usuarioId, set: valores });
  } catch (erro) {
    if (ehCpfDuplicado(erro)) throw new ErroDadosPessoais(CPF_EM_USO, { cpf: CPF_EM_USO });
    throw erro;
  }
  return dados;
}
