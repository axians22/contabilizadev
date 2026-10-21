// Apoio dos testes de tela: separa, no HTML do servidor, o que fica visível do que está dentro dos tooltips
// (<Explicacao>, app/explicacao.tsx). O balão vai sempre no HTML (escondido, para o leitor de tela), então o texto
// "visível" é o HTML sem os balões.

export const texto = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ");

// Fim do <span> que abre em `inicio`, contando os <span> de dentro.
function fimDoSpan(html: string, inicio: number): number {
  const re = /<span\b|<\/span>/g;
  re.lastIndex = inicio;
  let nivel = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    nivel += m[0] === "</span>" ? -1 : 1;
    if (nivel === 0) return m.index + "</span>".length;
  }
  throw new Error("balão sem fechamento");
}

const INICIO_DO_BALAO = /<span[^>]*\bid="(explicacao-[^"]+)"[^>]*>/g;

// O HTML sem os balões dos tooltips: o que a pessoa vê sem abrir nada.
export function semExplicacoes(html: string): string {
  let saida = "";
  let i = 0;
  for (const m of html.matchAll(INICIO_DO_BALAO)) {
    if (m.index < i) continue; // balão dentro de balão não existe, mas não conta duas vezes
    saida += html.slice(i, m.index);
    i = fimDoSpan(html, m.index);
  }
  return saida + html.slice(i);
}

export type TooltipNoHtml = { rotulo: string; id: string; balao: string; texto: string; botao: string };

// Os tooltips do HTML: o botão (com o rótulo) e o balão a que ele aponta.
export function explicacoes(html: string): TooltipNoHtml[] {
  return [...html.matchAll(/<button[^>]*aria-describedby="(explicacao-[^"]+)"[^>]*>/g)].map((b) => {
    const id = b[1];
    const inicio = html.indexOf(`id="${id}"`);
    const abre = html.lastIndexOf("<span", inicio);
    const balao = html.slice(abre, fimDoSpan(html, abre));
    const rotulo = /aria-label="([^"]*)"/.exec(b[0])?.[1] ?? "";
    return { rotulo: texto(rotulo).trim(), id, balao, texto: texto(balao).trim(), botao: b[0] };
  });
}

// Os parágrafos visíveis (fora dos balões), com o texto de cada um.
export const paragrafosVisiveis = (html: string) => [...semExplicacoes(html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((m) => texto(m[1]).trim());
