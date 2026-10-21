"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { entrarComGoogleAcao } from "@/app/entrar/acoes";

// O que o Google Identity Services expõe em window.
type JanelaComGoogle = {
  google?: {
    accounts: {
      id: {
        initialize: (o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: "popup"; context?: "signin" }) => void;
        renderButton: (alvo: HTMLElement, o: Record<string, string | number>) => void;
      };
    };
  };
};

const SCRIPT_GOOGLE = "https://accounts.google.com/gsi/client";
let carregamento: Promise<void> | null = null;

// Injeta o script do Google uma vez só. Script clássico (e não import()): é o que o Google publica, e uma falha
// de rede pode ser tentada de novo.
function carregarScript(): Promise<void> {
  if (carregamento) return carregamento;
  carregamento = new Promise<void>((ok, falha) => {
    if ((window as unknown as JanelaComGoogle).google) return ok();
    const s = document.createElement("script");
    s.src = SCRIPT_GOOGLE;
    s.async = true;
    s.onload = () => ok();
    s.onerror = () => {
      s.remove();
      carregamento = null;
      falha(new Error("Não foi possível carregar o login do Google."));
    };
    document.head.appendChild(s);
  });
  return carregamento;
}

// Botão "Fazer login com o Google" (portado do horizons). Aqui o botão é o oficial (renderButton): numa tela só
// de login ele cabe bem e funciona mesmo quando o navegador bloqueia o One Tap. O ID token vai para a server
// action, que confere no servidor e grava o cookie httpOnly; nada de token no localStorage.
export function BotaoGoogle({ clientId, de }: { clientId: string; de: string }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, iniciar] = useTransition();

  useEffect(() => {
    let cancelado = false;
    carregarScript()
      .then(() => {
        const g = (window as unknown as JanelaComGoogle).google;
        if (cancelado || !g || !caixa.current) return;
        g.accounts.id.initialize({
          client_id: clientId,
          ux_mode: "popup",
          context: "signin",
          callback: ({ credential }) =>
            iniciar(async () => {
              setErro(null);
              const r = await entrarComGoogleAcao(credential, de);
              if (r?.erro) setErro(r.erro);
            }),
        });
        const escuro = window.matchMedia("(prefers-color-scheme: dark)").matches;
        g.accounts.id.renderButton(caixa.current, {
          type: "standard",
          theme: escuro ? "filled_black" : "outline",
          size: "large",
          shape: "pill",
          text: "signin_with",
          locale: "pt-BR",
          width: 280,
        });
      })
      .catch((e: Error) => !cancelado && setErro(e.message));
    return () => {
      cancelado = true;
    };
  }, [clientId, de]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div ref={caixa} className={`min-h-11 ${entrando ? "pointer-events-none opacity-50" : ""}`} aria-busy={entrando} />
      {entrando && <span className="text-sm text-muted">Entrando…</span>}
      {erro && (
        <span role="alert" className="text-center text-sm text-bad">
          {erro}
        </span>
      )}
    </div>
  );
}
