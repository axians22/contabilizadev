import { BarraLateral } from "@/app/barra-lateral";
import { MenuUsuario } from "@/app/(painel)/menu-usuario";
import { SeletorEmpresa } from "@/app/(painel)/seletor-empresa";
import { escolherEmpresaAcao, sairAcao } from "@/app/(painel)/acoes";
import { SinoNoNavegador } from "@/app/(painel)/sino-navegador";
import { configAutenticacao } from "@/lib/autenticacao/servidor";
import { entraNaAreaDoAdmin } from "@/lib/admin";
import { juntarAvisos } from "@/lib/avisos/central";
import { avisosDaEmpresa } from "@/lib/avisos/coleta";
import { exigirConteudo } from "@/lib/empresas/portao-servidor";
import { avisosDoAdminPara } from "@/lib/plataforma/servidor";
import { termoDoServidor } from "@/lib/termo/servidor";
import { banco } from "@/banco";
import { situacaoTermo } from "@/lib/termo/termo";

// Tudo dentro do painel exige sessão (lida do banco a cada requisição; exigirConteudo chama exigirSessao). As páginas e
// ações também conferem: o layout não roda de novo em toda navegação, então não pode ser a única barreira.
// A barra lateral mostra sempre todas as abas, sem nada de administração (isso fica na área /admin, aberta pelo menu do
// usuário para quem tem acesso); o conteúdo de cada aba passa pelo portão (lib/empresas/portao.ts).
export default async function LayoutDoPainel({ children }: Readonly<{ children: React.ReactNode }>) {
  const { usuario, empresas, empresaAtiva, portao } = await exigirConteudo();
  // Sino: a central de avisos da empresa ativa (lib/avisos/coleta.ts), só com o portão liberado (é dado da empresa) e só
  // banco (nada é chamado para montar um aviso). O do certificado guardado no navegador entra lá (SinoNoNavegador).
  const daEmpresa =
    portao.estado === "liberado"
      ? await avisosDaEmpresa(banco(), portao.acesso, new Date(), { termo: await situacaoTermo(await termoDoServidor(), portao.acesso) })
      : [];
  // Só o ADMIN: o certificado da plataforma (vence em 30 dias, venceu, ilegível ou faltando), com ou sem empresa ativa. O
  // aviso leva para a área do administrador (/admin/plataforma).
  const avisos = juntarAvisos(daEmpresa, await avisosDoAdminPara(usuario.papel, new Date()));
  return (
    <>
      <BarraLateral
        sino={<SinoNoNavegador avisos={avisos} cnpj={portao.estado === "liberado" ? portao.empresa.cnpj : null} />}
        empresa={<SeletorEmpresa empresas={empresas} ativaId={empresaAtiva?.id ?? null} escolher={escolherEmpresaAcao} />}
        usuario={<MenuUsuario usuario={usuario} areaDoAdmin={entraNaAreaDoAdmin(usuario.papel)} semLogin={configAutenticacao().loginDesligado} sair={sairAcao} />}
      />
      <div className="transition-[padding] duration-300 ease-out motion-reduce:transition-none lg:pl-64 lg:in-data-[barra=fechada]:pl-16">
        <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 pt-6 pb-24 sm:px-6 sm:pt-8 lg:px-8 lg:pt-10">{children}</main>
      </div>
    </>
  );
}
