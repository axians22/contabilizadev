"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { Papel } from "@/banco/esquema";
import { GRUPOS_DE_ABAS, abasDoGrupo, type AbaDaEmpresa, type HrefDeAba } from "@/lib/abas";
import { inicioDoAdmin, paginasDoAdmin, type HrefDoAdmin } from "@/lib/admin";

const icone = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" className="size-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

type Item = { href: string; nome: string; svg: ReactNode; exato?: boolean };
type Grupo = { titulo: string; itens: Item[] };

// Ícones das abas da empresa. A lista (nome, grupo, ordem, o que cada uma mostra) vem de lib/abas.ts.
const ICONES: Record<HrefDeAba, ReactNode> = {
  "/": icone(<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />),
  "/empresa": icone(<><path d="M4 21V5l8-2v18M12 8h8v13" /><path d="M2 21h20M8 8h.01M8 12h.01M8 16h.01M16 12h.01M16 16h.01" /></>),
  "/autorizacao": icone(<path d="M13 2 4 14h7l-1 8 9-12h-7z" />),
  "/roteiro": icone(<><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2" /></>),
  "/esocial": icone(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 9h6M16 13h6M18 17h4" /></>),
  "/guias": icone(<><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h7M9 17h5" /></>),
  "/historico": icone(<><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>),
  "/defis": icone(<><path d="M5 3h14v18H5z" /><path d="M9 7h6M9 11h6M9 15h3" /><path d="M15 17.5l1.5 1.5 3-3" /></>),
  "/situacao": icone(<><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>),
  "/avisos": icone(<><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>),
};

// Menu da empresa do cliente: sempre todas as abas, com ou sem empresa cadastrada, nos grupos de lib/abas.ts ("Empresa",
// as do dia a dia; "Configuração", no fim). O que aparece dentro de cada uma é decidido no servidor pelo portão
// (lib/empresas/portao.ts).
const daAba = (a: AbaDaEmpresa): Item => ({ href: a.href, nome: a.nome, exato: a.exato, svg: ICONES[a.href as HrefDeAba] });
// As páginas marcadas `foraDoMenu` (Avisos e mensagens) se abrem pelo sininho, não pela barra.
const GRUPOS: { titulo: string; itens: Item[] }[] = GRUPOS_DE_ABAS.map(({ grupo, titulo }) => ({
  titulo,
  itens: abasDoGrupo(grupo)
    .filter((a) => !a.foraDoMenu)
    .map(daAba),
}));

// A aplicação comum não tem nada de administração: o que é de gestão (usuários, certificado e chaves da plataforma, plano do
// projeto) fica na área do administrador (/admin), que se abre pelo menu do usuário e tem a própria barra.
export const gruposDaBarra = (): Grupo[] => GRUPOS;

// Ícones das páginas da área do administrador. A lista (nome, ordem, quem vê) vem de lib/admin.ts.
const ICONES_DO_ADMIN: Record<HrefDoAdmin, ReactNode> = {
  "/admin": icone(<path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" />),
  "/admin/usuarios": icone(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" /></>),
  "/admin/plataforma": icone(<><circle cx="12" cy="9" r="5" /><path d="m9 13.5-1.5 7.5 4.5-2.5 4.5 2.5-1.5-7.5" /></>),
  "/admin/custos": icone(<><circle cx="12" cy="12" r="9" /><path d="M14.5 9.5c-.4-.9-1.4-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.6 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.1 0-2.1-.6-2.5-1.5M12 6.5V8M12 16v1.5" /></>),
  "/admin/plano": icone(<><path d="M9 4h6v3H9z" /><path d="M15 5h3v16H6V5h3" /><path d="M9 12h6M9 16h4" /></>),
};

// A barra da área do administrador: só as páginas que o papel vê (MANAGER, os usuários; ADMIN, tudo). Cada página também
// confere no servidor (exigirAreaDoAdmin); a barra só não mostra o que não abriria.
export const gruposDaAdministracao = (papel: Papel): Grupo[] => [
  {
    titulo: "Administração",
    itens: paginasDoAdmin(papel).map((p) => ({ href: p.href, nome: p.nome, exato: p.exato, svg: ICONES_DO_ADMIN[p.href as HrefDoAdmin] })),
  },
];

const foco = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink";

function Marca({ href }: { href: string }) {
  return (
    <Link href={href} className={`flex shrink-0 items-center gap-2.5 rounded-full ${foco}`}>
      <span className="grid size-8 place-items-center rounded-[10px] bg-hero text-accent">
        <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M3 13V8M8 13V3M13 13V6" />
        </svg>
      </span>
      <strong className="text-[17px] font-semibold tracking-tight whitespace-nowrap lg:in-data-[barra=fechada]:hidden">ContabilizaDev</strong>
    </Link>
  );
}

function Itens({ aoClicar, grupos }: { aoClicar?: () => void; grupos: Grupo[] }) {
  const atual = usePathname();
  const ativo = (i: Item) => (i.exato ? atual === i.href : atual === i.href || atual.startsWith(`${i.href}/`));
  return (
    <nav className="flex flex-col gap-6" aria-label="Menu principal">
      {grupos.map((g) => (
        <div key={g.titulo} className="flex flex-col gap-1">
          <span className="px-3 pb-1 text-[11px] font-semibold tracking-wider whitespace-nowrap text-muted uppercase lg:in-data-[barra=fechada]:hidden">{g.titulo}</span>
          {/* Recolhida: o título do grupo vira uma linha. */}
          <span className="mx-2 mb-1 hidden border-t border-line lg:in-data-[barra=fechada]:block" aria-hidden="true" />
          {g.itens.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              onClick={aoClicar}
              aria-current={ativo(i) ? "page" : undefined}
              title={i.nome}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors lg:in-data-[barra=fechada]:justify-center lg:in-data-[barra=fechada]:px-0 ${foco} ${
                ativo(i) ? "bg-accent text-on-accent" : "text-muted hover:bg-raised hover:text-fg"
              }`}
            >
              {i.svg}
              <span className="whitespace-nowrap lg:in-data-[barra=fechada]:hidden">{i.nome}</span>
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

const CHAVE = "barra-lateral";
const telaLarga = () => window.matchMedia("(min-width: 1024px)").matches;

// Barra lateral à esquerda, que abre e fecha com animação:
// - telas largas: fica ao lado do conteúdo; recolhe pelo botão ‹ e, recolhida, mostra só os ícones (clicar fora deles expande). A escolha fica salva
//   no navegador e é aplicada antes da página aparecer (atributo data-barra no <html>, ver layout).
// - celular: abre pelo ☰ da barra de cima, por cima do conteúdo, como gaveta, com o fundo escurecido.
// A barra de cima mostra a empresa ativa, o sininho das mensagens, a configuração e o menu do usuário.
// `empresa`, `usuario` e `sino` vêm do servidor (leem a sessão e o banco), por isso entram prontos.
// Com `administracao` (o papel de quem está na área /admin), a mesma barra vira a da área do administrador: as páginas de
// lib/admin.ts no lugar das abas, o título "Administração" com uma faixa de cor, "Voltar para a aplicação" no fim e, em
// cima, sem o seletor de empresa, o sino e a engrenagem (não há empresa ativa aqui).

export function BarraLateral({
  sino,
  empresa,
  usuario,
  administracao,
}: {
  sino?: ReactNode;
  empresa?: ReactNode;
  usuario: ReactNode;
  administracao?: Papel;
}) {
  const naAdministracao = administracao !== undefined;
  const grupos = naAdministracao ? gruposDaAdministracao(administracao) : gruposDaBarra();
  const [gavetaAberta, setGavetaAberta] = useState(false);
  const [larga, setLarga] = useState(true);
  const [recolhida, setRecolhida] = useState(false);
  const atual = usePathname();

  // Acompanha o tamanho da tela e o estado salvo.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const ler = () => {
      setLarga(mq.matches);
      setRecolhida(document.documentElement.dataset.barra === "fechada");
    };
    ler();
    mq.addEventListener("change", ler);
    return () => mq.removeEventListener("change", ler);
  }, []);

  // Gaveta do celular: fecha com Esc e trava a rolagem do fundo.
  useEffect(() => {
    if (!gavetaAberta) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setGavetaAberta(false);
    document.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = "";
    };
  }, [gavetaAberta]);

  const alternar = () => {
    if (!telaLarga()) return setGavetaAberta((v) => !v);
    const fechar = document.documentElement.dataset.barra !== "fechada";
    if (fechar) document.documentElement.dataset.barra = "fechada";
    else delete document.documentElement.dataset.barra;
    try {
      localStorage.setItem(CHAVE, fechar ? "fechada" : "aberta");
    } catch {
      // Sem armazenamento (ex.: janela anônima): vale só nesta página.
    }
    setRecolhida(fechar);
  };
  const visivel = larga || gavetaAberta;
  const animacao = "duration-300 ease-out motion-reduce:transition-none";

  return (
    <>
      {/* Fundo escurecido da gaveta (só no celular). */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => setGavetaAberta(false)}
        className={`fixed inset-0 z-20 bg-black/50 transition-opacity lg:hidden ${animacao} ${gavetaAberta ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />

      <aside
        inert={!visivel}
        aria-label="Menu"
        // Recolhida (só ícones): clicar fora de um ícone expande a barra.
        onClick={(e) => {
          if (larga && recolhida && !(e.target as HTMLElement).closest("a, button")) alternar();
        }}
        data-area={naAdministracao ? "administracao" : undefined}
        className={`fixed inset-y-0 left-0 z-30 flex w-72 max-w-[85vw] flex-col gap-8 data-[area=administracao]:border-t-4 data-[area=administracao]:border-t-warn overflow-x-hidden overflow-y-auto border-r border-line bg-surface px-4 py-5 transition-[transform,width,padding] lg:w-64 lg:translate-x-0 lg:shadow-none lg:in-data-[barra=fechada]:w-16 lg:in-data-[barra=fechada]:cursor-pointer lg:in-data-[barra=fechada]:px-3 ${animacao} ${
          gavetaAberta ? "translate-x-0 shadow-2xl" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-2 px-1">
          <Marca href={naAdministracao ? (inicioDoAdmin(administracao) ?? "/") : "/"} />
          <button
            type="button"
            onClick={() => (telaLarga() ? alternar() : setGavetaAberta(false))}
            aria-label={larga ? "Recolher menu" : "Fechar menu"}
            className={`grid size-9 shrink-0 place-items-center rounded-full lg:in-data-[barra=fechada]:hidden text-muted transition-colors hover:bg-raised hover:text-fg ${foco}`}
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 6-6 6 6 6" />
            </svg>
          </button>
        </div>
        <Itens aoClicar={() => setGavetaAberta(false)} grupos={grupos} />
        {naAdministracao && (
          <Link
            href="/"
            onClick={() => setGavetaAberta(false)}
            title="Voltar para a aplicação"
            className={`mt-auto flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-raised hover:text-fg lg:in-data-[barra=fechada]:justify-center lg:in-data-[barra=fechada]:px-0 ${foco}`}
          >
            {icone(<path d="M19 12H5M11 6l-6 6 6 6" />)}
            <span className="whitespace-nowrap lg:in-data-[barra=fechada]:hidden">Voltar para a aplicação</span>
          </Link>
        )}
      </aside>

      {/* Barra de cima em todas as telas: ☰, empresa ativa, mensagens, configuração e usuário. */}
      <header className={`sticky top-0 z-10 border-b border-line/70 bg-bg/80 backdrop-blur-xl transition-[margin] lg:ml-64 lg:in-data-[barra=fechada]:ml-16 ${animacao}`}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setGavetaAberta(true)}
              aria-label="Abrir menu"
              aria-expanded={gavetaAberta}
              className={`grid size-9 place-items-center rounded-full text-muted transition-colors hover:bg-raised hover:text-fg lg:hidden ${foco}`}
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            {naAdministracao ? (
              <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                <span className="size-2 shrink-0 rounded-full bg-warn" aria-hidden="true" />
                <span className="truncate">Administração</span>
              </span>
            ) : (
              empresa
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!naAdministracao && sino}
            {!naAdministracao && (
              <Link
                href="/config"
                aria-label="Configuração"
                aria-current={atual.startsWith("/config") ? "page" : undefined}
                className={`grid size-9 shrink-0 place-items-center rounded-full border transition-colors ${foco} ${
                  atual.startsWith("/config") ? "border-fg bg-fg text-bg" : "border-line bg-surface/70 text-muted hover:text-fg"
                }`}
              >
                <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
                </svg>
              </Link>
            )}
            {usuario}
          </div>
        </div>
      </header>
    </>
  );
}
