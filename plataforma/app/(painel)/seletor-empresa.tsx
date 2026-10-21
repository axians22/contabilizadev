"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { formatarCnpj } from "@/lib/empresas/cnpj";
import type { EmpresaDoUsuario } from "@/lib/empresas/servico";

const foco = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink";

function Nome({ titulo, detalhe }: { titulo: string; detalhe: string }) {
  return (
    <span className="flex min-w-0 flex-col text-left leading-tight">
      <span className="truncate text-sm font-semibold" title={titulo}>{titulo}</span>
      <span className="truncate text-xs text-muted tabular-nums">{detalhe}</span>
    </span>
  );
}

// Empresa ativa na barra de cima: um botão que abre a lista para trocar (a troca é conferida no servidor, que recusa
// empresa sem vínculo) e cadastrar outra pelo CNPJ. Sem empresa, o atalho para o cadastro.
export function SeletorEmpresa({
  empresas,
  ativaId,
  escolher,
}: {
  empresas: EmpresaDoUsuario[];
  ativaId: string | null;
  escolher: (dados: FormData) => Promise<{ erro: string } | void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [trocando, iniciar] = useTransition();
  const caixa = useRef<HTMLDivElement>(null);
  const ativa = empresas.find((e) => e.id === ativaId) ?? null;

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => !caixa.current?.contains(e.target as Node) && setAberto(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  if (!ativa) {
    return (
      <Link href="/empresas/nova" className={`flex min-w-0 rounded-xl px-2 py-1 transition-colors hover:bg-raised ${foco}`}>
        <Nome titulo="Nenhuma empresa cadastrada" detalhe="Cadastrar pelo CNPJ" />
      </Link>
    );
  }
  const detalhe = `CNPJ ${formatarCnpj(ativa.cnpj)}`;

  const trocar = (id: string) => {
    setAberto(false);
    if (id === ativa.id) return;
    const dados = new FormData();
    dados.set("empresaId", id);
    iniciar(async () => {
      const r = await escolher(dados);
      setErro(r?.erro ?? null);
    });
  };

  return (
    // min-w-0 e o botão em largura total: com razão social longa, o nome encolhe (reticências) em vez de empurrar o sino e
    // a configuração para fora da tela no celular.
    <div ref={caixa} className="relative flex min-w-0">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="true"
        aria-expanded={aberto}
        aria-busy={trocando}
        className={`flex w-full max-w-full min-w-0 items-center gap-2 rounded-xl px-2 py-1 transition-colors hover:bg-raised ${foco} ${trocando ? "opacity-60" : ""}`}
      >
        <Nome titulo={ativa.razaoSocial} detalhe={detalhe} />
        <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {erro && <span role="alert" className="absolute top-full left-2 text-xs text-bad">{erro}</span>}
      {aberto && (
        <div className="absolute top-full left-0 z-40 mt-2 flex w-80 max-w-[85vw] flex-col gap-0.5 rounded-2xl border border-line bg-surface p-1.5 shadow-xl">
          <ul aria-label="Trocar de empresa" className="flex flex-col gap-0.5">
            {empresas.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  aria-current={e.id === ativa.id ? "true" : undefined}
                  onClick={() => trocar(e.id)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-raised ${foco} ${e.id === ativa.id ? "bg-raised" : ""}`}
                >
                  <Nome titulo={e.razaoSocial} detalhe={`CNPJ ${formatarCnpj(e.cnpj)}`} />
                  <span className="shrink-0 text-xs text-muted">{e.papel === "DONO" ? "Dono" : "Membro"}</span>
                </button>
              </li>
            ))}
          </ul>
          <span className="mx-2 my-1 border-t border-line" aria-hidden="true" />
          <Link
            href="/empresas/nova"
            onClick={() => setAberto(false)}
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-raised hover:text-fg ${foco}`}
          >
            <span aria-hidden="true">+</span> Cadastrar outra empresa
          </Link>
        </div>
      )}
    </div>
  );
}
