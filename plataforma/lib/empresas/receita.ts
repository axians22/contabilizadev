// Dados da Receita da empresa (BrasilAPI) e o diagnóstico, sempre pela porta de acesso (acesso.ts).
// Regra das consultas externas: primeiro o banco; a BrasilAPI só quando não há consulta guardada, quando ela passou
// da validade ou quando o cliente pede para atualizar (e nem assim mais de uma vez a cada poucos minutos).
// O resultado é guardado com o empresa_id do acesso.
import { desc, eq } from "drizzle-orm";
import { consultarCnpj, ErroConsultaCnpj, type Buscar, type DadosCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { completarDiagnostico, diagnosticar } from "@contabilizadev/nucleo/diagnostico";
import type { Banco } from "@/banco";
import { consultasCnpj, empresas, FONTE_CONSULTA_CNPJ } from "@/banco/esquema";
import { dadosDaEmpresa, daEmpresa, SemAcessoEmpresa, type AcessoEmpresa } from "./acesso";

export const VALIDADE_DOS_DADOS_DIAS = 30;
export const INTERVALO_MINIMO_MINUTOS = 5;
const DIA_MS = 24 * 60 * 60 * 1000;

export type ConsultaCnpj = typeof consultasCnpj.$inferSelect;

// Data de hoje no Brasil (AAAA-MM-DD), para o diagnóstico (opção e exclusão do Simples são por dia).
export const hojeNoBrasil = (agora: Date) => agora.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

export const consultaVencida = (consultadaEm: Date, agora: Date) => agora.getTime() - consultadaEm.getTime() > VALIDADE_DOS_DADOS_DIAS * DIA_MS;
export const consultaRecente = (consultadaEm: Date, agora: Date) => agora.getTime() - consultadaEm.getTime() < INTERVALO_MINIMO_MINUTOS * 60 * 1000;

export async function ultimaConsulta(banco: Banco, acesso: AcessoEmpresa): Promise<ConsultaCnpj | null> {
  const [linha] = await banco
    .select()
    .from(consultasCnpj)
    .where(daEmpresa(acesso, consultasCnpj))
    .orderBy(desc(consultasCnpj.consultadaEm), desc(consultasCnpj.id))
    .limit(1);
  if (!linha) return null;
  // Consulta guardada antes das versões curtas do diagnóstico: refaz o diagnóstico com os dados guardados e o dia da
  // consulta (é puro), para a tela sair igual à de quem cadastra hoje.
  return { ...linha, diagnostico: completarDiagnostico(linha.diagnostico, linha.dados, hojeNoBrasil(linha.consultadaEm)) };
}

// Guarda a consulta com o diagnóstico do dia dela. O CNPJ consultado tem de ser o da empresa do acesso.
// A empresa fica travada (FOR NO KEY UPDATE, a mesma trava da remoção em lib/empresas/remocao.ts) da conferência até a
// gravação: se ela foi removida enquanto a consulta à Receita corria, para com SemAcessoEmpresa ("Empresa não
// encontrada.", sem o CNPJ); se a remoção chega depois, espera esta gravação e apaga a consulta junto.
export async function salvarConsulta(banco: Banco, acesso: AcessoEmpresa, dados: DadosCnpj, consultadaEm: Date): Promise<ConsultaCnpj> {
  dadosDaEmpresa(banco, acesso); // confere o acesso antes de qualquer leitura
  const diagnostico = diagnosticar(dados, hojeNoBrasil(consultadaEm));
  return banco.transaction(async (tx) => {
    const banco = tx as unknown as Banco;
    const [empresa] = await banco.select({ cnpj: empresas.cnpj }).from(empresas).where(eq(empresas.id, acesso.empresaId)).for("no key update");
    if (!empresa) throw new SemAcessoEmpresa();
    if (empresa.cnpj !== dados.cnpj) throw new Error(`A consulta é do CNPJ ${dados.cnpj}, não do desta empresa.`);
    const [linha] = await dadosDaEmpresa(banco, acesso).inserir(consultasCnpj, {
      fonte: FONTE_CONSULTA_CNPJ,
      consultadaEm,
      cnaePrincipal: dados.cnaePrincipal.codigo,
      cnaesSecundarios: dados.cnaesSecundarios.map((c) => c.codigo),
      situacaoCadastral: dados.situacaoCadastral,
      optanteSimples: dados.simples.optante,
      optanteMei: dados.mei.optante,
      dados,
      diagnostico,
      atendida: diagnostico.atendido,
    });
    return linha;
  });
}

export type DadosDaReceita = {
  consulta: ConsultaCnpj | null;
  fonte: "banco" | "receita"; // receita = consulta nova feita agora
  // A consulta pedida não aconteceu: erro da BrasilAPI (mostra o que estava guardado) ou pedido repetido cedo demais.
  erro?: string;
  aviso?: string;
};

export type OpcoesReceita = { agora?: Date; forcar?: boolean; buscar?: Buscar };

// A consulta que vale para a empresa: a do banco se estiver em dia; senão (ou com `forcar`) uma nova na BrasilAPI,
// guardada no banco. Se a BrasilAPI falhar, devolve a guardada (se houver) com o erro, para a tela seguir de pé.
export async function dadosDaReceita(banco: Banco, acesso: AcessoEmpresa, opcoes: OpcoesReceita = {}): Promise<DadosDaReceita> {
  const agora = opcoes.agora ?? new Date();
  const guardada = await ultimaConsulta(banco, acesso);
  if (guardada && !opcoes.forcar && !consultaVencida(guardada.consultadaEm, agora)) return { consulta: guardada, fonte: "banco" };
  if (guardada && opcoes.forcar && consultaRecente(guardada.consultadaEm, agora)) {
    return { consulta: guardada, fonte: "banco", aviso: `Os dados foram consultados há menos de ${INTERVALO_MINIMO_MINUTOS} minutos; mostramos essa consulta.` };
  }

  const [empresa] = await banco.select({ cnpj: empresas.cnpj, razaoSocial: empresas.razaoSocial }).from(empresas).where(eq(empresas.id, acesso.empresaId));
  if (!empresa) return { consulta: guardada, fonte: "banco", erro: "Empresa não encontrada." };
  let dados: DadosCnpj;
  try {
    dados = await consultarCnpj(empresa.cnpj, { buscar: opcoes.buscar });
  } catch (erro) {
    if (erro instanceof ErroConsultaCnpj) return { consulta: guardada, fonte: "banco", erro: erro.message };
    throw erro;
  }
  let consulta: ConsultaCnpj;
  try {
    consulta = await salvarConsulta(banco, acesso, dados, agora);
  } catch (erro) {
    // Removida enquanto a consulta corria (outra aba ou outro usuário): nada é guardado e a tela segue de pé.
    if (erro instanceof SemAcessoEmpresa) return { consulta: null, fonte: "banco", erro: erro.message };
    throw erro;
  }
  // A razão social mostrada na barra de cima acompanha a da Receita.
  if (dados.razaoSocial !== empresa.razaoSocial) {
    await banco.update(empresas).set({ razaoSocial: dados.razaoSocial }).where(eq(empresas.id, acesso.empresaId));
  }
  return { consulta, fonte: "receita" };
}
