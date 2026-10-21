import { banco } from "@/banco";
import { comSessao } from "@/lib/autenticacao/servidor";
import { SemAcessoEmpresa } from "@/lib/empresas/acesso";
import { exigirAcessoAoConteudo } from "@/lib/empresas/portao";
import { documentoDaEmpresa } from "@/lib/historico/documentos";

type Contexto = { params: Promise<{ tipo: string; id: string }> };

// PDF guardado (extrato, situação fiscal, DEFIS, guias e declaração do PGDAS-D transmitida), só da empresa ativa: sessão, vínculo e plano conferidos
// no servidor (portão), e a linha procurada só nessa empresa. De outra empresa, ou que não existe: 404 igual.
export const GET = comSessao(async ({ usuario, empresaAtiva }, _requisicao, { params }: Contexto) => {
  const { tipo, id } = await params;
  try {
    const acesso = await exigirAcessoAoConteudo(banco(), usuario, empresaAtiva?.id);
    const documento = await documentoDaEmpresa(banco(), acesso, tipo, id);
    if (!documento) return Response.json({ erro: "Documento não encontrado." }, { status: 404 });
    return new Response(new Uint8Array(documento.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${documento.nome}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (erro) {
    if (erro instanceof SemAcessoEmpresa) return Response.json({ erro: "Documento não encontrado." }, { status: 404 });
    throw erro;
  }
});
