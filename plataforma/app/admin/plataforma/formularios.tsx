"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { CampoArquivo } from "@/app/campo-arquivo";
import { Botao, Campo } from "@/app/ui";
import { ACEITA_PFX, CHAMADA_DO_PFX, EXTENSOES_PFX, TAMANHO_MAXIMO_PFX } from "@/lib/arquivo";
import type { Resultado } from "./acoes";

type Acao = (anterior: Resultado, dados: FormData) => Promise<Resultado>;

// O certificado guardado, já pronto para mostrar (datas e CNPJ formatados no servidor).
export type CertificadoMostrado = { titular: string; cnpj: string; emissor: string; validoAte: string; vencido: boolean; enviado: string };

// Mensagem da ação: erro (alerta) ou confirmação. Nada do que foi enviado volta para cá.
function Mensagem({ estado }: { estado: Resultado }) {
  if (!estado) return null;
  if ("erro" in estado)
    return (
      <p role="alert" className="text-sm text-bad">
        {estado.erro}
      </p>
    );
  return (
    <p role="status" className="text-sm text-accent-ink">
      {estado.ok}
    </p>
  );
}

// Depois de guardar, o formulário volta vazio (a senha e o secret não ficam no navegador).
function useLimparAoGuardar(estado: Resultado, aoGuardar?: (mensagem: string) => void) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (estado && "ok" in estado) {
      form.current?.reset();
      aoGuardar?.(estado.ok);
    }
    // Só quando chega uma resposta nova.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  return form;
}

// Um passo numerado: o número em destaque e o título, que é também o nome do campo do passo.
export function Passo({ numero, titulo, idTitulo, paraCampo, children }: { numero: number; titulo: string; idTitulo?: string; paraCampo?: string; children: ReactNode }) {
  const classe = "text-sm font-semibold text-fg";
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-on-accent tabular-nums">
        {numero}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
        {paraCampo ? (
          <label htmlFor={paraCampo} className={classe}>
            {titulo}
          </label>
        ) : (
          <span id={idTitulo} className={classe}>
            {titulo}
          </span>
        )}
        {children}
      </div>
    </li>
  );
}

// Envio do e-CNPJ A1 da plataforma em três passos curtos: o arquivo, a senha e o envio.
export function FormularioCertificado({ acao, trocar, aoCancelar, aoGuardar }: { acao: Acao; trocar: boolean; aoCancelar?: () => void; aoGuardar?: (mensagem: string) => void }) {
  const [estado, executar, pendente] = useActionState(acao, undefined);
  const form = useLimparAoGuardar(estado, aoGuardar);
  return (
    <form ref={form} action={executar} className="flex flex-col gap-4" autoComplete="off">
      <ol className="flex flex-col gap-5" aria-label="Como enviar o certificado">
        <Passo numero={1} titulo="Escolha o arquivo do e-CNPJ A1" idTitulo="arquivo-titulo">
          <CampoArquivo
            id="arquivo"
            name="arquivo"
            rotuloPor="arquivo-titulo"
            chamada={CHAMADA_DO_PFX}
            extensoes={EXTENSOES_PFX}
            accept={ACEITA_PFX}
            tamanhoMaximo={TAMANHO_MAXIMO_PFX}
            required
          />
        </Passo>
        <Passo numero={2} titulo="Digite a senha do certificado" paraCampo="senha">
          <input
            id="senha"
            name="senha"
            type="password"
            autoComplete="off"
            required
            className="h-10 w-full max-w-xs rounded-xl border border-line bg-surface px-3 text-fg transition-colors hover:border-muted focus-visible:border-accent-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
          />
        </Passo>
        <Passo numero={3} titulo={trocar ? "Envie o certificado novo" : "Envie o certificado"}>
          <div className="flex flex-wrap items-center gap-3">
            <Botao disabled={pendente}>{pendente ? "Conferindo…" : "Enviar certificado"}</Botao>
            {aoCancelar && (
              <Botao type="button" leve onClick={aoCancelar} disabled={pendente}>
                Cancelar
              </Botao>
            )}
          </div>
          <Mensagem estado={estado} />
        </Passo>
      </ol>
    </form>
  );
}

function Linha({ nome, children }: { nome: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">{nome}</dt>
      <dd className="text-sm font-medium break-words">{children}</dd>
    </div>
  );
}

// O cartão do certificado guardado (titular, CNPJ, emissor, validade) com "Trocar certificado".
export function CartaoDoCertificado({ certificado, aoTrocar }: { certificado: CertificadoMostrado; aoTrocar: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Linha nome="Titular">{certificado.titular}</Linha>
        <Linha nome="CNPJ">{certificado.cnpj}</Linha>
        <Linha nome="Emissor">{certificado.emissor || "—"}</Linha>
        <Linha nome="Válido até">
          <span className={certificado.vencido ? "text-bad" : ""}>
            {certificado.validoAte}
            {certificado.vencido ? " (vencido)" : ""}
          </span>
        </Linha>
        <Linha nome="Enviado">{certificado.enviado}</Linha>
      </dl>
      <div>
        <Botao type="button" onClick={aoTrocar}>
          Trocar certificado
        </Botao>
      </div>
    </div>
  );
}

// Com certificado guardado: o cartão, e "Trocar certificado" abre o mesmo formulário. Sem: o formulário direto.
export function CertificadoDaPlataforma({ acao, certificado }: { acao: Acao; certificado: CertificadoMostrado | null }) {
  const [trocando, setTrocando] = useState(false);
  const [guardou, setGuardou] = useState<string | null>(null);
  if (certificado && !trocando) {
    return (
      <div className="flex flex-col gap-3">
        <CartaoDoCertificado
          certificado={certificado}
          aoTrocar={() => {
            setGuardou(null);
            setTrocando(true);
          }}
        />
        {guardou && (
          <p role="status" className="text-sm text-accent-ink">
            {guardou}
          </p>
        )}
      </div>
    );
  }
  return (
    <FormularioCertificado
      acao={acao}
      trocar={Boolean(certificado)}
      aoCancelar={certificado ? () => setTrocando(false) : undefined}
      aoGuardar={(mensagem) => {
        setGuardou(mensagem);
        setTrocando(false);
      }}
    />
  );
}

export function FormularioChaves({ acao, trocar }: { acao: Acao; trocar: boolean }) {
  const [estado, executar, pendente] = useActionState(acao, undefined);
  const form = useLimparAoGuardar(estado);
  return (
    <form ref={form} action={executar} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Consumer key" id="consumerKey" name="consumerKey" autoComplete="off" spellCheck={false} required />
        <Campo rotulo="Consumer secret" id="consumerSecret" name="consumerSecret" type="password" autoComplete="off" required />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Botao disabled={pendente}>{pendente ? "Guardando…" : trocar ? "Trocar chaves" : "Guardar chaves"}</Botao>
        <Mensagem estado={estado} />
      </div>
    </form>
  );
}
