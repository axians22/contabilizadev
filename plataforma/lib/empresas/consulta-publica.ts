// Consulta pública do CNPJ para o cadastro (dado público da Receita, igual para todos), na tabela cnpjs_consultados.
// Banco primeiro: a consulta guardada vale VALIDADE_DOS_DADOS_DIAS (a mesma dos dados da empresa); vencida, ausente ou
// guardada antes de vir com o CPF mascarado dos sócios, consulta de novo e guarda. Não fica presa a usuário nem a empresa:
// o cadastro provisório de um usuário não grava nada que outro provisório do mesmo CNPJ veja na empresa.
import { eq } from "drizzle-orm";
import { consultarCnpj, type Buscar, type DadosCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import type { Banco } from "@/banco";
import { cnpjsConsultados } from "@/banco/esquema";
import { VALIDADE_DOS_DADOS_DIAS } from "./receita";

const DIA_MS = 24 * 60 * 60 * 1000;

export type ConsultaPublica = { dados: DadosCnpj; consultadaEm: Date; fonte: "banco" | "receita" };

// A consulta guardada traz o CPF mascarado dos sócios? (Sem sócios também serve: não há o que faltar.)
const temDocumentos = (d: DadosCnpj) => d.socios.length === 0 || d.socios.every((s) => s.documento !== undefined);

export async function consultaPublica(banco: Banco, cnpj: string, opcoes: { agora?: Date; buscar?: Buscar; maisNovaQue?: Date } = {}): Promise<ConsultaPublica> {
  const agora = opcoes.agora ?? new Date();
  const [guardada] = await banco.select().from(cnpjsConsultados).where(eq(cnpjsConsultados.cnpj, cnpj));
  const emDia =
    guardada &&
    agora.getTime() - guardada.consultadoEm.getTime() <= VALIDADE_DOS_DADOS_DIAS * DIA_MS &&
    temDocumentos(guardada.dados) &&
    (!opcoes.maisNovaQue || guardada.consultadoEm >= opcoes.maisNovaQue);
  if (guardada && emDia) return { dados: guardada.dados, consultadaEm: guardada.consultadoEm, fonte: "banco" };
  const dados = await consultarCnpj(cnpj, { buscar: opcoes.buscar });
  await banco.insert(cnpjsConsultados).values({ cnpj, dados, consultadoEm: agora }).onConflictDoUpdate({ target: cnpjsConsultados.cnpj, set: { dados, consultadoEm: agora } });
  return { dados, consultadaEm: agora, fonte: "receita" };
}

// A guardada, sem consultar (para semear os dados da empresa quando ela é comprovada).
export async function consultaPublicaGuardada(banco: Banco, cnpj: string): Promise<{ dados: DadosCnpj; consultadaEm: Date } | null> {
  const [linha] = await banco.select().from(cnpjsConsultados).where(eq(cnpjsConsultados.cnpj, cnpj));
  return linha ? { dados: linha.dados, consultadaEm: linha.consultadoEm } : null;
}
