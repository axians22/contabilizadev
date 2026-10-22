// Os fatos que a conferência do ambiente (lib/producao/conferencia.ts) precisa, lidos só do próprio servidor: o banco (se
// responde e as migrações aplicadas), o certificado e as chaves da plataforma (o que já está guardado, sem chamar ninguém) e
// o protocolo da requisição. Nenhum serviço externo é chamado.
import "server-only";
import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { banco } from "@/banco";
import diario from "@/banco/migracoes/meta/_journal.json";
import { resolverChavesDoContrato } from "@/lib/serpro/config";
import { plataformaDoServidor } from "@/lib/plataforma/servidor";
import type { FatosDoServidor } from "./conferencia";

// As migrações que vêm no código (banco/migracoes/meta/_journal.json, o mesmo que o drizzle-kit aplica).
export const MIGRACOES_DO_CODIGO = { total: diario.entries.length, ultima: Math.max(0, ...diario.entries.map((e) => e.when)) };

// A tabela que o drizzle-kit migrate preenche (uma linha por migração aplicada, created_at = o "when" do diário).
async function migracoesAplicadas(): Promise<FatosDoServidor["banco"]> {
  try {
    const linhas = await banco().execute<{ total: number; ultima: string | null }>(sql`select count(*)::int as total, max(created_at)::text as ultima from drizzle.__drizzle_migrations`);
    const [l] = linhas as unknown as { total: number; ultima: string | null }[];
    return { ok: true, aplicadas: Number(l?.total ?? 0), ultimaAplicada: l?.ultima ? Number(l.ultima) : null };
  } catch (erro) {
    // Sem a tabela do drizzle (banco novo, nenhuma migração): o banco responde, com zero aplicadas.
    if ((erro as { code?: string }).code === "42P01" || (erro as { cause?: { code?: string } }).cause?.code === "42P01") return { ok: true, aplicadas: 0, ultimaAplicada: null };
    return { ok: false };
  }
}

export async function fatosDoServidor(agora = new Date()): Promise<FatosDoServidor> {
  const [bancoLido, p, h] = await Promise.all([migracoesAplicadas(), plataformaDoServidor(), headers()]);
  const c = p.certificado;
  const chaves = p.guardado.chaves;
  const doContrato = resolverChavesDoContrato(process.env, p.guardado);
  return {
    banco: bancoLido,
    migracoesDoCodigo: MIGRACOES_DO_CODIGO,
    certificado: c.pronto
      ? { pronto: true, origem: c.origem, validoAte: c.validoAte }
      : { pronto: false, motivo: c.motivo, vencidoEm: c.falha.tipo === "vencido" ? c.falha.validoAte : undefined },
    chaves: chaves?.legivel ? "guardadas" : chaves ? "ilegiveis" : doContrato.pronto ? "ambiente" : "faltam",
    protocolo: h.get("x-forwarded-proto"),
    agora,
  };
}
