import { BarraLateral } from "@/app/barra-lateral";
import { MenuUsuario } from "@/app/(painel)/menu-usuario";
import { sairAcao } from "@/app/(painel)/acoes";
import { configAutenticacao, exigirEntradaNaAreaDoAdmin } from "@/lib/autenticacao/servidor";

export const metadata = { title: "Administração · ContabilizaDev" };

// Área do administrador (/admin), separada da aplicação do cliente: barra lateral própria (só as páginas que o papel vê,
// lib/admin.ts), sem seletor de empresa, sem sino e sem as abas de empresa. Fechada por padrão no servidor: COMMON_USER
// recebe 404 (a área "não existe" para ele); MANAGER vê só os usuários (abrir /admin leva a /admin/usuarios); ADMIN vê
// tudo. Cada página e ação também confere (exigirAreaDoAdmin com o próprio endereço): o layout não roda de novo em toda
// navegação.
export default async function LayoutDaAdministracao({ children }: Readonly<{ children: React.ReactNode }>) {
  const { usuario } = await exigirEntradaNaAreaDoAdmin();
  return (
    <>
      <BarraLateral
        administracao={usuario.papel}
        usuario={<MenuUsuario usuario={usuario} areaDoAdmin naAdministracao semLogin={configAutenticacao().loginDesligado} sair={sairAcao} />}
      />
      <div className="transition-[padding] duration-300 ease-out motion-reduce:transition-none lg:pl-64 lg:in-data-[barra=fechada]:pl-16">
        <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 pt-6 pb-24 sm:px-6 sm:pt-8 lg:px-8 lg:pt-10">{children}</main>
      </div>
    </>
  );
}
