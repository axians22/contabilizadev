// Empresas do usuário e a empresa ativa da sessão: a criação com o vínculo de dono e a escolha da empresa ativa.
// O cadastro pelo CNPJ (consulta na BrasilAPI e diagnóstico) fica em cadastro.ts e usa criarEmpresa.
import { and, asc, eq } from "drizzle-orm";
import type { Banco } from "@/banco";
import { empresas, empresaUsuarios, sessoes, type PapelNaEmpresa } from "@/banco/esquema";
import { exigirAcessoEmpresa } from "./acesso";
import { validarCnpj } from "./cnpj";

export type EmpresaDoUsuario = { id: string; cnpj: string; razaoSocial: string; papel: PapelNaEmpresa };

export class ErroDeEmpresa extends Error {}

// Cria a empresa e o vínculo de DONO com quem criou, na mesma transação.
export async function criarEmpresa(banco: Banco, usuario: { id: string }, dados: { cnpj: string; razaoSocial: string }) {
  const cnpj = validarCnpj(dados.cnpj);
  if (!cnpj) throw new ErroDeEmpresa("CNPJ inválido: confira os números (os dígitos verificadores não batem).");
  const razaoSocial = dados.razaoSocial.trim();
  if (!razaoSocial) throw new ErroDeEmpresa("Informe a razão social.");
  return banco.transaction(async (tx) => {
    // Empresa já cadastrada por outra pessoa não é "adotada": o acesso vem do dono, não do CNPJ digitado.
    // O conflito é resolvido no próprio insert (e não num select antes): dois cadastros simultâneos do mesmo CNPJ
    // não passam juntos pela conferência, e o segundo recebe a mensagem em vez do erro cru da constraint.
    const [empresa] = await tx.insert(empresas).values({ cnpj, razaoSocial }).onConflictDoNothing({ target: empresas.cnpj }).returning();
    if (!empresa) throw new ErroDeEmpresa("Este CNPJ já está cadastrado. Peça acesso ao dono da empresa.");
    await tx.insert(empresaUsuarios).values({ empresaId: empresa.id, usuarioId: usuario.id, papel: "DONO" });
    return empresa;
  });
}

export async function listarEmpresasDoUsuario(banco: Banco, usuario: { id: string }): Promise<EmpresaDoUsuario[]> {
  return banco
    .select({ id: empresas.id, cnpj: empresas.cnpj, razaoSocial: empresas.razaoSocial, papel: empresaUsuarios.papel })
    .from(empresaUsuarios)
    .innerJoin(empresas, eq(empresas.id, empresaUsuarios.empresaId))
    .where(eq(empresaUsuarios.usuarioId, usuario.id))
    .orderBy(asc(empresas.razaoSocial), asc(empresas.id));
}

// A empresa ativa: a escolhida na sessão, se o usuário ainda tiver acesso a ela; senão a primeira da lista;
// null se ele não tiver nenhuma. Nunca devolve empresa sem vínculo, mesmo que a sessão aponte para ela.
export function escolherAtiva(empresasDoUsuario: EmpresaDoUsuario[], escolhida: string | null): EmpresaDoUsuario | null {
  return empresasDoUsuario.find((e) => e.id === escolhida) ?? empresasDoUsuario[0] ?? null;
}

// As empresas do usuário da sessão e a ativa entre elas (o que a barra de cima e o portão usam a cada requisição).
export async function empresasDaSessao(banco: Banco, sessao: { usuario: { id: string }; empresaAtivaId: string | null }) {
  const lista = await listarEmpresasDoUsuario(banco, sessao.usuario);
  return { empresas: lista, empresaAtiva: escolherAtiva(lista, sessao.empresaAtivaId) };
}

// Grava a empresa ativa na sessão, depois de conferir o vínculo (lança SemAcessoEmpresa se não houver).
export async function definirEmpresaAtiva(banco: Banco, sessao: { sessaoId: string; usuario: { id: string } }, empresaId: string) {
  const acesso = await exigirAcessoEmpresa(banco, sessao.usuario, empresaId);
  await banco
    .update(sessoes)
    .set({ empresaAtivaId: acesso.empresaId })
    .where(and(eq(sessoes.id, sessao.sessaoId), eq(sessoes.usuarioId, sessao.usuario.id)));
  return acesso;
}
