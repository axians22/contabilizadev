import Link from "next/link";
import type { ReactNode } from "react";
import { ATIVIDADES_PGDASD } from "@contabilizadev/nucleo/serpro/atividades-pgdasd";
import { brl, dataBr, pct } from "@contabilizadev/nucleo/formato";
import { rotuloMes } from "@contabilizadev/nucleo/meses";
import { nomeTributo, valoresDoDas, type Valores } from "@contabilizadev/nucleo/serpro/pgdasd";
import { inssProLaboreDoMes, tetoInss, tributosDoDas, type Tributo } from "@contabilizadev/nucleo/simples";
import { Explicacao, ExplicacaoDoTermo } from "@/app/explicacao";
import { TERMO_DO_TRIBUTO } from "@/lib/empresas/glossario";
import { Tabela } from "@/app/tabela";
import { Bloco, Cartao, Check, botaoLink } from "@/app/ui";
import type { BaseDoMes, FonteFolha, FonteReceita } from "@/lib/rotina/base";
import { LINK_PROLABORE_DO_MES_ATUAL, textosDoAviso, type AvisoFatorR } from "@/lib/rotina/fator-r";
import type { EnvioResumido } from "@/lib/rotina/pgdasd";

// Partes da tela da rotina do mês, só de apresentação (recebem os dados prontos): o passo numerado, o cálculo com a
// explicação no tooltip, a comparação da simulação, os valores para o portal (modo guiado) e o aviso do Fator R.

