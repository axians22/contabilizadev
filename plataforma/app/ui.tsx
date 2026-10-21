import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { rotuloMes, somarMeses } from "@contabilizadev/nucleo/meses";

const foco = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink";
export const botaoLink = `inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-4 text-sm font-medium whitespace-nowrap transition-colors hover:border-muted ${foco}`;
export const botaoPrimario = `inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full bg-accent px-5 text-sm font-semibold whitespace-nowrap text-on-accent transition hover:brightness-95 active:scale-[0.98] ${foco}`;
export const rotulo = "text-xs font-medium tracking-wide text-muted uppercase";

// `explicacao`: o tooltip (<Explicacao>) com o que a página ou a seção explica, ao lado do título.
export function Titulo({ children, sobre, explicacao }: { children: ReactNode; sobre?: string; explicacao?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      {sobre && <span className={rotulo}>{sobre}</span>}
      <h1 className="text-4xl font-semibold tracking-tight first-letter:uppercase">
        {children}
        {explicacao && <span className="ml-2 inline-flex align-middle text-base">{explicacao}</span>}
      </h1>
    </div>
  );
}

export function Secao({ titulo, children, explicacao }: { titulo: string; children: ReactNode; explicacao?: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <h2 className="flex items-center gap-1 text-xl font-semibold tracking-tight">
        {titulo}
        {explicacao}
      </h2>
      {children}
    </section>
  );
}

export function Cartao({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`min-w-0 rounded-2xl border border-line bg-surface ${className}`}>{children}</div>;
}

const seta = "grid size-9 place-items-center rounded-full text-muted transition-colors hover:bg-raised hover:text-fg";

export function CabecalhoMes({ mes, rota, sobre, ate, rotuloAtual = "Hoje" }: { mes: string; rota: string; sobre: string; ate?: string; rotuloAtual?: string }) {
  const temProximo = !ate || mes < ate;
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <Titulo sobre={sobre}>{rotuloMes(mes)}</Titulo>
      <nav className="flex items-center rounded-full border border-line bg-surface p-0.5">
        <Link className={`${seta} ${foco}`} href={`${rota}?mes=${somarMeses(mes, -1)}`} aria-label="Mês anterior">
          <Chevron className="rotate-180" />
        </Link>
        <Link className={`rounded-full px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:text-fg ${foco}`} href={rota}>
          {rotuloAtual}
        </Link>
        {temProximo ? (
          <Link className={`${seta} ${foco}`} href={`${rota}?mes=${somarMeses(mes, 1)}`} aria-label="Próximo mês">
            <Chevron />
          </Link>
        ) : (
          <span className={`${seta} opacity-30`} aria-hidden="true">
            <Chevron />
          </span>
        )}
      </nav>
    </div>
  );
}

function Chevron({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`size-4 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

// `explicacao`: o tooltip (<Explicacao>) ao lado do rótulo, no lugar da nota aberta que o ../fiscal põe embaixo do bloco.
export function Bloco({ rotulo: nome, children, explicacao }: { rotulo: string; children: ReactNode; explicacao?: ReactNode }) {
  return (
    <Cartao className="flex flex-col gap-2 px-4 py-4 sm:px-5">
      {explicacao ? (
        <span className={`${rotulo} flex items-center gap-1`}>
          {nome}
          {explicacao}
        </span>
      ) : (
        <span className={rotulo}>{nome}</span>
      )}
      <b className="text-lg font-semibold tracking-tight tabular-nums sm:text-2xl">{children}</b>
    </Cartao>
  );
}

const entrada = `h-10 max-w-full rounded-xl border border-line bg-surface px-3 text-fg tabular-nums transition-colors placeholder:text-muted hover:border-muted focus-visible:border-accent-ink ${foco}`;

// `explicacao`: tooltips (<Explicacao>) ao lado do rótulo. Ficam fora do <label>, que não pode ter outro botão dentro.
export function Campo({ rotulo: nome, id, explicacao, ...props }: { rotulo: string; id: string; explicacao?: ReactNode } & ComponentProps<"input">) {
  if (explicacao) {
    return (
      <div className="flex flex-col gap-1.5 text-sm font-medium text-muted">
        <span className="flex items-center gap-1">
          <label htmlFor={id}>{nome}</label>
          {explicacao}
        </span>
        <input id={id} className={`${entrada} font-normal`} {...props} />
      </div>
    );
  }
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5 text-sm font-medium text-muted">
      {nome}
      <input id={id} className={`${entrada} font-normal`} {...props} />
    </label>
  );
}

export function EntradaTabela(props: ComponentProps<"input">) {
  return <input className={`${entrada} h-8 w-28 rounded-lg bg-transparent px-2.5 text-right`} {...props} />;
}

export function Botao({ leve, ...props }: { leve?: boolean } & ComponentProps<"button">) {
  const estilo = leve
    ? `inline-flex h-8 cursor-pointer items-center rounded-full px-2.5 text-sm font-medium text-muted transition-colors hover:bg-raised hover:text-fg ${foco}`
    : botaoPrimario;
  return <button type="submit" className={estilo} {...props} />;
}

export function Check() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
}

// Versão para celular de uma tabela: um bloco por linha, com título, detalhe e texto auxiliar.
