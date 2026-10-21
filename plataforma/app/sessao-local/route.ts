import { abrirSessaoLocal } from "@/lib/autenticacao/sessao-local";
import { dependenciasDeLogin } from "@/lib/autenticacao/servidor";

// Login desligado: entra sozinho com a conta de desenvolvimento (ver lib/autenticacao/sessao-local.ts).
export async function GET(requisicao: Request) {
  return abrirSessaoLocal(dependenciasDeLogin(), requisicao);
}
