// Aviso do Fator R perto de 28% (Parte 6, passo 19), no painel e no sino: com o pró-labore do mês corrente, em que anexo fica
// o próximo mês que ainda dá para mudar, o pró-labore que deixa o Fator R em 28% (Anexo III) e a economia estimada
// (DAS no Anexo V menos DAS no III, menos o INSS de 11% sobre o pró-labore a mais, até o teto do INSS). Faixa de atenção e a conta no
// núcleo (apuracao.ts). Só banco: nada é chamado.
import { sugestaoFatorR, type SugestaoFatorR } from "@contabilizadev/nucleo/apuracao";
import { brl, pct } from "@contabilizadev/nucleo/formato";
import { rotuloMes, somarMeses } from "@contabilizadev/nucleo/meses";
import type { Banco } from "@/banco";
import type { AcessoEmpresa } from "@/lib/empresas/acesso";
import type { ConsultaCnpj } from "@/lib/empresas/receita";
import { mesAtualNoBrasil } from "@/lib/historico/prazos";
import { empresaDaRotina, historicoDeValores, proLaboreVigente } from "./base";

export type AvisoFatorR = SugestaoFatorR & { proLaboreInformado: boolean };

// Onde o cliente informa o pró-labore do mês corrente (o que a sugestão pede): o formulário próprio na rotina do mês,
// separado do pró-labore do mês apurado (passo 2), que já fechou.
export const LINK_PROLABORE_DO_MES_ATUAL = "/roteiro#prolabore-do-mes-atual";

export async function avisoFatorR(banco: Banco, acesso: AcessoEmpresa, agora: Date, consultaLida?: Promise<ConsultaCnpj | null>): Promise<AvisoFatorR | null> {
  const empresa = await empresaDaRotina(banco, acesso, consultaLida);
  if (!empresa.regra || empresa.regra.tributacao !== "fator-r") return null;
  const historico = await historicoDeValores(banco, acesso);
  const mesAtual = mesAtualNoBrasil(agora);
  const informado = proLaboreVigente(historico.prolabores, mesAtual);
  // Sem pró-labore informado, o do mês passado (extrato ou DARF) é a melhor previsão do deste mês.
  const proLaboreAtual = informado ?? historico.folhas[somarMeses(mesAtual, -1)] ?? 0;
  const receitas = Object.fromEntries(Object.entries(historico.receitas).filter(([m]) => m < mesAtual));
  try {
    const s = sugestaoFatorR({ mesAtual, receitas, folhas: historico.folhas, regra: empresa.regra, proLaboreAtual, inicioAtividade: empresa.inicioAtividade });
    // "Informado" só quando o próprio mês corrente foi informado (o de um mês anterior é só a previsão).
    return s ? { ...s, proLaboreInformado: historico.prolabores.has(mesAtual) } : null;
  } catch {
    return null; // começo de atividade fora do previsto: sem aviso
  }
}

// Textos do aviso (cartão do painel e sino): uma frase curta; a conta inteira vai no tooltip.
export function textosDoAviso(a: AvisoFatorR) {
  const mes = rotuloMes(a.paAfetado);
  const deste = rotuloMes(a.mes); // o mês corrente, o único cujo pró-labore ainda dá para ajustar
  const fator = pct(a.fatorR);
  const titulo = a.anexo === "V" ? `Fator R em ${fator}: abaixo de 28%` : `Fator R em ${fator}: perto de 28%`;
  const curto =
    a.anexo === "V"
      ? `Com o pró-labore de ${brl(a.proLaboreAtual)} em ${deste}, ${mes} fica no Anexo V. Com ${brl(a.proLaboreSugerido)} em ${deste}, fica no Anexo III.`
      : `Com o pró-labore de ${brl(a.proLaboreAtual)} em ${deste}, ${mes} fica no Anexo III, com pouca margem. Não reduza o pró-labore de ${deste}.`;
  const conta = [
    `O Fator R é a folha de salários (pró-labore e salários com encargos) dos 12 meses anteriores dividida pela receita dos mesmos meses. Com 28% ou mais, a atividade é tributada pelo Anexo III; abaixo, pelo Anexo V, mais caro.`,
    `Avisamos entre 25% e 30%: abaixo de 28% a empresa está no Anexo V; até 30% está no Anexo III, mas um mês de receita maior ou um pró-labore menor já a derruba.`,
    `O pró-labore de ${deste} (mês corrente) entra no Fator R de ${mes}. Previsão com a receita de ${brl(a.receitaPrevista)} por mês (a do último mês conhecido).`,
    `DAS de ${mes} no Anexo III: ${brl(a.dasAnexoIII)}. No Anexo V: ${brl(a.dasAnexoV)}.`,
    a.aumento > 0
      ? `Aumentar o pró-labore em ${brl(a.aumento)} custa ${brl(a.custoInss)} de INSS (11%, até o teto do INSS). Economia estimada no mês: ${brl(a.economia)}${a.economia < 0 ? " (não compensa)" : ""}. O imposto de renda sobre o pró-labore não entra nesta conta.`
      : `Para continuar no Anexo III, mantenha o pró-labore de ${deste} em pelo menos ${brl(a.proLaboreSugerido)}.`,
  ];
  if (!a.proLaboreInformado) conta.push(`O pró-labore de ${deste} ainda não foi informado: usamos o último conhecido. Informe na rotina do mês.`);
  return { titulo, curto, conta };
}
