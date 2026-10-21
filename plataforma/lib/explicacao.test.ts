import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  janelaVisivel,
  aberta,
  alturaMaxima,
  DISTANCIA,
  FECHADA,
  LARGURA_MAXIMA,
  larguraDoBalao,
  MARGEM,
  posicionarBalao,
  reduzirExplicacao,
  type EstadoExplicacao,
  type EventoExplicacao,
} from "./explicacao";

// Aplica uma sequência de eventos a partir do balão fechado.
const apos = (...eventos: EventoExplicacao["tipo"][]): EstadoExplicacao =>
  eventos.reduce((e, tipo) => reduzirExplicacao(e, { tipo } as EventoExplicacao), FECHADA);

describe("tooltip: abrir e fechar", () => {
  it("começa fechado", () => {
    assert.equal(aberta(FECHADA), false);
  });

  it("mouse: abre ao passar e fecha ao sair (do gatilho e do balão)", () => {
    assert.equal(aberta(apos("entrou")), true);
    assert.equal(aberta(apos("entrou", "saiu")), false);
  });

  it("mouse: ir do gatilho para o balão não fecha (a saída espera e a entrada no balão cancela)", () => {
    // A tela só despacha "saiu" depois da espera; se o mouse entrou no balão antes, a espera é cancelada e o
    // estado continua com o mouse em cima.
    assert.equal(aberta(apos("entrou", "entrou")), true);
  });

  it("teclado: abre ao focar com Tab e fecha ao sair com Tab", () => {
    assert.equal(aberta(apos("focou")), true);
    assert.equal(aberta(apos("focou", "desfocou")), false);
  });

  it("teclado: Enter/Espaço deixa aberto; de novo, fecha", () => {
    assert.equal(aberta(apos("focou", "alternar")), true);
    assert.equal(aberta(apos("focou", "alternar", "alternar")), false);
  });

  it("Esc fecha o que estiver aberto, por qualquer motivo", () => {
    assert.equal(aberta(apos("entrou", "focou", "alternar", "esc")), false);
    assert.equal(aberta(apos("focou", "esc")), false);
    assert.equal(aberta(apos("entrou", "esc")), false);
  });

  it("clique fora fecha", () => {
    assert.equal(aberta(apos("focou", "alternar", "fora")), false);
    assert.equal(aberta(apos("entrou", "fora")), false);
  });

  it("clique com o mouse: fica aberto mesmo tirando o mouse; o segundo clique fecha", () => {
    const clicou = apos("entrou", "focou", "alternar");
    assert.equal(aberta(reduzirExplicacao(clicou, { tipo: "saiu" })), true);
    assert.equal(aberta(apos("entrou", "focou", "alternar", "saiu", "alternar")), false);
  });

  it("toque no celular: o toque foca e clica; abre no primeiro e fecha no segundo (sem abrir e fechar de uma vez)", () => {
    // Navegadores de celular focam o botão no toque e depois disparam o clique; "entrou" não vem do toque.
    const primeiro = apos("focou", "alternar");
    assert.equal(aberta(primeiro), true);
    assert.equal(aberta(reduzirExplicacao(primeiro, { tipo: "alternar" })), false);
    // Safari no iPhone não foca botão no toque: só o clique abre, e o próximo fecha.
    assert.equal(aberta(apos("alternar")), true);
    assert.equal(aberta(apos("alternar", "alternar")), false);
  });

  it("depois do Esc, só reabre com uma nova ação (o foco que ficou no botão não reabre sozinho)", () => {
    const fechado = apos("focou", "esc");
    assert.deepEqual(fechado, FECHADA);
    assert.equal(aberta(reduzirExplicacao(fechado, { tipo: "focou" })), true);
  });

  it("sair com Tab fecha mesmo o que foi aberto com Enter (o balão não fica longe do foco)", () => {
    assert.equal(aberta(apos("focou", "alternar", "desfocou")), false);
  });

  it("evento que não muda nada devolve o mesmo estado (sem render à toa)", () => {
    const e = apos("entrou");
    assert.equal(reduzirExplicacao(e, { tipo: "entrou" }), e);
    assert.equal(reduzirExplicacao(FECHADA, { tipo: "saiu" }), FECHADA);
  });
});

