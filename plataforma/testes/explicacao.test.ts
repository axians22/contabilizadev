// Tooltip único da aplicação (app/explicacao.tsx) e a regra de tela "explicações vão no tooltip": o componente é
// acessível no HTML que o navegador recebe, é o único tooltip/popover/"saiba mais" do código, e as telas do portão,
// do automático, da ficha da empresa, do sino, dos planos e da configuração deixam a explicação no tooltip.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { lerRespostaCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { respostaGravada } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { diagnosticar } from "@contabilizadev/nucleo/diagnostico";
import { Explicacao, ExplicacaoDoTermo } from "@/app/explicacao";
import { PortaoFechado } from "@/app/(painel)/portao";
import { SinoVisual as Sino } from "@/app/(painel)/sino-visual";
import { avisoDoTermo } from "@/lib/avisos/fontes";
import { CartaoAutorizacao } from "@/app/(painel)/autorizacao/cartao-autorizacao";
import { Requisitos } from "@/app/(painel)/autorizacao/requisitos";
import { CartaoDiagnostico, FichaReceita } from "@/app/(painel)/empresa/ficha";
import { Assistente } from "@/app/(painel)/empresas/nova/assistente";
import { FacaNoPortal } from "@/app/(painel)/faca-no-portal";
import { ABAS_DA_EMPRESA } from "@/lib/abas";
import { GLOSSARIO, type Termo } from "@/lib/empresas/glossario";
import type { Situacao } from "@/lib/termo/situacao";
import { explicacoes, paragrafosVisiveis, semExplicacoes, texto } from "./tela";

const RAIZ = path.join(import.meta.dirname, "..");
const APP = path.join(RAIZ, "app");
const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const visivel = (html: string) => texto(semExplicacoes(html));

// Tela enxuta: parágrafos visíveis curtos e todo tooltip acessível.
function conferir(html: string) {
  for (const p of paragrafosVisiveis(html)) assert.ok(p.length <= 140, `parágrafo longo na tela: ${p}`);
  for (const e of explicacoes(html)) {
    assert.match(e.botao, /type="button"/);
    assert.match(e.botao, /aria-expanded="false"/);
    assert.ok(e.botao.includes(`aria-controls="${e.id}"`), e.rotulo);
    assert.match(e.balao, /^<span[^>]* hidden=""/, e.rotulo);
    assert.ok(e.rotulo.length > 3 && e.texto.length > 10, e.rotulo);
  }
}

