import { brl, dataBr } from "@contabilizadev/nucleo/formato";
import { rotuloMes } from "@contabilizadev/nucleo/meses";
import { Explicacao } from "@/app/explicacao";
import { Cartao } from "@/app/ui";
import type { GuiaDoMes } from "@/lib/rotina/guias";
import type { DebitoDaPendencia, PendenciaExplicada } from "@/lib/situacao/pendencias";
import type { EstadoDaAcao } from "../roteiro/acoes";
import { GuiaAqui } from "../roteiro/guia-aqui";

type Acao = (anterior: EstadoDaAcao, dados: FormData) => Promise<EstadoDaAcao>;

const NOME_DO_TRIBUTO = { DAS: "DAS do Simples", INSS: "INSS do pró-labore", outro: "Tributo" } as const;

// Uma linha curta para o débito: o tributo, o mês e o saldo; o texto do relatório fica no tooltip.
export function rotuloDoDebito(d: DebitoDaPendencia): string {
  const partes = [`${NOME_DO_TRIBUTO[d.tributo]}${d.pa ? ` de ${rotuloMes(d.pa)}` : ""}`];
  if (d.vencimento) partes.push(`venceu em ${dataBr(d.vencimento)}`);
  if (d.saldo !== null) partes.push(brl(d.saldo));
  return partes.join(" · ");
}

// A guia vencida da plataforma que resolve este débito (mesmo tributo e mês), se houver.
export const guiaDoDebito = (d: DebitoDaPendencia, vencidas: GuiaDoMes[]) => (d.tributo === "outro" || !d.pa ? undefined : vencidas.find((g) => g.tipo === d.tributo && g.pa === d.pa));

// As pendências do relatório em linguagem simples: o título curto de cada uma (o que é e o que fazer no tooltip) e os
// débitos; débito de DAS ou de INSS do pró-labore com a guia vencida da rotina do mês vem com o botão de gerar a guia
// nova com multa e juros para a data escolhida (Parte 6, GuiaAqui). Sem autorização, o caminho fica no tooltip.
export function PendenciasExplicadas({
  pendencias,
  vencidas,
  empresaId,
  autorizada,
  gerar,
}: {
  pendencias: PendenciaExplicada[];
  vencidas: GuiaDoMes[];
  empresaId: string;
  autorizada: boolean;
  gerar: Acao;
}) {
  if (pendencias.length === 0) return null;
  return (
    <section id="pendencias" className="flex scroll-mt-24 flex-col gap-3" aria-label="Pendências">
      <h2 className="text-xl font-semibold tracking-tight">Pendências</h2>
      {pendencias.map((p, i) => (
        <Cartao key={`${p.cabecalho}-${i}`} className="flex flex-col gap-3 border-bad/40 px-5 py-4 text-sm">
          <div className="flex flex-wrap items-center gap-1">
            <b className="font-semibold text-bad">{p.titulo}</b>
            <Explicacao rotulo={`O que é "${p.titulo}" e o que fazer?`} texto={[p.oQueE, p.oQueFazer, `No relatório da Receita Federal: ${p.cabecalho}`]} />
          </div>
          {p.debitos.length > 0 && (
            <ul className="flex flex-col gap-3">
              {p.debitos.map((d, j) => {
                const guia = autorizada ? guiaDoDebito(d, vencidas) : undefined;
                return (
                  <li key={`${d.linha}-${j}`} className="flex flex-col gap-2">
                    <span className="flex flex-wrap items-center gap-1">
                      {rotuloDoDebito(d)}
                      <Explicacao rotulo={`Como aparece no relatório: ${rotuloDoDebito(d)}?`} texto={d.linha} />
                    </span>
                    {guia && <GuiaAqui guia={guia} campos={{ empresaId, pa: guia.pa }} rotulo="Gerar" gerar={gerar} />}
                  </li>
                );
              })}
            </ul>
          )}
        </Cartao>
      ))}
    </section>
  );
}
