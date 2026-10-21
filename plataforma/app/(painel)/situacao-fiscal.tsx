import Link from "next/link";
import { dataBr } from "@contabilizadev/nucleo/formato";
import { rotuloMes } from "@contabilizadev/nucleo/meses";
import { Explicacao } from "@/app/explicacao";
import { botaoLink, botaoPrimario } from "@/app/ui";
import { enderecoDoDocumento } from "@/lib/historico/documentos";
import type { SituacaoFiscal } from "@/lib/historico/leitura";
import { hojeNoBrasil, proximaSituacao } from "@/lib/historico/prazos";

// Faixa da situação fiscal no painel (a do ../fiscal, app/situacao-fiscal.tsx): a empresa está regular com a Receita
// Federal e a Procuradoria da Fazenda? Verde se regular, vermelha com pendências (os títulos em linguagem simples) e o
// botão de gerar as novas guias com multa e juros de cada mês com guia vencida que resolve uma pendência. Vem do último
// relatório guardado (só banco). `automatica`: com a autorização em dia, a consulta é refeita sozinha a cada 2 meses.
export function SituacaoFiscalDoPainel({
  situacao,
  pendencias,
  mesesComGuia,
  automatica,
}: {
  situacao: SituacaoFiscal;
  pendencias: string[];
  mesesComGuia: string[];
  automatica: boolean;
}) {
  const atual = situacao.atual;
  const estilo =
    atual?.regular === true
      ? { caixa: "border-accent-ink/30 bg-accent/15", ponto: "bg-accent-ink", texto: "text-accent-ink", titulo: "Empresa regular" }
      : atual?.regular === false
        ? { caixa: "border-bad/40 bg-bad/10", ponto: "bg-bad", texto: "text-bad", titulo: "Empresa com pendências" }
        : { caixa: "border-line bg-surface", ponto: "bg-muted", texto: "text-muted", titulo: atual ? "Situação não identificada" : "Situação fiscal ainda não verificada" };
  const proxima = atual && automatica ? proximaSituacao(atual.prontoEm) : null;
  const rodape = atual
    ? `Verificada em ${dataBr(hojeNoBrasil(atual.prontoEm))}`
    : situacao.processando
      ? "Consultando a Receita Federal…"
      : automatica
        ? "A primeira verificação acontece sozinha em instantes"
        : "Sem a autorização, consulte no e-CAC";

  return (
    <section aria-label="Situação fiscal" className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border px-5 py-4 ${estilo.caixa}`}>
      <div className="flex min-w-0 flex-1 basis-80 items-start gap-3">
        <span className={`grid size-9 shrink-0 place-items-center rounded-full ${estilo.ponto} text-bg`} aria-hidden="true">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            {atual?.regular === true ? <path d="m5 12.5 4.5 4.5L19 7.5" /> : atual?.regular === false ? <path d="M12 7v6M12 17h.01" /> : <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01" />}
          </svg>
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1 text-xs font-medium tracking-wide text-muted uppercase">
            Situação fiscal · Receita e PGFN
            <Explicacao
              rotulo="O que é a situação fiscal?"
              texto={[
                "É o relatório da Receita Federal com as pendências da empresa na Receita e na Procuradoria-Geral da Fazenda Nacional (PGFN), o mesmo que a certidão negativa considera.",
                atual?.regular === false
                  ? "Com pendências, a empresa não consegue a certidão negativa e pode ser excluída do Simples. Em Detalhes, cada pendência explicada e o que fazer."
                  : automatica
                    ? "Consultada sozinha a cada 2 meses; em Detalhes dá para atualizar agora."
                    : "Sem a autorização, a consulta é feita por você no e-CAC; em Detalhes, o caminho.",
              ]}
            />
          </span>
          <b className={`text-lg font-semibold tracking-tight ${estilo.texto}`}>{estilo.titulo}</b>
          {pendencias.slice(0, 4).map((p) => (
            <span key={p} className="text-sm break-words">
              {p}
            </span>
          ))}
          <span className="text-sm text-muted">
            {rodape}
            {proxima ? ` · próxima em ${dataBr(proxima)}` : ""}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {mesesComGuia.map((m) => (
          <Link key={m} className={botaoPrimario} href={`/?mes=${m}#guias`}>
            Gerar novas guias{mesesComGuia.length > 1 ? ` · ${rotuloMes(m)}` : ""}
          </Link>
        ))}
        {atual?.regular === false && mesesComGuia.length === 0 && <span className="self-center text-sm text-muted">Nenhuma guia vencida aqui: veja os detalhes.</span>}
        {atual?.temPdf && (
          <a className={botaoLink} href={enderecoDoDocumento("situacao", atual.id)} target="_blank" rel="noopener">
            Ver relatório
          </a>
        )}
        <Link className={botaoLink} href="/situacao">
          Detalhes
        </Link>
      </div>
    </section>
  );
}
