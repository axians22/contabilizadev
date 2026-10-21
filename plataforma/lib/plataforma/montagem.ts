// A montagem da plataforma (certificado, configurações do Serpro e do eSocial) e até quando ela pode ser reaproveitada por
// lib/plataforma/servidor.ts. Fora a troca pela tela (a versão do guardado muda), ela fica velha:
// - no validoAte do certificado em uso: depois dele o certificado está vencido e a montagem nova mostra o motivo;
// - logo, se algo não está pronto: o que falta pode aparecer sem troca pela tela (drive de CERT_PFX_PATH montado depois).
import { readFileSync } from "node:fs";
import { lerConfigEsocial, type ConfigEsocial } from "@/lib/esocial/config";
import {
  lerCertificado,
  lerCnpjPlataforma,
  lerConfigSerpro,
  resolverCertificadoDaPlataforma,
  type CertificadoDaPlataforma,
  type CnpjPlataforma,
  type ConfigSerpro,
} from "@/lib/serpro/config";
import { NADA_GUARDADO, type Guardado } from "./segredos";

export const RELEITURA_SEM_PRONTO_MS = 15_000;

export type MontagemDaPlataforma = { plataforma: CnpjPlataforma; certificado: CertificadoDaPlataforma; serpro: ConfigSerpro; esocial: ConfigEsocial };

// O CNPJ e o certificado da plataforma resolvidos uma vez só (uma leitura e uma abertura do .pfx do ambiente, quando é ele
// que vale); Serpro e eSocial montam a partir desse mesmo resultado, então nunca divergem.
export function montarPlataforma(
  env: Record<string, string | undefined> = process.env,
  guardado: Guardado = NADA_GUARDADO,
  agora = new Date(),
  ler: (arquivo: string) => Buffer = readFileSync,
  abrir: Parameters<typeof resolverCertificadoDaPlataforma>[5] = lerCertificado,
): MontagemDaPlataforma {
  const plataforma = lerCnpjPlataforma(env);
  const certificado: CertificadoDaPlataforma =
    plataforma.cnpj === null ? { pronto: false, motivo: plataforma.motivo, falha: { tipo: "invalido" } } : resolverCertificadoDaPlataforma(plataforma.cnpj, env, guardado, ler, agora, abrir);
  return { plataforma, certificado, serpro: lerConfigSerpro(plataforma, certificado, guardado, env), esocial: lerConfigEsocial(plataforma, certificado) };
}

export function montagemValeAte(
  m: { certificado: CertificadoDaPlataforma; serpro: { pronto: boolean }; esocial: { pronto: boolean } },
  agora: Date,
): number {
  const limites: number[] = [];
  if (m.certificado.pronto) limites.push(m.certificado.validoAte.getTime());
  if (!m.certificado.pronto || !m.serpro.pronto || !m.esocial.pronto) limites.push(agora.getTime() + RELEITURA_SEM_PRONTO_MS);
  return limites.length ? Math.min(...limites) : Infinity;
}
