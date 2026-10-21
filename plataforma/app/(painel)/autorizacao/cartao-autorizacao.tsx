import Link from "next/link";
import { dataBr } from "@contabilizadev/nucleo/formato";
import { Explicacao } from "@/app/explicacao";
import { Cartao, botaoLink, botaoPrimario } from "@/app/ui";
import { PROPRIA_SEM_TERMO } from "@/lib/termo/mensagens";
import { avisoDaSituacao, type Situacao } from "@/lib/termo/situacao";

// Situação da autorização da empresa ativa (painel e página Autorização): ativa pelo termo de autorização (com a
// validade), perto de vencer, vencida, recusada, pendente (sem termo) ou ativa sem termo (a empresa da própria
// plataforma). Uma frase por estado; o que ela significa na prática vai para o tooltip.
const ROTULO: Record<Situacao["estado"], { texto: string; cor: string }> = {
  propria: { texto: "Autorização ativa", cor: "bg-accent text-on-accent" },
  vigente: { texto: "Autorização ativa", cor: "bg-accent text-on-accent" },
  vencendo: { texto: "Autorização ativa", cor: "bg-accent text-on-accent" },
  vencida: { texto: "Autorização vencida", cor: "bg-bad text-white" },
  recusada: { texto: "Autorização recusada", cor: "bg-bad text-white" },
  ausente: { texto: "Autorização pendente", cor: "bg-raised text-muted" },
};

const O_QUE_FAZ = "Declarações, guias e consultas à Receita Federal são feitas aqui, sempre com a sua confirmação.";
const GUIADO = "Enquanto isso, tudo continua no modo guiado: calculamos e mostramos o que lançar no portal.";

function Resumo({ situacao, indisponivel }: { situacao: Situacao; indisponivel: boolean }) {
  switch (situacao.estado) {
    case "propria":
      return (
        <span>
          Esta é a empresa da própria plataforma: já está autorizada, sem termo.{" "}
          <Explicacao
            rotulo="Por que esta empresa não precisa de termo?"
            texto={[PROPRIA_SEM_TERMO, O_QUE_FAZ]}
          />
        </span>
      );
    case "vigente":
    case "vencendo":
      return (
        <span>
          Autorização ativa até <b className="font-semibold">{dataBr(situacao.validaAte)}</b>.{" "}
          <Explicacao
            rotulo="O que a autorização permite?"
            texto={[
              O_QUE_FAZ,
              situacao.motivo === "certificado"
                ? "A data é a do fim da validade do certificado usado na assinatura: com o e-CNPJ renovado, assine o termo de novo."
                : "Antes de vencer, avisamos aqui e no sino para você assinar de novo.",
            ]}
          />
        </span>
      );
    case "vencida":
      return (
        <span>
          A autorização venceu em {dataBr(situacao.validaAte)}: assine de novo.{" "}
          <Explicacao rotulo="O que acontece com a autorização vencida?" texto={GUIADO} />
        </span>
      );
    case "recusada":
      return (
        <span>
          A Receita Federal recusou a autorização guardada: assine de novo.{" "}
          <Explicacao
            rotulo="Por que a Receita Federal recusou a autorização?"
            texto={["Acontece quando o certificado usado na assinatura foi revogado ou deixou de valer.", GUIADO]}
          />
        </span>
      );
    case "ausente":
      return (
        <span>
          {indisponivel ? "A assinatura da autorização ainda não está disponível." : "A empresa ainda não assinou o termo de autorização."}{" "}
          <Explicacao rotulo="O que é o modo guiado?" texto={GUIADO} />
        </span>
      );
  }
}

// indisponivel: a assinatura não está disponível nesta instalação (configuração incompleta); não é erro do cliente.
export function CartaoAutorizacao({ situacao, comLink, indisponivel = false }: { situacao: Situacao; comLink?: boolean; indisponivel?: boolean }) {
  const r = ROTULO[situacao.estado];
  const aviso = avisoDaSituacao(situacao);
  const ligado = situacao.estado === "propria" || situacao.estado === "vigente";
  return (
    <Cartao className={`flex flex-col gap-3 px-5 py-4 text-sm ${aviso?.nivel === "vencida" ? "border-bad/40" : aviso ? "border-warn/40" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={`inline-flex h-7 items-center rounded-full px-3 text-xs font-semibold ${r.cor}`}>{r.texto}</span>
        {comLink && situacao.estado !== "propria" && (
          <Link className={ligado ? botaoLink : botaoPrimario} href="/autorizacao">
            {ligado ? "Ver a autorização" : situacao.estado === "ausente" ? "Autorizar" : "Assinar de novo"}
          </Link>
        )}
      </div>
      <p className="leading-relaxed">
        <Resumo situacao={situacao} indisponivel={indisponivel} />
      </p>
      {/* Vencido ou recusado: o resumo já diz. Aqui, o "vence em breve". */}
      {aviso?.nivel === "vence" && <p className="font-medium text-warn">{aviso.titulo}.</p>}
    </Cartao>
  );
}
