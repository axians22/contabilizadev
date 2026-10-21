"use client";

import { useActionState } from "react";
import { Botao } from "@/app/ui";
import type { EstadoAtualizacaoHistorico } from "./acoes";

// Botão Atualizar das abas do histórico: pede a consulta à Receita (em segundo plano) e mostra o desfecho curto.
export function BotaoAtualizarHistorico({
  empresaId,
  atualizar,
  rotulo = "Atualizar",
}: {
  empresaId: string;
  atualizar: (anterior: EstadoAtualizacaoHistorico, dados: FormData) => Promise<EstadoAtualizacaoHistorico>;
  rotulo?: string;
}) {
  const [estado, executar, pendente] = useActionState(atualizar, undefined);
  return (
    <form action={executar} className="flex flex-col items-start gap-1.5 sm:items-end">
      <input type="hidden" name="empresaId" value={empresaId} />
      <Botao disabled={pendente}>{pendente ? "Pedindo à Receita…" : rotulo}</Botao>
      <span aria-live="polite" className={`max-w-72 text-xs sm:text-right ${estado?.erro ? "text-bad" : "text-muted"}`}>
        {estado?.erro ?? estado?.aviso ?? (estado?.ok ? "Buscando na Receita Federal. Acompanhe aqui." : "")}
      </span>
    </form>
  );
}
