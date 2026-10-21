// Ligação com o servidor do Next: CNPJ da plataforma, configuração do contrato e o cliente real do Serpro (com o
// registro das chamadas no banco). Vem de plataformaDoServidor (lib/plataforma/servidor.ts): o certificado e as chaves
// guardados pelo ADMIN primeiro, o ambiente como alternativa. Sem credenciais, `cliente` fica nulo e nada é chamado.
import "server-only";
import type { ClienteSerpro } from "@contabilizadev/nucleo/serpro/cliente";
import { plataformaDoServidor } from "@/lib/plataforma/servidor";
import type { CnpjPlataforma, ConfigSerpro } from "./config";

export type SerproDoServidor = { plataforma: CnpjPlataforma; config: ConfigSerpro; cliente: ClienteSerpro | null };

export async function serproDoServidor(): Promise<SerproDoServidor> {
  const { plataforma, serpro, cliente } = await plataformaDoServidor();
  return { plataforma, config: serpro, cliente };
}
