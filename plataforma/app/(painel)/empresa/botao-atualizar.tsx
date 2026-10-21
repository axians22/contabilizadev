"use client";

import { useActionState } from "react";
import { Botao } from "@/app/ui";
import type { EstadoAtualizacao } from "./acoes";

// Botão "Atualizar dados": consulta a Receita de novo e mostra o resultado (erro, aviso ou ok).
export function BotaoAtualizar({ empresaId, atualizar }: { empresaId: string; atualizar: (anterior: EstadoAtualizacao, dados: FormData) => Promise<EstadoAtualizacao> }) {
  const [estado, executar, pendente] = useActionState(atualizar, undefined);
  return (
    <form action={executar} className="flex flex-col items-start gap-1.5 sm:items-end">
      <input type="hidden" name="empresaId" value={empresaId} />
      <Botao disabled={pendente}>{pendente ? "Consultando a Receita…" : "Atualizar dados"}</Botao>
      <span aria-live="polite" className={`max-w-72 text-xs sm:text-right ${estado?.erro ? "text-bad" : "text-muted"}`}>
        {estado?.erro ?? estado?.aviso ?? (estado?.ok ? "Dados atualizados agora." : "")}
      </span>
    </form>
  );
}
