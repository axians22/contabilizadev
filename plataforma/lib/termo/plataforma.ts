// A empresa da própria plataforma (o contratante) e a razão social dela, o "nome" do destinatário no termo de
// autorização.
//
// Ter o CNPJ igual ao PLATAFORMA_CNPJ não prova nada: o cadastro aceita qualquer CNPJ válido. A empresa só é
// reconhecida como a da plataforma (autorizada sem termo, razão social do destinatário) quando um DONO dela é
// administrador da plataforma (ADMIN_EMAILS, reavaliada a cada chamada, conta ativa). Para as outras empresas quem
// prova o vínculo é o termo assinado com o e-CNPJ; aqui, a configuração do servidor.
import { and, eq } from "drizzle-orm";
import type { Banco } from "@/banco";
import { empresas, empresaUsuarios, usuarios } from "@/banco/esquema";
import { papelPara } from "@/lib/autenticacao/papeis";
import { lerRazaoPlataforma } from "@/lib/serpro/config";

// Algum DONO ativo da empresa é ADMIN? (papelPara: ADMIN_EMAILS ganha sempre e a coluna crua nunca dá ADMIN.)
export async function donoEhAdmin(banco: Banco, empresaId: string, adminEmails: readonly string[]): Promise<boolean> {
  if (adminEmails.length === 0) return false;
  const donos = await banco
    .select({ email: usuarios.email, papel: usuarios.papel })
    .from(empresaUsuarios)
    .innerJoin(usuarios, eq(usuarios.id, empresaUsuarios.usuarioId))
    .where(and(eq(empresaUsuarios.empresaId, empresaId), eq(empresaUsuarios.papel, "DONO"), eq(usuarios.ativo, true)));
  return donos.some((d) => papelPara(d.email, d.papel, [...adminEmails]) === "ADMIN");
}

// Primeiro o ambiente (PLATAFORMA_RAZAO_SOCIAL); senão, a razão social guardada da empresa com o PLATAFORMA_CNPJ, só
// se ela for da plataforma (dono ADMIN): um cadastro qualquer com esse CNPJ não escolhe o nome do destinatário. Nunca
// fixa no código. Sem nenhum dos dois, null: a assinatura fica indisponível (o motivo vai para o log).
export async function nomeDaPlataforma(
  banco: Banco,
  cnpj: string,
  adminEmails: readonly string[],
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  const doAmbiente = lerRazaoPlataforma(env);
  if (doAmbiente) return doAmbiente;
  const [empresa] = await banco.select({ id: empresas.id, razaoSocial: empresas.razaoSocial }).from(empresas).where(eq(empresas.cnpj, cnpj)).limit(1);
  if (!empresa || !(await donoEhAdmin(banco, empresa.id, adminEmails))) return null;
  return empresa.razaoSocial.toUpperCase();
}
