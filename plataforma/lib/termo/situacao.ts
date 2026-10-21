// Situação da autorização de uma empresa, calculada só com o que está guardado no banco (sem chamar nada): o termo de
// autorização vigente, perto de vencer, vencido, recusado pela Receita ou ausente; ou "própria" (a empresa da
// plataforma, que não precisa de termo). Também o aviso do sino e se as funções da plataforma estão liberadas.
// Funções puras: recebem a linha do banco e o relógio. O que vence é o termo (a vigência ou a validade do
// certificado, o que vier antes); o token, que dura só até a meia-noite do dia seguinte, é renovado sozinho com o
// termo guardado (termo.ts). Textos para o cliente: a fonte é sempre a Receita Federal.
import { dataBr, isoDeCompacta } from "@contabilizadev/nucleo/formato";
import type { MotivoRecusa } from "@contabilizadev/nucleo/serpro/autentica-procurador";
import { dataEmBrasilia } from "@contabilizadev/nucleo/serpro/termo-autorizacao";
import type { termosAutorizacao } from "@/banco/esquema";
import { AVISO_DIAS } from "./aviso";

export { AVISO_DIAS };

const DIA_MS = 24 * 60 * 60 * 1000;

export type Linha = typeof termosAutorizacao.$inferSelect;

export type TermoGuardado = {
  validaAte: string; // AAAA-MM-DD: o menor entre a vigência do termo e o último dia do certificado
  motivo: "vigencia" | "certificado"; // o que vence primeiro
  diasRestantes: number; // 0 = vence hoje; negativo = vencido
  signatario: { cnpj: string; nome: string };
  enviadoEm: Date;
};

export type Situacao =
  | { estado: "propria" } // a empresa é a própria plataforma (contratante): autorizada sem termo
  | { estado: "ausente" }
  | ({ estado: "vigente" | "vencendo" | "vencida" } & TermoGuardado)
  | ({ estado: "recusada"; recusadoEm: Date; recusa: MotivoRecusa | null } & TermoGuardado);

const compacta = (aaaaMmDd: string) => aaaaMmDd.replace(/-/g, "");
const diasEntre = (de: string, ate: string) =>
  Math.round((Date.UTC(+ate.slice(0, 4), +ate.slice(4, 6) - 1, +ate.slice(6)) - Date.UTC(+de.slice(0, 4), +de.slice(4, 6) - 1, +de.slice(6))) / DIA_MS);

export function situacaoDa(linha: Linha | null | undefined, agora: Date): Situacao {
  if (!linha) return { estado: "ausente" };
  const hoje = dataEmBrasilia(agora);
  const vigencia = compacta(linha.vigencia);
  const ultimoDiaCertificado = dataEmBrasilia(linha.certificadoValidoAte);
  // Vigência limitada pelo certificado (mesmo dia): quem vence é o certificado, e renovar pede um certificado novo.
  const motivo = ultimoDiaCertificado <= vigencia ? "certificado" : "vigencia";
  const validaAte = motivo === "certificado" ? ultimoDiaCertificado : vigencia;
  const vencida = hoje > vigencia || agora >= linha.certificadoValidoAte;
  const diasRestantes = diasEntre(hoje, validaAte);
  const guardado: TermoGuardado = {
    validaAte: isoDeCompacta(validaAte),
    motivo,
    diasRestantes: vencida ? Math.min(diasRestantes, -1) : diasRestantes,
    signatario: { cnpj: linha.signatarioCnpj, nome: linha.signatarioNome },
    enviadoEm: linha.enviadoEm,
  };
  if (vencida) return { estado: "vencida", ...guardado };
  if (linha.recusadoEm) return { estado: "recusada", recusadoEm: linha.recusadoEm, recusa: (linha.recusaMotivo as MotivoRecusa | null) ?? null, ...guardado };
  return { estado: diasRestantes <= AVISO_DIAS ? "vencendo" : "vigente", ...guardado };
}

// As funções que dependem da Receita (declaração, guia, caixa postal…) rodam sozinhas para esta empresa? Com o termo
// em dia (ou na empresa da própria plataforma), sim, todas: o termo autoriza a plataforma em nome da empresa, sem
// lista de serviços. Sem termo, vencido ou recusado, não: a tela mostra o caminho no portal (guiado.ts).
export const liberada = (situacao: Situacao) => situacao.estado === "propria" || situacao.estado === "vigente" || situacao.estado === "vencendo";

export type Aviso = { nivel: "vence" | "vencida"; titulo: string; texto: string };

// Aviso do sino e do painel: o termo vence em AVISO_DIAS dias ou menos (amarelo), venceu ou foi recusado (vermelho).
// Sem termo não há aviso (o painel convida a autorizar).
export function avisoDaSituacao(s: Situacao): Aviso | null {
  if (s.estado === "propria" || s.estado === "ausente" || s.estado === "vigente") return null;
  const data = dataBr(s.validaAte);
  if (s.estado === "recusada") {
    return {
      nivel: "vencida",
      titulo: "A Receita Federal recusou a autorização",
      texto: `Ao renovar o acesso, a Receita Federal recusou o termo assinado${s.recusa === "certificado-revogado" ? " (o certificado foi revogado)" : s.recusa === "certificado-vencido" ? " (o certificado venceu)" : ""}. A autorização deixou de valer: assine de novo.`,
    };
  }
  const oQue = s.motivo === "certificado" ? "O certificado usado na autorização" : "A autorização";
  const comoRenovar = s.motivo === "certificado" ? "Renove o e-CNPJ A1 e assine de novo" : "Assine de novo";
  if (s.estado === "vencida") {
    return { nivel: "vencida", titulo: "A autorização venceu", texto: `${oQue} venceu em ${data}. ${comoRenovar}; até lá, tudo fica no modo guiado.` };
  }
  const quando = s.diasRestantes === 0 ? "hoje" : s.diasRestantes === 1 ? "amanhã" : `em ${s.diasRestantes} dias`;
  return {
    nivel: "vence",
    titulo: `Autorização vence ${quando}`,
    texto: `${oQue} vale até ${data}. ${comoRenovar} antes disso para não voltar ao modo guiado.`,
  };
}
