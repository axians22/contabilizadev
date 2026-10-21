// As fontes da central de avisos (central.ts): cada uma transforma o que está no banco (já lido por coleta.ts) em avisos
// com chave, prioridade e o link de onde resolver. Funções puras, testadas sem banco.
import { dataBr } from "@contabilizadev/nucleo/formato";
import { rotuloMes } from "@contabilizadev/nucleo/meses";
import { ENDERECO_DAS_MENSAGENS } from "@/lib/abas";
import { avisoDoPrazo, prazoDoEsocial } from "@/lib/esocial/prazo";
import type { MesDoHistorico } from "@/lib/historico/leitura";
import { LINK_PROLABORE_DO_MES_ATUAL, textosDoAviso, type AvisoFatorR } from "@/lib/rotina/fator-r";
import type { GuiaDoMes } from "@/lib/rotina/guias";
import type { Aviso, Situacao } from "@/lib/termo/situacao";
import { avisoDaDeclaracaoAnual } from "@/lib/defis/prazo";
import { chaveDoCertificado, type AvisoDoSino } from "./central";

const DIA = 24 * 60 * 60 * 1000;
const diasAte = (prazo: string, hoje: string) => Math.round((Date.parse(`${prazo}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / DIA);
const quandoVence = (dias: number) => (dias === 0 ? "hoje" : dias === 1 ? "amanhã" : `em ${dias} dias`);
// Avisa a partir de 5 dias antes do prazo (o mesmo do eSocial).
export const AVISO_PRAZO_DIAS = 5;

// Aviso do termo de autorização da empresa ativa (vence em 30 dias ou menos, venceu ou foi recusado), com o link para
// assinar de novo. Quando o que vence é o certificado do termo, cobre o aviso do mesmo certificado guardado no navegador.
export function avisoDoTermo(aviso: Aviso | null, situacao?: Situacao): AvisoDoSino[] {
  if (!aviso) return [];
  const certificado = situacao && "motivo" in situacao && situacao.motivo === "certificado" ? [chaveDoCertificado(situacao.validaAte)] : undefined;
  return [{ ...aviso, chave: "autorizacao", cobre: certificado, link: { href: "/autorizacao", texto: "Assinar de novo" } }];
}

// Aviso do Fator R na faixa de atenção (25% a 30%, lib/rotina/fator-r.ts), com o link para ajustar o pró-labore.
export function avisoDoFatorR(aviso: AvisoFatorR | null): AvisoDoSino[] {
  if (!aviso?.emAtencao) return [];
  const t = textosDoAviso(aviso);
  return [{ chave: "fator-r", nivel: "vence", titulo: t.titulo, texto: t.curto, link: { href: LINK_PROLABORE_DO_MES_ATUAL, texto: "Ajustar o pró-labore" } }];
}

// Aviso do prazo do eSocial (Parte 7): o pró-labore do último mês ainda não enviado, faltando 5 dias ou menos para o dia
// 15 do mês seguinte (ou vencido), com o link para o passo do eSocial na rotina do mês. O fechamento do eSocial transmite a
// DCTFWeb do mês: este aviso cobre o da DCTFWeb.
export function avisoDoEsocial(pendencia: { mes: string; hoje: string; feito: boolean } | null): AvisoDoSino[] {
  const aviso = pendencia ? avisoDoPrazo(pendencia.mes, pendencia.hoje, pendencia.feito) : null;
  if (!aviso || !pendencia) return [];
  return [
    {
      chave: `esocial:${pendencia.mes}`,
      cobre: [`dctfweb:${pendencia.mes}`],
      nivel: aviso.nivel,
      titulo: aviso.titulo,
      texto: aviso.texto,
      link: { href: `/roteiro?mes=${pendencia.mes}#passo-6`, texto: "Enviar ao eSocial" },
    },
  ];
}

// Prazo da DCTFWeb: dia 15 do mês seguinte; não sendo dia útil, o primeiro dia útil depois (IN RFB 2.005/2021, art. 10,
// com a redação da IN RFB 2.162/2023) — a mesma regra do eSocial.
export const prazoDaDctfweb = prazoDoEsocial;

// DCTFWeb do último mês com pró-labore, ainda não transmitida: faltando 5 dias ou menos (amarelo) ou vencida (vermelho).
// Vencida só com a autorização em dia (`conferivel`): sem ela, a plataforma não tem como saber se foi transmitida no e-CAC.
export function avisoDaDctfweb(p: { mes: string; hoje: string; proLabore: number | null; feito: boolean; conferivel: boolean }): AvisoDoSino[] {
  if (p.feito || !p.proLabore || p.proLabore <= 0) return [];
  const prazo = prazoDaDctfweb(p.mes);
  const dias = diasAte(prazo, p.hoje);
  if (dias > AVISO_PRAZO_DIAS || (dias < 0 && !p.conferivel)) return [];
  const link = { href: `/roteiro?mes=${p.mes}`, texto: "Abrir a rotina do mês" };
  if (dias < 0) {
    return [{ chave: `dctfweb:${p.mes}`, nivel: "vencida", titulo: `DCTFWeb de ${rotuloMes(p.mes)} atrasada`, texto: `A DCTFWeb do pró-labore de ${rotuloMes(p.mes)} vencia em ${dataBr(prazo)} e não aparece transmitida. Se já transmitiu, confira na rotina do mês.`, link }];
  }
  return [{ chave: `dctfweb:${p.mes}`, nivel: "vence", titulo: `DCTFWeb de ${rotuloMes(p.mes)} vence ${quandoVence(dias)}`, texto: `Transmita a DCTFWeb do pró-labore de ${rotuloMes(p.mes)} até ${dataBr(prazo)}.`, link }];
}

