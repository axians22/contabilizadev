"use client";

import Link from "next/link";
import { Tabela } from "@/app/tabela";
import { juntarAvisos, NIVEIS, type AvisoDoSino } from "@/lib/avisos/central";
import { useAvisoDoCertificado } from "../sino-navegador";

const PILULA = { vencida: "bg-bad text-white", vence: "bg-warn-soft text-warn", info: "bg-raised text-muted" } as const;

// A lista completa da central de avisos (tabela única, com paginação): os do servidor mais o do certificado guardado neste
// navegador (sem empresa, cnpj null: nenhum), juntos e sem repetir, do mais grave ao informativo. O rótulo vem de quem
// chama (rotuloDosAvisos): a mesma lista leva só os da empresa, só os da plataforma (ADMIN) ou os dois.
export function ListaDeAvisos({ avisos, cnpj, rotulo }: { avisos: AvisoDoSino[]; cnpj: string | null; rotulo: string }) {
  const doCertificado = useAvisoDoCertificado(cnpj);
  const todos = doCertificado.length ? juntarAvisos(avisos, doCertificado) : avisos;
  return (
    <Tabela
      rotulo={rotulo}
      porPagina={10}
      vazio="Nenhum aviso agora."
      colunas={[
        { chave: "aviso", titulo: "Aviso", principal: true },
        { chave: "prioridade", titulo: "Prioridade" },
        { chave: "onde", titulo: "Onde resolver" },
      ]}
      linhas={todos.map((a, i) => ({
        chave: a.chave ?? i,
        destaque: a.nivel === "vencida",
        celulas: {
          aviso: (
            <span className="flex min-w-0 flex-col gap-0.5">
              <b className="font-semibold">{a.titulo}</b>
              <span className="text-muted">{a.texto}</span>
            </span>
          ),
          prioridade: <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${PILULA[a.nivel]}`}>{NIVEIS[a.nivel].rotulo}</span>,
          onde: (
            <Link href={a.link.href} className="font-medium whitespace-nowrap text-accent-ink underline underline-offset-2">
              {a.link.texto}
            </Link>
          ),
        },
      }))}
    />
  );
}
