"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useLayoutEffect, useReducer, useRef, type ReactNode } from "react";
import { GLOSSARIO, type Termo } from "@/lib/empresas/glossario";
import { aberta, alturaMaxima, ESPERA_AO_SAIR_MS, FECHADA, janelaVisivel, larguraDoBalao, posicionarBalao, reduzirExplicacao } from "@/lib/explicacao";

// Tooltip único da aplicação: toda explicação (o que é um termo, por que importa, onde achar, o que fazer) fica aqui,
// atrás de um ⓘ discreto ou do próprio termo sublinhado, e não num parágrafo aberto na tela. Não crie outro tooltip,
// popover ou "saiba mais": melhore este.
//
// - Botão de verdade (aria-label com a pergunta inteira, ex.: "O que é o Fator R?", aria-expanded, aria-controls e aria-describedby apontando para o balão).
// - Abre ao passar o mouse, ao focar com Tab e ao tocar no celular; Enter/Espaço/clique deixa aberto; fecha com Esc,
//   clicando fora, tocando de novo ou saindo com Tab. Não some enquanto o mouse está no balão.
// - O balão fica sempre no HTML (escondido), para o leitor de tela ler a descrição e a página funcionar sem JavaScript
//   carregado. Por isso o conteúdo é só de texto em linha (span): o tooltip pode ficar dentro de título ou parágrafo.
// - Posição calculada em lib/explicacao.ts: embaixo ou em cima, sem sair da tela, largura máxima legível; no celular,
//   alinhado às bordas. Tema claro/escuro pelas cores do tema; sem animação de movimento (prefers-reduced-motion).

export type LinkDaExplicacao = { href: string; texto: string };

type Props = {
  // O que o leitor de tela anuncia: a pergunta inteira e natural, com artigo ("O que é o Fator R?", "Por que 6201-5/01
  // fica no Anexo III ou V?"). Específica: duas explicações na mesma tela não repetem o rótulo.
  rotulo: string;
  titulo?: string; // título curto no balão
  texto?: string | string[]; // um parágrafo por item
  lista?: string[];
  ordenada?: boolean;
  link?: LinkDaExplicacao | LinkDaExplicacao[]; // um ou mais links no fim do balão (ex.: o sino com dois avisos)
  children?: ReactNode; // conteúdo extra, só em linha (span, b, a)
  gatilho?: ReactNode; // o que aparece no lugar do ⓘ: o próprio termo (sublinhado pontilhado) ou um ícone próprio
  classeGatilho?: string; // estilo do botão quando o gatilho é um ícone próprio (ex.: o sino)
};

const foco = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink";

