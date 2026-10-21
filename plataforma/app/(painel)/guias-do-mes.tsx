import Link from "next/link";
import { brl, dataBr } from "@contabilizadev/nucleo/formato";
import { Explicacao, ExplicacaoDoTermo } from "@/app/explicacao";
import { Check, botaoLink, botaoPrimario, rotulo } from "@/app/ui";
import { enderecoDoDocumento } from "@/lib/historico/documentos";
import { botoesDaGuia, entradaDaGuia, valorDaGuia } from "@/lib/rotina/botoes-guia";
import type { GuiaDoMes } from "@/lib/rotina/guias";
import { BotoesDaGuia } from "./botoes-da-guia";
import type { EstadoDaAcao } from "./roteiro/acoes";
import { BotaoDeAcao } from "./roteiro/componentes";

// Guias do mês no painel (as do ../fiscal, app/botoes-guias.tsx e app/guia-vencida.tsx): a situação em destaque (pago, em
// aberto, vencido) e o próximo passo. Os botões da guia (abrir em nova aba e Baixar; botoes-da-guia.tsx) aparecem quando
// já foi gerada aqui e também quando o mês foi feito fora da plataforma: ao clicar, a guia (ou, paga, o comprovante) é
// buscada na Receita uma vez e fica guardada. Sem a declaração (DAS) ou a DCTFWeb (DARF), leva ao passo da rotina do mês
// que falta. Vencida e sem pagamento, a guia nova com multa e juros para o dia escolhido. Sem a autorização em dia, os
// botões levam ao portal (os passos no tooltip).

type Gerar = (anterior: EstadoDaAcao, dados: FormData) => Promise<EstadoDaAcao>;
type Situacao = "pago" | "aberto" | "vencido" | "a-informar";

const ESTILO: Record<Situacao, { texto: string; pilula: string; borda: string }> = {
  pago: { texto: "Pago", pilula: "bg-accent text-on-accent", borda: "border-accent-ink/40" },
  aberto: { texto: "Em aberto", pilula: "bg-warn-soft text-warn", borda: "border-line" },
  vencido: { texto: "Vencido", pilula: "bg-bad/15 text-bad", borda: "border-bad/50" },
  // DARF do INSS sem o pró-labore do mês informado aqui: não dá para dizer o valor nem se é devido.
  "a-informar": { texto: "A informar", pilula: "bg-raised text-muted", borda: "border-line" },
};

// A guia existe no mês? Como no ../fiscal (lib/guias-vencidas.ts, vencidaNoMes): gerada ou declarada (tem referência, a
// guia emitida ou o valor do extrato) ou, no DAS, com a receita lançada. Sem ela, passado o dia 20 o mês não fica vencido:
// não há guia a pagar, só o passo que falta (declarar ou enviar o pró-labore).
export const guiaExiste = (g: GuiaDoMes, receitaLancada: boolean) =>
  g.referencia !== null || g.original !== null || g.declarado != null || (g.tipo === "DAS" && receitaLancada);

export const situacaoNoPainel = (g: GuiaDoMes, hoje: string, receitaLancada: boolean): Situacao =>
  g.paga ? "pago" : hoje > g.vencimento && guiaExiste(g, receitaLancada) ? "vencido" : "aberto";

function Icone({ situacao }: { situacao: Situacao }) {
  if (situacao === "pago") return <Check />;
  if (situacao === "a-informar") return null;
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      {situacao === "vencido" ? <path d="M8 4v5M8 12h.01" /> : <path d="M8 4.5V8l2.5 1.5" />}
      {situacao === "aberto" && <circle cx="8" cy="8" r="6" />}
    </svg>
  );
}

