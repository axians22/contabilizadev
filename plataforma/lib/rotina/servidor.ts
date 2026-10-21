// Ligação da rotina do mês com o servidor do Next: o banco, o cliente real do contrato, o contexto da empresa (termo de
// autorização e token, lib/termo), o certificado da plataforma (só para a DCTFWeb da própria empresa da plataforma) e o
// fetch da PTAX. Quem chama confere antes a autorização (liberada) e o portão.
import "server-only";
import type { Pem } from "@contabilizadev/nucleo/certificado";
import { banco } from "@/banco";
import type { AcessoEmpresa } from "@/lib/empresas/acesso";
import { plataformaDoServidor } from "@/lib/plataforma/servidor";
import { serproDoServidor } from "@/lib/serpro/servidor";
import { termoDoServidor } from "@/lib/termo/servidor";
import { liberada } from "@/lib/termo/situacao";
import { contextoSerpro, situacaoTermo } from "@/lib/termo/termo";
import type { DependenciasRotina } from "./dependencias";

// O certificado da plataforma em PEM, para assinar como a própria plataforma (a DCTFWeb e o eSocial da empresa dela). Lido
// pela mesma função de tudo (lib/plataforma/servidor.ts); aberto só quando alguém pede e uma vez por montagem.
export async function certificadoDaPlataforma(): Promise<() => Pem | null> {
  const { certificado } = await plataformaDoServidor();
  return () => {
    if (!certificado.pronto) return null;
    try {
      return certificado.pem();
    } catch (erro) {
      console.error("[serpro] Não foi possível abrir o certificado da plataforma:", (erro as Error).message);
      return null;
    }
  };
}

export async function rotinaDoServidor(acesso: AcessoEmpresa): Promise<DependenciasRotina & { autorizada: boolean }> {
  const termo = await termoDoServidor();
  const autorizada = liberada(await situacaoTermo(termo, acesso));
  return {
    banco: banco(),
    cliente: (await serproDoServidor()).cliente,
    contexto: () => contextoSerpro(termo, acesso),
    certificadoDaPlataforma: await certificadoDaPlataforma(),
    autorizada,
  };
}
