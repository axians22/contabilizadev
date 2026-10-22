import { sql } from "drizzle-orm";
import { banco } from "@/banco";
import { respostaDaSaude } from "@/lib/producao/saude";

// Health check do Coolify (Path /api/saude na aba Healthcheck da aplicação): pública e sem sessão (ROTAS_PUBLICAS), por isso
// não usa comSessao. Responde só {ok}: nada de versão, segredo ou dado (lib/producao/saude.ts).
export async function GET() {
  return respostaDaSaude(() => banco().execute(sql`select 1`));
}