// Vencida e sem pagamento: a guia atualizada já gerada (válida até a data escolhida) ou o pedido de uma nova.
function GuiaVencida({ guia, nome, campos, gerar }: { guia: GuiaDoMes; nome: string; campos: Record<string, string>; gerar: Gerar }) {
  const a = guia.atualizada;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-bad/30 bg-bad/5 px-4 py-3">
      {a ? (
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1 text-sm font-semibold text-bad">
            Guia atualizada para pagar até {dataBr(a.pagarEm!)}
            <Explicacao
              rotulo={`Até quando vale a guia atualizada do ${nome}?`}
              texto="Pague até essa data. Depois dela, gere outra: multa e juros mudam a cada dia."
            />
          </span>
          {a.total !== null && <b className="text-2xl font-semibold tracking-tight tabular-nums">{brl(a.total)}</b>}
          {a.principal !== null && a.multa !== null && a.juros !== null && (
            <span className="text-sm text-muted">
              {brl(a.principal)} + multa {brl(a.multa)} + juros {brl(a.juros)}
            </span>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <a className={botaoPrimario} href={enderecoDoDocumento("guia", a.id)} target="_blank" rel="noopener">
              Abrir guia atualizada
            </a>
            <a className={botaoLink} href={enderecoDoDocumento("guia", a.id)} download>
              Baixar
            </a>
          </div>
        </div>
      ) : (
        <span className="text-sm">
          <b className="font-semibold text-bad">Passou do vencimento.</b> Gere uma nova com multa e juros.{" "}
          <Explicacao
            rotulo={`Por que gerar outra guia do ${nome}?`}
            texto={[
              "Depois do vencimento a guia original não vale mais: a nova traz o valor com multa e juros até o dia em que você vai pagar.",
              "A Receita Federal só aceita dia útil, de hoje até o fim do mês.",
            ]}
          />
        </span>
      )}
      <BotaoDeAcao acao={gerar} campos={campos} rotulo={a ? "Gerar para outra data" : "Gerar guia com multa e juros"} pendente="Gerando…" leve={Boolean(a)}>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Vou pagar em
          <input type="date" name="pagarEm" required defaultValue={guia.pagarEmSugerido} className="h-9 rounded-xl border border-line bg-surface px-3 text-sm text-fg" />
        </label>
      </BotaoDeAcao>
    </div>
  );
}

function Guia(props: {
  nome: string;
  orgao: string;
  guia: GuiaDoMes;
  calculado: number | null;
  hoje: string;
  receitaLancada: boolean;
  autorizada: boolean;
  empresaId: string;
  gerar: Gerar;
  passo: number; // o passo da rotina do mês que gera esta guia
  pendente: { texto: string; passo: number }; // o que falta antes de gerar
  faltaInformar?: { texto: string; passo: number }; // sem o dado do mês (o pró-labore), nada a cobrar ainda
}) {
  const g = props.guia;
  const semDados = Boolean(props.faltaInformar) && !g.paga && !g.original && !g.referencia;
  const situacao: Situacao = semDados ? "a-informar" : situacaoNoPainel(g, props.hoje, props.receitaLancada);
  const estilo = ESTILO[situacao];
  const { valor, origem: de } = valorDaGuia(g, props.calculado);
  const origem = de === "declarado" ? " · valor declarado" : de === "pago" ? " · valor pago" : de === "calculado" ? " · valor calculado aqui" : "";
  const botoes = situacao === "a-informar" ? null : botoesDaGuia(entradaDaGuia(g, situacao, props.autorizada));
  const campos = { empresaId: props.empresaId, pa: g.pa, tipo: g.tipo };
  const rotina = (passo: number) => `/roteiro?mes=${g.pa}#passo-${passo}`;

  return (
    <div className={`flex flex-col gap-4 rounded-2xl border bg-surface px-5 py-4 ${estilo.borda}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <span className="font-semibold">
            <ExplicacaoDoTermo termo={props.guia.tipo === "DAS" ? "das" : "darf"} gatilho={props.nome} />
          </span>
          <span className="text-sm text-muted">{props.orgao}</span>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold ${estilo.pilula}`}>
          <Icone situacao={situacao} />
          {estilo.texto}
        </span>
      </div>

      <div className="flex flex-col">
        <b className="text-3xl font-semibold tracking-tight tabular-nums">{valor !== null ? brl(valor) : "—"}</b>
        <span className="text-sm text-muted">
          {situacao === "a-informar"
            ? "Pró-labore do mês não informado"
            : situacao === "pago"
              ? g.pagaEm
                ? `Pago em ${dataBr(g.pagaEm)}`
                : "Pago"
              : `${props.hoje > g.vencimento ? "Venceu" : "Vence"} em ${dataBr(g.vencimento)}`}
          {situacao === "a-informar" ? "" : origem}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {props.faltaInformar && semDados ? (
          <Link className={botaoLink} href={rotina(props.faltaInformar.passo)}>
            {props.faltaInformar.texto}
          </Link>
        ) : botoes ? (
          <BotoesDaGuia botoes={botoes} nome={props.nome === "DAS" ? "DAS" : "DARF do INSS"} destaque={situacao === "aberto"} />
        ) : situacao === "pago" ? null : !g.referencia ? (
          // Sem a declaração (ou a DCTFWeb) não há guia para gerar, nem a com multa e juros: o caminho é o passo que falta,
          // também depois do vencimento.
          <Link className={situacao === "vencido" ? botaoPrimario : botaoLink} href={rotina(props.pendente.passo)}>
            {props.pendente.texto}
          </Link>
        ) : null}
      </div>
      {situacao === "vencido" && g.referencia !== null && (props.autorizada ? (
        <GuiaVencida guia={g} nome={props.nome} campos={campos} gerar={props.gerar} />
      ) : (
        <span className="text-sm">
          <b className="font-semibold text-bad">Passou do vencimento.</b>{" "}
          <Link className="font-medium underline underline-offset-2" href={rotina(props.passo)}>
            Gerar a nova no portal
          </Link>
        </span>
      ))}
    </div>
  );
}

export function GuiasDoMes({
  das,
  inss,
  dasCalculado,
  inssCalculado,
  hoje,
  receitaLancada,
  autorizada,
  empresaId,
  gerar,
}: {
  das: GuiaDoMes;
  inss: GuiaDoMes;
  dasCalculado: number | null;
  inssCalculado: number | null;
  hoje: string;
  receitaLancada: boolean;
  autorizada: boolean;
  empresaId: string;
  gerar: Gerar;
}) {
  const comuns = { hoje, receitaLancada, autorizada, empresaId, gerar };
  return (
    <div id="guias" className="flex scroll-mt-24 flex-col gap-3">
      <span className={rotulo}>Guias deste mês</span>
      <div className="grid gap-3 sm:grid-cols-2">
        <Guia nome="DAS" orgao="Simples Nacional" guia={das} calculado={dasCalculado} passo={5} pendente={{ texto: "Declarar na rotina do mês", passo: 4 }} {...comuns} />
        <Guia
          nome="DARF"
          orgao="INSS do pró-labore"
          guia={inss}
          calculado={inssCalculado}
          passo={7}
          pendente={{ texto: "Enviar o pró-labore na rotina do mês", passo: 6 }}
          faltaInformar={inssCalculado === null ? { texto: "Informar o pró-labore", passo: 2 } : undefined}
          {...comuns}
        />
      </div>
    </div>
  );
}
