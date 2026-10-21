"use client";

import { useRouter } from "next/navigation";
import { useActionState, useId, useRef, useState } from "react";
import { apagarGuardados, EXPLICACAO_APAGAR, useGuardado } from "@/app/assinador/guardados";
import { Explicacao } from "@/app/explicacao";
import { cnpjConfere, formatarCnpj } from "@/lib/empresas/cnpj";
import type { PapelNaEmpresa } from "@/banco/esquema";
import type { EstadoRemocao } from "./acoes";

const foco = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink";
const botaoPerigo = `inline-flex h-10 cursor-pointer items-center rounded-full bg-bad px-5 text-sm font-semibold whitespace-nowrap text-bg transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100 ${foco}`;
const botaoNeutro = `inline-flex h-10 cursor-pointer items-center rounded-full border border-line bg-surface px-5 text-sm font-medium whitespace-nowrap transition-colors hover:border-muted ${foco}`;

type Remover = (anterior: EstadoRemocao, dados: FormData) => Promise<EstadoRemocao>;

// A ação do formulário: primeiro o servidor remove; só com o { ok } dele apaga o certificado guardado (se a caixa ficou
// marcada) e volta para Dados da empresa com a confirmação curta. Com { erro }, nada é apagado.
export function acaoDeRemover(
  remover: Remover,
  cnpj: string,
  { apagar, navegar }: { apagar: (cnpjs: string[]) => Promise<void>; navegar: (url: string) => void },
): Remover {
  return async (anterior, dados) => {
    const resultado = await remover(anterior, dados);
    if (resultado?.ok) {
      if (dados.get("apagarCertificado") === "on") await apagar([cnpj]);
      navegar("/empresa?removida=1");
    }
    return resultado;
  };
}

// Seção discreta no fim de Dados da empresa: só o DONO vê (e o servidor confere de novo na ação). A confirmação é uma
// caixa de diálogo modal (<dialog>, com foco preso, Esc fecha) que pede o CNPJ digitado para liberar o botão. Com o
// certificado da empresa guardado neste navegador (app/assinador), a caixa oferece apagá-lo junto (marcado): só o
// navegador pode apagar, então é apagado aqui, e só depois de o servidor confirmar a remoção ({ ok }): se ela falhar,
// a empresa continua e o certificado também. Tudo roda dentro da ação do useActionState, para o `pendente` valer até o fim.
export function RemoverEmpresa({
  empresa,
  remover,
}: {
  empresa: { id: string; cnpj: string; razaoSocial: string; papel: PapelNaEmpresa };
  remover: Remover;
}) {
  const router = useRouter();
  const [estado, executar, pendente] = useActionState(
    acaoDeRemover(remover, empresa.cnpj, { apagar: apagarGuardados, navegar: (url) => router.replace(url) }),
    undefined,
  );
  const [digitado, setDigitado] = useState("");
  const temGuardado = useGuardado(empresa.cnpj);
  const [apagarCertificado, setApagarCertificado] = useState(true);
  const dialogo = useRef<HTMLDialogElement>(null);
  const abrir = useRef<HTMLButtonElement>(null);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  if (empresa.papel !== "DONO") return null;

  const cnpj = formatarCnpj(empresa.cnpj);
  const confere = cnpjConfere(digitado, empresa.cnpj);
  const fechar = () => dialogo.current?.close();

  return (
    <section aria-labelledby={`remover-${id}`} className="mt-4 flex flex-col items-start gap-2 border-t border-line pt-6">
      <h2 id={`remover-${id}`} className="flex items-center gap-1 text-sm font-semibold">
        Remover empresa
        <Explicacao
          rotulo="O que acontece ao remover a empresa?"
          titulo="Remover empresa"
          texto={[
            "Apaga a empresa e tudo o que a plataforma guarda dela: os dados consultados na Receita Federal, o termo de autorização assinado e o acesso de todos os usuários desta empresa. Não dá para desfazer.",
            "Nada é apagado nem cancelado na Receita Federal: os dados da empresa continuam lá. A plataforma só deixa de usar o termo de autorização e apaga a cópia que guardava dele.",
            "Só o dono vê esta opção. Depois de remover, a empresa pode ser cadastrada de novo pelo CNPJ.",
          ]}
        />
      </h2>
      <p className="text-xs text-muted">Apaga a empresa e os dados dela da plataforma.</p>
      <button
        ref={abrir}
        type="button"
        onClick={() => dialogo.current?.showModal()}
        className={`inline-flex h-8 cursor-pointer items-center rounded-full px-2.5 text-sm font-medium text-bad transition-colors hover:bg-raised ${foco}`}
      >
        Remover empresa…
      </button>

      <dialog
        ref={dialogo}
        aria-labelledby={`remover-titulo-${id}`}
        aria-describedby={`remover-texto-${id}`}
        onClose={() => {
          setDigitado("");
          abrir.current?.focus();
        }}
        className="m-auto w-[calc(100vw-2rem)] max-w-md rounded-2xl border border-line bg-surface p-6 text-fg shadow-xl backdrop:bg-black/40"
      >
        <form action={executar} className="flex flex-col gap-4">
          <input type="hidden" name="empresaId" value={empresa.id} />
          <h2 id={`remover-titulo-${id}`} className="text-lg font-semibold tracking-tight">
            Remover {empresa.razaoSocial}?
          </h2>
          <p id={`remover-texto-${id}`} className="text-sm text-muted">
            Isso apaga a empresa e todos os dados dela na plataforma, para todos os usuários. Não dá para desfazer.
          </p>
          <label htmlFor={`remover-cnpj-${id}`} className="flex flex-col gap-1.5 text-sm font-medium text-muted">
            <span>
              Digite o CNPJ <b className="font-semibold text-fg tabular-nums">{cnpj}</b> para confirmar
            </span>
            <input
              id={`remover-cnpj-${id}`}
              name="cnpj"
              value={digitado}
              onChange={(e) => setDigitado(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              inputMode="text"
              aria-invalid={estado?.erro ? true : undefined}
              className={`h-10 max-w-full rounded-xl border border-line bg-surface px-3 font-normal text-fg tabular-nums transition-colors hover:border-muted focus-visible:border-accent-ink ${foco}`}
            />
          </label>
          {temGuardado && (
            <span className="flex items-center gap-2 text-sm">
              <input
                id={`remover-certificado-${id}`}
                type="checkbox"
                name="apagarCertificado"
                checked={apagarCertificado}
                onChange={(e) => setApagarCertificado(e.target.checked)}
                className="size-4 shrink-0 cursor-pointer accent-accent-ink"
              />
              <label htmlFor={`remover-certificado-${id}`} className="cursor-pointer">
                Apagar também o certificado guardado neste navegador
              </label>
              <Explicacao rotulo="Por que apagar o certificado guardado neste navegador?" texto={EXPLICACAO_APAGAR} />
            </span>
          )}
          <span role="alert" className="text-sm text-bad empty:hidden">
            {estado?.erro ?? ""}
          </span>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={fechar} className={botaoNeutro}>
              Cancelar
            </button>
            <button type="submit" disabled={!confere || pendente || estado?.ok} className={botaoPerigo}>
              {pendente || estado?.ok ? "Removendo…" : "Remover definitivamente"}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