export function Explicacao({ rotulo, titulo, texto, lista, ordenada, link, children, gatilho, classeGatilho }: Props) {
  const id = useId();
  const idBalao = `explicacao-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [estado, despachar] = useReducer(reduzirExplicacao, FECHADA);
  const aberto = aberta(estado);
  const caixa = useRef<HTMLSpanElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const balao = useRef<HTMLSpanElement>(null);
  const seta = useRef<HTMLSpanElement>(null);
  const conteudo = useRef<HTMLSpanElement>(null);
  const saida = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelarSaida = () => {
    if (saida.current) clearTimeout(saida.current);
    saida.current = null;
  };
  useEffect(() => cancelarSaida, []);

  // Mede o gatilho e o balão e coloca o balão no lugar. Mexe direto no estilo (sem novo render a cada rolagem).
  const posicionar = useCallback(() => {
    const b = balao.current;
    const g = botao.current;
    if (!b || !g) return;
    const janela = janelaVisivel({ largura: document.documentElement.clientWidth, altura: window.innerHeight }, window.visualViewport);
    b.style.width = `${larguraDoBalao(janela)}px`;
    // A altura máxima vai no conteúdo (que rola), não no balão: rolagem no balão cortaria a setinha.
    if (conteudo.current) conteudo.current.style.maxHeight = `${alturaMaxima(janela) - 26}px`;
    const r = g.getBoundingClientRect();
    const p = posicionarBalao({ esquerda: r.left, topo: r.top, largura: r.width, altura: r.height }, b.offsetHeight, janela);
    b.style.left = `${p.esquerda}px`;
    b.style.top = `${p.topo}px`;
    // Um ancestral com transform ou backdrop-filter (a barra de cima) muda a referência do position: fixed; mede onde
    // o balão ficou de fato e corrige a diferença.
    const real = b.getBoundingClientRect();
    if (Math.abs(real.left - p.esquerda) > 0.5) b.style.left = `${2 * p.esquerda - real.left}px`;
    if (Math.abs(real.top - p.topo) > 0.5) b.style.top = `${2 * p.topo - real.top}px`;
    b.dataset.lado = p.lado;
    if (seta.current) {
      seta.current.style.left = `${p.seta - 5}px`;
      seta.current.style.top = p.lado === "baixo" ? "-6px" : "";
      seta.current.style.bottom = p.lado === "cima" ? "-6px" : "";
    }
  }, []);

  useLayoutEffect(() => {
    if (aberto) posicionar();
  }, [aberto, posicionar]);

  // Aberto: acompanha rolagem e redimensionamento; fecha com Esc e com clique ou toque fora.
  useEffect(() => {
    if (!aberto) return;
    let quadro = 0;
    const reposicionar = () => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(posicionar);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // O foco estava no balão (num link): volta para o botão, para não se perder na página.
      if (balao.current?.contains(document.activeElement)) botao.current?.focus();
      despachar({ tipo: "esc" });
    };
    const fora = (e: PointerEvent) => {
      if (!caixa.current?.contains(e.target as Node)) despachar({ tipo: "fora" });
    };
    window.addEventListener("resize", reposicionar);
    window.addEventListener("scroll", reposicionar, true);
    window.visualViewport?.addEventListener("resize", reposicionar);
    window.visualViewport?.addEventListener("scroll", reposicionar);
    document.addEventListener("keydown", tecla);
    document.addEventListener("pointerdown", fora);
    return () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener("resize", reposicionar);
      window.removeEventListener("scroll", reposicionar, true);
      window.visualViewport?.removeEventListener("resize", reposicionar);
      window.visualViewport?.removeEventListener("scroll", reposicionar);
      document.removeEventListener("keydown", tecla);
      document.removeEventListener("pointerdown", fora);
    };
  }, [aberto, posicionar]);

  const paragrafos = texto === undefined ? [] : Array.isArray(texto) ? texto : [texto];
  const links = link === undefined ? [] : Array.isArray(link) ? link : [link];
  const icone = gatilho === undefined;

  return (
    <span
      ref={caixa}
      className={`relative inline-flex align-middle ${icone ? "-my-1" : ""}`}
      // Só o mouse abre ao passar: no toque, quem abre e fecha é o próprio toque (alternar).
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        cancelarSaida();
        despachar({ tipo: "entrou" });
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        cancelarSaida();
        saida.current = setTimeout(() => despachar({ tipo: "saiu" }), ESPERA_AO_SAIR_MS);
      }}
      onFocus={() => despachar({ tipo: "focou" })}
      onBlur={(e) => {
        if (!caixa.current?.contains(e.relatedTarget as Node | null)) despachar({ tipo: "desfocou" });
      }}
    >
      <button
        ref={botao}
        type="button"
        aria-label={rotulo}
        aria-expanded={aberto}
        aria-controls={idBalao}
        aria-describedby={idBalao}
        onClick={() => despachar({ tipo: "alternar" })}
        className={
          classeGatilho ??
          (icone
            ? `grid size-6 shrink-0 cursor-help place-items-center rounded-full text-muted transition-colors hover:text-accent-ink aria-expanded:text-accent-ink ${foco}`
            : `cursor-help rounded-sm text-left underline decoration-muted decoration-dotted underline-offset-4 hover:decoration-accent-ink aria-expanded:decoration-accent-ink ${foco}`)
        }
      >
        {icone ? (
          <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <circle cx="8" cy="8" r="6.25" />
            <path d="M8 7.25v3.5" />
            <circle cx="8" cy="5" r="0.4" fill="currentColor" />
          </svg>
        ) : (
          gatilho
        )}
      </button>
      <span
        ref={balao}
        id={idBalao}
        role={links.length ? undefined : "tooltip"}
        hidden={!aberto}
        className="group fixed top-0 left-0 z-50 block w-[calc(100vw-2rem)] sm:w-80 rounded-xl border border-line bg-surface px-3.5 py-3 text-left text-sm leading-relaxed font-normal tracking-normal text-fg normal-case shadow-lg shadow-black/10 animate-[explicacao-aparece_120ms_ease-out] motion-reduce:animate-none"
      >
        <span ref={seta} aria-hidden="true" className="absolute block size-2.5 rotate-45 border-line bg-surface group-data-[lado=baixo]:border-t group-data-[lado=baixo]:border-l group-data-[lado=cima]:border-r group-data-[lado=cima]:border-b" />
        <span ref={conteudo} className="relative flex flex-col gap-1.5 overflow-y-auto">
          {titulo && <span className="block font-semibold">{titulo}</span>}
          {paragrafos.map((p) => (
            <span key={p} className="block text-muted">
              {p}
            </span>
          ))}
          {lista && lista.length > 0 && (
            <span role="list" className="flex flex-col gap-1 text-muted">
              {lista.map((item, i) => (
                <span role="listitem" key={item} className="flex gap-2">
                  <span aria-hidden="true" className="shrink-0 tabular-nums">
                    {ordenada ? `${i + 1}.` : "•"}
                  </span>
                  <span>{item}</span>
                </span>
              ))}
            </span>
          )}
          {children && <span className="block text-muted">{children}</span>}
          {links.map((l) =>
            l.href.startsWith("/") ? (
              <Link key={l.href} href={l.href} onClick={() => despachar({ tipo: "fora" })} className={`w-fit rounded-sm font-medium text-accent-ink underline underline-offset-2 ${foco}`}>
                {l.texto}
              </Link>
            ) : (
              <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className={`w-fit rounded-sm font-medium text-accent-ink underline underline-offset-2 ${foco}`}>
                {l.texto} ↗
              </a>
            ),
          )}
        </span>
      </span>
    </span>
  );
}

// Explicação de um termo do glossário (CNPJ, CNAE, Simples Nacional, MEI, anexo, Fator R…), com o rótulo "O que é…?".
// O nome acessível precisa conter o texto visível (WCAG 2.5.3): com um gatilho de texto que não está na pergunta, o
// rótulo vira "<gatilho>: <pergunta>", ex.: gatilho "DARF do INSS", rótulo "DARF do INSS: o que é o INSS do pró-labore?".
// rotulo: só para trocar esse padrão.
export function ExplicacaoDoTermo({ termo, gatilho, rotulo }: { termo: Termo; gatilho?: ReactNode; rotulo?: string }) {
  const { titulo, texto, lista } = GLOSSARIO[termo];
  return <Explicacao rotulo={rotulo ?? rotuloDoTermo(titulo, gatilho)} titulo={titulo} texto={texto} lista={lista} gatilho={gatilho} />;
}

export const rotuloDoTermo = (titulo: string, gatilho?: ReactNode) =>
  typeof gatilho === "string" && !titulo.toLowerCase().includes(gatilho.toLowerCase())
    ? `${gatilho}: ${titulo.charAt(0).toLowerCase()}${titulo.slice(1)}`
    : titulo;