// PGDAS-D: os meses que a Receita Federal não tem declarados e cujo prazo (dia 20 do mês seguinte) já passou (vermelho), e
// o último mês ainda não declarado faltando 5 dias ou menos (amarelo). Meses antes do início de atividade não contam.
// Sem o histórico importado (modo guiado), não dá para saber o que foi declarado: só o lembrete do prazo do último mês.
export function avisosDoPgdasd(meses: MesDoHistorico[], hoje: string, ultimoMes: string, inicioAtividade?: string): AvisoDoSino[] {
  const avisos: AvisoDoSino[] = [];
  const link = (pa: string) => ({ href: `/roteiro?mes=${pa}`, texto: "Declarar na rotina do mês" });
  for (const m of meses) {
    if (m.situacao !== "nao-declarado" || (inicioAtividade && m.pa < inicioAtividade)) continue;
    avisos.push({ chave: `pgdasd:${m.pa}`, nivel: "vencida", titulo: `PGDAS-D de ${rotuloMes(m.pa)} sem declaração`, texto: `A Receita Federal não tem a declaração de ${rotuloMes(m.pa)}, que vencia em ${dataBr(m.vencimento)}. Declare o quanto antes: o atraso tem multa.`, link: link(m.pa) });
  }
  const ultimo = meses.find((m) => m.pa === ultimoMes);
  const semDeclaracao = !ultimo || ultimo.situacao === "no-prazo" || ultimo.situacao === "nao-importado";
  if (semDeclaracao && !(inicioAtividade && ultimoMes < inicioAtividade)) {
    const vencimento = ultimo?.vencimento;
    const dias = vencimento ? diasAte(vencimento, hoje) : Number.POSITIVE_INFINITY;
    if (vencimento && dias >= 0 && dias <= AVISO_PRAZO_DIAS) {
      avisos.push({ chave: `pgdasd:${ultimoMes}`, nivel: "vence", titulo: `PGDAS-D de ${rotuloMes(ultimoMes)} vence ${quandoVence(dias)}`, texto: `Declare ${rotuloMes(ultimoMes)} e pague o DAS até ${dataBr(vencimento)}.`, link: link(ultimoMes) });
    }
  }
  return avisos;
}

const NOME_DA_GUIA = { DAS: "DAS", INSS: "DARF do INSS" } as const;

// Guias vencidas sem pagamento (rotina do mês, Parte 6): uma por mês e tipo, com o link para gerar a guia com juros.
export function avisosDasGuias(vencidas: GuiaDoMes[]): AvisoDoSino[] {
  return vencidas.map((g) => ({
    chave: `guia:${g.tipo}:${g.pa}`,
    nivel: "vencida" as const,
    titulo: `${NOME_DA_GUIA[g.tipo]} de ${rotuloMes(g.pa)} vencido`,
    texto: `Venceu em ${dataBr(g.vencimento)} sem pagamento. Gere a guia nova com multa e juros para o dia em que vai pagar.`,
    link: { href: `/guias#guia-${g.tipo}-${g.pa}`, texto: "Gerar a guia com juros" },
  }));
}

// Mensagens não lidas na Caixa Postal da Receita (nem lidas lá nem abertas aqui). Vermelho enquanto houver uma marcada
// pela Receita como importante (intimações e afins), mesmo depois de vista na lista: ver o cabeçalho não é ler. Amarelo se
// chegou mensagem que ainda não foi vista na lista; informativo para as demais não lidas.
export function avisoDasMensagens(resumo: { naoLidas: number; novas: number; importantesNaoLidas: number } | null): AvisoDoSino[] {
  if (!resumo || resumo.naoLidas <= 0) return [];
  const n = resumo.naoLidas;
  const importante = resumo.importantesNaoLidas > 0;
  return [
    {
      chave: "mensagens",
      nivel: importante ? "vencida" : resumo.novas > 0 ? "vence" : "info",
      titulo: n === 1 ? "1 mensagem não lida da Receita Federal" : `${n} mensagens não lidas da Receita Federal`,
      texto: importante
        ? "Há mensagem marcada como importante sem abrir na Caixa Postal. Veja o assunto e abra para conferir os prazos."
        : "Há mensagem sem abrir na Caixa Postal. Veja o assunto antes de abrir.",
      link: { href: ENDERECO_DAS_MENSAGENS, texto: "Ver as mensagens" },
    },
  ];
}

// Declaração anual (DEFIS) do ano que fechou: na época (janeiro a março) e atrasada (prazo passado sem entrega).
export function avisoDaDefis(hoje: string, entregue: boolean | null, inicio: string | null = null): AvisoDoSino[] {
  const a = avisoDaDeclaracaoAnual(hoje, entregue, inicio);
  return a ? [{ chave: `defis:${a.ano}`, nivel: a.nivel, titulo: a.titulo, texto: a.texto, link: { href: "/defis", texto: "Ver a declaração anual" } }] : [];
}
