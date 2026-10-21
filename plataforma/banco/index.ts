// Conexão com o Postgres (Drizzle + postgres.js). Criada só no primeiro uso (o build roda sem banco) e
// reaproveitada nos recarregamentos do modo de desenvolvimento.
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as esquema from "./esquema";

// Tipo do banco que as regras recebem por parâmetro (o site passa banco(); os testes, o banco de teste).
export type Banco = PostgresJsDatabase<typeof esquema>;

const global = globalThis as unknown as { __conexao?: ReturnType<typeof postgres>; __banco?: Banco };

function conexao() {
  if (global.__conexao) return global.__conexao;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Defina DATABASE_URL no plataforma/.env.local (veja .env.exemplo na raiz).");
  global.__conexao = postgres(url, { max: 10 });
  return global.__conexao;
}

export function banco(): Banco {
  return (global.__banco ??= drizzle(conexao(), { schema: esquema }));
}

// Confere se o banco responde (para a página inicial e diagnósticos).
export async function bancoNoAr(): Promise<{ ok: true; versao: string } | { ok: false; erro: string }> {
  try {
    const [linha] = await conexao()<{ versao: string }[]>`select current_setting('server_version') as versao`;
    return { ok: true, versao: linha.versao };
  } catch (erro) {
    return { ok: false, erro: (erro as Error).message };
  }
}
