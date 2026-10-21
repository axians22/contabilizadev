"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatarCnpj } from "@contabilizadev/nucleo/formato";
import { Explicacao } from "@/app/explicacao";
import { cofreDoNavegador } from "@/lib/assinador/cofre";

// Os certificados guardados neste navegador (os CNPJs), para oferecer apagar ao remover a empresa e ao sair da conta.
// Só o navegador sabe o que guardou: o servidor não tem como apagar (nem ver) a chave.
export async function cnpjsGuardados(): Promise<string[]> {
  try {
    return await cofreDoNavegador().cnpjs();
  } catch {
    return [];
  }
}

export async function apagarGuardados(cnpjs: string[]): Promise<void> {
  const cofre = cofreDoNavegador();
  for (const cnpj of cnpjs) {
    try {
      await cofre.remover(cnpj);
    } catch {
      // Cofre inacessível: não há o que apagar.
    }
  }
}

export function useGuardado(cnpj: string): boolean {
  const [tem, setTem] = useState(false);
  useEffect(() => {
    let vivo = true;
    void cnpjsGuardados().then((lista) => vivo && setTem(lista.includes(cnpj)));
    return () => {
      vivo = false;
    };
  }, [cnpj]);
  return tem;
}

export const EXPLICACAO_APAGAR = [
  "O certificado guardado para assinar fica só neste navegador: a plataforma não tem cópia e não consegue apagá-lo daqui.",
  "Apague se outras pessoas usam este computador. Para assinar de novo, é só informar o arquivo e a senha.",
];

const foco = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink";
const botaoPerigo = `inline-flex h-10 cursor-pointer items-center rounded-full bg-bad px-5 text-sm font-semibold whitespace-nowrap text-bg transition hover:brightness-95 ${foco}`;
const botaoNeutro = `inline-flex h-10 cursor-pointer items-center rounded-full border border-line bg-surface px-5 text-sm font-medium whitespace-nowrap transition-colors hover:border-muted ${foco}`;

// Ao sair da conta: com certificado guardado neste navegador, pergunta antes se apaga (padrão do botão: apagar).
// `sair` envia o formulário de saída.
export function OfertaAoSair({ cnpjs, sair, cancelar }: { cnpjs: string[]; sair: () => void; cancelar: () => void }) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [apagando, setApagando] = useState(false);
  const saindo = useRef(false); // fechar a caixa para sair não é cancelar
  useEffect(() => {
    if (!dialogo.current?.open) dialogo.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialogo}
      aria-labelledby={`sair-titulo-${id}`}
      onClose={() => !saindo.current && cancelar()}
      className="m-auto w-[calc(100vw-2rem)] max-w-md rounded-2xl border border-line bg-surface p-6 text-fg shadow-xl backdrop:bg-black/40"
    >
      <div className="flex flex-col gap-4">
        <h2 id={`sair-titulo-${id}`} className="flex items-center gap-1 text-lg font-semibold tracking-tight">
          Apagar o certificado guardado neste navegador?
          <Explicacao rotulo="Por que apagar o certificado guardado ao sair?" texto={EXPLICACAO_APAGAR} />
        </h2>
        <ul className="text-sm text-muted tabular-nums">
          {cnpjs.map((c) => (
            <li key={c}>CNPJ {formatarCnpj(c)}</li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => dialogo.current?.close()} className={botaoNeutro} disabled={apagando}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => {
              saindo.current = true;
              dialogo.current?.close();
              sair();
            }}
            className={botaoNeutro}
            disabled={apagando}
          >
            Sair e manter
          </button>
          <button
            type="button"
            onClick={async () => {
              saindo.current = true;
              setApagando(true);
              await apagarGuardados(cnpjs);
              dialogo.current?.close();
              sair();
            }}
            className={botaoPerigo}
            disabled={apagando}
          >
            {apagando ? "Apagando…" : "Apagar e sair"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
