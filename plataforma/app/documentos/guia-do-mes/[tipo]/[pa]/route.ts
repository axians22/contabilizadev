import { comSessao } from "@/lib/autenticacao/servidor";
import { banco } from "@/banco";
import { SemAcessoEmpresa } from "@/lib/empresas/acesso";
import { exigirAcessoAoConteudo } from "@/lib/empresas/portao";
import { paginaDeAviso, respostaDaGuiaDoMes } from "@/lib/rotina/documento-da-guia";
import { rotinaDoServidor } from "@/lib/rotina/servidor";

type Contexto = { params: Promise<{ tipo: string; pa: string }> };

// Os botões da guia do mês quando o PDF ainda não está no banco (ex.: mês importado da Receita): só da empresa ativa, com a
// sessão, o vínculo e o plano conferidos no servidor (portão). Banco primeiro; senão busca na Receita uma única vez e
// guarda (lib/rotina/documento-da-guia.ts). ?baixar=1 devolve para baixar; sem ele, abre na aba.
export const GET = comSessao(async ({ usuario, empresaAtiva }, requisicao, { params }: Contexto) => {
  const { tipo, pa } = await params;
  try {
    const acesso = await exigirAcessoAoConteudo(banco(), usuario, empresaAtiva?.id);
    const deps = await rotinaDoServidor(acesso);
    const url = new URL(requisicao.url);
    return await respostaDaGuiaDoMes(deps, acesso, {
      tipo,
      pa,
      baixar: url.searchParams.get("baixar") === "1",
      deOutroSite: requisicao.headers.get("sec-fetch-site") === "cross-site",
      usuarioId: usuario.id,
    });
  } catch (erro) {
    if (erro instanceof SemAcessoEmpresa) return paginaDeAviso("Guia não encontrada.", 404);
    console.error("[serpro] Falha inesperada ao buscar a guia do mês:", (erro as Error).message);
    return paginaDeAviso("A Receita Federal não respondeu agora. Nada foi alterado; tente de novo mais tarde.", 502);
  }
});
