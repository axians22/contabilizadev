// Converte o conteúdo HTML das mensagens da Caixa Postal em parágrafos de texto e links,
// sem renderizar HTML vindo de fora (nada de dangerouslySetInnerHTML).

const ENTIDADES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ordm: "º", ordf: "ª", deg: "°",
  ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  sect: "§", copy: "©", reg: "®", middot: "·", bull: "•",
};
const ACENTOS: Record<string, string> = { acute: "́", grave: "̀", circ: "̂", tilde: "̃", uml: "̈", cedil: "̧" };

export function decodificar(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (inteiro, nome: string) => {
    if (nome[0] === "#") {
      const n = nome[1].toLowerCase() === "x" ? parseInt(nome.slice(2), 16) : parseInt(nome.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : inteiro;
    }
    if (ENTIDADES[nome]) return ENTIDADES[nome];
    // Letras acentuadas: &atilde; = a + til, &Ccedil; = C + cedilha etc.
    const acento = Object.keys(ACENTOS).find((a) => nome.length === a.length + 1 && nome.endsWith(a));
    return acento ? (nome[0] + ACENTOS[acento]).normalize("NFC") : inteiro;
  });
}

export type Trecho = { texto: string; link?: string };

const ECAC = "https://cav.receita.fazenda.gov.br";

function linkSeguro(href: string): string | undefined {
  const url = decodificar(href.trim());
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return ECAC + url; // links relativos são do e-CAC
  return undefined; // javascript:, mailto: e outros ficam como texto
}

const limpar = (s: string) => decodificar(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ");

// Divide em parágrafos (<p>, <br>, <li>, <div>) e mantém os links como trechos clicáveis.
export function paragrafos(html: string): Trecho[][] {
  const blocos = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "• ")
    .split(/\n+/);
  const resultado: Trecho[][] = [];
  for (const bloco of blocos) {
    const trechos: Trecho[] = [];
    let resto = bloco;
    const a = /<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/i;
    let m: RegExpExecArray | null;
    while ((m = a.exec(resto))) {
      const antes = limpar(resto.slice(0, m.index));
      if (antes.trim()) trechos.push({ texto: antes });
      const texto = limpar(m[2]).trim() || limpar(m[1]);
      trechos.push({ texto, link: linkSeguro(m[1]) });
      resto = resto.slice(m.index + m[0].length);
    }
    const depois = limpar(resto);
    if (depois.trim()) trechos.push({ texto: depois });
    if (trechos.some((t) => t.texto.trim())) {
      trechos[0].texto = trechos[0].texto.replace(/^\s+/, "");
      resultado.push(trechos);
    }
  }
  return resultado;
}
