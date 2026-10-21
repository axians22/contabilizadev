import Link from "next/link";
import type { ReactNode } from "react";
import { brl, dataBr, pct } from "@contabilizadev/nucleo/formato";
import { rotuloMes, somarMeses, vencimento } from "@contabilizadev/nucleo/meses";
import { centavos } from "@contabilizadev/nucleo/simples";
import { Explicacao, ExplicacaoDoTermo } from "@/app/explicacao";
import { TERMO_DO_TRIBUTO } from "@/lib/empresas/glossario";
import { Bloco, Botao, CabecalhoMes, Cartao, botaoLink, rotulo } from "@/app/ui";
import type { SituacaoFiscal } from "@/lib/historico/leitura";
import type { ResumoDoMes } from "@/lib/painel/resumo";
import type { BaseDoMes } from "@/lib/rotina/base";
import type { GuiaDoMes } from "@/lib/rotina/guias";
import { avisoDaSituacao, type Situacao } from "@/lib/termo/situacao";
import { FuncoesDoPainel } from "./funcoes-do-painel";
import { GuiasDoMes, guiaExiste, situacaoNoPainel } from "./guias-do-mes";
import type { EstadoDaAcao } from "./roteiro/acoes";
import { LancarReceita } from "./roteiro/componentes";
import { SituacaoFiscalDoPainel } from "./situacao-fiscal";

// Painel do mês (página inicial), no desenho do painel do ../fiscal (app/page.tsx), bloco a bloco e na mesma ordem: o
// cabeçalho do mês com as setas, as faixas de aviso, a situação fiscal, o destaque com o total a pagar (verde; vermelho
// se venceu), a receita do mês e dos 12 meses, o cartão de lançar com as guias do mês, e os cartões "Guias do mês" e
// "Alíquota". Diferenças do ../fiscal: tudo da empresa ativa, explicações no tooltip, sem o fornecedor, o modo guiado sem
// a autorização, e sem repetir o que o sino já mostra: a declaração anual (DEFIS) fica só no sino (aviso defis:<ano>).
// Só apresentação: os dados chegam prontos da página (page.tsx), que lê o banco.

export type DadosDoPainel = {
  empresaId: string;
  base: BaseDoMes;
  resumo: ResumoDoMes;
  ultimo: string; // o último mês que dá para lançar (o anterior ao atual)
  das: GuiaDoMes;
  inss: GuiaDoMes;
  situacaoFiscal: SituacaoFiscal;
  pendencias: string[]; // os títulos das pendências, em linguagem simples
  mesesComGuia: string[]; // meses com guia vencida que resolve uma pendência
  autorizada: boolean;
  termo: Situacao;
};

export type AcoesDoPainel = {
  lancar: (anterior: EstadoDaAcao, dados: FormData) => Promise<EstadoDaAcao>;
  remover: (dados: FormData) => Promise<void>;
  gerar: (anterior: EstadoDaAcao, dados: FormData) => Promise<EstadoDaAcao>;
};

const linha = "flex items-baseline justify-between gap-4 border-t border-line py-3 first:border-t-0";

// Faixa de aviso do ../fiscal (sem autorização, histórico incompleto): o título, uma frase curta, o tooltip e a ação.
function Faixa({ acao, children }: { acao: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warn/25 bg-warn-soft px-5 py-3.5">
      <p className="flex min-w-0 flex-1 basis-80 items-start gap-3 text-sm leading-relaxed">
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-warn" aria-hidden="true" />
        <span>{children}</span>
      </p>
      {acao}
    </div>
  );
}

const corDaParte = (i: number, inss: boolean, vencido: boolean) =>
  inss ? "bg-white/40" : vencido ? ["bg-red-400", "bg-red-400/65", "bg-red-400/35"][i] ?? "bg-red-400/20" : ["bg-accent", "bg-accent/65", "bg-accent/35"][i] ?? "bg-accent/20";

