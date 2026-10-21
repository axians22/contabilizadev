"use client";

import { lazy, Suspense } from "react";
import { Explicacao, ExplicacaoDoTermo } from "@/app/explicacao";
import { Cartao } from "@/app/ui";
import type { EstadoEnvio } from "@/app/(painel)/autorizacao/acoes";
import { AssinarTermo, AutorizacaoConcluida } from "@/app/(painel)/autorizacao/assinar-termo";
import { PROPRIA_SEM_TERMO } from "@/lib/termo/mensagens";
import { vistaDaAutorizacao, type EstadoAssistente } from "@/lib/empresas/assistente";

// 7. Autorização: o mesmo fluxo da página Autorização (requisitos, certificado e senha, texto oficial, assinar no
// navegador e enviar), com os mesmos componentes e a mesma ação do servidor. O texto oficial do termo é carregado sob
// demanda, só quando o cliente abre o certificado (é quando ele aparece), junto com o código da assinatura.
const TextoOficial = lazy(() => import("@/app/(painel)/autorizacao/texto-oficial").then((m) => ({ default: m.TextoOficial })));

export function EtapaAutorizacao({
  estado,
  enviar,
  aoConcluir,
  aoMudarEnvio,
}: {
  estado: EstadoAssistente;
  enviar: (empresaId: string, xml: string) => Promise<EstadoEnvio>;
  aoConcluir: (validaAte: string) => void;
  aoMudarEnvio: (enviando: boolean) => void;
}) {
  const a = estado.autorizacao;
  switch (vistaDaAutorizacao(estado)) {
    case "carregando":
      return (
        <p role="status" className="text-sm text-muted">
          Preparando a autorização…
        </p>
      );
    case "concluida":
      return <AutorizacaoConcluida validaAte={estado.autorizadaAte ?? ""} />;
    case "propria":
      return (
        <p className="text-sm leading-relaxed">
          Esta é a empresa da própria plataforma: já está autorizada, sem termo.{" "}
          <Explicacao
            rotulo="Por que esta empresa não precisa de termo?"
            texto={PROPRIA_SEM_TERMO}
          />
        </p>
      );
    case "indisponivel":
      return (
        <>
          <Cartao className="border-warn/40 bg-warn-soft px-5 py-4 text-sm">{a?.tipo === "indisponivel" ? a.mensagem : null}</Cartao>
          <p className="text-sm leading-relaxed">
            A empresa já está cadastrada e funciona no modo guiado.{" "}
            <Explicacao rotulo="O que é o modo guiado?" texto="Sem a autorização, calculamos e mostramos o que lançar no portal da Receita Federal. Dá para autorizar depois, pela página Autorização." />
          </p>
        </>
      );
    case "assinar":
      if (a?.tipo !== "assinar" || !estado.empresaId) return null;
      return (
        <>
          <p className="text-sm leading-relaxed">
            Opcional: com a autorização, declarações e guias são feitas aqui mesmo, sempre com a sua confirmação. <ExplicacaoDoTermo termo="termo" />
          </p>
          <AssinarTermo
            empresaId={estado.empresaId}
            parametros={a.parametros}
            textoOficial={
              <Suspense fallback={<p className="text-sm text-muted">Carregando o texto oficial do termo…</p>}>
                <TextoOficial contratante={a.parametros.contratante} empresa={a.parametros.empresa} />
              </Suspense>
            }
            enviar={enviar}
            aoConcluir={aoConcluir}
            aoMudarEnvio={aoMudarEnvio}
          />
        </>
      );
  }
}
