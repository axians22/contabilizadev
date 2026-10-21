import Link from "next/link";
import { Explicacao } from "@/app/explicacao";
import { Cartao, Secao, Titulo, botaoLink } from "@/app/ui";
import { bancoNoAr } from "@/banco";
import { paginasDoAdmin } from "@/lib/admin";
import { exigirAreaDoAdmin } from "@/lib/autenticacao/servidor";
import { NIVEIS } from "@/lib/avisos/central";
import { avisosDoAdmin } from "@/lib/plataforma/servidor";

export const metadata = { title: "Administração · ContabilizaDev" };

// Visão geral da área do administrador (só ADMIN; o MANAGER que abre /admin vai para /admin/usuarios): o que precisa de
// atenção na plataforma (o certificado da plataforma, os mesmos avisos do sino), o banco de dados, que antes ficavam no
// painel da aplicação, e os atalhos para as outras páginas da área.
export default async function VisaoGeral() {
  const { usuario } = await exigirAreaDoAdmin("/admin");
  const paginas = paginasDoAdmin(usuario.papel).filter((p) => p.href !== "/admin");
  const [avisos, banco] = await Promise.all([avisosDoAdmin(new Date()), bancoNoAr()]);

  return (
    <>
      <Titulo
        sobre="Administração"
        explicacao={
          <Explicacao
            rotulo="O que é a área do administrador?"
            texto={[
              "A parte de gestão da plataforma, separada da aplicação das empresas: os clientes não chegam aqui.",
              "Os gestores entram direto em Usuários, a única página da área que eles veem.",
            ]}
          />
        }
      >
        Visão geral
      </Titulo>

      <Secao titulo="Precisa de atenção">
        {avisos.length ? (
          <ul className="flex flex-col gap-3">
            {avisos.map((a) => (
              <li key={a.chave ?? a.titulo}>
                <Cartao className={`flex flex-wrap items-center justify-between gap-3 px-5 py-4 ${a.nivel === "vencida" ? "border-bad/40" : "border-warn/40 bg-warn-soft"}`}>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-xs font-semibold text-muted uppercase">{NIVEIS[a.nivel].rotulo}</span>
                    <span className="flex flex-wrap items-center gap-x-1 font-semibold">
                      {a.titulo}
                      <Explicacao rotulo={`Detalhe: ${a.titulo}`} texto={a.texto} />
                    </span>
                  </span>
                  <Link className={botaoLink} href={a.link.href}>
                    {a.link.texto}
                  </Link>
                </Cartao>
              </li>
            ))}
          </ul>
        ) : (
          <Cartao className="px-5 py-4 text-sm text-muted">Nada pendente na plataforma.</Cartao>
        )}
        <Cartao className="flex flex-wrap items-center gap-3 px-5 py-4 text-sm">
          <span className={`size-2.5 shrink-0 rounded-full ${banco.ok ? "bg-accent-ink" : "bg-bad"}`} aria-hidden="true" />
          {banco.ok ? (
            <span>
              <b className="font-semibold">Banco de dados no ar</b> · Postgres {banco.versao}
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-x-1">
              <b className="font-semibold text-bad">Banco de dados fora do ar.</b>
              <Explicacao rotulo="Como subir o banco de dados?" texto="Abra o Docker Desktop e rode npm run banco:subir na raiz do projeto." />
            </span>
          )}
        </Cartao>
      </Secao>

      <Secao titulo="Nesta área">
        <ul className="grid gap-3 sm:grid-cols-2">
          {paginas.map((p) => (
            <li key={p.href}>
              <Link
                href={p.href}
                className="block h-full rounded-2xl border border-line bg-surface px-5 py-4 transition-colors hover:border-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
              >
                <span className="block font-semibold">{p.nome}</span>
                <span className="mt-1 block text-sm text-muted">{p.resumo}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Secao>
    </>
  );
}
