import { brl, dataBr } from "@contabilizadev/nucleo/formato";
import { Explicacao } from "@/app/explicacao";
import { Cartao, botaoPrimario } from "@/app/ui";
import { enderecoDoDocumento } from "@/lib/historico/documentos";
import { botoesDaGuia, entradaDaGuia } from "@/lib/rotina/botoes-guia";
import type { GuiaDoMes } from "@/lib/rotina/guias";
import { BotoesDaGuia } from "../botoes-da-guia";
import type { EstadoDaAcao } from "./acoes";
import { BotaoDeAcao } from "./componentes";

export function situacaoDaGuia(g: GuiaDoMes): string {
  if (g.paga) return g.pagaEm ? `Paga em ${dataBr(g.pagaEm)}` : "Paga";
  if (g.vencida) return `Vencida em ${dataBr(g.vencimento)}`;
  if (g.original) return `Gerada · vence em ${dataBr(g.vencimento)}`;
  return "Pendente";
}

// A guia do mês feita aqui (rotina do mês e aba Guias): gerar (ou abrir a gerada) e, vencida e sem pagamento, a guia
// atualizada com multa e juros para o dia escolhido (dia útil de hoje até o fim do mês).
export function GuiaAqui({
  guia,
  campos,
  rotulo,
  gerar,
  autorizada = true,
}: {
  guia: GuiaDoMes;
  campos: Record<string, string>;
  rotulo: string;
  gerar: (anterior: EstadoDaAcao, dados: FormData) => Promise<EstadoDaAcao>;
  autorizada?: boolean;
}) {
  const nome = guia.tipo === "DAS" ? "DAS" : "DARF do INSS";
  // Os mesmos botões do painel (abrir em nova aba e Baixar), para a guia guardada ou, paga fora daqui, o comprovante.
  const botoes = (situacao: "pago" | "aberto" | "vencido") => <BotoesDaGuia botoes={botoesDaGuia(entradaDaGuia(guia, situacao, autorizada))} nome={nome} destaque={situacao === "aberto"} />;
  if (!guia.referencia) {
    return <p className="text-sm text-muted">{guia.tipo === "DAS" ? "Liberado depois da declaração do mês." : "Liberado com a DCTFWeb transmitida."}</p>;
  }
  if (guia.paga)
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-accent-ink">{`${nome} pago${guia.pagaEm ? ` em ${dataBr(guia.pagaEm)}` : ""}.`}</span>
        {botoes("pago")}
      </div>
    );
  const campoGuia = { ...campos, pa: guia.pa, tipo: guia.tipo };
  return (
    <div className="flex flex-col gap-3">
      {guia.original ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <b className="text-lg font-semibold tabular-nums">{guia.original.total !== null ? brl(guia.original.total) : nome}</b>
          {botoes(guia.vencida ? "vencido" : "aberto")}
          <span className="text-muted">{`vence em ${dataBr(guia.vencimento)}`}</span>
        </div>
      ) : (
        guia.vencida ? (
          // Vencida sem a original guardada (mês declarado fora): o botão "Guia original" leva ao portal, motivo no tooltip.
          <div className="flex flex-wrap items-center gap-3 text-sm">{botoes("vencido")}</div>
        ) : (
          <BotaoDeAcao acao={gerar} campos={campoGuia} rotulo={rotulo} pendente="Gerando…" />
        )
      )}
      {guia.vencida && (
        <Cartao className="flex flex-col gap-3 border-bad/30 bg-bad/5 px-4 py-3">
          {guia.atualizada ? (
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-semibold text-bad">{`Guia atualizada para pagar até ${dataBr(guia.atualizada.pagarEm!)}`}</span>
              {guia.atualizada.total !== null && <b className="text-2xl font-semibold tracking-tight tabular-nums">{brl(guia.atualizada.total)}</b>}
              {guia.atualizada.principal !== null && guia.atualizada.multa !== null && guia.atualizada.juros !== null && (
                <span className="text-muted">{`${brl(guia.atualizada.principal)} + multa ${brl(guia.atualizada.multa)} + juros ${brl(guia.atualizada.juros)}`}</span>
              )}
              <a className={`${botaoPrimario} w-fit`} href={enderecoDoDocumento("guia", guia.atualizada.id)} target="_blank" rel="noopener">
                Abrir a guia atualizada
              </a>
            </div>
          ) : (
            <span className="text-sm">
              <b className="font-semibold text-bad">Passou do vencimento.</b> Gere a guia com multa e juros para o dia em que vai pagar.{" "}
              <Explicacao
                rotulo={`Por que gerar outra guia do ${nome} de ${guia.pa.slice(5)}/${guia.pa.slice(0, 4)}?`}
                texto={[
                  "Depois do vencimento a guia original não vale mais: a nova traz o valor com multa e juros até a data de pagamento escolhida.",
                  "A Receita Federal só aceita dia útil, de hoje até o fim do mês. Pague até a data da guia; depois dela, gere outra (multa e juros mudam a cada dia).",
                ]}
              />
            </span>
          )}
          <BotaoDeAcao acao={gerar} campos={campoGuia} rotulo={guia.atualizada ? "Gerar para outra data" : "Gerar com multa e juros"} pendente="Gerando…" leve={Boolean(guia.atualizada)}>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              Vou pagar em
              <input type="date" name="pagarEm" required defaultValue={guia.pagarEmSugerido} className="h-9 rounded-xl border border-line bg-surface px-3 text-sm text-fg" />
            </label>
          </BotaoDeAcao>
        </Cartao>
      )}
    </div>
  );
}
