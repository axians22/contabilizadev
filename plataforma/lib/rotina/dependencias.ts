// O que as regras da rotina do mês recebem por parâmetro (servidor.ts monta as do Next; os testes, as falsas): banco,
// cliente do contrato (nulo sem contrato: nada é chamado), o contexto da empresa (termo de autorização e token; recusa
// empresa sem autorização em dia), o certificado da plataforma (assina a DCTFWeb da própria empresa da plataforma), o
// fetch da cotação PTAX e o relógio.
import type { Pem } from "@contabilizadev/nucleo/certificado";
import type { ClienteSerpro, Contexto } from "@contabilizadev/nucleo/serpro/cliente";
import type { Banco } from "@/banco";

export type DependenciasRotina = {
  banco: Banco;
  cliente: ClienteSerpro | null;
  contexto: () => Promise<Contexto>;
  certificadoDaPlataforma?: () => Pem | null;
  buscarPtax?: typeof fetch;
  agora?: () => Date;
  log?: (mensagem: string) => void;
};

export type Resposta<T = object> = ({ ok: true } & T) | { ok: false; mensagem: string };
export const recusa = (mensagem: string): { ok: false; mensagem: string } => ({ ok: false, mensagem });

export const relogio = (deps: Pick<DependenciasRotina, "agora">) => (deps.agora ?? (() => new Date()))();
export const log = (deps: Pick<DependenciasRotina, "log">, mensagem: string) => (deps.log ?? console.error)(mensagem);

// Data e hora de Brasília no formato das datas da Receita (AAAA-MM-DDTHH:MM:SS).
export const dataHoraNoBrasil = (agora: Date) => agora.toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).replace(" ", "T");

export const codigoPostgres = (erro: unknown) =>
  (erro as { code?: string; cause?: { code?: string } })?.code ?? (erro as { cause?: { code?: string } })?.cause?.code;
