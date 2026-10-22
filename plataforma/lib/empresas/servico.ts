// Empresas do usuário e a empresa ativa da sessão: a criação com o vínculo de dono, o cadastro provisório (aguardando
// comprovação), a promoção a dono quando o termo prova a posse e a escolha da empresa ativa.
// O cadastro pelo CNPJ (consulta pública e diagnóstico) fica em cadastro.ts e usa cadastrarProvisorio (ou criarEmpresa,
// para a empresa da plataforma).
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import type { Banco } from "@/banco";
import { cadastrosEncerrados, empresas, empresaUsuarios, sessoes, type PapelNaEmpresa } from "@/banco/esquema";
import { exigirAcessoAoTermo, SemAcessoEmpresa, type AcessoProvisorio } from "./acesso";
import { apagarEmpresaETudo } from "./apagar-empresa";
import { validarCnpj } from "./cnpj";

export type EmpresaDoUsuario = { id: string; cnpj: string; razaoSocial: string; papel: PapelNaEmpresa };

export class ErroDeEmpresa extends Error {}

export const COMPROVADA_POR_OUTRA = "Esta empresa já foi comprovada por outra conta. Se o e-CNPJ dela está em seu nome, fale com o suporte.";

// Cria a empresa e o vínculo de DONO com quem criou, na mesma transação. É o caminho da empresa da plataforma (cadastrada
// por um ADMIN, já nasce comprovada); os clientes entram por cadastrarProvisorio.
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

// Cadastro provisório (aguardando comprovação): cria a empresa, se ainda não existir, e o vínculo PROVISORIO de quem
// cadastrou. O CNPJ não fica bloqueado: outro usuário que também bata com o quadro de sócios entra com o próprio
// provisório, sem saber que já havia outro (nada muda na resposta). Empresa já comprovada (tem DONO ou MEMBRO) é
// recusada: "comprovada por outra conta", sem dizer qual. A linha da empresa fica travada (FOR NO KEY UPDATE, a mesma
// trava da promoção a dono): um cadastro e uma comprovação ao mesmo tempo entram um depois do outro.
export async function cadastrarProvisorio(banco: Banco, usuario: { id: string }, dados: { cnpj: string; razaoSocial: string }): Promise<{ id: string }> {
  const cnpj = validarCnpj(dados.cnpj);
  if (!cnpj) throw new ErroDeEmpresa("CNPJ inválido: confira os números (os dígitos verificadores não batem).");
  const razaoSocial = dados.razaoSocial.trim();
  if (!razaoSocial) throw new ErroDeEmpresa("Informe a razão social.");
  return banco.transaction(async (tx) => {
    await tx.insert(empresas).values({ cnpj, razaoSocial }).onConflictDoNothing({ target: empresas.cnpj });
    const [empresa] = await tx.select({ id: empresas.id }).from(empresas).where(eq(empresas.cnpj, cnpj)).for("no key update");
    const vinculos = await tx.select({ usuarioId: empresaUsuarios.usuarioId, papel: empresaUsuarios.papel }).from(empresaUsuarios).where(eq(empresaUsuarios.empresaId, empresa.id));
    if (vinculos.some((v) => v.usuarioId === usuario.id)) return { id: empresa.id };
    if (vinculos.some((v) => v.papel !== "PROVISORIO")) throw new ErroDeEmpresa(COMPROVADA_POR_OUTRA);
    await tx.insert(empresaUsuarios).values({ empresaId: empresa.id, usuarioId: usuario.id, papel: "PROVISORIO" });
    return { id: empresa.id };
  });
}

