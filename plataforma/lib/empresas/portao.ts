// Acesso em camadas (plano.txt, "Modelo"): quem entra vê o site e todas as abas da barra lateral, mas o conteúdo de
// uma aba de empresa só sai por este portão, que decide entre três caminhos:
//   1. sem empresa ativa      -> "sem-empresa": a aba explica o que vai ter e leva ao cadastro;
//   2. empresa sem plano ativo -> "sem-plano":  a aba explica e leva à escolha do plano;
//   3. liberado               -> o AcessoEmpresa (lib/empresas/acesso.ts), único jeito de ler dado da empresa.
// O portão não é só visual: o AcessoEmpresa só é entregue no caminho liberado, então sem empresa (ou sem plano) não
// há como ler dado de empresa nenhuma. O termo de autorização (autorizada x modo guiado) é outra camada, que vem
// depois do portão e não muda a decisão dele.
import type { Banco } from "@/banco";
import { exigirAcessoEmpresa, SemAcessoEmpresa, type AcessoEmpresa } from "./acesso";
import type { EmpresaDoUsuario } from "./servico";

// PONTO ÚNICO DA EXIGÊNCIA DE PLANO. Hoje sempre libera: a cobrança da assinatura chega na Parte 9 (plano.txt, passo
// 24), e é aqui que ela passa a consultar se a empresa tem plano ativo. Nada mais no código decide isso.
export async function planoAtivo(empresa: { id: string }): Promise<boolean> {
  void empresa;
  return true;
}

export type ConferirPlano = (empresa: { id: string }) => boolean | Promise<boolean>;
export type OpcoesDoPortao = { planoAtivo?: ConferirPlano };

export type Portao =
  | { estado: "sem-empresa" }
  | { estado: "sem-plano"; empresa: EmpresaDoUsuario }
  | { estado: "liberado"; empresa: EmpresaDoUsuario; acesso: AcessoEmpresa };

export class SemPlanoAtivo extends SemAcessoEmpresa {
  constructor() {
    super("Esta função faz parte da assinatura: escolha um plano para continuar.");
  }
}

// Para server actions, que recebem o id da empresa do formulário: o vínculo (exigirAcessoEmpresa) e o plano. Lança
// SemAcessoEmpresa (ou SemPlanoAtivo, que é um SemAcessoEmpresa) em vez de devolver o acesso.
export async function exigirAcessoAoConteudo(banco: Banco, usuario: { id: string }, empresaId: string | null | undefined, opcoes: OpcoesDoPortao = {}): Promise<AcessoEmpresa> {
  const acesso = await exigirAcessoEmpresa(banco, usuario, empresaId);
  if (!(await (opcoes.planoAtivo ?? planoAtivo)({ id: acesso.empresaId }))) throw new SemPlanoAtivo();
  return acesso;
}

// Para as páginas: decide pela empresa ativa da sessão (que já vem conferida contra o vínculo, ver escolherAtiva).
// O vínculo é conferido de novo aqui, no banco, antes de olhar o plano: o plano é da empresa, e só quem tem acesso a
// ela pode saber dele.
export async function abrirPortao(banco: Banco, usuario: { id: string }, empresaAtiva: EmpresaDoUsuario | null, opcoes: OpcoesDoPortao = {}): Promise<Portao> {
  if (!empresaAtiva) return { estado: "sem-empresa" };
  try {
    const acesso = await exigirAcessoAoConteudo(banco, usuario, empresaAtiva.id, opcoes);
    return { estado: "liberado", empresa: empresaAtiva, acesso };
  } catch (erro) {
    if (erro instanceof SemPlanoAtivo) return { estado: "sem-plano", empresa: empresaAtiva };
    // Vínculo tirado entre a leitura da sessão e agora: para a aba, é como não ter empresa.
    if (erro instanceof SemAcessoEmpresa) return { estado: "sem-empresa" };
    throw erro;
  }
}
