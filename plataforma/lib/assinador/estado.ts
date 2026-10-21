// Se o certificado guardado neste navegador serve para a empresa ativa agora (assinador.ts e o aviso do sino,
// lib/avisos/central.ts). Sem nada do núcleo: o sino roda em todas as páginas e não pode levar junto o node-forge.
import type { CertificadoGuardado } from "./cofre";

// A partir de quantos dias para vencer o certificado guardado a tela avisa para trocar.
export const AVISO_VENCIMENTO_DIAS = 30;
const DIA = 24 * 60 * 60 * 1000;

export type EstadoDoGuardado =
  | { estado: "pronto"; validoAte: Date }
  | { estado: "vencendo"; validoAte: Date; dias: number }
  | { estado: "vencido"; validoAte: Date }
  | { estado: "outro-cnpj"; validoAte: Date };

// Se o certificado guardado serve para a empresa ativa agora: o mesmo CNPJ e dentro da validade (avisa a partir de
// AVISO_VENCIMENTO_DIAS dias antes de vencer).
export function estadoDoGuardado(registro: Pick<CertificadoGuardado, "cnpj" | "info">, cnpjEmpresa: string, agora: Date): EstadoDoGuardado {
  const { validoAte } = registro.info;
  if (registro.cnpj !== cnpjEmpresa || registro.info.titular.numero !== cnpjEmpresa) return { estado: "outro-cnpj", validoAte };
  if (agora >= validoAte) return { estado: "vencido", validoAte };
  const dias = Math.ceil((validoAte.getTime() - agora.getTime()) / DIA);
  return dias <= AVISO_VENCIMENTO_DIAS ? { estado: "vencendo", validoAte, dias } : { estado: "pronto", validoAte };
}
