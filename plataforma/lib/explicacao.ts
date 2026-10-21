// Regras do tooltip único da aplicação (app/explicacao.tsx): quando o balão abre ou fecha e onde ele fica na tela.
// Sem DOM: a tela mede o gatilho, o balão e a janela e pergunta aqui, o que deixa tudo testável com node --test.

// ---------------------------------------------------------------------------------------------------------------
// Abrir e fechar

// O balão fica aberto por três motivos independentes: o mouse está no gatilho ou no balão (passou), o gatilho tem o
// foco do teclado (focou) ou a pessoa clicou/tocou/apertou Enter (fixo). Separar os três evita que tirar o mouse feche
// o que foi aberto pelo clique, e que um toque no celular (que também foca o botão) abra e feche na mesma hora.
export type EstadoExplicacao = { passou: boolean; focou: boolean; fixo: boolean };

export type EventoExplicacao =
  | { tipo: "entrou" } // mouse entrou no gatilho ou no balão (toque não conta: no celular quem abre é o toque)
  | { tipo: "saiu" } // mouse saiu do gatilho e do balão (a tela espera um pouco antes, para dar tempo de chegar ao balão)
  | { tipo: "focou" }
  | { tipo: "desfocou" } // o foco saiu do gatilho e do balão
  | { tipo: "alternar" } // clique, toque, Enter ou Espaço no botão
  | { tipo: "esc" }
  | { tipo: "fora" }; // clique ou toque fora do gatilho e do balão

export const FECHADA: EstadoExplicacao = { passou: false, focou: false, fixo: false };

export const aberta = (e: EstadoExplicacao) => e.passou || e.focou || e.fixo;

export function reduzirExplicacao(estado: EstadoExplicacao, evento: EventoExplicacao): EstadoExplicacao {
  switch (evento.tipo) {
    case "entrou":
      return estado.passou ? estado : { ...estado, passou: true };
    case "saiu":
      return estado.passou ? { ...estado, passou: false } : estado;
    case "focou":
      return estado.focou ? estado : { ...estado, focou: true };
    case "desfocou":
      // Sair com Tab fecha mesmo o que foi aberto com Enter: o balão não fica solto longe do foco.
      return { ...estado, focou: false, fixo: false };
    case "alternar":
      // Aberto pelo clique: o segundo clique fecha tudo. Aberto só pelo mouse ou pelo foco (o toque no celular foca
      // antes do clique): o clique deixa fixo, para não fechar ao tirar o mouse.
      return estado.fixo ? FECHADA : { ...estado, fixo: true };
    case "esc":
    case "fora":
      return FECHADA;
  }
}

// Espera (ms) entre o mouse sair do gatilho e o balão fechar: tempo de atravessar o espaço até o balão.
export const ESPERA_AO_SAIR_MS = 150;

// ---------------------------------------------------------------------------------------------------------------
// Posição

export const LARGURA_MAXIMA = 320; // px: linha confortável de ler (uns 45 caracteres no texto pequeno)
export const MARGEM = 16; // px de folga até a borda da janela (a mesma margem lateral das telas no celular)
export const DISTANCIA = 8; // px entre o gatilho e o balão

export type Retangulo = { esquerda: number; topo: number; largura: number; altura: number };
// Área visível da tela. `esquerda`/`topo`: onde ela começa nas coordenadas do position: fixed (diferente de 0 quando a
// pessoa amplia com os dedos no celular e arrasta a tela).
export type Janela = { largura: number; altura: number; esquerda?: number; topo?: number };

type VisorDoNavegador = { width: number; height: number; offsetLeft: number; offsetTop: number };

// Mede pela window.visualViewport (o que a pessoa vê de fato) quando existe; senão, pela janela de layout. Assim o balão
// não abre fora da área visível com zoom no celular (onde innerHeight pode ser bem maior do que a tela).
export function janelaVisivel(layout: { largura: number; altura: number }, visor?: VisorDoNavegador | null): Janela {
  if (!visor || !(visor.width > 0) || !(visor.height > 0)) return { largura: layout.largura, altura: layout.altura, esquerda: 0, topo: 0 };
  return {
    largura: Math.min(visor.width, layout.largura || visor.width),
    altura: visor.height,
    esquerda: visor.offsetLeft || 0,
    topo: visor.offsetTop || 0,
  };
}
export type Lado = "baixo" | "cima";
export type Posicao = { lado: Lado; esquerda: number; topo: number; largura: number; seta: number };

export const LARGURA_DO_CELULAR = 640; // px: abaixo disso (o "sm" do Tailwind), o balão ocupa a largura da tela

// Largura do balão: no celular, a tela toda menos as margens (alinhado às duas bordas); no computador, a máxima legível.
export function larguraDoBalao(janela: Janela): number {
  const disponivel = Math.max(0, janela.largura - 2 * MARGEM);
  return janela.largura < LARGURA_DO_CELULAR ? disponivel : Math.min(LARGURA_MAXIMA, disponivel);
}

// Altura máxima do balão: a janela menos as margens (o resto rola dentro dele).
export const alturaMaxima = (janela: Janela) => Math.max(0, janela.altura - 2 * MARGEM);

const entre = (x: number, min: number, max: number) => Math.min(Math.max(x, min), Math.max(min, max));

// Onde desenhar o balão (coordenadas da janela, como position: fixed). Prefere embaixo do gatilho; vai para cima se
// embaixo não couber e em cima couber (ou se em cima houver mais espaço). Na horizontal, centraliza no gatilho e encosta
// na margem quando passaria da borda. `seta` é a posição da setinha dentro do balão, apontando para o meio do gatilho.
export function posicionarBalao(gatilhoNaTela: Retangulo, alturaDoBalao: number, janela: Janela): Posicao {
  // Calcula dentro da área visível e devolve nas coordenadas da tela.
  const dx = janela.esquerda ?? 0;
  const dy = janela.topo ?? 0;
  const gatilho = { ...gatilhoNaTela, esquerda: gatilhoNaTela.esquerda - dx, topo: gatilhoNaTela.topo - dy };
  const largura = larguraDoBalao(janela);
  const embaixo = janela.altura - (gatilho.topo + gatilho.altura) - DISTANCIA - MARGEM;
  const emCima = gatilho.topo - DISTANCIA - MARGEM;
  const lado: Lado = alturaDoBalao <= embaixo ? "baixo" : alturaDoBalao <= emCima || emCima > embaixo ? "cima" : "baixo";
  const desejado = lado === "baixo" ? gatilho.topo + gatilho.altura + DISTANCIA : gatilho.topo - DISTANCIA - alturaDoBalao;
  // Não coube em nenhum lado (janela baixa, texto longo): fica dentro da tela, e o balão rola por dentro (alturaMaxima).
  const topo = entre(desejado, MARGEM, janela.altura - MARGEM - alturaDoBalao);
  const meio = gatilho.esquerda + gatilho.largura / 2;
  const esquerda = entre(meio - largura / 2, MARGEM, janela.largura - MARGEM - largura);
  // A seta fica dentro do balão, longe dos cantos arredondados.
  const seta = entre(meio - esquerda, 12, largura - 12);
  return { lado, esquerda: esquerda + dx, topo: topo + dy, largura, seta };
}
