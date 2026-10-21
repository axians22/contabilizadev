// Regra do produto: o cliente nunca vê quem está por trás (Serpro, Integra Contador, BrasilAPI). Em tudo o que chega ao navegador (texto das telas,
// títulos e metadata, avisos do sino, mensagens de erro de ações e rotas, nomes de rota) não aparece "Serpro",
// "Integra Contador", "BrasilAPI", códigos de sistema ou serviço da API (PGDASD, ENVIOXMLASSINADO81…) nem mensagens cruas
// dela ("[Erro-PGDASD-…]"): a fonte é sempre a Receita Federal.
//
// ÚNICA exceção (plano.txt, Modelo): o texto oficial do termo de autorização, que cita a API por trás e é mostrado por
// inteiro antes da assinatura (o cliente precisa ler o que assina). Vale só para os textos oficiais exatos, só onde
// eles são definidos (o núcleo) e só no componente que os mostra (TextoOficial); qualquer outro texto com o nome do
// fornecedor, nesses mesmos arquivos ou fora deles, continua reprovando.
//
// O teste lê o código com o compilador do TypeScript e confere todo texto literal (JSX, strings e templates) de app/ e
// dos módulos de lib/ e do núcleo que produzem texto para a tela. Ficam de fora só: caminhos de import, argumentos de
// log do servidor (console.* e deps.log), endereços (URL inteira, que é código de chamada e não texto de tela) e os
// arquivos internos da lista EXCECOES (páginas da área do administrador só para ADMIN).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SISTEMA, TEXTO_AVISO_LEGAL, TEXTO_FINALIDADE, TEXTO_TERMO } from "@contabilizadev/nucleo/serpro/termo-autorizacao";
import { CartaoAutorizacao } from "@/app/(painel)/autorizacao/cartao-autorizacao";
import { Requisitos } from "@/app/(painel)/autorizacao/requisitos";
import { TextoOficial } from "@/app/(painel)/autorizacao/texto-oficial";
import { SinoVisual as Sino } from "@/app/(painel)/sino-visual";
import { podeVerNoAdmin } from "@/lib/admin";
import { avisoDoTermo } from "@/lib/avisos/fontes";
import { avisoDaSituacao, type Situacao } from "@/lib/termo/situacao";
import { MENSAGENS_DA_PLATAFORMA, MENSAGENS_DO_ENVIO } from "@/lib/termo/mensagens";
import { texto as textoDoHtml } from "./tela";

const RAIZ = path.join(import.meta.dirname, "..");
const APP = path.join(RAIZ, "app");

// Arquivos internos (não chegam ao cliente comum). Cada exceção diz por quê.
const EXCECOES: Record<string, string> = {
  "app/admin/plano/page.tsx": "plano do projeto, na área do administrador: só ADMIN (exigirAreaDoAdmin), nem MANAGER nem o login desligado",
  // Só a página: as ações e os formulários dela continuam conferidos (não citam o fornecedor).
  "app/admin/plataforma/page.tsx": "certificado e chaves do contrato da plataforma, na área do administrador: só ADMIN (exigirAreaDoAdmin), nem MANAGER nem o login desligado",
  "app/admin/custos/page.tsx": "custo por cliente das chamadas ao contrato da plataforma, na área do administrador: só ADMIN (exigirAreaDoAdmin), nem MANAGER nem o login desligado",
};

// Módulos de lib/ cujo texto vai para a tela (mensagens, avisos, modo guiado, erros de ação).
const LIB_DA_TELA = ["lib/termo", "lib/empresas", "lib/usuarios", "lib/autenticacao", "lib/historico", "lib/rotina", "lib/assinador", "lib/esocial", "lib/caixa-postal", "lib/avisos", "lib/situacao", "lib/defis", "lib/painel"];
// Arquivos avulsos e módulos do núcleo cujas mensagens chegam à tela (descrição das abas, erros da consulta de CNPJ,
// motivos do diagnóstico, regras de CNAE, erros do certificado e da conferência do termo de autorização).
const NUCLEO_DA_TELA = [
  "lib/abas.ts",
  "../nucleo/src/brasilapi/cnpj.ts",
  "../nucleo/src/diagnostico.ts",
  "../nucleo/src/cnae.ts",
  "../nucleo/src/formato.ts",
  "../nucleo/src/serpro/termo-autorizacao.ts",
  "../nucleo/src/serpro/termo-xml.ts",
  "../nucleo/src/serpro/conferir-termo.ts",
  "../nucleo/src/conferencia-anexo.ts",
  "../nucleo/src/serpro/atividades-pgdasd.ts",
  "../nucleo/src/ptax.ts",
  "../nucleo/src/apuracao.ts",
  "../nucleo/src/simples.ts",
  "../nucleo/src/serpro/mensagem-receita.ts",
  // O aviso do certificado da plataforma vai para o sino (do ADMIN, mas o sino é o mesmo do cliente).
  "lib/plataforma/aviso.ts",
];

