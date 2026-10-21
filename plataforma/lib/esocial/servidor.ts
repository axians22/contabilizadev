// Ligação do eSocial com o servidor do Next: o banco, o cliente real do eSocial com o certificado da plataforma (o
// transmissor, lido por lib/plataforma/servidor.ts como tudo o mais; registro das chamadas por empresa), se a empresa é a
// da própria plataforma (assina no servidor) e o acompanhamento em segundo plano com after() (consulta o resultado dos lotes sem a tela esperar).
import "server-only";
import { after } from "next/server";
import { criarClienteEsocial } from "@contabilizadev/nucleo/esocial/ws";
import { banco } from "@/banco";
import type { AcessoEmpresa } from "@/lib/empresas/acesso";
import { certificadoDaPlataforma } from "@/lib/rotina/servidor";
import { termoDoServidor } from "@/lib/termo/servidor";
import { situacaoTermo } from "@/lib/termo/termo";
import { plataformaDoServidor } from "@/lib/plataforma/servidor";
import type { ConfigEsocial } from "./config";
import { acompanharEnvio, enviosParaConsultar, type DependenciasEsocial } from "./envio";
import { registroEsocialNoBanco } from "./registro";

export async function configEsocialDoServidor(): Promise<ConfigEsocial> {
  return (await plataformaDoServidor()).esocial;
}

export async function esocialDoServidor(acesso: AcessoEmpresa): Promise<DependenciasEsocial> {
  const c = await configEsocialDoServidor();
  const propria = (await situacaoTermo(await termoDoServidor(), acesso)).estado === "propria";
  return {
    banco: banco(),
    cliente: c.pronto ? criarClienteEsocial({ certificado: c.certificado, registro: registroEsocialNoBanco(banco(), acesso.empresaId) }) : null,
    transmissor: c.pronto ? c.transmissor : null,
    propria,
    certificadoDaPlataforma: await certificadoDaPlataforma(),
  };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Depois de um envio: consulta o resultado algumas vezes em segundo plano (o eSocial costuma processar em segundos ou
// poucos minutos); aceito o lote, o seguinte vai sozinho. O que sobrar a tela consulta ao abrir (acompanharAoAbrir).
export function acompanharDepois(deps: DependenciasEsocial, acesso: AcessoEmpresa, envioId: string, vezes = 8) {
  after(async () => {
    try {
      for (let i = 0; i < vezes; i++) {
        await esperar(15_000);
        const r = await acompanharEnvio(deps, acesso, envioId);
        if (r.ok && r.estado !== "aguardando" && r.estado !== "enviando") return;
      }
    } catch (erro) {
      console.error("[esocial] Falha ao acompanhar o envio:", (erro as Error).message);
    }
  });
}

// Ao abrir a tela: os envios cuja próxima consulta já venceu são consultados em segundo plano (nunca derruba a página).
export async function acompanharAoAbrir(acesso: AcessoEmpresa): Promise<void> {
  try {
    const deps = await esocialDoServidor(acesso);
    if (!deps.cliente) return;
    const pendentes = await enviosParaConsultar(deps.banco, acesso, new Date());
    if (pendentes.length) after(async () => {
      for (const e of pendentes) await acompanharEnvio(deps, acesso, e.id).catch((erro) => console.error("[esocial] Falha ao consultar o lote:", (erro as Error).message));
    });
  } catch (erro) {
    console.error("[esocial] Falha ao planejar a consulta dos lotes:", (erro as Error).message);
  }
}
