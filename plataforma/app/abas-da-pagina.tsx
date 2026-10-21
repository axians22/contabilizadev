import Link from "next/link";

// Componente único das abas de uma página (Avisos e mensagens, Plano do projeto): links com a aba no endereço, a atual
// marcada com aria-current e, se houver, um selo com a contagem (acima de 99 vira "99+"). Mudar o visual das abas é só aqui.
export type AbaDaPagina<Id extends string = string> = {
  id: Id;
  nome: string;
  href: string;
  contagem?: number;
  rotuloDaContagem?: string;
};

export function AbasDaPagina<Id extends string>({ rotulo, abas, atual }: { rotulo: string; abas: readonly AbaDaPagina<Id>[]; atual: Id }) {
  return (
    <nav aria-label={rotulo} className="flex gap-1 border-b border-line">
      {abas.map((a) => (
        <Link
          key={a.id}
          href={a.href}
          aria-current={a.id === atual ? "page" : undefined}
          className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            a.id === atual ? "border-accent-ink text-fg" : "border-transparent text-muted hover:text-fg"
          }`}
        >
          {a.nome}
          {a.contagem !== undefined && a.contagem > 0 && (
            <span className="rounded-full bg-raised px-2 text-xs tabular-nums" aria-label={a.rotuloDaContagem}>
              {a.contagem > 99 ? "99+" : a.contagem}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
