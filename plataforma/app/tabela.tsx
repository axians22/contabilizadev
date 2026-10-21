"use client";

import { useState, type ReactNode } from "react";

// Tabela única do site: tabela no computador, cartões no celular, paginação e renderização preguiçosa
// (só a página aberta vai para a tela; as outras são montadas quando o usuário chega nelas).
// As células podem ser qualquer coisa vinda do servidor: texto, links, formulários com server actions.

export type Coluna = {
  chave: string;
  titulo: ReactNode;
  alinhar?: "esquerda" | "direita" | "centro";
  // Título do cartão no celular (a primeira coluna, se nenhuma for marcada).
  principal?: boolean;
  // Some no celular (ex.: detalhes que já aparecem no título do cartão).
  ocultarNoCelular?: boolean;
  // Classes extras para as células desta coluna (ex.: largura).
  classe?: string;
};

// destaque: true pinta no verde do tema (a linha que é sua, a nova); "alerta" pinta num tom de erro (ex.: mês com divergência).
export type Linha = { chave: string | number; celulas: Record<string, ReactNode>; destaque?: boolean | "alerta" };

const fundoDoDestaque = (d: Linha["destaque"]) => (d === "alerta" ? "bg-bad/5" : d ? "bg-accent/10" : "");

const ALINHAR = { esquerda: "text-left", direita: "text-right tabular-nums", centro: "text-center" } as const;
const foco = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink";
const botao = `grid size-8 place-items-center rounded-full text-muted transition-colors hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-30 ${foco}`;

