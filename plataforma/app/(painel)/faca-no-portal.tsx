import Link from "next/link";
import type { ReactNode } from "react";
import { Explicacao } from "@/app/explicacao";
import { Cartao } from "@/app/ui";
import { CAMINHOS, motivoGuiado, type Funcao } from "@/lib/termo/guiado";
import { liberada, type Situacao } from "@/lib/termo/situacao";

// Modo guiado (reutilizável pelas próximas partes; ver lib/termo/guiado.ts): enquanto não há autorização em dia (sem
// termo de autorização, vencido ou recusado), mostra o caminho para fazer no portal. Sem estado: serve a páginas do
// servidor e a componentes do navegador.

// Aviso "faça no portal": o motivo, o passo a passo, o link do portal oficial e, em `children`, os valores que a
// plataforma calculou para o cliente lançar lá. `situacaoNaTela`: a página já mostra a situação do termo (o cartão da
// autorização), então o motivo (o mesmo para todas as funções) não se repete aqui.
// O que não depende do termo (o eSocial, Parte 7) passa o próprio `motivo`, a explicação do modo e o `rodape` (ex.: "Já
// lancei no portal") no lugar do atalho para a autorização. `modoExplicado`: uma lista de vários (o painel) já explica o
// modo guiado uma vez no título; cada item não repete o mesmo tooltip.
export function FacaNoPortal({
  funcao,
  situacao,
  situacaoNaTela = false,
  modoExplicado = false,
  motivo,
  explicacao,
  rodape,
  children,
}: {
  funcao: Funcao;
  situacao?: Situacao;
  situacaoNaTela?: boolean;
  modoExplicado?: boolean;
  motivo?: ReactNode;
  explicacao?: string;
  rodape?: ReactNode;
  children?: ReactNode;
}) {
  const caminho = CAMINHOS[funcao];
  const modoGuiado = modoExplicado ? null : (
    <Explicacao
      rotulo="O que é o modo guiado?"
      texto={explicacao ?? `Enquanto a empresa não tem autorização em dia, você mesmo faz no ${caminho.portal.nome}; a plataforma calcula e mostra o que lançar.`}
    />
  );
  return (
    <Cartao className="flex flex-col gap-3 border-warn/40 bg-warn-soft px-5 py-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-6 items-center rounded-full bg-warn px-2.5 text-xs font-semibold text-bg">Faça no portal</span>
        <b className="font-semibold">{caminho.nome}</b>
        {situacaoNaTela && modoGuiado}
      </div>
      {!situacaoNaTela && (
        <p className="text-muted">
          {motivo ?? (situacao ? motivoGuiado(situacao) : null)} {modoGuiado}
        </p>
      )}
      {children}
      <ol className="flex list-decimal flex-col gap-1 pl-5 leading-relaxed">
        {caminho.passos.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <a href={caminho.portal.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-ink underline underline-offset-2">
          Abrir o {caminho.portal.nome} ↗
        </a>
        {rodape ?? (
          <span className="text-muted">
            Disponível aqui depois da autorização:{" "}
            <Link href="/autorizacao" className="underline underline-offset-2 hover:text-fg">
              Autorizar
            </Link>
          </span>
        )}
      </div>
    </Cartao>
  );
}

// Mostra `children` (o que a plataforma faz sozinha) com a autorização em dia; senão, o aviso do modo guiado.
export function SeAutomatico({ funcao, situacao, children, guiado }: { funcao: Funcao; situacao: Situacao; children: ReactNode; guiado?: ReactNode }) {
  return liberada(situacao) ? (
    <>{children}</>
  ) : (
    <FacaNoPortal funcao={funcao} situacao={situacao}>
      {guiado}
    </FacaNoPortal>
  );
}