export function Passo({ numero, titulo, feito, situacao, explicacao, children }: { numero: number; titulo: string; feito: boolean; situacao: string; explicacao?: ReactNode; children: ReactNode }) {
  return (
    <section id={`passo-${numero}`} className="scroll-mt-24" aria-labelledby={`passo-${numero}-titulo`}>
      <Cartao className={`flex flex-col gap-4 px-5 py-5 sm:px-6 ${feito ? "border-accent-ink/60" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`passo-${numero}-titulo`} className="flex items-center gap-3 text-xl font-semibold tracking-tight">
            <span className={`grid size-8 shrink-0 place-items-center rounded-full text-sm ${feito ? "bg-accent text-on-accent" : "bg-raised text-muted"}`}>{feito ? <Check /> : numero}</span>
            {titulo}
            {explicacao}
          </h2>
          <span className={`text-sm font-medium ${feito ? "text-accent-ink" : "text-muted"}`}>{situacao}</span>
        </div>
        {children}
      </Cartao>
    </section>
  );
}

export const Lista = ({ itens }: { itens: [string, ReactNode][] }) => (
  <dl className="text-sm">
    {itens.map(([nome, valor]) => (
      <div key={nome} className="flex flex-wrap justify-between gap-x-4 border-t border-line py-2 first:border-t-0">
        <dt className="text-muted">{nome}</dt>
        <dd className="font-medium tabular-nums">{valor}</dd>
      </div>
    ))}
  </dl>
);

const NOMES: Partial<Record<Tributo, string>> = { irpj: "IRPJ", csll: "CSLL", cpp: "INSS patronal (CPP)", cofins: "COFINS", pis: "PIS", iss: "ISS", cbs: "CBS", ibs: "IBS" };
export const nomeDaAtividade = (id: number) => {
  const a = ATIVIDADES_PGDASD.find((x) => x.id === id);
  return a ? `${a.grupo} - ${a.descricao}` : String(id);
};

// O cálculo do mês: receita, RBT12, Fator R, anexo, alíquota efetiva e o DAS por tributo. A conta inteira no tooltip.
export function CalculoDoMes({ base }: { base: BaseDoMes }) {
  const a = base.apuracao;
  if (!a) {
    return <p className="text-sm text-bad">{base.semRegra ?? `Não deu para calcular este mês: ${base.erro ?? ""}`}</p>;
  }
  // Os tributos que a exportação paga, pelos percentuais (com receita zero os valores são todos zero, mas a lista não muda).
  const tributos = tributosDoDas(a.das);
  const pendente = base.receitaPendente;
  return (
    <div className="flex flex-col gap-4">
      {a.mesesSemReceita.length > 0 && (
        <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          Faltam receitas de {a.mesesSemReceita.length} {a.mesesSemReceita.length === 1 ? "mês" : "meses"} anteriores: a alíquota pode estar subestimada.{" "}
          <Explicacao
            rotulo="Como completar a receita dos meses anteriores?"
            texto={[
              `Sem receita conhecida em: ${a.mesesSemReceita.map(rotuloMes).join(", ")}. Esses meses contam como zero.`,
              "Com a autorização, trazemos as declarações da Receita Federal (aba Histórico). Sem ela, lance a receita desses meses aqui, mudando o mês no topo da página.",
            ]}
          />
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Bloco rotulo="Receita do mês">{pendente ? "a lançar" : brl(base.receita)}</Bloco>
        <Bloco rotulo="Receita dos 12 meses (RBT12)">{brl(a.rbt12.valor)}</Bloco>
        {a.fatorR && <Bloco rotulo="Fator R">{pct(a.fatorR.valor)}</Bloco>}
        <Bloco rotulo="Anexo">{a.anexo}</Bloco>
        <Bloco rotulo="Alíquota paga (exportação)">{pct(a.das.aliquotaPaga)}</Bloco>
        <Bloco rotulo="DAS do mês">{pendente ? "—" : brl(a.das.total)}</Bloco>
      </div>
      <p className="flex items-center gap-1 text-sm text-muted">
        Como chegamos no valor
        <Explicacao
          rotulo={`Como o DAS de ${rotuloMes(base.pa)} foi calculado?`}
          titulo="O cálculo do DAS"
          texto={[
            `RBT12: a receita bruta dos 12 meses anteriores (${rotuloMes(a.rbt12.meses[0] ?? base.pa)} a ${rotuloMes(a.rbt12.meses.at(-1) ?? base.pa)}) = ${brl(a.rbt12.valor)}. Ela define a faixa (${a.das.faixa}ª) e a alíquota.`,
            a.fatorR
              ? `Fator R: folha de ${brl(a.fatorR.folha)} ÷ receita de ${brl(a.fatorR.receita)} = ${pct(a.fatorR.valor)}. Com 28% ou mais, Anexo III; abaixo, Anexo V.`
              : `A atividade da empresa é tributada pelo Anexo ${a.anexo}, sem Fator R.`,
            `Alíquota efetiva = (RBT12 × ${pct(a.das.aliquotaNominal)} − parcela a deduzir) ÷ RBT12 = ${pct(a.das.aliquotaEfetiva)}.`,
            `Na exportação de serviços não há ISS, PIS e COFINS: sobram ${tributos.map((t) => NOMES[t]).join(", ")}, ${pct(a.das.aliquotaPaga)} da receita (a alíquota paga).`,
            ...(pendente ? ["A receita do mês ainda não foi lançada: o DAS aparece depois do lançamento (ou da marcação de que não houve receita)."] : []),
            "Cada tributo é arredondado ao centavo e o DAS é a soma deles, como a Receita Federal calcula.",
            `Atividade declarada: ${nomeDaAtividade(a.idAtividade)}.`,
          ]}
        />
      </p>
      <Tabela
        semCartao
        rotulo={`Tributos do DAS de ${rotuloMes(base.pa)}`}
        colunas={[
          { chave: "tributo", titulo: "Tributo", principal: true },
          { chave: "percentual", titulo: "Percentual", alinhar: "direita" },
          { chave: "valor", titulo: "Valor", alinhar: "direita" },
        ]}
        linhas={tributos.map((t) => ({ chave: t, celulas: { tributo: <ExplicacaoDoTermo termo={TERMO_DO_TRIBUTO[t]} gatilho={NOMES[t]} />, percentual: pct(a.das.percentuais[t]), valor: pendente ? "—" : brl(a.das.tributos[t]) } }))}
      />
    </div>
  );
}

const ROTULO_RECEITA: Record<FonteReceita, string> = { declarada: "Declarada", "receita-federal": "Receita Federal", lancada: "Lançada aqui" };
const ROTULO_FOLHA: Record<FonteFolha, string> = {
  informada: "Informada aqui",
  "receita-federal": "Receita Federal",
  darf: "Pelo DARF do INSS",
  "darf-teto": "DARF do INSS no teto: informe o pró-labore",
};

// Os 12 meses da base (receita e folha, com a fonte de cada valor), na tabela única.
export function BaseDosDozeMeses({ base }: { base: BaseDoMes }) {
  const a = base.apuracao;
  if (!a) return null;
  const meses = [...new Set([...a.rbt12.meses, ...(a.fatorR?.meses ?? [])])].filter((m) => m !== base.pa).sort().reverse();
  return (
    <Tabela
      rotulo="Receita e folha dos meses anteriores"
      porPagina={6}
      colunas={[
        { chave: "mes", titulo: "Mês", principal: true },
        { chave: "receita", titulo: "Receita", alinhar: "direita" },
        { chave: "fonteReceita", titulo: "Fonte", ocultarNoCelular: true },
        { chave: "folha", titulo: "Folha (pró-labore)", alinhar: "direita" },
        { chave: "fonteFolha", titulo: "Fonte da folha", ocultarNoCelular: true },
      ]}
      linhas={meses.map((m) => ({
        chave: m,
        celulas: {
          mes: <span className="first-letter:uppercase">{rotuloMes(m)}</span>,
          receita: base.receitas[m] !== undefined ? brl(base.receitas[m]) : "sem dado",
          fonteReceita: base.fontesReceita[m] ? ROTULO_RECEITA[base.fontesReceita[m]] : "—",
          folha: base.folhas[m] !== undefined ? brl(base.folhas[m]) : brl(0),
          fonteFolha: base.fontesFolha[m] ? ROTULO_FOLHA[base.fontesFolha[m]] : "—",
        },
      }))}
    />
  );
}

// Resultado da última simulação: o cálculo da plataforma ao lado do da Receita, tributo a tributo.
export function ResultadoSimulacao({ simulacao, valores }: { simulacao: EnvioResumido; valores: Valores }) {
  const daReceita = simulacao.valoresReceita ?? {};
  const codigos = [...new Set([...Object.keys(valores), ...Object.keys(daReceita)])].sort();
  const igual = (c: string) => Math.abs((valores[c] ?? 0) - (daReceita[c] ?? 0)) < 0.005;
  return (
    <Tabela
      semCartao
      rotulo="Simulação na Receita Federal"
      colunas={[
        { chave: "tributo", titulo: "Tributo", principal: true },
        { chave: "plataforma", titulo: "Calculado aqui", alinhar: "direita" },
        { chave: "receita", titulo: "Receita Federal", alinhar: "direita" },
      ]}
      linhas={codigos.map((c) => ({
        chave: c,
        celulas: {
          tributo: nomeTributo(Number(c)),
          plataforma: brl(valores[c] ?? 0),
          receita: <span className={igual(c) ? "text-accent-ink" : "font-semibold text-bad"}>{brl(daReceita[c] ?? 0)}</span>,
        },
      }))}
    />
  );
}

// Modo guiado: os valores prontos para lançar no Portal do Simples.
export function ValoresDaDeclaracao({ base }: { base: BaseDoMes }) {
  const a = base.apuracao;
  if (!a) return null;
  if (base.receitaPendente) return <p className="text-sm text-muted">Lance a receita do mês (ou marque que não houve receita) para ver os valores.</p>;
  const valores = valoresDoDas(a.das);
  return (
    <Lista
      itens={[
        ["Período de apuração", rotuloMes(base.pa)],
        ["Atividade", nomeDaAtividade(a.idAtividade)],
        ["Receita no mercado interno", brl(0)],
        ["Receita no mercado externo (exportação)", brl(base.receita)],
        ...(a.fatorR ? ([["Folha de salários dos 12 meses", brl(a.fatorR.folha)]] as [string, string][]) : []),
        ...Object.entries(valores).map(([c, v]) => [nomeTributo(Number(c)), brl(v)] as [string, string]),
        ["DAS esperado", brl(a.das.total)],
      ]}
    />
  );
}

// O INSS do sócio é 11% do pró-labore, limitado ao teto do salário de contribuição do ano (como o eSocial calcula).
export const valoresDoInss = (pa: string, prolabore: number | null): [string, string][] => {
  if (prolabore === null) return [["Pró-labore do mês", "informe no passo 2"]];
  const inss = inssProLaboreDoMes(pa, prolabore);
  const noTeto = prolabore > tetoInss(pa);
  return [
    ["Período de apuração", rotuloMes(pa)],
    ["Pró-labore do mês", brl(prolabore)],
    [noTeto ? `INSS do sócio (11% do teto de ${brl(tetoInss(pa))}, código 1099)` : "INSS do sócio (11%, código 1099)", brl(inss)],
    ["DARF esperado", brl(inss)],
  ];
};

// Aviso do Fator R perto de 28% (painel e rotina do mês): uma frase e a conta no tooltip.
export function CartaoFatorR({ aviso, comLink = false }: { aviso: AvisoFatorR; comLink?: boolean }) {
  const t = textosDoAviso(aviso);
  const grave = aviso.anexo === "V";
  return (
    <Cartao className={`flex flex-col gap-2 px-5 py-4 text-sm ${grave ? "border-bad/50" : "border-warn/40 bg-warn-soft"}`}>
      <span className="flex items-center gap-1">
        <b className={`font-semibold ${grave ? "text-bad" : "text-warn"}`}>{t.titulo}</b>
        <Explicacao rotulo="Como funciona o Fator R e a sugestão de pró-labore?" titulo="Fator R e pró-labore" texto={t.conta} />
      </span>
      <span>{t.curto}</span>
      {aviso.aumento > 0 && (
        <span className="text-muted">
          Economia estimada: <b className={aviso.economia > 0 ? "text-accent-ink" : "text-bad"}>{brl(aviso.economia)}</b> em {rotuloMes(aviso.paAfetado)}.
        </span>
      )}
      {comLink && (
        <Link href={LINK_PROLABORE_DO_MES_ATUAL} className={`${botaoLink} w-fit`}>
          Ajustar o pró-labore
        </Link>
      )}
    </Cartao>
  );
}

export const dataDaDeclaracao = (transmitidaEm: string | null) => (transmitidaEm ? dataBr(transmitidaEm.slice(0, 10)) : "data não informada");
