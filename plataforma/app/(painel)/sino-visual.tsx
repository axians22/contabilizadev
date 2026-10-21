import Link from "next/link";
import { nivelMaisGrave, type AvisoDoSino } from "@/lib/avisos/central";

const COR = { vencida: "bg-bad text-white", vence: "bg-warn text-bg", info: "bg-accent text-on-accent" } as const;

// Sininho da barra de cima, ligado à central de avisos (lib/avisos): acende com a cor do aviso mais grave (vermelho,
// amarelo ou informativo) e mostra quantos são. Não abre balão: leva direto à página Avisos e mensagens, com as duas
// abas (é o único caminho para ela, que não fica na barra lateral). Sem estado: serve ao servidor e ao navegador.
export function SinoVisual({ avisos }: { avisos: AvisoDoSino[] }) {
  const nivel = nivelMaisGrave(avisos);
  const rotulo =
    avisos.length === 0
      ? "Avisos e mensagens: nada pendente"
      : `Avisos e mensagens: ${avisos.length === 1 ? "1 aviso pendente" : `${avisos.length} avisos pendentes`}`;
  return (
    <Link
      href="/avisos"
      aria-label={rotulo}
      className="relative grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border border-line bg-surface/70 text-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
    >
      <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
      </svg>
      {nivel && (
        <span className={`absolute -top-1 -right-1 grid min-w-5 place-items-center rounded-full px-1 text-[11px] leading-5 font-bold tabular-nums ${COR[nivel]}`} aria-hidden="true">
          {avisos.length > 99 ? "99+" : avisos.length}
        </span>
      )}
    </Link>
  );
}
