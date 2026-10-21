"use client";

import { useActionState } from "react";
import { Botao } from "@/app/ui";

type Resultado = { erro: string } | undefined;

// Um botão que dispara uma server action com campos fixos e mostra o erro devolvido.
export function BotaoAcao({
  acao,
  campos,
  children,
  confirmar,
}: {
  acao: (anterior: Resultado, dados: FormData) => Promise<Resultado>;
  campos: Record<string, string>;
  children: React.ReactNode;
  confirmar?: string;
}) {
  const [estado, executar, pendente] = useActionState(acao, undefined);
  return (
    <form
      action={executar}
      onSubmit={(e) => {
        if (confirmar && !window.confirm(confirmar)) e.preventDefault();
      }}
      className="inline-flex flex-col items-end gap-1"
    >
      {Object.entries(campos).map(([nome, valor]) => (
        <input key={nome} type="hidden" name={nome} value={valor} />
      ))}
      <Botao leve disabled={pendente}>
        {children}
      </Botao>
      {estado?.erro && (
        <span role="alert" className="max-w-56 text-right text-xs text-bad">
          {estado.erro}
        </span>
      )}
    </form>
  );
}