describe("tooltip: posição", () => {
  const desktop = { largura: 1280, altura: 800 };
  const celular = { largura: 360, altura: 640 };
  const gatilho = (esquerda: number, topo: number) => ({ esquerda, topo, largura: 24, altura: 24 });

  it("largura máxima legível no computador; no celular, a tela menos as margens", () => {
    assert.equal(larguraDoBalao(desktop), LARGURA_MAXIMA);
    assert.equal(larguraDoBalao(celular), 360 - 2 * MARGEM);
    assert.equal(larguraDoBalao({ largura: 639, altura: 800 }), 639 - 2 * MARGEM);
    assert.equal(larguraDoBalao({ largura: 640, altura: 800 }), LARGURA_MAXIMA);
    assert.equal(larguraDoBalao({ largura: 20, altura: 100 }), 0);
  });

  it("altura máxima: a janela menos as margens", () => {
    assert.equal(alturaMaxima(desktop), 800 - 2 * MARGEM);
    assert.equal(alturaMaxima({ largura: 100, altura: 10 }), 0);
  });

  it("com espaço, fica embaixo do gatilho, centralizado, com a seta no meio do gatilho", () => {
    const p = posicionarBalao(gatilho(600, 100), 120, desktop);
    assert.equal(p.lado, "baixo");
    assert.equal(p.topo, 100 + 24 + DISTANCIA);
    assert.equal(p.esquerda, 612 - LARGURA_MAXIMA / 2);
    assert.equal(p.esquerda + p.seta, 612);
  });

  it("sem espaço embaixo (gatilho no pé da tela), vai para cima", () => {
    const p = posicionarBalao(gatilho(600, 740), 120, desktop);
    assert.equal(p.lado, "cima");
    assert.equal(p.topo, 740 - DISTANCIA - 120);
  });

  it("não cabe em nenhum lado: escolhe o lado com mais espaço e não sai da tela", () => {
    const baixa = { largura: 1280, altura: 300 };
    const perto = posicionarBalao(gatilho(600, 60), 260, baixa); // mais espaço embaixo
    assert.equal(perto.lado, "baixo");
    const longe = posicionarBalao(gatilho(600, 230), 260, baixa); // mais espaço em cima
    assert.equal(longe.lado, "cima");
    for (const p of [perto, longe]) {
      assert.ok(p.topo >= MARGEM, `topo ${p.topo}`);
      assert.ok(p.topo + 260 <= baixa.altura - MARGEM + 0.001 || p.topo === MARGEM, `fundo ${p.topo + 260}`);
    }
  });

  it("gatilho perto do canto esquerdo: encosta na margem, e a seta continua apontando para o gatilho", () => {
    const p = posicionarBalao(gatilho(20, 100), 80, desktop);
    assert.equal(p.esquerda, MARGEM);
    assert.equal(p.esquerda + p.seta, 32);
    // Colado na borda: a seta para no limite, longe do canto arredondado do balão.
    assert.equal(posicionarBalao(gatilho(0, 100), 80, desktop).seta, 12);
  });

  it("gatilho no canto direito: encosta na margem direita", () => {
    const p = posicionarBalao(gatilho(1250, 100), 80, desktop);
    assert.equal(p.esquerda + p.largura, desktop.largura - MARGEM);
    assert.ok(p.seta <= p.largura - 12);
  });

  it("celular: o balão ocupa a largura toda, alinhado às duas margens, onde quer que esteja o gatilho", () => {
    for (const x of [0, 160, 330]) {
      const p = posicionarBalao(gatilho(x, 200), 100, celular);
      assert.equal(p.esquerda, MARGEM);
      assert.equal(p.esquerda + p.largura, celular.largura - MARGEM);
      assert.ok(p.seta >= 12 && p.seta <= p.largura - 12);
    }
  });

  it("nunca sai da tela na horizontal (varredura de posições e larguras)", () => {
    for (const largura of [320, 375, 768, 1440]) {
      const janela = { largura, altura: 700 };
      for (let x = -10; x <= largura + 10; x += 37) {
        const p = posicionarBalao(gatilho(x, 300), 150, janela);
        assert.ok(p.esquerda >= MARGEM - 0.001, `${largura}/${x}: esquerda ${p.esquerda}`);
        assert.ok(p.esquerda + p.largura <= largura - MARGEM + 0.001, `${largura}/${x}: direita ${p.esquerda + p.largura}`);
      }
    }
  });

  it("mede pela área visível (visualViewport) quando existe; sem ela, pela janela de layout", () => {
    // Celular com a página mais larga que a tela: a janela de layout fica bem mais alta do que o que se vê.
    const j = janelaVisivel({ largura: 360, altura: 1192 }, { width: 360, height: 640, offsetLeft: 0, offsetTop: 0 });
    assert.deepEqual(j, { largura: 360, altura: 640, esquerda: 0, topo: 0 });
    assert.deepEqual(janelaVisivel({ largura: 1280, altura: 800 }, null), { largura: 1280, altura: 800, esquerda: 0, topo: 0 });
    assert.deepEqual(janelaVisivel({ largura: 1280, altura: 800 }, { width: 0, height: 0, offsetLeft: 0, offsetTop: 0 }), { largura: 1280, altura: 800, esquerda: 0, topo: 0 });
    // O gatilho no meio da área visível (y=600 numa tela de 640) abre o balão para cima, dentro do que se vê.
    const p = posicionarBalao(gatilho(160, 600), 200, j);
    assert.equal(p.lado, "cima");
    assert.ok(p.topo >= MARGEM && p.topo + 200 <= 640 - MARGEM);
  });

  it("com zoom e a tela arrastada, o balão fica dentro da área visível deslocada", () => {
    const j = janelaVisivel({ largura: 360, altura: 640 }, { width: 180, height: 320, offsetLeft: 100, offsetTop: 200 });
    const p = posicionarBalao(gatilho(150, 250), 100, j);
    assert.equal(p.lado, "baixo");
    assert.equal(p.topo, 250 + 24 + DISTANCIA);
    assert.ok(p.esquerda >= 100 + MARGEM - 0.001 && p.esquerda + p.largura <= 100 + 180 - MARGEM + 0.001, `${p.esquerda}/${p.largura}`);
    assert.ok(p.topo + 100 <= 200 + 320 - MARGEM);
    // A seta continua apontando para o meio do gatilho.
    assert.equal(p.esquerda + p.seta, 162);
  });
});
