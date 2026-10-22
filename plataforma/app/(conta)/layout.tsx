import Link from "next/link";
import { sairAcao } from "@/app/(painel)/acoes";
import { botaoLink } from "@/app/ui";
import { exigirSessaoSemDados } from "@/lib/autenticacao/servidor";
import { exigeSeusDados } from "@/lib/usuarios/portao-dos-dados";

// Telas da conta ("Seus dados" e os termos): fora do painel, porque o painel passa pelo portão do primeiro login e estas
// são justamente as que ficam livres dele (exigirSessaoSemDados). Só o essencial: a marca, voltar (quando os dados já
// estão completos) e sair.
export default async function LayoutDaConta({ children }: Readonly<{ children: React.ReactNode }>) {
  const { usuario } = await exigirSessaoSemDados();
  const preso = exigeSeusDados(usuario);
  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <span className="grid size-8 place-items-center rounded-xl bg-hero text-accent" aria-hidden="true">
              <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 13V8M8 13V3M13 13V6" />
              </svg>
            </span>
            ContabilizaDev
          </span>
          <div className="flex items-center gap-2">
            {!preso && (
              <Link href="/" className={botaoLink}>
                Voltar para a aplicação
              </Link>
            )}
            <form action={sairAcao}>
              <button type="submit" className="h-9 cursor-pointer rounded-full px-3 text-sm font-medium text-bad hover:bg-raised">
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-6 pb-24 sm:px-6 sm:pt-8">{children}</main>
    </>
  );
}