function Seta({ girar }: { girar?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={`size-4 ${girar ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

// Páginas visíveis na paginação: primeira, última e vizinhas da atual, com "…" no meio.
function numeros(atual: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const meio = [atual - 1, atual, atual + 1].filter((n) => n > 1 && n < total);
  return [1, ...(meio[0] > 2 ? ["…" as const] : []), ...meio, ...(meio[meio.length - 1] < total - 1 ? ["…" as const] : []), total];
}

export function Tabela({
  colunas,
  linhas,
  porPagina = 10,
  vazio = "Nada para mostrar.",
  rotulo,
  semCartao = false,
  densa = false,
  paginaInicial,
  rodape,
}: {
  colunas: Coluna[];
  linhas: Linha[];
  porPagina?: number;
  vazio?: ReactNode;
  // Nome da tabela para leitores de tela.
  rotulo?: string;
  // Dentro de outro cartão: sem borda própria.
  semCartao?: boolean;
  // Muitas colunas: menos espaço entre elas e títulos que quebram linha, para caber sem rolar para o lado.
  densa?: boolean;
  // Página que abre primeiro (ex.: a que contém a linha em destaque). Sem ela, a página 1.
  paginaInicial?: number;
  // Linha fixa ao pé (ex.: a soma), igual em todas as páginas da paginação; as células seguem as chaves das colunas.
  rodape?: Record<string, ReactNode>;
}) {
  const [escolhida, setPagina] = useState(() => Math.max(1, paginaInicial ?? 1));
  const paginas = Math.max(1, Math.ceil(linhas.length / porPagina));
  // Se as linhas diminuírem (filtro, nova importação), fica na última página que existe.
  const pagina = Math.min(escolhida, paginas);
  const inicio = (pagina - 1) * porPagina;
  const visiveis = linhas.slice(inicio, inicio + porPagina);
  const principal = colunas.find((c) => c.principal) ?? colunas[0];
  const outras = colunas.filter((c) => c !== principal && !c.ocultarNoCelular);
  const caixa = semCartao ? "" : "rounded-2xl border border-line bg-surface";
  const celula = densa ? "px-2 first:pl-4 last:pr-4" : "px-3 first:pl-5 last:pr-5";

  if (linhas.length === 0) {
    return <div className={`${caixa} px-5 py-4 text-sm text-muted`}>{vazio}</div>;
  }

  return (
    <div className={`flex min-w-0 flex-col ${caixa}`}>
      {/* Computador: tabela. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm" aria-label={rotulo}>
          <thead>
            <tr>
              {colunas.map((c) => (
                <th
                  key={c.chave}
                  scope="col"
                  className={`py-3 align-bottom font-medium tracking-wide text-muted uppercase ${celula} ${densa ? "text-[11px] leading-tight" : "text-xs whitespace-nowrap"} ${ALINHAR[c.alinhar ?? "esquerda"]} ${c.classe ?? ""} ${densa ? "whitespace-normal!" : ""}`}
                >
                  {c.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visiveis.map((l) => (
              <tr key={l.chave} className={`transition-colors hover:bg-raised/50 ${fundoDoDestaque(l.destaque)}`}>
                {colunas.map((c) => (
                  <td key={c.chave} className={`border-t border-line ${densa ? "py-2" : "py-2.5"} ${celula} ${ALINHAR[c.alinhar ?? "esquerda"]} ${c.classe ?? ""}`}>
                    {l.celulas[c.chave] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {rodape && (
            <tfoot>
              <tr className="font-semibold">
                {colunas.map((c) => (
                  <td key={c.chave} className={`border-t-2 border-line ${densa ? "py-2" : "py-2.5"} ${celula} ${ALINHAR[c.alinhar ?? "esquerda"]} ${c.classe ?? ""}`}>
                    {rodape[c.chave] ?? ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Celular: um cartão por linha. */}
      <ul className="flex flex-col divide-y divide-line md:hidden" aria-label={rotulo}>
        {visiveis.map((l) => (
          <li key={l.chave} className={`flex flex-col gap-1.5 px-4 py-3 text-sm ${fundoDoDestaque(l.destaque)}`}>
            <div className="min-w-0 font-medium">{l.celulas[principal.chave] ?? "—"}</div>
            {outras.length > 0 && (
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
                {outras.map((c) => (
                  <div key={c.chave} className="contents">
                    <dt className="text-xs text-muted">{c.titulo}</dt>
                    <dd className="min-w-0 text-right break-words tabular-nums">{l.celulas[c.chave] ?? "—"}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
        {rodape && (
          <li className="flex flex-col gap-1.5 border-t-2 border-line px-4 py-3 text-sm font-semibold">
            <div className="min-w-0">{rodape[principal.chave]}</div>
            {outras.length > 0 && (
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
                {outras.map((c) => (
                  <div key={c.chave} className="contents">
                    <dt className="text-xs font-normal text-muted">{c.titulo}</dt>
                    <dd className="min-w-0 text-right break-words tabular-nums">{rodape[c.chave] ?? ""}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        )}
      </ul>

      {paginas > 1 && (
        <nav className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-sm sm:px-5" aria-label="Paginação">
          <span className="text-muted tabular-nums">
            {inicio + 1}–{Math.min(inicio + porPagina, linhas.length)} de {linhas.length}
          </span>
          <div className="flex items-center gap-1">
            <button type="button" className={botao} onClick={() => setPagina(pagina - 1)} disabled={pagina <= 1} aria-label="Página anterior">
              <Seta girar />
            </button>
            {numeros(pagina, paginas).map((n, i) =>
              n === "…" ? (
                <span key={`r${i}`} className="px-1 text-muted">…</span>
              ) : (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPagina(n)}
                  aria-current={n === pagina ? "page" : undefined}
                  className={`grid h-8 min-w-8 place-items-center rounded-full px-2 tabular-nums transition-colors ${foco} ${
                    n === pagina ? "bg-fg font-semibold text-bg" : "text-muted hover:bg-raised hover:text-fg"
                  }`}
                >
                  {n}
                </button>
              ),
            )}
            <button type="button" className={botao} onClick={() => setPagina(pagina + 1)} disabled={pagina >= paginas} aria-label="Próxima página">
              <Seta />
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
