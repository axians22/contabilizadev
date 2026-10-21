// PDFs guardados do histórico (extrato da declaração ou a própria declaração do mês sem DAS, relatório de situação fiscal, DEFIS e recibo): só saem por aqui,
// pela porta de acesso (a linha tem de ser da empresa do acesso), para a rota de documentos (app/documentos), que confere
// a sessão e o portão. Nunca há endereço público para o arquivo.
import { eq } from "drizzle-orm";
import type { Banco } from "@/banco";
import { defis, pgdasdExtratos, situacoesFiscais } from "@/banco/esquema";
import { daEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { pdfDaGuia } from "@/lib/rotina/guias";
import { pdfDoEnvio } from "@/lib/rotina/pgdasd";

// Da rotina do mês (Parte 6): as guias geradas (DAS e DARF) e a declaração e o recibo do PGDAS-D transmitido aqui.
export const TIPOS_DE_DOCUMENTO = ["extrato", "situacao", "defis", "recibo-defis", "guia", "declaracao-pgdasd", "recibo-pgdasd"] as const;
export type TipoDeDocumento = (typeof TIPOS_DE_DOCUMENTO)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const enderecoDoDocumento = (tipo: TipoDeDocumento, id: string) => `/documentos/${tipo}/${id}`;

export async function documentoDaEmpresa(banco: Banco, acesso: AcessoEmpresa, tipo: string, id: string): Promise<{ nome: string; pdf: Buffer } | null> {
  if (!UUID.test(id) || !(TIPOS_DE_DOCUMENTO as readonly string[]).includes(tipo)) return null;
  if (tipo === "extrato") {
    const [l] = await banco
      .select({ pa: pgdasdExtratos.pa, origem: pgdasdExtratos.origem, pdf: pgdasdExtratos.pdf })
      .from(pgdasdExtratos)
      .where(daEmpresa(acesso, pgdasdExtratos, eq(pgdasdExtratos.id, id)));
    return l ? { nome: `${l.origem === "declaracao" ? "declaracao" : "extrato"}-${l.pa}.pdf`, pdf: l.pdf } : null;
  }
  if (tipo === "guia") return pdfDaGuia(banco, acesso, id);
  if (tipo === "declaracao-pgdasd") return pdfDoEnvio(banco, acesso, id, "declaracao");
  if (tipo === "recibo-pgdasd") return pdfDoEnvio(banco, acesso, id, "recibo");
  if (tipo === "situacao") {
    const [l] = await banco
      .select({ prontoEm: situacoesFiscais.prontoEm, pdf: situacoesFiscais.pdf })
      .from(situacoesFiscais)
      .where(daEmpresa(acesso, situacoesFiscais, eq(situacoesFiscais.id, id)));
    return l?.pdf ? { nome: `situacao-fiscal-${(l.prontoEm ?? new Date()).toISOString().slice(0, 10)}.pdf`, pdf: l.pdf } : null;
  }
  const [l] = await banco
    .select({ ano: defis.ano, declaracao: defis.declaracaoPdf, recibo: defis.reciboPdf })
    .from(defis)
    .where(daEmpresa(acesso, defis, eq(defis.id, id)));
  const pdf = tipo === "defis" ? l?.declaracao : l?.recibo;
  return l && pdf ? { nome: `${tipo === "defis" ? "defis" : "recibo-defis"}-${l.ano}.pdf`, pdf } : null;
}
