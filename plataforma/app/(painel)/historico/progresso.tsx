"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Cartao } from "@/app/ui";

export type EtapaNaTela = { id: string; nome: string; estado: "pendente" | "rodando" | "feito" | "erro"; feitos?: number; total?: number; mensagem?: string };

const MARCA: Record<EtapaNaTela["estado"], { simbolo: string; cor: string; texto: string }> = {
  pendente: { simbolo: "○", cor: "text-muted", texto: "Na fila" },
  rodando: { simbolo: "◐", cor: "text-accent-ink", texto: "Buscando" },
  feito: { simbolo: "●", cor: "text-accent-ink", texto: "Pronto" },
  erro: { simbolo: "●", cor: "text-bad", texto: "Não deu" },
};

// Progresso da importação do histórico, sem travar a tela: enquanto roda, a página é recarregada do servidor a cada
// poucos segundos (o estado fica no banco); terminou, mostra o resultado de cada etapa.
export function ProgressoImportacao({ rodando, etapas }: { rodando: boolean; etapas: EtapaNaTela[] }) {
  const router = useRouter();
  useEffect(() => {
    if (!rodando) return;
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [rodando, router]);
  const erros = etapas.filter((e) => e.estado === "erro");
  if (!rodando && erros.length === 0) return null;
  return (
    <Cartao className={`flex flex-col gap-2 px-5 py-4 text-sm ${rodando ? "" : "border-bad/40"}`}>
      <b className="font-semibold" role="status">
        {rodando ? "Buscando os dados na Receita Federal…" : "Parte dos dados não veio da Receita Federal."}
      </b>
      <ul className="flex flex-col gap-1">
        {etapas.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-x-2">
            <span className={MARCA[e.estado].cor} aria-hidden="true">
              {MARCA[e.estado].simbolo}
            </span>
            <span>{e.nome}</span>
            <span className="text-muted tabular-nums">
              {MARCA[e.estado].texto}
              {e.estado === "rodando" && e.total ? ` ${e.feitos ?? 0} de ${e.total}` : ""}
            </span>
            {e.estado === "erro" && e.mensagem && <span className="text-muted">· {e.mensagem}</span>}
          </li>
        ))}
      </ul>
    </Cartao>
  );
}
