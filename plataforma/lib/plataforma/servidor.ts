// Ligação do certificado e das chaves da plataforma com o servidor do Next: a PLATAFORMA_CHAVE, o que um ADMIN guardou no
// banco (lib/plataforma/segredos.ts) e, a partir disso, as configurações do Serpro e do eSocial e o cliente real do
// contrato. É a única porta para o certificado da plataforma: termo de autorização, histórico, rotina, Caixa Postal e
// eSocial leem por aqui. Montado de novo quando o guardado muda (troca na tela), quando passa o validoAte do certificado
// em uso e, enquanto algo não está pronto, a cada poucos segundos (lib/plataforma/montagem.ts); fora isso, uma consulta
// pequena por chamada (a versão do guardado).
import "server-only";
import { criarClienteSerpro, type ClienteSerpro } from "@contabilizadev/nucleo/serpro/cliente";
import { banco } from "@/banco";
import type { ConfigEsocial } from "@/lib/esocial/config";
import type { CertificadoDaPlataforma, CnpjPlataforma, ConfigSerpro } from "@/lib/serpro/config";
import { registroNoBanco } from "@/lib/serpro/registro";
import { ErroDeChave, lerChavePlataforma } from "@/lib/termo/cifra";
import type { AvisoDoSino } from "@/lib/avisos/central";
import type { Papel } from "@/banco/esquema";
import { podeVerNoAdmin } from "@/lib/admin";
import { avisoDoCertificadoDaPlataforma, estadoDoCertificado } from "./aviso";
import { montagemValeAte, montarPlataforma } from "./montagem";
import { lerGuardado, NADA_GUARDADO, versaoDoGuardado, type Guardado } from "./segredos";

// A PLATAFORMA_CHAVE (conferida também na subida, instrumentation.ts). Ausente ou inválida: nada guardado abre.
export function chaveDaPlataforma(): { chave: Buffer | null; motivo: string | null } {
  try {
    return { chave: lerChavePlataforma(process.env.PLATAFORMA_CHAVE, process.env.TOKEN_CHAVE), motivo: null };
  } catch (erro) {
    if (erro instanceof ErroDeChave) return { chave: null, motivo: erro.message };
    throw erro;
  }
}

export type PlataformaDoServidor = {
  plataforma: CnpjPlataforma;
  guardado: Guardado;
  certificado: CertificadoDaPlataforma;
  serpro: ConfigSerpro;
  esocial: ConfigEsocial;
  cliente: ClienteSerpro | null;
};

let montado: { versao: string; valeAte: number; valor: PlataformaDoServidor } | undefined;

async function lerDoBanco(): Promise<{ versao: string; guardado: () => Promise<Guardado> }> {
  try {
    const versao = await versaoDoGuardado(banco());
    return { versao, guardado: () => lerGuardado(banco(), chaveDaPlataforma().chave) };
  } catch (erro) {
    // Banco fora do ar ou sem a migração: segue com o ambiente (CERT_PFX_PATH etc.), sem derrubar a página.
    console.error("[plataforma] Não foi possível ler o certificado e as chaves guardados:", (erro as Error).message);
    return { versao: "sem-banco", guardado: async () => NADA_GUARDADO };
  }
}

export async function plataformaDoServidor(): Promise<PlataformaDoServidor> {
  const agora = new Date();
  const lido = await lerDoBanco();
  const versao = lido.versao;
  if (montado?.versao === versao && agora.getTime() < montado.valeAte) return montado.valor;
  const guardado = await lido.guardado();
  const { plataforma, certificado, serpro, esocial } = montarPlataforma(process.env, guardado, agora);
  if (!serpro.pronto) console.warn(`[serpro] ${serpro.motivo}`);
  if (!esocial.pronto) console.warn(`[esocial] ${esocial.motivo}`);
  const cliente = serpro.pronto
    ? criarClienteSerpro({
        consumerKey: serpro.consumerKey,
        consumerSecret: serpro.consumerSecret,
        certificado: serpro.certificado,
        contratante: serpro.contratante,
        limitePorPeriodo: serpro.limitePorPeriodo,
        registro: registroNoBanco(banco()),
      })
    : null;
  const valor = { plataforma, guardado, certificado, serpro, esocial, cliente };
  montado = { versao, valeAte: montagemValeAte(valor, agora), valor };
  return valor;
}

// Os avisos de administração que este papel vê: só quem abre a página para onde levam (/admin/plataforma, só o ADMIN).
// O sino (app/(painel)/layout.tsx) e a página Avisos usam esta mesma função, para o que o sino conta estar na página.
export async function avisosDoAdminPara(papel: Papel, agora: Date): Promise<AvisoDoSino[]> {
  return podeVerNoAdmin(papel, "/admin/plataforma") ? avisosDoAdmin(agora) : [];
}

// Os avisos do ADMIN (nunca derrubam a página: a falha vai para o log).
export async function avisosDoAdmin(agora: Date): Promise<AvisoDoSino[]> {
  try {
    return avisoDoCertificadoDaPlataforma(estadoDoCertificado(await plataformaDoServidor()), agora);
  } catch (erro) {
    console.error("[plataforma] Aviso do certificado da plataforma não montado:", (erro as Error).message);
    return [];
  }
}
