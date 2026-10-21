"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cnpjsGuardados, OfertaAoSair } from "@/app/assinador/guardados";
import { inicioDoAdmin } from "@/lib/admin";
import type { UsuarioDaSessao } from "@/lib/autenticacao/servico";

const foco = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink";
const PAPEL: Record<UsuarioDaSessao["papel"], string> = { ADMIN: "Administrador", MANAGER: "Gestor", COMMON_USER: "Usuário" };

const iniciais = (nome: string) =>
  nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

// Menu do usuário na barra de cima: quem está logado, a entrada da área do administrador (só para quem tem acesso) e sair.
// Com certificado guardado neste navegador (app/assinador), sair pergunta antes se apaga.
// `areaDoAdmin` vem do layout (entraNaAreaDoAdmin, lib/admin.ts: MANAGER e ADMIN); dentro da área (`naAdministracao`), o
// atalho é o de volta para a aplicação. A entrada leva à primeira página que o papel vê (inicioDoAdmin: o MANAGER cai
// direto em Usuários). `semLogin` = login desligado (desenvolvimento).
export function MenuUsuario({
  usuario,
  areaDoAdmin,
  naAdministracao = false,
  semLogin,
  sair,
}: {
  usuario: UsuarioDaSessao;
  areaDoAdmin: boolean;
  naAdministracao?: boolean;
  semLogin: boolean;
  sair: () => Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [guardados, setGuardados] = useState<string[] | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const formularioSair = useRef<HTMLFormElement>(null);

  async function clicarSair() {
    const cnpjs = await cnpjsGuardados();
    setAberto(false);
    if (cnpjs.length) setGuardados(cnpjs);
    else formularioSair.current?.requestSubmit();
  }

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

  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-label={`Conta de ${usuario.nome}`}
        aria-haspopup="menu"
        aria-expanded={aberto}
        className={`grid size-9 shrink-0 place-items-center overflow-hidden rounded-full border border-line bg-raised text-xs font-semibold transition-colors hover:border-muted ${foco}`}
      >
        {usuario.avatarUrl ? (
          // Foto do Google: imagem externa pequena, sem passar pelo otimizador do Next.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={usuario.avatarUrl} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          iniciais(usuario.nome)
        )}
      </button>
      {aberto && (
        <div role="menu" className="absolute top-full right-0 z-40 mt-2 flex w-64 flex-col gap-1 rounded-2xl border border-line bg-surface p-1.5 shadow-xl">
          <div className="flex flex-col px-3 py-2 leading-tight">
            <span className="truncate text-sm font-semibold">{usuario.nome}</span>
            <span className="truncate text-xs text-muted">{usuario.email}</span>
            <span className="mt-1 text-xs text-muted">{PAPEL[usuario.papel]}</span>
            {semLogin && <span className="mt-1 text-xs text-warn">Login desligado (desenvolvimento): sair abre uma sessão nova.</span>}
          </div>
          <span className="mx-2 border-t border-line" aria-hidden="true" />
          {naAdministracao ? (
            <Link role="menuitem" href="/" onClick={() => setAberto(false)} className={`rounded-xl px-3 py-2 text-sm transition-colors hover:bg-raised ${foco}`}>
              Voltar para a aplicação
            </Link>
          ) : (
            areaDoAdmin && (
              <Link role="menuitem" href={inicioDoAdmin(usuario.papel) ?? "/"} onClick={() => setAberto(false)} className={`rounded-xl px-3 py-2 text-sm transition-colors hover:bg-raised ${foco}`}>
                Área do administrador
              </Link>
            )
          )}
          <button role="menuitem" type="button" onClick={clicarSair} className={`w-full cursor-pointer rounded-xl px-3 py-2 text-left text-sm font-medium text-bad transition-colors hover:bg-raised ${foco}`}>
            Sair
          </button>
        </div>
      )}
      <form ref={formularioSair} action={sair} hidden />
      {guardados && <OfertaAoSair cnpjs={guardados} sair={() => formularioSair.current?.requestSubmit()} cancelar={() => setGuardados(null)} />}
    </div>
  );
}
