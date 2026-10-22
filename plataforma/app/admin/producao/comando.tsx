"use client";

import { useState } from "react";

// Bloco de comando copiável do passo a passo da produção: o comando em <pre> e um botão que copia o texto inteiro.
// Sem a área de transferência (navegador antigo ou página sem HTTPS), o botão avisa e o texto continua selecionável.
export function Comando({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [estado, setEstado] = useState<"parado" | "copiado" | "falhou">("parado");
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setEstado("copiado");
    } catch {
      setEstado("falhou");
    }
    setTimeout(() => setEstado("parado"), 2000);
  }
  return (
    <div className="relative min-w-0 rounded-xl border border-line bg-raised">
      <pre className="overflow-x-auto px-4 py-3 pr-24 font-mono text-xs leading-relaxed whitespace-pre">
        <code>{texto}</code>
      </pre>
      <button
        type="button"
        onClick={copiar}
        aria-label={`Copiar o comando: ${rotulo}`}
        className="absolute top-2 right-2 inline-flex h-7 cursor-pointer items-center rounded-full border border-line bg-surface px-3 text-xs font-medium transition-colors hover:border-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
      >
        <span aria-live="polite">{estado === "copiado" ? "Copiado" : estado === "falhou" ? "Selecione e copie" : "Copiar"}</span>
      </button>
    </div>
  );
}
