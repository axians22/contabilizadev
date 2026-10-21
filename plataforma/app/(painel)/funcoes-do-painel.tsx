import Link from "next/link";
import { Explicacao } from "@/app/explicacao";
import { Cartao } from "@/app/ui";
import { CAMINHOS, type Funcao } from "@/lib/termo/guiado";
import type { Situacao } from "@/lib/termo/situacao";
import { FacaNoPortal } from "./faca-no-portal";

// Funções que dependem da Receita Federal, na ordem do mês. Com a autorização em dia (termo de autorização assinado),
// rodam aqui; sem ele, o modo guiado mostra o caminho no portal.
export const FUNCOES_DO_PAINEL: Funcao[] = ["declaracaoMensal", "guiaDoMes", "dctfweb", "caixaPostal", "situacaoFiscal", "pagamentos", "declaracaoAnual"];

// A declaração anual (DEFIS) é sempre entregue pelo cliente no portal, mesmo com a autorização: a plataforma só deixa os
// valores prontos na aba (Parte 8). Nunca aparece como "Feito aqui".
const SO_NO_PORTAL: ReadonlySet<Funcao> = new Set(["declaracaoAnual"]);
const ABA_DOS_VALORES: Partial<Record<Funcao, string>> = { declaracaoAnual: "/defis" };

const pilula = "inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-semibold whitespace-nowrap";

// "O que fazemos com a Receita Federal" no painel: com a autorização em dia, "Feito aqui" (e "Valores prontos aqui" para o
// que é entregue no portal); sem ela, cada função abre o caminho do modo guiado.
export function FuncoesDoPainel({ ligado, situacao }: { ligado: boolean; situacao: Situacao }) {
  return (
    <section className="flex flex-col gap-3" aria-label="O que a plataforma faz">
      <h2 className="flex items-center gap-1 text-xl font-semibold tracking-tight">
        O que fazemos com a Receita Federal
        <Explicacao
          rotulo="O que é feito aqui e o que é feito no portal?"
          texto={[
            "Feito aqui: com a autorização em dia, a plataforma faz sozinha, sempre com a sua confirmação.",
            "Valores prontos aqui: a plataforma reúne os valores, e a entrega é feita por você no portal (é o caso da declaração anual).",
            "Faça no portal: sem a autorização, você faz no portal da Receita e a plataforma mostra o caminho e os valores.",
          ]}
        />
      </h2>
      {ligado ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {FUNCOES_DO_PAINEL.map((f) => (
            <li key={f}>
              {SO_NO_PORTAL.has(f) ? (
                <Cartao className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className={`${pilula} bg-warn-soft text-warn`}>Valores prontos aqui</span>
                  <span>
                    {CAMINHOS[f].nome} · entrega no portal.{" "}
                    <Link href={ABA_DOS_VALORES[f] ?? "/"} className="font-medium underline underline-offset-2">
                      Ver os valores
                    </Link>
                  </span>
                </Cartao>
              ) : (
                <Cartao className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className={`${pilula} bg-accent text-on-accent`}>Feito aqui</span>
                  {CAMINHOS[f].nome}
                </Cartao>
              )}
            </li>
          ))}
        </ul>
      ) : (
        FUNCOES_DO_PAINEL.map((f) => (
          <details key={f} className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
              <span className="flex items-center gap-3">
                <span className={`${pilula} bg-warn-soft text-warn`}>Faça no portal</span>
                {CAMINHOS[f].nome}
              </span>
              <span className="shrink-0 text-xs whitespace-nowrap text-muted group-open:hidden">Ver como</span>
            </summary>
            <div className="pt-2">
              {SO_NO_PORTAL.has(f) ? (
                // A autorização não muda a entrega: no lugar do atalho "Disponível aqui depois da autorização", a aba
                // com os valores prontos.
                <FacaNoPortal
                  funcao={f}
                  situacao={situacao}
                  situacaoNaTela
                  explicacao="Com ou sem a autorização, a entrega é feita por você no portal; a plataforma reúne os valores do ano na aba."
                  rodape={
                    <Link href={ABA_DOS_VALORES[f] ?? "/"} className="text-muted underline underline-offset-2 hover:text-fg">
                      Ver os valores prontos
                    </Link>
                  }
                />
              ) : (
                <FacaNoPortal funcao={f} situacao={situacao} situacaoNaTela modoExplicado />
              )}
            </div>
          </details>
        ))
      )}
    </section>
  );
}
