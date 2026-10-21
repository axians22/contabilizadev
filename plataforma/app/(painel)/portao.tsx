import Link from "next/link";
import { Explicacao } from "@/app/explicacao";
import { Cartao, Titulo, botaoPrimario } from "@/app/ui";
import type { AbaDaEmpresa } from "@/lib/abas";
import type { Portao } from "@/lib/empresas/portao";

// O que uma aba de empresa mostra com o portão fechado (lib/empresas/portao.ts): o título da aba, o que ela vai mostrar
// e o próximo passo. A aba continua no menu e responde normalmente, sem redirecionar. Curto: o que a aba mostra e o
// porquê ficam no tooltip.
export function PortaoFechado({ aba, portao, sobre }: { aba: AbaDaEmpresa; portao: Exclude<Portao, { estado: "liberado" }>; sobre?: string }) {
  const semEmpresa = portao.estado === "sem-empresa";
  return (
    <>
      <Titulo sobre={sobre ?? (semEmpresa ? undefined : portao.empresa.razaoSocial)}>{aba.nome}</Titulo>
      <Cartao className="flex flex-col items-start gap-4 px-6 py-6">
        <span className="grid size-11 place-items-center rounded-2xl bg-accent/15 text-accent-ink" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {semEmpresa ? (
              <>
                <path d="M4 21V5l8-2v18M12 8h8v13" />
                <path d="M2 21h20M16 12h.01M16 16h.01" />
              </>
            ) : (
              <>
                <rect x="4" y="10" width="16" height="11" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </>
            )}
          </svg>
        </span>
        <div className="flex max-w-2xl flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">{semEmpresa ? "Cadastre sua empresa para ver esta aba" : "Escolha um plano para ver esta aba"}</h2>
          <p className="text-sm text-muted">
            {semEmpresa ? "Só com o CNPJ, em poucos minutos." : "Esta aba faz parte da assinatura."}{" "}
            <Explicacao
              rotulo="O que esta aba vai mostrar?"
              titulo={`Aqui você vai ver: ${aba.nome}`}
              texto={[
                aba.descricao,
                semEmpresa
                  ? "O cadastro é pelo CNPJ: buscamos os dados na Receita Federal e dizemos em que anexo do Simples a empresa fica."
                  : "Com um plano ativo, o conteúdo da empresa aparece aqui.",
              ]}
            />
          </p>
        </div>
        <Link className={botaoPrimario} href={semEmpresa ? "/empresas/nova" : "/planos"}>
          {semEmpresa ? "Cadastrar empresa" : "Escolher um plano"}
        </Link>
      </Cartao>
    </>
  );
}
