// A resposta da rota /documentos/guia-do-mes/<tipo>/<mês> (os botões da guia quando o PDF ainda não está aqui): banco
// primeiro; senão, com a autorização em dia, busca na Receita uma única vez (buscarGuiaDoMes) e devolve o PDF, inline
// (nova aba) ou para baixar. Erro vira uma página curta em linguagem simples (a aba foi aberta pelo cliente), nunca o
// texto da API. Pedido vindo de outro site (Sec-Fetch-Site: cross-site) não dispara chamada paga: só o que já está no banco.
import { mesValido } from "@contabilizadev/nucleo/meses";
import type { AcessoEmpresa } from "@/lib/empresas/acesso";
import { documentoDaEmpresa } from "@/lib/historico/documentos";
import { mesAtualNoBrasil } from "@/lib/historico/prazos";
import { recusa, relogio, type DependenciasRotina } from "./dependencias";
import { buscarGuiaDoMes, guiaDoMes, type TipoGuia } from "./guias";
import { MENSAGENS_DA_ROTINA } from "./mensagens";

export type PedidoDaGuia = { tipo: string; pa: string; baixar: boolean; deOutroSite: boolean; usuarioId?: string };

const escapar = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function paginaDeAviso(mensagem: string, status: number): Response {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Guia · ContabilizaDev</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:48px 16px;background:#f7f7f5;color:#1c1c1a}main{max-width:32rem;margin:0 auto}a{color:inherit;font-weight:600}@media (prefers-color-scheme:dark){body{background:#151514;color:#ededeb}}</style></head>
<body><main><h1 style="font-size:1.25rem">Não deu para abrir a guia</h1><p>${escapar(mensagem)}</p><p><a href="/">Voltar ao painel</a></p></main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function respostaDaGuiaDoMes(deps: DependenciasRotina & { autorizada: boolean }, acesso: AcessoEmpresa, pedido: PedidoDaGuia): Promise<Response> {
  const tipo: TipoGuia | null = pedido.tipo === "DAS" || pedido.tipo === "INSS" ? pedido.tipo : null;
  const agora = relogio(deps);
  if (!tipo || !mesValido(pedido.pa) || pedido.pa >= mesAtualNoBrasil(agora)) return paginaDeAviso("Guia não encontrada.", 404);
  let r;
  if (pedido.deOutroSite || !deps.autorizada) {
    // Só banco: a guia (ou o comprovante) já guardada.
    const g = await guiaDoMes(deps.banco, acesso, pedido.pa, tipo, agora);
    const guardada = g.original ?? (g.paga ? g.comprovante : null) ?? null;
    r = guardada ? { ok: true as const, guia: guardada } : recusa(pedido.deOutroSite ? "Abra a guia pelo painel da plataforma." : MENSAGENS_DA_ROTINA.guiaSemAutorizacao);
  } else {
    r = await buscarGuiaDoMes(deps, acesso, pedido.pa, tipo, { usuarioId: pedido.usuarioId });
  }
  if (!r.ok) return paginaDeAviso(r.mensagem, 409);
  const documento = await documentoDaEmpresa(deps.banco, acesso, "guia", r.guia.id);
  if (!documento) return paginaDeAviso("Guia não encontrada.", 404);
  return new Response(new Uint8Array(documento.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${pedido.baixar ? "attachment" : "inline"}; filename="${documento.nome}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
