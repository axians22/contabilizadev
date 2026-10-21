// Prazo da declaração anual do Simples Nacional (DEFIS), em linguagem simples. Fonte: Resolução CGSN 140/2018, art. 72 —
// a DEFIS é entregue "até 31 de março do ano-calendário subsequente ao da ocorrência dos fatos geradores" (prazoDefis, no
// núcleo). Toda empresa que esteve no Simples em algum mês do ano entrega, inclusive sem movimento. Atraso: multa de 2% ao
// mês sobre os tributos informados, limitada a 20%, mínimo de R$ 200 (LC 123/2006, art. 38, I e § 3º).
// Na virada do ano (1º de janeiro) o ano que acabou fecha: a declaração dele passa a poder ser entregue e o lucro isento do
// sócio recomeça a contar no ano novo.
import type { DadosCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { dataBr } from "@contabilizadev/nucleo/formato";
import { prazoDefis } from "@contabilizadev/nucleo/serpro/defis";
import type { NivelDoAviso } from "@/lib/avisos/central";
import { hojeNoBrasil } from "@/lib/historico/prazos";

const DIA = 24 * 60 * 60 * 1000;
const diasAte = (prazo: string, hoje: string) => Math.round((Date.parse(`${prazo}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / DIA);

export type EstadoDaDeclaracaoAnual = "entregue" | "na-epoca" | "atrasada" | "a-conferir" | "nao-devida";

export type SituacaoDaDeclaracaoAnual = {
  ano: number; // o ano declarado (o que acabou)
  prazo: string; // AAAA-MM-DD
  dias: number; // até o prazo (negativo: passou)
  estado: EstadoDaDeclaracaoAnual;
  inicio: string | null; // AAAA-MM-DD: desde quando a empresa está no Simples (só quando conhecido)
};

// Desde quando a empresa está no Simples, pelo cadastro da Receita: o mais tarde entre o início de atividade e a data de
// opção pelo Simples. A data de opção só conta sem exclusão informada: com exclusão, a opção informada pode ser uma volta
// ao Simples e a empresa ter sido optante em anos anteriores (e dever a DEFIS deles).
export function inicioNoSimples(dados: Pick<DadosCnpj, "dataInicioAtividade" | "simples"> | null | undefined): string | null {
  if (!dados) return null;
  const opcao = dados.simples?.optante !== false && !dados.simples?.dataExclusao ? dados.simples?.dataOpcao ?? null : null;
  const datas = [dados.dataInicioAtividade, opcao].filter((d): d is string => Boolean(d)).sort();
  return datas.at(-1) ?? null;
}

// A DEFIS é do ano-calendário em que a empresa foi optante (Resolução CGSN 140/2018, art. 72): quem entrou no Simples
// depois do ano declarado não a deve.
export const declaracaoDevida = (ano: number, inicio: string | null | undefined) => !inicio || Number(inicio.slice(0, 4)) <= ano;

// A declaração do ano anterior ao de hoje (Brasília): entregue (a Receita tem), na época (até o prazo), atrasada (a
// Receita foi consultada depois do prazo e não tem), a conferir (prazo passado e ainda não consultada) ou não devida (a
// empresa entrou no Simples depois do ano declarado).
export function situacaoDaDeclaracaoAnual(hoje: string, entregue: boolean | null, inicio: string | null = null): SituacaoDaDeclaracaoAnual {
  const ano = Number(hoje.slice(0, 4)) - 1;
  const prazo = prazoDefis(ano);
  const dias = diasAte(prazo, hoje);
  const estado: EstadoDaDeclaracaoAnual = entregue
    ? "entregue"
    : !declaracaoDevida(ano, inicio)
      ? "nao-devida"
      : dias >= 0
        ? "na-epoca"
        : entregue === false
          ? "atrasada"
          : "a-conferir";
  return { ano, prazo, dias, estado, inicio };
}

// O que a consulta guardada diz da entrega do ano: true se a Receita tem a declaração; false só se a Receita foi consultada
// depois do prazo (dia seguinte a ele, em Brasília) e não tem; null no resto (sem consulta, ou "não encontrada" de antes do
// prazo: o cliente pode ter entregue no portal depois dela).
export function entregaDaDeclaracaoAnual(ano: number, registro: { situacao: string; consultadaEm: Date } | null | undefined): boolean | null {
  if (!registro) return null;
  if (registro.situacao === "entregue") return true;
  return hojeNoBrasil(registro.consultadaEm) > prazoDefis(ano) ? false : null;
}

export type AvisoDaDeclaracaoAnual = { ano: number; nivel: NivelDoAviso; titulo: string; texto: string };

// O aviso do painel e do sino: em janeiro, informativo (o ano fechou, já dá para entregar); em fevereiro e março, amarelo
// (o prazo chegando); depois do prazo sem entrega na Receita, vermelho. Entregue, nada. Sem saber se foi entregue depois
// do prazo (modo guiado, ou ainda não consultada), nada: não há como afirmar o atraso.
// Não devida (a empresa entrou no Simples depois do ano), nada.
export function avisoDaDeclaracaoAnual(hoje: string, entregue: boolean | null, inicio: string | null = null): AvisoDaDeclaracaoAnual | null {
  const s = situacaoDaDeclaracaoAnual(hoje, entregue, inicio);
  if (s.estado === "entregue" || s.estado === "a-conferir" || s.estado === "nao-devida") return null;
  if (s.estado === "atrasada") {
    return {
      ano: s.ano,
      nivel: "vencida",
      titulo: `Declaração anual de ${s.ano} atrasada`,
      texto: `A Receita Federal não tem a declaração anual (DEFIS) de ${s.ano}, que vencia em ${dataBr(s.prazo)}. Entregue o quanto antes: o atraso tem multa.`,
    };
  }
  if (hoje.slice(5, 7) === "01") {
    return {
      ano: s.ano,
      nivel: "info",
      titulo: `Declaração anual de ${s.ano}: entregue até ${dataBr(s.prazo)}`,
      texto: `O ano de ${s.ano} fechou e a declaração anual dele já pode ser entregue. Os valores do ano estão prontos na aba Declaração anual.`,
    };
  }
  const quando = s.dias === 0 ? "hoje" : s.dias === 1 ? "amanhã" : `em ${s.dias} dias`;
  return {
    ano: s.ano,
    nivel: "vence",
    titulo: `Declaração anual de ${s.ano} vence ${quando}`,
    texto: `Entregue a declaração anual (DEFIS) de ${s.ano} até ${dataBr(s.prazo)}, mesmo se a empresa não teve movimento.`,
  };
}

// O que explicar no tooltip da aba (prazo, quem entrega, multa e o que muda na virada do ano).
export function explicacaoDoPrazo(ano: number): string[] {
  const prazo = dataBr(prazoDefis(ano));
  return [
    `A declaração anual de ${ano} vai até ${prazo} (Resolução CGSN 140/2018, art. 72). Toda empresa que esteve no Simples Nacional em ${ano} entrega, mesmo sem movimento.`,
    "Entregar depois do prazo tem multa de 2% ao mês sobre os tributos do ano, até 20%, com mínimo de R$ 200.",
    `Na virada do ano: em 1º de janeiro de ${ano + 1} o ano de ${ano} fecha e a declaração dele passa a poder ser entregue; o lucro que sai isento para o sócio recomeça a contar no ano novo.`,
  ];
}