// O termo provou a posse (lib/termo/termo.ts, dentro da transação do envio, com a empresa travada): quem enviou vira DONO
// e os provisórios dos outros usuários para o CNPJ caem. Cada um deles fica com um registro em cadastros_encerrados
// ("a empresa foi comprovada por outra conta", sem dizer qual). Lança SemAcessoEmpresa se o provisório de quem enviou já
// não existe.
export async function promoverADono(banco: Banco, acesso: AcessoProvisorio, agora: Date): Promise<void> {
  const [promovido] = await banco
    .update(empresaUsuarios)
    .set({ papel: "DONO" })
    .where(and(eq(empresaUsuarios.empresaId, acesso.empresaId), eq(empresaUsuarios.usuarioId, acesso.usuarioId), eq(empresaUsuarios.papel, "PROVISORIO")))
    .returning({ usuarioId: empresaUsuarios.usuarioId });
  if (!promovido) throw new SemAcessoEmpresa();
  const removidos = await banco
    .delete(empresaUsuarios)
    .where(and(eq(empresaUsuarios.empresaId, acesso.empresaId), eq(empresaUsuarios.papel, "PROVISORIO"), ne(empresaUsuarios.usuarioId, acesso.usuarioId)))
    .returning({ usuarioId: empresaUsuarios.usuarioId });
  if (removidos.length === 0) return;
  const [empresa] = await banco.select({ cnpj: empresas.cnpj, razaoSocial: empresas.razaoSocial }).from(empresas).where(eq(empresas.id, acesso.empresaId));
  await banco.insert(cadastrosEncerrados).values(removidos.map((r) => ({ usuarioId: r.usuarioId, cnpj: empresa.cnpj, razaoSocial: empresa.razaoSocial, encerradoEm: agora })));
}

// Desistir do cadastro provisório: tira o vínculo; se ninguém mais tem vínculo com a empresa, ela é apagada como na
// remoção definitiva (apagar-empresa.ts): o que tiver empresa_id é apagado e o gasto registrado (um envio do termo que
// a Receita recusou, por exemplo) fica anonimizado, sem empresa_id, sem CNPJ e sem mensagens.
export async function desistirDoCadastro(banco: Banco, acesso: AcessoProvisorio): Promise<void> {
  await banco.transaction(async (tx) => {
    const [empresa] = await tx.select({ id: empresas.id, cnpj: empresas.cnpj }).from(empresas).where(eq(empresas.id, acesso.empresaId)).for("no key update");
    if (!empresa) return;
    await tx
      .delete(empresaUsuarios)
      .where(and(eq(empresaUsuarios.empresaId, acesso.empresaId), eq(empresaUsuarios.usuarioId, acesso.usuarioId), eq(empresaUsuarios.papel, "PROVISORIO")));
    const [resta] = await tx.select({ u: empresaUsuarios.usuarioId }).from(empresaUsuarios).where(eq(empresaUsuarios.empresaId, acesso.empresaId)).limit(1);
    if (!resta) await apagarEmpresaETudo(tx, empresa);
  });
}

export type CadastroEncerrado = { id: string; cnpj: string; razaoSocial: string; encerradoEm: Date };

// Os cadastros provisórios do usuário que caíram porque outra conta comprovou a empresa e que ele ainda não viu.
export async function cadastrosEncerradosNaoVistos(banco: Banco, usuario: { id: string }): Promise<CadastroEncerrado[]> {
  return banco
    .select({ id: cadastrosEncerrados.id, cnpj: cadastrosEncerrados.cnpj, razaoSocial: cadastrosEncerrados.razaoSocial, encerradoEm: cadastrosEncerrados.encerradoEm })
    .from(cadastrosEncerrados)
    .where(and(eq(cadastrosEncerrados.usuarioId, usuario.id), isNull(cadastrosEncerrados.vistoEm)))
    .orderBy(desc(cadastrosEncerrados.encerradoEm));
}

export async function marcarEncerradosVistos(banco: Banco, usuario: { id: string }, agora: Date): Promise<void> {
  await banco.update(cadastrosEncerrados).set({ vistoEm: agora }).where(and(eq(cadastrosEncerrados.usuarioId, usuario.id), isNull(cadastrosEncerrados.vistoEm)));
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

// Grava a empresa ativa na sessão, depois de conferir o vínculo (lança SemAcessoEmpresa se não houver). O provisório
// também escolhe a empresa: é nela que ele assina o termo (o conteúdo continua fechado pelo portão).
export async function definirEmpresaAtiva(banco: Banco, sessao: { sessaoId: string; usuario: { id: string } }, empresaId: string) {
  const acesso = await exigirAcessoAoTermo(banco, sessao.usuario, empresaId);
  await banco
    .update(sessoes)
    .set({ empresaAtivaId: acesso.empresaId })
    .where(and(eq(sessoes.id, sessao.sessaoId), eq(sessoes.usuarioId, sessao.usuario.id)));
  return acesso;
}
