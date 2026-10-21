// Pagamentos das guias (DAS e DARF do INSS) pelo Serpro (PAGTOWEB, consulta de pagamentos).
// Regras de custo: uma chamada cobre todos os meses; cada guia é procurada automaticamente no máximo uma vez, e só
// depois do vencimento. A busca manual ignora essa restrição.
import { somarMeses, vencimento } from "../meses.ts";
import { pdfDoBase64, RESPOSTA_SEM_PDF } from "../pdf.ts";
import { falha, falhaDoErro, respostaOk, textoMensagens, type ClienteSerpro, type Contexto, type Resultado } from "./cliente.ts";
import { TIPOS_GUIA, type TipoGuia } from "./guias.ts";

const RECEITA_INSS = "1099"; // CP descontada do segurado contribuinte individual (11% do pró-labore)

type Campo = { codigo?: string | number | null; descricao?: string | null } | string | null | undefined;
export type DocumentoPago = {
  numeroDocumento?: string;
  tipo?: Campo;
  periodoApuracao?: string;
  dataArrecadacao?: string;
  receitaPrincipal?: Campo;
  valorTotal?: number;
  valorPrincipal?: number;
  desmembramentos?: { receitaPrincipal?: { codigo?: string | number | null } }[];
};

const codigo = (v: Campo) => (typeof v === "object" && v !== null ? String(v.codigo ?? "") : String(v ?? ""));
const descricao = (v: Campo) => (typeof v === "object" && v !== null ? String(v.descricao ?? "") : String(v ?? ""));

// Tipo 9 = DAS (Simples Nacional). DARF cuja composição tem a receita 1099 = INSS descontado do sócio
// (no topo o DARF da DCTFWeb vem com outro código, como 1410 ou 4444; a receita 1099 fica nos desmembramentos).
export function classificarPagamento(d: DocumentoPago): TipoGuia | null {
  if (codigo(d.tipo) === "9" || /SIMPLES NACIONAL/i.test(descricao(d.tipo))) return "DAS";
  if (codigo(d.receitaPrincipal).startsWith(RECEITA_INSS)) return "INSS";
  if ((d.desmembramentos ?? []).some((p) => String(p.receitaPrincipal?.codigo ?? "") === RECEITA_INSS)) return "INSS";
  return null;
}

export type Pagamento = { numero: string; tipo: TipoGuia; mes: string; pagoEm: string | null; valor: number | null };

// O valor efetivamente pago do documento (PAGTOWEB/PAGAMENTOS71): valorTotal, que inclui multa e juros de uma guia paga
// com atraso; sem ele, o principal. Não confundir com Pagamento.valor, que é o principal (o valor do DAS ou do INSS do mês).
export function valorPago(d: DocumentoPago | null | undefined): number | null {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return n(d?.valorTotal) ?? n(d?.valorPrincipal);
}

// Pagamento de guia que interessa (DAS ou INSS), ou null.
export function lerPagamento(d: DocumentoPago): Pagamento | null {
  const tipo = classificarPagamento(d);
  const mes = (d.periodoApuracao ?? "").slice(0, 7);
  if (!d.numeroDocumento || !tipo || !mes) return null;
  return {
    numero: d.numeroDocumento,
    tipo,
    mes,
    pagoEm: (d.dataArrecadacao ?? "").slice(0, 10) || null,
    valor: d.valorPrincipal ?? d.valorTotal ?? null,
  };
}