export function PainelDoMes({ dados, acoes }: { dados: DadosDoPainel; acoes: AcoesDoPainel }) {
  const { base, resumo: r, das, inss } = dados;
  const pa = base.pa;
  const a = r.apuracao;
  const lancavel = pa <= dados.ultimo;
  const declarada = base.receitaDeclarada !== null;
  const liberadoEm = dataBr(`${somarMeses(pa, 1)}-01`);
  // Só conta a guia que existe (como no ../fiscal, vencidaNoMes): sem nada lançado nem declarado, não há o que pagar.
  const receitaLancada = base.lancamentos.length > 0;
  // O DARF conta com o pró-labore informado aqui ou quando a guia já existe (a DCTFWeb transmitida): a mesma regra das
  // guias abaixo e do sino (guiasVencidas), para a tela nunca dizer "Total a pagar" com um DARF vencido embaixo.
  const inssExiste = guiaExiste(inss, receitaLancada);
  const comInss = r.inss !== null || inssExiste;
  // O valor do DARF: o calculado com o pró-labore ou, sem ele, o da guia (gerada aqui); null = guia sem valor conhecido.
  const valorInss = r.inss ?? (inssExiste ? (inss.original?.total ?? inss.declarado ?? null) : null);
  const total = r.inss !== null ? r.total : centavos(r.total + (valorInss ?? 0));
  // Alguma guia do mês passou do vencimento sem pagamento: o destaque fica vermelho.
  const guias = comInss ? [das, inss] : [das];
  const vencidas = lancavel ? guias.filter((g) => situacaoNoPainel(g, base.hoje, receitaLancada) === "vencido") : [];
  const vencido = vencidas.length > 0;
  // As guias aparecem com receita lançada ou declarada e também quando alguma já existe sem ela (o DARF da DCTFWeb
  // transmitida num mês sem receita): o destaque vermelho e a faixa da situação fiscal levam a #guias, que tem de existir.
  const mostrarGuias = lancavel && (receitaLancada || declarada || [das, inss].some((g) => guiaExiste(g, receitaLancada)));
  // Empresa com pendência e a guia deste mês vencida na tela: a faixa leva a ela (nunca "nenhuma guia vencida").
  const mesesComGuia =
    dados.situacaoFiscal.atual?.regular === false && vencido ? [...new Set([...dados.mesesComGuia, base.pa])].sort() : dados.mesesComGuia;
  // A guia com multa e juros só sai depois da declaração (DAS) ou da DCTFWeb (DARF): sem ela, o passo que falta vem antes.
  const semDeclaracao = vencidas.some((g) => g.referencia === null);
  const abertas = guias.filter((g) => !g.paga);
  const prazo = abertas.length ? abertas.map((g) => g.vencimento).sort()[0] : vencimento(pa);
  const partesDoTotal = r.inss === null && valorInss !== null ? [...r.partes, { nome: "DARF do INSS", valor: valorInss, tributo: "inss" as const }] : r.partes;
  const partes = partesDoTotal.map((p, i) => ({ ...p, cor: corDaParte(i, p.tributo === "inss", vencido) }));
  // O DAS que a Receita tem para o mês (gerado aqui ou o da declaração importada), para comparar com o cálculo.
  const emitido = das.original?.total ?? das.declarado ?? null;

  return (
    <>
      <CabecalhoMes mes={pa} rota="/" sobre="Apuração" rotuloAtual="Último mês" />

      {/* Termo vencido ou recusado já tem o aviso no sino (avisoDoTermo, "Assinar de novo"): a faixa fica só para quem
          nunca assinou, que não tem aviso lá. */}
      {!dados.autorizada && avisoDaSituacao(dados.termo) === null && (
        <Faixa acao={<Link className={botaoLink} href="/autorizacao">Autorizar</Link>}>
          <b className="font-semibold text-warn">Modo guiado.</b> Sem a autorização em dia, você faz no portal com os valores daqui.{" "}
          <Explicacao
            rotulo="O que muda sem a autorização?"
            texto={[
              "A plataforma calcula tudo e mostra o caminho no portal da Receita Federal; a declaração, as guias e as consultas são feitas por você lá.",
              "Com a autorização (o termo assinado com o e-CNPJ da empresa), tudo é feito aqui, sempre com a sua confirmação.",
            ]}
          />
        </Faixa>
      )}

      {r.mesesSemReceita.length > 0 && (
        <Faixa acao={<Link className={botaoLink} href="/historico">Completar o histórico</Link>}>
          <b className="font-semibold text-warn">Histórico incompleto.</b> Faltam receitas em {r.mesesSemReceita.length} dos 12 meses anteriores.{" "}
          <Explicacao
            rotulo="Por que o histórico incompleto muda o imposto?"
            texto={[
              `Sem receita conhecida em: ${r.mesesSemReceita.map(rotuloMes).join(", ")}. Esses meses contam como zero, então a alíquota abaixo está subestimada.`,
              "Com a autorização, as declarações vêm da Receita Federal (aba Histórico). Sem ela, lance a receita desses meses mudando o mês no topo da página.",
            ]}
          />
        </Faixa>
      )}

      <SituacaoFiscalDoPainel situacao={dados.situacaoFiscal} pendencias={dados.pendencias} mesesComGuia={mesesComGuia} automatica={dados.autorizada} />

      <section
        aria-label="Total a pagar"
        className={`relative overflow-hidden rounded-3xl bg-linear-to-br px-6 py-7 text-white sm:px-9 sm:py-9 ${vencido ? "from-hero-vencido to-hero-vencido-deep" : "from-hero to-hero-deep"}`}
      >
        <div className={`pointer-events-none absolute -top-32 -right-24 size-96 rounded-full blur-3xl ${vencido ? "bg-red-500/25" : "bg-accent/25"}`} aria-hidden="true" />
        <div className="relative flex flex-col gap-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-white/60">{vencido ? `Venceu em ${dataBr(prazo)} e não foi pago` : `Total a pagar até ${dataBr(prazo)}`}</span>
              <b className={`text-5xl font-semibold tracking-tighter tabular-nums sm:text-7xl ${vencido ? "text-red-300" : "text-accent"}`}>{a ? brl(total) : "—"}</b>
              {vencido && (
                <span className="text-sm text-white/70">
                  {semDeclaracao ? "Sem multa e juros. Declare o mês e gere as guias atualizadas abaixo." : "Sem multa e juros. Gere as guias atualizadas abaixo."}
                </span>
              )}
              {!a && (
                <span className="text-sm text-white/70">
                  {r.erro}{" "}
                  <Link href="/empresa" className="font-medium text-white underline underline-offset-2">
                    Dados da empresa
                  </Link>
                </span>
              )}
            </div>
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium ${vencido ? "border-red-300/30 bg-red-500/15 text-red-200" : "border-white/15 bg-white/5"}`}
            >
              <span className={`size-1.5 rounded-full ${vencido ? "bg-red-400" : r.receita !== null ? "bg-accent" : "bg-white/50"}`} aria-hidden="true" />
              {vencido ? "Vencido" : r.receita !== null ? "Calculado" : "Previsão"}
            </span>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex h-2.5 gap-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
              {total > 0 && partes.map((p) => <span key={p.nome} className={`rounded-full ${p.cor}`} style={{ width: `${(p.valor / total) * 100}%` }} />)}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              {partes.map((p) => (
                <div key={p.nome} className="flex flex-col gap-1">
                  <dt className="flex items-center gap-2 text-sm text-white/60">
                    <span className={`size-2 rounded-full ${p.cor}`} aria-hidden="true" />
                    <ExplicacaoDoTermo termo={TERMO_DO_TRIBUTO[p.tributo]} gatilho={p.nome} />
                  </dt>
                  <dd className="text-lg font-medium tabular-nums">{brl(p.valor)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <section aria-label="Receita" className="grid gap-3 sm:grid-cols-2">
        {r.receita !== null ? (
          <Bloco
            rotulo="Recebido no banco"
            explicacao={
              <Explicacao
                rotulo="De onde vem a receita do mês?"
                texto={
                  base.receitaLancada !== null
                    ? "O imposto usa o valor em reais que caiu na conta da empresa no Brasil pelo trabalho deste mês, lançado aqui."
                    : declarada
                      ? "O valor já declarado na Receita Federal (PGDAS-D) para este mês."
                      : "Você marcou que não houve receita neste mês: a declaração vai com receita zero."
                }
              />
            }
          >
            {brl(r.receita)}
          </Bloco>
        ) : (
          <div className="flex min-w-0 flex-col gap-2 rounded-2xl border border-dashed border-muted/60 bg-raised/40 px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`${rotulo} flex items-center gap-1`}>
                Recebido no banco
                <Explicacao
                  rotulo="Como a previsão é calculada?"
                  texto="Estimativa pela média das últimas três receitas conhecidas. Não é um valor recebido: lance a receita do mês para calcular o imposto de verdade."
                />
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-0.5 text-xs font-semibold text-warn">
                <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="8" cy="8" r="6" />
                  <path d="M8 4.5V8l2.5 1.5" />
                </svg>
                Previsão
              </span>
            </div>
            <b className="text-lg font-semibold tracking-tight text-muted tabular-nums sm:text-2xl">~ {brl(r.previsao ?? 0)}</b>
          </div>
        )}
        <Bloco
          rotulo="Receita em 12 meses"
          explicacao={<Explicacao rotulo="O que é a receita em 12 meses?" texto="A receita bruta dos 12 meses anteriores (RBT12): ela define a faixa e a alíquota do Simples." />}
        >
          {a ? brl(a.rbt12.valor) : "—"}
        </Bloco>
      </section>

      <Cartao className="flex flex-col gap-4 px-6 py-5">
        <div className="flex flex-col gap-1">
          <h2 className={`${rotulo} flex items-center gap-1`}>
            {declarada ? rotuloMes(pa) : `Lançar ${rotuloMes(pa)}`}
            <Explicacao
              rotulo={`Como lançar a receita de ${rotuloMes(pa)}?`}
              texto={[
                "Depois de trabalhar e receber, lance o valor que caiu na conta da empresa no Brasil pelo trabalho deste mês. Em moeda estrangeira, convertemos pela PTAX de compra do dia (ou use o valor em reais do extrato).",
                "Não houve receita, precisa retificar um mês declarado ou informar o pró-labore? Tudo isso fica na rotina do mês (aba Roteiro).",
              ]}
            />
          </h2>
          <span className="text-sm text-muted">
            {!lancavel
              ? `${rotuloMes(pa).replace(/^./, (l) => l.toUpperCase())} ainda está em andamento. O botão de lançar é liberado em ${liberadoEm}.`
              : declarada
                ? `Já declarado na Receita Federal com ${brl(base.receitaDeclarada ?? 0)}. Não há nada a lançar.`
                : base.semReceita
                  ? "Marcado como mês sem receita."
                  : "Lance o valor em reais que caiu na conta pelo trabalho deste mês."}
          </span>
        </div>
        {/* Como no ../fiscal: o mesmo formulário de lançar; com o mês em andamento, os campos já aparecem e o botão fica
            desligado até o mês acabar (a ação no servidor também recusa). */}
        {!declarada && <LancarReceita acao={acoes.lancar} empresaId={dados.empresaId} pa={pa} hoje={base.hoje} liberadoEm={lancavel ? undefined : liberadoEm} />}
        {base.lancamentos.length > 0 && (
          <ul className="flex flex-col text-sm">
            {base.lancamentos.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-2.5">
                <span>
                  <b className="font-semibold tabular-nums">{brl(l.valorBrl)}</b>
                  <span className="text-muted">
                    {l.moeda !== "BRL" ? ` · ${l.moeda} ${l.valorMoeda.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : ""} · caiu em {dataBr(l.recebidaEm)}
                  </span>
                </span>
                <form action={acoes.remover}>
                  <input type="hidden" name="empresaId" value={dados.empresaId} />
                  <input type="hidden" name="id" value={l.id} />
                  <Botao leve>Remover</Botao>
                </form>
              </li>
            ))}
          </ul>
        )}
        {mostrarGuias && (
          <GuiasDoMes
            das={das}
            inss={inss}
            dasCalculado={a && r.receita !== null ? a.das.total : null}
            inssCalculado={r.inss}
            hoje={base.hoje}
            receitaLancada={receitaLancada}
            autorizada={dados.autorizada}
            empresaId={dados.empresaId}
            gerar={acoes.gerar}
          />
        )}
      </Cartao>

      <section aria-label="Guias e alíquota" className="grid gap-3 md:grid-cols-2">
        <Cartao className="px-6 py-5">
          <h2 className={rotulo}>Guias do mês</h2>
          <div className="mt-2 flex flex-col">
            <div className={linha}>
              <span>DAS {r.receita !== null ? "calculado" : "previsto"}</span>
              <b className="font-semibold tabular-nums">{r.das !== null ? brl(r.das) : "—"}</b>
            </div>
            <div className={linha}>
              <span>
                DARF do INSS{" "}
                <Explicacao
                  rotulo="O que são os 11% do INSS?"
                  texto={[
                    "O sócio contribui com 11% do pró-labore para o INSS (como contribuinte individual), até o teto da Previdência. O valor é descontado do pró-labore e pago no DARF gerado pela DCTFWeb.",
                    "A parte da empresa (CPP) não entra aqui: nos Anexos III e V ela já vai dentro do DAS.",
                  ]}
                />{" "}
                <span className="text-muted">
                  · {base.prolabore !== null ? `11% de ${brl(base.prolabore)}` : inssExiste ? (vencidas.includes(inss) ? "vencido" : "guia da DCTFWeb") : "pró-labore não informado"}
                </span>
              </span>
              <b className={`font-semibold tabular-nums ${vencidas.includes(inss) ? "text-bad" : ""}`}>{valorInss !== null ? brl(valorInss) : "—"}</b>
            </div>
            <div className={linha}>
              <span className="font-semibold">Total</span>
              <b className="text-xl font-semibold tracking-tight text-accent-ink tabular-nums">{a ? brl(total) : "—"}</b>
            </div>
          </div>
          {emitido !== null && r.das !== null && r.receita !== null && (
            <p className={`mt-3 rounded-xl bg-raised px-3.5 py-2.5 text-sm ${Math.abs(emitido - r.das) < 0.005 ? "text-accent-ink" : "text-bad"}`}>
              DAS {das.original?.total != null ? "emitido" : "declarado"}: {brl(emitido)}. Diferença para o cálculo: {brl(r.das - emitido)}.
            </p>
          )}
        </Cartao>

        <Cartao className="px-6 py-5">
          <h2 className={rotulo}>Alíquota</h2>
          {a && r.faixa ? (
            <>
              <div className="mt-4 flex items-baseline justify-between gap-4">
                <b className="text-4xl font-semibold tracking-tight tabular-nums">{pct(a.das.aliquotaPaga)}</b>
                <span className="flex items-center gap-1 text-sm text-muted">
                  paga na exportação
                  <Explicacao
                    rotulo="O que é a alíquota paga na exportação?"
                    texto={[
                      `É o percentual da receita do mês que vai para o DAS: ${pct(a.das.aliquotaPaga)}.`,
                      `Sai da alíquota efetiva da tabela (${pct(a.das.aliquotaEfetiva)}) sem os tributos que não são cobrados na exportação de serviços: ISS, PIS e COFINS (LC 123/2006, art. 18, § 14). Ficam IRPJ, CSLL e CPP.`,
                    ]}
                  />
                </span>
              </div>
              <div className="mt-5 flex gap-1" aria-hidden="true">
                {r.faixa.limites.map((ate, i) => (
                  <span key={ate} className="h-2 flex-1 overflow-hidden rounded-full bg-raised">
                    <span
                      className="block h-full rounded-full bg-accent-ink"
                      style={{ width: `${i + 1 < r.faixa!.numero ? 100 : i + 1 === r.faixa!.numero ? Math.max(4, r.faixa!.naFaixa * 100) : 0}%` }}
                    />
                  </span>
                ))}
              </div>
              <p className="mt-2.5 flex flex-wrap items-center gap-1 text-sm text-muted">
                Faixa {r.faixa.numero} de {r.faixa.limites.length} do Anexo {r.faixa.anexo}, até {brl(r.faixa.teto)} em 12 meses.
                <Explicacao
                  rotulo="O que é a faixa?"
                  texto={[
                    `Cada anexo do Simples tem ${r.faixa.limites.length} faixas, escolhidas pela receita dos últimos 12 meses (RBT12). Quanto maior a receita, maior a faixa e a alíquota.`,
                    `A barra mostra quanto da faixa ${r.faixa.numero} já foi usado; passando de ${brl(r.faixa.teto)} em 12 meses, a empresa sobe de faixa.`,
                  ]}
                />
              </p>
              <div className="mt-3 flex flex-col">
                <div className={`${linha} first:border-t`}>
                  <span className="flex items-center gap-1">
                    Alíquota efetiva da tabela
                    <Explicacao
                      rotulo="O que é a alíquota efetiva?"
                      texto={[
                        `É a alíquota cheia da faixa, calculada pela fórmula do Simples: (receita de 12 meses × alíquota nominal − parcela a deduzir) ÷ receita de 12 meses (LC 123/2006, art. 18, § 1º-A).`,
                        `A alíquota nominal da faixa ${r.faixa.numero} é ${pct(a.das.aliquotaNominal)}; com a dedução, a efetiva fica em ${pct(a.das.aliquotaEfetiva)}. Na exportação, parte dela não é cobrada (veja a alíquota paga).`,
                      ]}
                    />
                  </span>
                  <b className="font-semibold tabular-nums">{pct(a.das.aliquotaEfetiva)}</b>
                </div>
                {a.fatorR && (
                  <div className={linha}>
                    <span className="flex items-center gap-1">
                      Fator R
                      <Explicacao
                        rotulo="O que é o Fator R?"
                        texto={`A folha (pró-labore e encargos) dividida pela receita dos 12 meses: ${brl(a.fatorR.folha)} ÷ ${brl(a.fatorR.receita)}. Com 28% ou mais, a empresa fica no Anexo III; abaixo, no Anexo V, mais caro.`}
                      />
                    </span>
                    <b className="font-semibold tabular-nums">{pct(a.fatorR.valor)}</b>
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="mt-4 text-sm text-muted">—</p>
          )}
        </Cartao>
      </section>

      {!dados.autorizada && <FuncoesDoPainel ligado={false} situacao={dados.termo} />}
    </>
  );
}
