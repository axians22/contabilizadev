// Extrai o texto simples de um PDF gerado pela Receita (streams FlateDecode com operadores Tj/TJ).
// Não é um leitor de PDF completo: serve para os relatórios do Serpro, que usam fontes padrão.
import zlib from "node:zlib";

// O PDF decodificado do Base64 que a Receita devolve, ou null quando o conteúdo não é um PDF (página de erro em HTML,
// vazio, lixo): a assinatura %PDF- tem de estar no começo (os leitores aceitam até 1024 bytes antes dela).
// Serve para não guardar no banco, como a guia do mês, um arquivo que não abre.
export function pdfDoBase64(base64: string | null | undefined): Buffer | null {
  if (!base64) return null;
  const pdf = Buffer.from(base64, "base64");
  return pdf.subarray(0, 1024).includes("%PDF-") ? pdf : null;
}

// Texto da falha quando a resposta não traz um PDF (mensagemDaFalha da plataforma o reconhece).
export const RESPOSTA_SEM_PDF = "A resposta não é um PDF";

const desescapar = (s: string) =>
  s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c: string) =>
    /^[0-7]/.test(c) ? String.fromCharCode(parseInt(c, 8)) : ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" } as Record<string, string>)[c] ?? c,
  );

export function textoDoPdf(pdf: Buffer): string {
  const bruto = pdf.toString("latin1");
  const partes: string[] = [];
  const inicio = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = inicio.exec(bruto))) {
    const de = m.index + m[0].length;
    const ate = bruto.indexOf("endstream", de);
    if (ate < 0) break;
    let conteudo: string;
    try {
      conteudo = zlib.inflateSync(pdf.subarray(de, ate)).toString("latin1");
    } catch {
      continue;
    }
    for (const t of conteudo.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj|\[((?:\\.|[^\]])*)\]\s*TJ/g)) {
      const texto = t[1] !== undefined ? desescapar(t[1]) : [...t[2].matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map((x) => desescapar(x[1])).join("");
      if (texto.trim()) partes.push(texto.trim());
    }
  }
  return partes.join("\n");
}