describe("<Explicacao>: acessível no HTML do servidor", () => {
  const html = render(
    createElement(Explicacao, {
      rotulo: "O que é o Fator R?",
      titulo: "O que é o Fator R?",
      texto: ["Primeiro parágrafo.", "Segundo parágrafo."],
      lista: ["um", "dois"],
      ordenada: true,
      link: { href: "/autorizacao", texto: "Autorizar" },
    }),
  );
  const [e] = explicacoes(html);

  it("botão de verdade com rótulo com a pergunta inteira ('O que é o Fator R?'), aria-expanded, aria-controls e aria-describedby no balão", () => {
    assert.ok(e);
    assert.equal(e.rotulo, "O que é o Fator R?");
    assert.match(e.botao, /type="button"/);
    assert.match(e.botao, /aria-expanded="false"/);
    assert.ok(e.botao.includes(`aria-controls="${e.id}"`));
    assert.ok(e.botao.includes(`aria-describedby="${e.id}"`));
  });

  it("o balão vem no HTML, escondido, com título, parágrafos, lista e link (o leitor de tela lê a descrição)", () => {
    assert.match(e.balao, /^<span[^>]* hidden=""/);
    assert.match(e.texto, /O que é o Fator R\? Primeiro parágrafo\. Segundo parágrafo\. 1\. um 2\. dois Autorizar/);
    assert.match(e.balao, /role="list"/);
    assert.equal((e.balao.match(/role="listitem"/g) ?? []).length, 2);
    assert.match(e.balao, /<a [^>]*href="\/autorizacao"/);
    // Com link (conteúdo interativo) não é role="tooltip"; sem link, é.
    assert.doesNotMatch(e.balao, /role="tooltip"/);
    assert.match(render(createElement(Explicacao, { rotulo: "O que é x?", texto: "Texto do balão." })), /role="tooltip"/);
  });

  it("só conteúdo em linha (span): pode ficar dentro de título e parágrafo sem HTML inválido", () => {
    assert.doesNotMatch(e.balao, /<(p|div|ul|ol|li|h\d)\b/);
  });

  it("foco visível, alvo de 24px, tema pelas cores do tema e sem animação com prefers-reduced-motion", () => {
    assert.match(e.botao, /focus-visible:outline-2/);
    assert.match(e.botao, /size-6/);
    assert.match(e.balao, /bg-surface/);
    assert.match(e.balao, /text-fg/);
    assert.match(e.balao, /motion-reduce:animate-none/);
    // Largura: a tela menos as margens no celular, máxima legível no computador (lib/explicacao.ts acerta na hora).
    assert.match(e.balao, /w-\[calc\(100vw-2rem\)\] sm:w-80/);
  });

  it("link externo abre em outra aba, com noopener", () => {
    const h = render(createElement(Explicacao, { rotulo: "O que é o e-CAC?", texto: "Portal.", link: { href: "https://cav.receita.fazenda.gov.br", texto: "Abrir" } }));
    assert.match(h, /<a [^>]*href="https:\/\/cav\.receita\.fazenda\.gov\.br"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  });

  it("com o próprio termo como gatilho: sublinhado pontilhado, e o rótulo contém o texto visível", () => {
    const h = render(createElement(ExplicacaoDoTermo, { termo: "cnae", gatilho: "CNAE" }));
    assert.match(h, /<button[^>]*aria-label="O que é o CNAE\?"[^>]*class="[^"]*decoration-dotted[^"]*"[^>]*>CNAE<\/button>/);
  });

  it("vários na mesma tela: ids únicos", () => {
    const h = render(createElement(Fragment, null, createElement(ExplicacaoDoTermo, { termo: "cnpj" }), createElement(ExplicacaoDoTermo, { termo: "mei" })));
    const lista = explicacoes(h);
    assert.equal(lista.length, 2);
    assert.notEqual(lista[0].id, lista[1].id);
  });

  it("todo termo do glossário vira tooltip com rótulo em pergunta e o texto inteiro no balão", () => {
    for (const termo of Object.keys(GLOSSARIO) as Termo[]) {
      const [t] = explicacoes(render(createElement(ExplicacaoDoTermo, { termo })));
      const v = GLOSSARIO[termo];
      assert.equal(t.rotulo, v.titulo, termo);
      assert.ok(v.titulo.endsWith("?"), termo);
      for (const p of [...v.texto, ...(v.lista ?? [])]) assert.ok(t.texto.includes(texto(p).trim()), `${termo}: ${p}`);
    }
  });
});

describe("um tooltip só na aplicação", () => {
  const arquivos = (readdirSync(APP, { recursive: true }) as string[])
    .map((f) => path.join(APP, f))
    .filter((f) => statSync(f).isFile() && /\.tsx?$/.test(f));
  const fonte = (f: string) => readFileSync(f, "utf8");
  const rel = (f: string) => path.relative(RAIZ, f).split(path.sep).join("/");

  it("o 'Saiba mais' antigo não existe mais e ninguém o importa", () => {
    assert.equal(existsSync(path.join(APP, "saiba-mais.tsx")), false);
    for (const f of arquivos) assert.doesNotMatch(fonte(f), /saiba-mais|SaibaMais|Explicavel|Saiba mais/, rel(f));
  });

  it("nenhum outro tooltip, popover ou dica nativa: role tooltip, popover e title de explicação só no componente", () => {
    for (const f of arquivos) {
      if (rel(f) === "app/explicacao.tsx") continue;
      assert.doesNotMatch(fonte(f), /role="tooltip"|\bpopover\b|popoverTarget|aria-haspopup="dialog"/, rel(f));
    }
    // title= só como nome do item no menu recolhido e no nome cortado da empresa (não são explicações).
    const comTitle = arquivos.filter((f) => /\stitle=\{/.test(fonte(f))).map(rel).sort();
    assert.deepEqual(comTitle, ["app/(painel)/seletor-empresa.tsx", "app/barra-lateral.tsx"]);
  });

  it("<details> só para conteúdo que não é explicação (a tabela do gráfico, o passo a passo no portal e ações do eSocial)", () => {
    const comDetails = arquivos.filter((f) => /<details\b/.test(fonte(f))).map(rel).sort();
    // eSocial (Parte 7): o passo a passo no portal com os valores (passo 21), o cadastro inicial no portal, e as ações
    // recolhidas (retificar, importar de novo ou corrigir os cadastros). Parte 8: cada mensagem da Caixa Postal em lista
    // suspensa (o cabeçalho visível, o conteúdo dentro). Nenhum deles é explicação.
    assert.deepEqual(comDetails, ["app/(painel)/esocial/page.tsx", "app/(painel)/funcoes-do-painel.tsx", "app/(painel)/mensagens/mensagem.tsx", "app/(painel)/roteiro/esocial.tsx", "app/grafico-barras.tsx"]);
  });

  it("o parágrafo aberto de explicação (Nota) saiu: cada página usa o tooltip ao lado do título", () => {
    assert.doesNotMatch(fonte(path.join(APP, "ui.tsx")), /export function Nota\b/);
    for (const pagina of ["(painel)/painel-do-mes.tsx", "(painel)/autorizacao/page.tsx", "(painel)/planos/page.tsx", "(painel)/config/page.tsx", "(painel)/empresas/nova/page.tsx", "(painel)/empresa/page.tsx"]) {
      const f = fonte(path.join(APP, pagina));
      assert.match(f, /from "@\/app\/explicacao"/, pagina);
      assert.doesNotMatch(f, /<Nota\b/, pagina);
    }
  });
});

const EMPRESA = { id: "00000000-0000-0000-0000-000000000001", cnpj: "12345678000195", razaoSocial: "Alfa Software Ltda", papel: "DONO" as const };

describe("estados vazios do portão: curtos, com o que a aba mostra no tooltip", () => {
  it("sem empresa e sem plano, em todas as abas", () => {
    for (const aba of ABAS_DA_EMPRESA) {
      for (const portao of [{ estado: "sem-empresa" as const }, { estado: "sem-plano" as const, empresa: EMPRESA }]) {
        const html = render(createElement(PortaoFechado, { aba, portao }));
        conferir(html);
        const t = explicacoes(html).find((e) => e.rotulo === "O que esta aba vai mostrar?");
        assert.ok(t, aba.href);
        assert.ok(t.texto.includes(aba.descricao), aba.href);
        assert.ok(!visivel(html).includes(aba.descricao), `${aba.href}: descrição aberta na tela`);
      }
    }
  });
});

// Pedido do usuário (21/10/2026): o sino não abre balão; leva direto à página Avisos e mensagens (duas abas).
describe("sino: leva direto à página Avisos e mensagens, com o número no ícone", () => {
  it("com aviso: link para /avisos, rótulo com a contagem, número no ícone e nenhum balão", () => {
    const html = render(createElement(Sino, { avisos: avisoDoTermo({ nivel: "vence", titulo: "O termo de autorização vence em 10 dias", texto: "Assine de novo." }) }));
    assert.match(html, /<a [^>]*href="\/avisos"/);
    assert.match(html, /aria-label="Avisos e mensagens: 1 aviso pendente"/);
    assert.match(html, />1<\/span>/);
    assert.equal(explicacoes(html).length, 0);
    assert.doesNotMatch(html, /\stitle="/);
  });

  it("sem aviso: 'nada pendente' e nenhum número", () => {
    const html = render(createElement(Sino, { avisos: avisoDoTermo(null) }));
    assert.match(html, /aria-label="Avisos e mensagens: nada pendente"/);
    assert.doesNotMatch(html, />1<\/span>/);
  });
});

const TERMO = { validaAte: "2027-10-18", motivo: "vigencia" as const, diasRestantes: 300, signatario: { cnpj: "12345678000195", nome: "ALFA SOFTWARE LTDA" }, enviadoEm: new Date("2026-10-18T12:00:00Z") };

describe("autorização: frase curta por estado, o que significa no tooltip", () => {
  const estados: Situacao[] = [
    { estado: "propria" },
    { estado: "ausente" },
    { estado: "vigente", ...TERMO },
    { estado: "vencendo", ...TERMO, diasRestantes: 12 },
    { estado: "vencida", ...TERMO, diasRestantes: -3 },
    { estado: "recusada", recusadoEm: new Date("2026-10-18T12:00:00Z"), recusa: "certificado-revogado", ...TERMO },
  ];

  it("cartão da autorização em cada estado", () => {
    for (const situacao of estados) conferir(render(createElement(CartaoAutorizacao, { situacao, comLink: true })));
    const ausente = render(createElement(CartaoAutorizacao, { situacao: { estado: "ausente" } }));
    assert.match(visivel(ausente), /A empresa ainda não assinou o termo de autorização\./);
    assert.ok(explicacoes(ausente).some((e) => /modo guiado/.test(e.texto)));
    assert.doesNotMatch(visivel(ausente), /modo guiado/);
    const vigente = render(createElement(CartaoAutorizacao, { situacao: estados[2], comLink: true }));
    assert.match(visivel(vigente), /Autorização ativa.*Autorização ativa até 18\/10\/2027 ?\./);
    assert.match(vigente, /href="\/autorizacao"[^>]*>Ver a autorização</);
    assert.match(render(createElement(CartaoAutorizacao, { situacao: { estado: "ausente" }, comLink: true })), /href="\/autorizacao"[^>]*>Autorizar</);
    const vencendo = visivel(render(createElement(CartaoAutorizacao, { situacao: estados[3] })));
    assert.match(vencendo, /Autorização vence em 12 dias\./);
    const vencida = render(createElement(CartaoAutorizacao, { situacao: estados[4], comLink: true }));
    assert.match(visivel(vencida), /Autorização vencida.*A autorização venceu em 18\/10\/2027: assine de novo/);
    assert.match(vencida, />Assinar de novo</);
    const propria = render(createElement(CartaoAutorizacao, { situacao: { estado: "propria" }, comLink: true }));
    assert.match(visivel(propria), /Autorização ativa.*empresa da própria plataforma: já está autorizada, sem termo/);
    assert.doesNotMatch(propria, /href="\/autorizacao"/);
    assert.ok(explicacoes(propria).some((e) => e.rotulo === "Por que esta empresa não precisa de termo?"));
  });

  it("sem a assinatura nesta instalação: uma frase curta, sem detalhe técnico", () => {
    const html = render(createElement(CartaoAutorizacao, { situacao: { estado: "ausente" }, indisponivel: true }));
    conferir(html);
    assert.match(visivel(html), /Autorização pendente A assinatura da autorização ainda não está disponível\./);
    assert.doesNotMatch(visivel(html), /PLATAFORMA_|TOKEN_CHAVE|variável/);
  });

  it("requisitos: dois itens para marcar, com o que é e onde conseguir no tooltip (link oficial do ITI e do gov.br)", () => {
    const html = render(createElement(Requisitos, { marcados: { certificado: false, govbr: false }, marcar: () => {} }));
    conferir(html);
    assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2);
    const t = visivel(html);
    assert.match(t, /Certificado digital e-CNPJ A1 da empresa \(arquivo \.pfx ou \.p12\)/);
    assert.match(t, /Conta gov\.br nível prata ou ouro/);
    assert.match(t, /enquanto isso, o modo guiado continua funcionando/);
    const certificado = explicacoes(html).find((e) => e.rotulo === "O que é o e-CNPJ A1 e onde conseguir?");
    assert.ok(certificado);
    assert.match(certificado.texto, /A3 \(token ou cartão\) não serve/);
    assert.match(certificado.texto, /ICP-Brasil/);
    assert.match(certificado.texto, /videoconferência/);
    assert.match(certificado.texto, /centenas de reais por ano/);
    assert.doesNotMatch(certificado.texto, /R\$ ?\d/); // sem preço exato
    assert.match(certificado.balao, /href="https:\/\/www\.gov\.br\/iti\/[^"]+"[^>]*target="_blank"/);
    const govbr = explicacoes(html).find((e) => e.rotulo === "Para que serve a conta gov.br prata ou ouro?");
    assert.ok(govbr);
    assert.match(govbr.texto, /e-CAC/);
    assert.match(govbr.texto, /modo guiado/);
    assert.match(govbr.balao, /href="https:\/\/www\.gov\.br\/governodigital\/[^"]+niveis[^"]*"/);
    for (const re of [/videoconferência/, /A3/, /modo guiado/]) assert.doesNotMatch(t.replace("o modo guiado continua", ""), re);
    // Com os dois marcados, o convite "ainda não tem?" sai.
    const marcados = visivel(render(createElement(Requisitos, { marcados: { certificado: true, govbr: true }, marcar: () => {} })));
    assert.doesNotMatch(marcados, /Ainda não tem/);
  });

  it("painel: com a situação já no cartão, o 'faça no portal' não repete o motivo", () => {
    for (const situacao of [estados[1], estados[4], estados[5]]) {
      const html = render(createElement(FacaNoPortal, { funcao: "caixaPostal", situacao, situacaoNaTela: true }));
      conferir(html);
      assert.doesNotMatch(visivel(html), /Autorização pendente|venceu|recusou/, situacao.estado);
      assert.ok(explicacoes(html).some((e) => e.rotulo === "O que é o modo guiado?"));
    }
  });

  it("modo guiado ('faça no portal'): o motivo na tela, o que é o modo guiado no tooltip", () => {
    const html = render(createElement(FacaNoPortal, { funcao: "caixaPostal", situacao: { estado: "ausente" } }));
    conferir(html);
    assert.match(visivel(html), /Autorização pendente: a empresa ainda não assinou o termo de autorização\./);
    assert.match(visivel(html), /Disponível aqui depois da autorização: Autorizar/);
    assert.ok(explicacoes(html).some((e) => /a plataforma calcula e mostra o que lançar/.test(e.texto)));
    assert.match(html, /href="\/autorizacao"[^>]*>Autorizar</);
  });
});

describe("ficha da empresa: cada dado com o ⓘ, o Fator R no tooltip", () => {
  const dados = lerRespostaCnpj(respostaGravada("ti-fator-r"));
  const diagnostico = diagnosticar(dados, "2026-10-16");

  it("campos e seções com os termos do glossário; nada de quadro aberto do Fator R", () => {
    const html = render(createElement(FichaReceita, { dados, diagnostico, consultadaEm: "2026-10-16T12:00:00Z" }));
    conferir(html);
    const rotulos = explicacoes(html).map((e) => e.rotulo);
    for (const termo of ["razaoSocial", "nomeFantasia", "situacao", "natureza", "abertura", "simples", "mei", "endereco", "dadosErrados", "cnaeEAnexo", "socios"] as const) {
      assert.ok(rotulos.includes(GLOSSARIO[termo].titulo), termo);
    }
    // O Fator R vem do glossário (a mesma fonte do assistente), só no balão.
    const fatorR = GLOSSARIO.fatorR.texto.join(" ");
    assert.ok(!visivel(html).includes(GLOSSARIO.fatorR.texto[0]), "Fator R aberto na tela");
    assert.ok(explicacoes(html).some((e) => e.rotulo === "O que é o Fator R?" && e.texto.includes(fatorR)));
  });

  it("O que é o Fator R? tem o mesmo balão no assistente (etapa Diagnóstico), na ficha e no painel", () => {
    const balaoDoFatorR = (html: string) => {
      const achados = explicacoes(html).filter((e) => e.rotulo === "O que é o Fator R?");
      assert.equal(achados.length, 1);
      return achados[0].texto;
    };
    const previa = { dados, diagnostico, consultadaEm: "2026-10-16T12:00:00Z", token: "t", qsa: "confere" as const };
    const nada = async () => ({ erro: "não chamado" });
    const assistente = render(
      createElement(Assistente, { consultar: nada, cadastrar: nada, preparar: nada as never, enviar: nada, inicial: { etapa: "diagnostico", cnpj: "12.345.678/0001-95", previa, recebidaEm: Date.now(), empresaId: null, autorizacao: null, autorizadaAte: null } }),
    );
    const noAssistente = balaoDoFatorR(assistente);
    assert.equal(balaoDoFatorR(render(createElement(FichaReceita, { dados, diagnostico, consultadaEm: "2026-10-16T12:00:00Z" }))), noAssistente);
    assert.equal(balaoDoFatorR(render(createElement(CartaoDiagnostico, { diagnostico }))), noAssistente);
    assert.equal(noAssistente, texto(`${GLOSSARIO.fatorR.titulo} ${GLOSSARIO.fatorR.texto.join(" ")}`).trim());
  });

  it("não atendida: cada motivo curto na tela e o texto completo no balão dele", () => {
    for (const ex of ["mei", "banco-do-brasil", "fora-do-escopo", "baixada"] as const) {
      const d = diagnosticar(lerRespostaCnpj(respostaGravada(ex)), "2026-10-16");
      const html = render(createElement(CartaoDiagnostico, { diagnostico: d }));
      const tooltips = explicacoes(html);
      for (const n of d.impedimentos) {
        assert.ok(visivel(html).includes(texto(n.curto).trim()), `${ex}: curto na tela: ${n.curto}`);
        if (n.detalhe !== n.curto) assert.ok(!visivel(html).includes(texto(n.detalhe).trim()), `${ex}: completo fora da tela: ${n.detalhe}`);
        assert.ok(tooltips.some((e) => e.texto.includes(texto(n.detalhe).trim())), `${ex}: completo no balão: ${n.detalhe}`);
      }
      const rotulos = tooltips.map((e) => e.rotulo);
      assert.equal(new Set(rotulos).size, rotulos.length, `${ex}: rótulos repetidos: ${rotulos.join(" | ")}`);
    }
  });

  it("aviso de regra (atividades em anexos diferentes): frase curta na tela, regra no balão", () => {
    const d = diagnosticar(lerRespostaCnpj(respostaGravada("ti-fator-r")), "2026-10-16");
    const html = render(createElement(CartaoDiagnostico, { diagnostico: d }));
    assert.ok(d.observacoes.length > 0);
    for (const n of d.observacoes) {
      assert.ok(visivel(html).includes(texto(n.curto).trim()), n.curto);
      assert.ok(!visivel(html).includes(texto(n.detalhe).trim()), n.detalhe);
      assert.ok(explicacoes(html).some((e) => e.texto.includes(texto(n.detalhe).trim())), n.detalhe);
    }
  });
});
