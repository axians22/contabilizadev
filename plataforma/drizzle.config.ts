import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// O drizzle-kit roda fora do Next: lê a DATABASE_URL do .env.local por conta própria.
if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");

// Migrações: npm run banco:gerar (cria o SQL a partir do esquema) e npm run banco:migrar (aplica).
export default defineConfig({
  dialect: "postgresql",
  schema: "./banco/esquema.ts",
  out: "./banco/migracoes",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
