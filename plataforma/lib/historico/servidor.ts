// Ligação da importação do histórico com o servidor do Next: o banco, o cliente real do contrato, o contexto da empresa
// (termo de autorização e token, lib/termo) e a execução em segundo plano com after() (roda depois da resposta, a tela
// não espera). Só para empresa com a autorização em dia (ou a da própria plataforma); sem ela, nada é planejado.
import "server-only";
import { after } from "next/server";
import { banco } from "@/banco";
import type { AcessoEmpresa } from "@/lib/empresas/acesso";
import { serproDoServidor } from "@/lib/serpro/servidor";
import { termoDoServidor } from "@/lib/termo/servidor";
import { liberada } from "@/lib/termo/situacao";
import { contextoSerpro, situacaoTermo } from "@/lib/termo/termo";
import { executarImportacao, iniciarImportacao, type DependenciasImportacao, type Inicio } from "./importacao";
import { jaImportou } from "./leitura";
import type { Pedido } from "./prazos";

export async function importacaoDoServidor(acesso: AcessoEmpresa): Promise<DependenciasImportacao> {
  const termo = await termoDoServidor();
  return { banco: banco(), cliente: (await serproDoServidor()).cliente, contexto: () => contextoSerpro(termo, acesso) };
}

export type Disparo = Inicio | { estado: "sem-autorizacao" };

// Planeja (banco primeiro) e, se houver o que consultar, roda em segundo plano. Devolve o que aconteceu, para a tela.
export async function atualizarEmSegundoPlano(acesso: AcessoEmpresa, pedido: Pedido): Promise<Disparo> {
  const termo = await termoDoServidor();
  if (!liberada(await situacaoTermo(termo, acesso))) return { estado: "sem-autorizacao" };
  const deps = await importacaoDoServidor(acesso);
  const inicio = await iniciarImportacao(deps, acesso, pedido);
  if (inicio.estado === "iniciada") {
    after(() =>
      executarImportacao(deps, acesso, inicio.id).catch((erro) => console.error("[serpro] Falha inesperada na importação do histórico:", (erro as Error).message)),
    );
  }
  return inicio;
}

// Importação inicial: quando a empresa fica autorizada (fim do passo 7 do cadastro, página Autorização) ou na primeira
// visita autorizada ao painel, se ainda nunca importou. Tudo o que estiver faltando.
export async function importarSeNuncaImportou(acesso: AcessoEmpresa): Promise<void> {
  try {
    if (await jaImportou(banco(), acesso)) return;
    await atualizarEmSegundoPlano(acesso, { grupos: ["historico", "defis", "situacao"], manual: false });
  } catch (erro) {
    console.error("[serpro] Falha ao iniciar a importação do histórico:", (erro as Error).message);
  }
}

// Ao abrir uma aba (Histórico, Situação fiscal, Declaração anual, painel): o que estiver velho pelas regras de prazo
// (prazos.ts) é buscado sozinho em segundo plano; na primeira vez, tudo (importação inicial). Uma falha aqui nunca
// derruba a página: fica no log e a tela mostra o que está guardado.
export async function atualizarAoAbrir(acesso: AcessoEmpresa, grupos: Pedido["grupos"]): Promise<void> {
  try {
    const primeira = !(await jaImportou(banco(), acesso));
    await atualizarEmSegundoPlano(acesso, { grupos: primeira ? ["historico", "defis", "situacao"] : grupos, manual: false });
  } catch (erro) {
    console.error("[serpro] Falha ao planejar a atualização do histórico:", (erro as Error).message);
  }
}