// A exceção do texto oficial do termo: os textos exatos e os arquivos onde podem aparecer.
const TEXTOS_OFICIAIS = [SISTEMA, TEXTO_TERMO, TEXTO_AVISO_LEGAL, TEXTO_FINALIDADE];
// Os textos oficiais ficam em termo-xml.ts (a parte do termo sem o node-forge), reexportados por termo-autorizacao.ts.
const ARQUIVOS_DO_TEXTO_OFICIAL = ["../nucleo/src/serpro/termo-xml.ts", "app/(painel)/autorizacao/texto-oficial.tsx"];

const SISTEMAS = [
  "PGDASD", "PROCURACOES", "DCTFWEB", "SITFIS", "CAIXAPOSTAL", "PAGTOWEB", "ICGERENCIADOR",
  "EVENTOSATUALIZACAO", "REGIMEAPURACAO", "PARCSN", "SICALC", "PGMEI", "CCMEI", "DASNSIMEI", "PERTSN", "RELPSN",
];
const PROIBIDOS: { nome: string; re: RegExp }[] = [
  { nome: "Serpro", re: /serpro/i },
  { nome: "Integra Contador", re: /integra[\s-]*contador/i },
  { nome: "BrasilAPI", re: /brasil[\s-]*api/i },
  { nome: "código de sistema da API", re: new RegExp(`\\b(${SISTEMAS.join("|")})\\b`) },
  { nome: "código de serviço da API", re: /\b[A-Z]{5,}\d{2,3}\b/ },
  { nome: "mensagem crua da API", re: /\[(Sucesso|Aviso|Erro|AcessoNegado|EntradaIncorreta|EntrataIncorreta)-/ },
  // eSocial (Parte 7): para o cliente é "eSocial" (o portal do governo), nunca os termos técnicos da ligação.
  { nome: "termo técnico do eSocial (webservice)", re: /web\s*-?\s*service/i },
  { nome: "termo técnico do eSocial (SOAP)", re: /\bSOAP\b/i },
];

const relativo = (f: string) => path.relative(RAIZ, f).split(path.sep).join("/");

function arquivosDe(pasta: string): string[] {
  return (readdirSync(pasta, { recursive: true }) as string[])
    .map((f) => path.join(pasta, f))
    .filter((f) => statSync(f).isFile() && /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
}

// Argumento de log do servidor? (console.error("[serpro] …"), deps.log?.(`[serpro] …`))
function emLog(no: ts.Node): boolean {
  for (let p: ts.Node | undefined = no.parent; p; p = p.parent) {
    if (ts.isCallExpression(p)) {
      const alvo = p.expression.getText();
      if (/^console\.\w+$/.test(alvo) || /(^|\.)log$/.test(alvo)) return true;
    }
    if (ts.isBlock(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}

// Todos os textos literais visíveis de um arquivo, com a linha.
function textosDe(codigo: string, nome = "x.tsx"): { texto: string; linha: number }[] {
  const fonte = ts.createSourceFile(nome, codigo, ts.ScriptTarget.Latest, true, nome.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const achados: { texto: string; linha: number }[] = [];
  const visitar = (no: ts.Node) => {
    // Caminhos de import/export e de import() são código, não texto de tela.
    if ((ts.isImportDeclaration(no) || ts.isExportDeclaration(no)) && no.moduleSpecifier) return;
    if (ts.isCallExpression(no) && no.expression.kind === ts.SyntaxKind.ImportKeyword) return;
    if (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no) || ts.isTemplateHead(no) || ts.isTemplateMiddle(no) || ts.isTemplateTail(no) || ts.isJsxText(no)) {
      if (!emLog(no) && !/^https?:\/\/\S+$/.test(no.text)) achados.push({ texto: no.text, linha: fonte.getLineAndCharacterOfPosition(no.getStart()).line + 1 });
    }
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  return achados;
}

// `permitidos`: textos exatos aceitos neste arquivo (só a exceção do texto oficial do termo).
const violacoes = (codigo: string, nome?: string, permitidos: string[] = []) =>
  textosDe(codigo, nome)
    .filter(({ texto }) => !permitidos.includes(texto))
    .flatMap(({ texto, linha }) => PROIBIDOS.filter((p) => p.re.test(texto)).map((p) => ({ linha, nome: p.nome, texto })));
const permitidosEm = (f: string) => (ARQUIVOS_DO_TEXTO_OFICIAL.includes(relativo(f)) ? TEXTOS_OFICIAIS : []);

describe("o cliente não vê o fornecedor por trás (só a Receita Federal)", () => {
  it("o verificador acha o proibido e ignora import, log e comentário (senão o resto mede o vazio)", () => {
    const amostra = `
      import { x } from "@/lib/serpro/servidor";
      // comentário sobre o Serpro
      export const metadata = { title: "Integra Contador · ContabilizaDev" };
      export const URL = "https://brasilapi.com.br/api/cnpj/v1/";
      const erro = "Falha na BrasilAPI";
      export function P() {
        console.error("[serpro] detalhe técnico");
        deps.log?.(\`[serpro] \${1}\`);
        return <p title={\`via \${a} Serpro\`}>Conferindo com o Serpro… {"PGDASD"} ENVIOXMLASSINADO81 [Erro-PGDASD-50001]</p>;
      }`;
    const v = violacoes(amostra);
    assert.deepEqual([...new Set(v.map((x) => x.nome))].sort(), ["BrasilAPI", "Integra Contador", "Serpro", "código de serviço da API", "código de sistema da API", "mensagem crua da API"]);
    assert.ok(!v.some((x) => x.texto.includes("detalhe técnico")));
    assert.ok(!v.some((x) => x.texto.includes("@/lib/serpro")));
    assert.ok(!v.some((x) => x.texto.startsWith("https://")), "URL inteira é código, não texto de tela");
    assert.ok(v.some((x) => x.texto === "Falha na BrasilAPI"));
    // Nomes públicos da Receita continuam permitidos.
    assert.deepEqual(violacoes(`<p>PGDAS-D, DEFIS, DCTFWeb, e-CAC, Receita Federal, Caixa Postal - Mensagens, 00146</p>`), []);
  });

  it("acha os arquivos da tela", () => {
    const todos = arquivosDe(APP).map(relativo);
    assert.ok(todos.includes("app/(painel)/autorizacao/page.tsx"));
    assert.ok(todos.includes("app/(painel)/sino-visual.tsx"));
    assert.ok(todos.includes("app/barra-lateral.tsx"));
    assert.ok(todos.includes("app/layout.tsx"));
    assert.ok(todos.includes("app/(painel)/empresas/nova/assistente.tsx"));
    // O conteúdo dos tooltips também é texto de tela: o componente, quem passa texto para ele e o glossário.
    assert.ok(todos.includes("app/explicacao.tsx"));
    assert.ok(todos.includes("app/(painel)/autorizacao/assinar-termo.tsx"));
    assert.ok(todos.includes("app/(painel)/autorizacao/requisitos.tsx"));
    assert.ok(todos.includes("app/(painel)/autorizacao/texto-oficial.tsx"));
    assert.ok(statSync(path.join(RAIZ, "lib/empresas/glossario.ts")).isFile() && LIB_DA_TELA.includes("lib/empresas"));
    for (const f of NUCLEO_DA_TELA) assert.ok(statSync(path.join(RAIZ, f)).isFile(), f);
  });

  it("nenhum texto de app/ nem dos módulos de lib/ e do núcleo que vão para a tela cita o fornecedor, códigos ou mensagens da API", () => {
    const arquivos = [...arquivosDe(APP), ...LIB_DA_TELA.flatMap((p) => arquivosDe(path.join(RAIZ, p))), ...NUCLEO_DA_TELA.map((f) => path.join(RAIZ, f))];
    const problemas = arquivos
      .filter((f) => !EXCECOES[relativo(f)])
      .flatMap((f) => violacoes(readFileSync(f, "utf8"), f, permitidosEm(f)).map((v) => `${relativo(f)}:${v.linha} (${v.nome}): ${JSON.stringify(v.texto.trim().slice(0, 80))}`));
    assert.deepEqual(problemas, []);
  });

  it("nenhuma rota (URL) tem o nome do fornecedor", () => {
    const pastas = (readdirSync(APP, { recursive: true }) as string[]).filter((f) => statSync(path.join(APP, f)).isDirectory());
    assert.deepEqual(pastas.filter((p) => /serpro|integra|brasil-?api/i.test(p)), []);
  });

  it("as exceções existem e são só páginas internas", () => {
    for (const [arquivo, motivo] of Object.entries(EXCECOES)) {
      assert.ok(statSync(path.join(RAIZ, arquivo)).isFile(), arquivo);
      assert.match(motivo, /ADMIN/);
      const href = `/${path.dirname(arquivo).replace(/^app\//, "")}`;
      assert.ok(podeVerNoAdmin("ADMIN", href) && !podeVerNoAdmin("MANAGER", href) && !podeVerNoAdmin("COMMON_USER", href), `${href} é só do ADMIN`);
      assert.ok(readFileSync(path.join(RAIZ, arquivo), "utf8").includes(`await exigirAreaDoAdmin("${href}")`), `${arquivo} precisa barrar quem não é ADMIN`);
    }
  });

  it("exceção do texto oficial do termo: só os textos exatos, só nos arquivos permitidos (e o resto continua reprovando)", () => {
    const comTexto = `export const T = ${JSON.stringify(TEXTO_TERMO)};`;
    assert.deepEqual(violacoes(comTexto, "x.ts", TEXTOS_OFICIAIS), []);
    // O mesmo texto em qualquer outro arquivo reprova.
    assert.ok(violacoes(comTexto, "x.ts").some((v) => v.nome === "Integra Contador"));
    // No arquivo da exceção, outro texto com o fornecedor reprova; um pedaço do texto oficial também.
    assert.ok(violacoes(`const m = "Fale com o Serpro";`, "x.ts", TEXTOS_OFICIAIS).length > 0);
    assert.ok(violacoes(`const m = "pela API INTEGRA CONTADOR, onde";`, "x.ts", TEXTOS_OFICIAIS).length > 0);
    // O sistema, o termo e a finalidade oficiais citam a API (senão a exceção não precisaria existir); o aviso legal não.
    assert.deepEqual(TEXTOS_OFICIAIS.map((t) => /integra contador/i.test(t)), [true, true, false, true]);
    for (const f of ARQUIVOS_DO_TEXTO_OFICIAL) assert.ok(statSync(path.join(RAIZ, f)).isFile(), f);
  });

  it("em app/, só o TextoOficial usa os textos oficiais do termo", () => {
    const usam = arquivosDe(APP)
      .filter((f) => /\b(SISTEMA|TEXTO_TERMO|TEXTO_AVISO_LEGAL|TEXTO_FINALIDADE)\b/.test(readFileSync(f, "utf8")))
      .map(relativo);
    assert.deepEqual(usam, ["app/(painel)/autorizacao/texto-oficial.tsx"]);
  });

  it("na tela renderizada, o fornecedor aparece só dentro do bloco 'Texto oficial do termo'", () => {
    const html = renderToStaticMarkup(
      createElement(TextoOficial, { contratante: { numero: "11444777000161", nome: "PLATAFORMA DE TESTE LTDA" }, empresa: { cnpj: "11222333000181", razaoSocial: "EMPRESA DE TESTE LTDA" } }),
    );
    assert.match(html, /^<section data-texto-oficial=""/);
    assert.match(html, /Texto oficial do termo/);
    for (const t of TEXTOS_OFICIAIS) assert.ok(textoDoHtml(html).includes(t), t.slice(0, 40));
    // Tudo o que não é o texto oficial (títulos, rótulos) continua sem o fornecedor.
    let fora = textoDoHtml(html);
    for (const t of TEXTOS_OFICIAIS) fora = fora.split(t).join(" ");
    assert.doesNotMatch(fora, /serpro|integra\s*contador/i);
  });

  it("cartão do automático, requisitos, sino e mensagens do termo não citam o fornecedor", () => {
    const base = { validaAte: "2027-10-18", motivo: "vigencia" as const, diasRestantes: 10, signatario: { cnpj: "11222333000181", nome: "X" }, enviadoEm: new Date() };
    const estados: Situacao[] = [
      { estado: "propria" },
      { estado: "ausente" },
      { estado: "vigente", ...base, diasRestantes: 300 },
      { estado: "vencendo", ...base },
      { estado: "vencida", ...base, diasRestantes: -1 },
      { estado: "recusada", recusadoEm: new Date(), recusa: "certificado-revogado", ...base },
    ];
    const htmls = [
      ...estados.map((situacao) => renderToStaticMarkup(createElement(CartaoAutorizacao, { situacao, comLink: true }))),
      ...estados.map((situacao) => renderToStaticMarkup(createElement(Sino, { avisos: avisoDoTermo(avisoDaSituacao(situacao)) }))),
      renderToStaticMarkup(createElement(Requisitos, { marcados: { certificado: false, govbr: false }, marcar: () => {} })),
    ];
    for (const html of htmls) for (const p of PROIBIDOS) assert.doesNotMatch(textoDoHtml(html), p.re);
    for (const m of [...Object.values(MENSAGENS_DA_PLATAFORMA), ...Object.values(MENSAGENS_DO_ENVIO)]) for (const p of PROIBIDOS) assert.doesNotMatch(m, p.re);
  });
});
