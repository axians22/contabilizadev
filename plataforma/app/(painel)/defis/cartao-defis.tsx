import { Cartao } from "@/app/ui";
import { enderecoDoDocumento } from "@/lib/historico/documentos";
import type { DefisGuardada } from "@/lib/historico/leitura";

export function Pdfs({ d }: { d: DefisGuardada }) {
  if (!d.declaracao && !d.recibo) return <>—</>;
  return (
    <span className="flex flex-wrap gap-x-3">
      {d.declaracao && (
        <a href={enderecoDoDocumento("defis", d.id)} target="_blank" rel="noopener" className="font-medium underline underline-offset-2">
          Declaração
        </a>
      )}
      {d.recibo && (
        <a href={enderecoDoDocumento("recibo-defis", d.id)} target="_blank" rel="noopener" className="font-medium underline underline-offset-2">
          Recibo
        </a>
      )}
    </span>
  );
}

// A última DEFIS entregue. "Não encontrada" só quando uma consulta feita não achou nenhuma; sem consulta (importação
// rodando ou ainda não feita), não há o que afirmar: "Consultando…" ou "Ainda não consultada".
export function CartaoUltimaDefis({ lista, autorizada, consultando }: { lista: DefisGuardada[]; autorizada: boolean; consultando: boolean }) {
  const ultima = lista.find((d) => d.situacao === "entregue") ?? null;
  if (ultima) {
    return (
      <Cartao className="flex flex-col gap-2 px-5 py-4 text-sm">
        <span className="text-xs font-medium tracking-wide text-muted uppercase">Última DEFIS entregue</span>
        <div className="flex flex-wrap items-center gap-3">
          <b className="text-2xl font-semibold tracking-tight tabular-nums">Ano {ultima.ano}</b>
          <span className="inline-flex h-6 items-center rounded-full bg-accent px-2.5 text-xs font-semibold text-on-accent">Entregue</span>
        </div>
        {ultima.idDefis && <span className="text-muted tabular-nums">Número {ultima.idDefis}</span>}
        <Pdfs d={ultima} />
      </Cartao>
    );
  }
  if (lista.some((d) => d.situacao === "nao-encontrada")) {
    return <Cartao className="px-5 py-4 text-sm text-muted">Nenhuma DEFIS entregue encontrada na Receita Federal.</Cartao>;
  }
  if (!autorizada) return null;
  return <Cartao className="px-5 py-4 text-sm text-muted">{consultando ? "Consultando a Receita Federal…" : "Ainda não consultada."}</Cartao>;
}
