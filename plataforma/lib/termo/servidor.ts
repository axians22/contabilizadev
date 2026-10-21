// Dependências do termo de autorização no servidor do Next: banco, TOKEN_CHAVE, o cliente real do contrato (nulo sem
// contrato configurado) e a plataforma (PLATAFORMA_CNPJ e a razão social). O motivo técnico de algo faltar vai só para
// o log e para o aviso do administrador, nunca para o cliente.
import "server-only";
import { banco } from "@/banco";
import { configAutenticacao } from "@/lib/autenticacao/servidor";
import { serproDoServidor } from "@/lib/serpro/servidor";
import { ErroDeChave, lerChaveToken } from "./cifra";
import { nomeDaPlataforma } from "./plataforma";
import type { DependenciasTermo } from "./termo";

function chaveDoAmbiente(): { chave: Buffer | null; motivo: string | null } {
  try {
    return { chave: lerChaveToken(process.env.TOKEN_CHAVE), motivo: null };
  } catch (erro) {
    if (erro instanceof ErroDeChave) return { chave: null, motivo: erro.message };
    throw erro;
  }
}

export async function termoDoServidor(): Promise<DependenciasTermo & { motivoTecnico: string | null }> {
  const { plataforma, config, cliente } = await serproDoServidor();
  const { chave, motivo } = chaveDoAmbiente();
  const { adminEmails } = configAutenticacao();
  const nome = plataforma.cnpj ? await nomeDaPlataforma(banco(), plataforma.cnpj, adminEmails) : null;
  const motivoTecnico =
    plataforma.cnpj === null
      ? plataforma.motivo
      : !nome
        ? "Falta a razão social da plataforma: preencha PLATAFORMA_RAZAO_SOCIAL ou cadastre a empresa do PLATAFORMA_CNPJ com uma conta de ADMIN_EMAILS."
        : (motivo ?? (config.pronto ? null : config.motivo));
  return {
    banco: banco(),
    chave,
    cliente,
    // Sem a razão social, o CNPJ ainda serve para reconhecer a empresa da própria plataforma; assinar fica indisponível.
    contratante: plataforma.cnpj ? { numero: plataforma.cnpj, nome: nome ?? "" } : null,
    adminEmails,
    motivoTecnico,
  };
}
