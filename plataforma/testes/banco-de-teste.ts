// Banco dos testes de integração: um banco separado ("<nome>_teste") no mesmo Postgres do desenvolvimento,
// criado se faltar e migrado com as mesmas migrações do site. Nunca o banco de desenvolvimento: a URL é
// recusada se o nome do banco não terminar em _teste. Cada teste começa com as tabelas vazias (limpar()).
import { existsSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { Banco } from "@/banco";
import * as esquema from "@/banco/esquema";

const RAIZ = path.join(import.meta.dirname, "..");

export function urlDoBancoDeTeste(env: Record<string, string | undefined> = process.env): string {
  if (env.DATABASE_URL_TESTE) return env.DATABASE_URL_TESTE;
  if (!env.DATABASE_URL) throw new Error("Defina DATABASE_URL (ou DATABASE_URL_TESTE) no plataforma/.env.local.");
  const url = new URL(env.DATABASE_URL);
  url.pathname = `${url.pathname.replace(/^\//, "")}_teste`;
  return url.toString();
}

export function nomeDoBanco(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

export type BancoDeTeste = { banco: Banco; limpar: () => Promise<void>; fechar: () => Promise<void> };

export async function prepararBancoDeTeste(): Promise<BancoDeTeste> {
  if (!process.env.DATABASE_URL && !process.env.DATABASE_URL_TESTE && existsSync(path.join(RAIZ, ".env.local"))) {
    process.loadEnvFile(path.join(RAIZ, ".env.local"));
  }
  const url = urlDoBancoDeTeste();
  const nome = nomeDoBanco(url);
  if (!nome.endsWith("_teste")) throw new Error(`Banco de teste recusado: "${nome}" não termina em _teste.`);

  // Cria o banco de teste pela conexão de manutenção ("postgres"), se ainda não existir.
  const manutencao = new URL(url);
  manutencao.pathname = "/postgres";
  const admin = postgres(manutencao.toString(), { max: 1, onnotice: () => {} });
  try {
    const [existe] = await admin`select 1 from pg_database where datname = ${nome}`;
    if (!existe) await admin.unsafe(`create database "${nome.replace(/"/g, '""')}"`);
  } catch (erro) {
    // Dois arquivos de teste criando ao mesmo tempo: o segundo encontra o banco já criado.
    if ((erro as { code?: string }).code !== "42P04") {
      throw new Error(`Banco de teste indisponível (${(erro as Error).message}). Suba o Postgres: npm run banco:subir`);
    }
  } finally {
    await admin.end();
  }

  const conexao = postgres(url, { max: 4, onnotice: () => {} });
  const banco = drizzle(conexao, { schema: esquema });
  await migrate(banco, { migrationsFolder: path.join(RAIZ, "banco", "migracoes") });

  return {
    banco,
    limpar: async () => {
      await conexao`truncate usuarios, empresas, empresa_usuarios, sessoes, consultas_cnpj, termos_autorizacao, serpro_chamadas, pgdasd_declaracoes, pgdasd_das, pgdasd_extratos, pagamentos, defis, situacoes_fiscais, historico_consultas, importacoes, receitas_lancadas, meses_sem_receita, prolabores, pgdasd_envios, dctfweb_envios, guias, cotacoes_ptax, esocial_config, esocial_envios, esocial_eventos, esocial_pedidos, esocial_chamadas, caixa_postal, defis_dados, plataforma_segredos restart identity cascade`;
    },
    fechar: () => conexao.end(),
  };
}
