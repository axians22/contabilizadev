// Comprovação da posse da empresa (21/10/2026): o termo assinado com o e-CNPJ em nome do CPF do usuário foi aceito
// (lib/termo/termo.ts, dentro da transação do envio, com a empresa travada). Quem tinha o cadastro provisório vira DONO,
// os provisórios dos outros caem (promoverADono) e a consulta pública do CNPJ feita no cadastro passa a ser o primeiro
// dado da empresa (consultas_cnpj, pela porta de acesso), para Dados da empresa não consultar de novo.
import type { Banco } from "@/banco";
import { exigirAcessoEmpresa, type AcessoEmpresa, type AcessoProvisorio } from "./acesso";
import { consultaPublicaGuardada } from "./consulta-publica";
import { salvarConsulta } from "./receita";
import { promoverADono } from "./servico";

export async function comprovarPosse(banco: Banco, acesso: AcessoProvisorio, cnpj: string, agora: Date): Promise<AcessoEmpresa> {
  await promoverADono(banco, acesso, agora);
  const dono = await exigirAcessoEmpresa(banco, { id: acesso.usuarioId }, acesso.empresaId);
  const publica = await consultaPublicaGuardada(banco, cnpj);
  if (publica && publica.dados.cnpj === cnpj) await salvarConsulta(banco, dono, publica.dados, publica.consultadaEm);
  return dono;
}