// Busca os pagamentos com data de arrecadação entre `de` e `ate` ("AAAA-MM-DD"), em até 3 páginas de 100.
// Devolve os documentos brutos (para guardar) e os pagamentos de guia já lidos. Resposta de erro lança (com o texto da
// API, para o log): uma recusa não pode passar por "nenhum pagamento".
export async function buscarPagamentos(cliente: ClienteSerpro, ctx: Contexto, de: string, ate: string) {
  const documentos: DocumentoPago[] = [];
  for (let pagina = 0; pagina < 3; pagina++) {
    const r = await cliente.chamar(
      "Consultar",
      {
        idSistema: "PAGTOWEB",
        idServico: "PAGAMENTOS71",
        versaoSistema: "1.0",
        dados: { intervaloDataArrecadacao: { dataInicial: de, dataFinal: ate }, primeiroDaPagina: pagina * 100, tamanhoDaPagina: 100 },
      },
      `Buscar valor e data de pagamento das guias pagas de ${de} a ${ate}`,
      ctx,
    );
    if (!respostaOk(r)) throw new Error(textoMensagens(r.mensagens) || `HTTP ${r.status}`);
    const lote = (Array.isArray(r.dados) ? r.dados : []) as DocumentoPago[];
    documentos.push(...lote);
    if (lote.length < 100) break;
  }
  return { documentos, pagamentos: documentos.map(lerPagamento).filter((p): p is Pagamento => p !== null) };
}

// Guias dos 12 meses anteriores a `mesAtual` que ainda precisam ser procuradas. Na busca automática, só as já
// vencidas e nunca procuradas.
export function guiasAProcurar(s: {
  mesAtual: string;
  hoje: string;
  manual: boolean;
  falta: (mes: string, tipo: TipoGuia) => boolean; // sem valor ou sem data de pagamento
  procurada: (mes: string, tipo: TipoGuia) => boolean;
  feriadosExtras?: string[]; // feriados locais, para o vencimento (ver feriados.ts)
}): { mes: string; tipo: TipoGuia }[] {
  const lista: { mes: string; tipo: TipoGuia }[] = [];
  for (let i = 12; i >= 1; i--) {
    const mes = somarMeses(s.mesAtual, -i);
    for (const tipo of TIPOS_GUIA) {
      if (!s.falta(mes, tipo)) continue;
      if (!s.manual && (vencimento(mes, s.feriadosExtras, tipo) >= s.hoje || s.procurada(mes, tipo))) continue;
      lista.push({ mes, tipo });
    }
  }
  return lista;
}

// Comprovante de arrecadação de um documento já pago (DAS ou DARF), pelo número do documento da consulta de pagamentos:
// PAGTOWEB/COMPARRECADACAO72 ("Emitir Comprovante de Arrecadação", tipo Emitir; catálogo de serviços do Integra Contador,
// item 7.2). Entrada: numeroDocumento (até 17 caracteres); saída: o PDF em Base64 (em dados.pdf, ou dados direto).
// É a "guia" que a Receita entrega de um mês pago fora da plataforma: o DAS pago não se emite de novo (GERARDAS12 geraria
// uma guia nova, com multa e juros se já venceu).
export async function emitirComprovante(cliente: ClienteSerpro, ctx: Contexto, numeroDocumento: string): Promise<Resultado<{ pdf: string }>> {
  const numero = numeroDocumento.trim();
  if (!/^\d{1,17}$/.test(numero)) return falha("Não enviado: o número do documento pago tem de ter até 17 dígitos.");
  try {
    const r = await cliente.chamar(
      "Emitir",
      { idSistema: "PAGTOWEB", idServico: "COMPARRECADACAO72", versaoSistema: "1.0", dados: { numeroDocumento: numero } },
      `Emitir o comprovante de arrecadação do documento pago ${numero}`,
      ctx,
    );
    const d = r.dados;
    const pdf = typeof d === "string" ? d : ((d as { pdf?: unknown } | null | undefined)?.pdf ?? (Array.isArray(d) ? (d[0] as { pdf?: unknown } | undefined)?.pdf : undefined));
    if (!respostaOk(r) || typeof pdf !== "string" || !pdf) return falha(textoMensagens(r.mensagens) || `HTTP ${r.status}`);
    if (!pdfDoBase64(pdf)) return falha(`${RESPOSTA_SEM_PDF} (comprovante do documento ${numero}).`);
    return { ok: true, pdf, detalhe: textoMensagens(r.mensagens) };
  } catch (erro) {
    return falhaDoErro(erro);
  }
}
