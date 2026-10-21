import Link from "next/link";
import { brl, dataBr } from "@contabilizadev/nucleo/formato";
import { prazoDefis } from "@contabilizadev/nucleo/serpro/defis";
import { Explicacao } from "@/app/explicacao";
import { Cartao } from "@/app/ui";
import { explicacaoDoLimiteIsento } from "@/lib/defis/limite";
import { declaracaoDevida, entregaDaDeclaracaoAnual, explicacaoDoPrazo, type SituacaoDaDeclaracaoAnual } from "@/lib/defis/prazo";
import type { ResumoDoAno } from "@/lib/defis/resumo";

const ESTADO = {
  entregue: { texto: "Entregue", cor: "bg-accent text-on-accent", borda: "" },
  "na-epoca": { texto: "A entregar", cor: "bg-warn-soft text-warn", borda: "" },
  atrasada: { texto: "Atrasada", cor: "bg-bad text-white", borda: "border-bad/50" },
  "a-conferir": { texto: "Não conferida", cor: "bg-raised text-muted", borda: "" },
  "nao-devida": { texto: "Não devida", cor: "bg-raised text-muted", borda: "" },
} as const;

// A declaração anual do ano que fechou (aba Declaração anual e painel): entregue, a entregar (com o prazo), atrasada ou
// ainda não conferida na Receita, ou não devida (a empresa entrou no Simples depois do ano). O prazo, a multa e o que muda na virada do ano ficam no tooltip.
export function CartaoDaDeclaracaoAnual({ s, comLink = false }: { s: SituacaoDaDeclaracaoAnual; comLink?: boolean }) {
  const e = ESTADO[s.estado];
  const quando = s.dias === 0 ? "vence hoje" : s.dias === 1 ? "vence amanhã" : s.dias > 0 ? `vence em ${s.dias} dias` : `venceu em ${dataBr(s.prazo)}`;
  return (
    <Cartao className={`flex flex-col gap-2 px-5 py-4 text-sm ${e.borda}`}>
      <span className="text-xs font-medium tracking-wide text-muted uppercase">Declaração anual de {s.ano}</span>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex h-7 items-center rounded-full px-3 text-sm font-semibold ${e.cor}`}>{e.texto}</span>
        <Explicacao rotulo={`Qual é o prazo da declaração anual de ${s.ano}?`} texto={explicacaoDoPrazo(s.ano)} />
      </div>
      <span className="text-muted">
        {s.estado === "nao-devida" && s.inicio
          ? `A empresa está no Simples desde ${dataBr(s.inicio)}.`
          : s.estado === "entregue"
            ? `Prazo era ${dataBr(s.prazo)}.`
            : `Prazo: ${dataBr(s.prazo)} (${quando}).`}
      </span>
      {comLink && (
        <Link href="/defis" className="font-medium underline underline-offset-2">
          Ver a declaração anual
        </Link>
      )}
    </Cartao>
  );
}

const linha = "flex items-baseline justify-between gap-4 border-t border-line py-2.5 first:border-t-0";

// Os valores do ano que a plataforma já sabe, prontos para lançar no portal. O limite do lucro isento sem contabilidade
// tem a conta inteira no tooltip.
export function ValoresDoAno({ ano, r }: { ano: number; r: ResumoDoAno }) {
  return (
    <Cartao className="flex flex-col px-5 py-2 text-sm">
      <div className={linha}>
        <span className="text-muted">Receita bruta do ano</span>
        <b className="font-semibold tabular-nums">{brl(r.receita)}</b>
      </div>
      <div className={linha}>
        <span className="text-muted">Pró-labore do sócio (rendimento tributável)</span>
        <b className="font-semibold tabular-nums">{brl(r.proLabore)}</b>
      </div>
      <div className={linha}>
        <span className="text-muted">INSS descontado do pró-labore</span>
        <b className="font-semibold tabular-nums">{brl(r.inss)}</b>
      </div>
      <div className={linha}>
        <span className="text-muted">DAS do ano</span>
        <b className="font-semibold tabular-nums">{brl(r.das)}</b>
      </div>
      <div className={linha}>
        <span className="flex items-center gap-1 text-muted">
          Limite de lucro isento sem contabilidade
          <Explicacao
            rotulo="O que é o limite de lucro isento sem contabilidade?"
            titulo="Limite de lucro isento"
            texto={explicacaoDoLimiteIsento(ano, r)}
          />
        </span>
        <b className="font-semibold tabular-nums">{brl(r.limiteLucroIsento)}</b>
      </div>
    </Cartao>
  );
}

// O quadro vermelho da DEFIS que a Receita não tem: só quando foi consultada depois do prazo e não estava entregue
// (entregaDaDeclaracaoAnual === false). Consultada antes do prazo (por exemplo, pelo Atualizar em fevereiro), ainda não
// é atraso: nada aparece, e o cartão do ano mostra "A entregar".
export function DefisNaoEncontrada({ ano, registro, inicio }: { ano: number; registro: { situacao: string; consultadaEm: Date } | null | undefined; inicio: string | null }) {
  if (entregaDaDeclaracaoAnual(ano, registro) !== false || !declaracaoDevida(ano, inicio)) return null;
  return (
    <Cartao className="border-bad/40 px-5 py-4 text-sm">
      <b className="font-semibold text-bad">DEFIS de {ano} não encontrada.</b> O prazo era {dataBr(prazoDefis(ano))}.{" "}
      <Explicacao
        rotulo={`O que fazer sem a DEFIS de ${ano}?`}
        texto={[
          "A Receita Federal não tem DEFIS entregue para esse ano. Entregue no Portal do Simples Nacional o quanto antes: o atraso tem multa.",
          "Se você já entregou, use Atualizar para consultar de novo.",
        ]}
      />
    </Cartao>
  );
}
