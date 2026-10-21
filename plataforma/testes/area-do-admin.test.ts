// A área do administrador (/admin), separada da aplicação do cliente: fechada por padrão no servidor. Cada página e ação de
// app/admin confere o próprio endereço (exigirAreaDoAdmin), o layout confere a entrada, e a regra de quem vê o quê é a
// lista de lib/admin.ts (COMMON_USER nada, MANAGER só os usuários, ADMIN tudo).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import type { Papel } from "@/banco/esquema";
import { PAGINAS_DO_ADMIN, podeVerNoAdmin } from "@/lib/admin";

const APP = path.join(import.meta.dirname, "..", "app");
const ADMIN = path.join(APP, "admin");
const ROOT_LIB = path.join(import.meta.dirname, "..", "lib");
const arquivos = (readdirSync(ADMIN, { recursive: true }) as string[]).map((f) => path.join(ADMIN, f));
// O endereço de um arquivo da área: a pasta dele, abaixo de /admin.
const enderecoDe = (arquivo: string) => `/${path.relative(APP, path.dirname(arquivo)).split(path.sep).join("/")}`;
const ler = (f: string) => readFileSync(f, "utf8");
const PAPEIS: Papel[] = ["COMMON_USER", "MANAGER", "ADMIN"];

describe("área do administrador: cada rota confere no servidor", () => {
  const paginas = arquivos.filter((f) => /[\\/]page\.tsx$/.test(f));

  it("toda página da lista existe e toda página da pasta está na lista (nada fica sem regra)", () => {
    assert.deepEqual(paginas.map(enderecoDe).sort(), PAGINAS_DO_ADMIN.map((p) => p.href).sort());
    for (const p of PAGINAS_DO_ADMIN) assert.ok(existsSync(path.join(APP, ...p.href.split("/").filter(Boolean), "page.tsx")), p.href);
  });

  it("toda página chama exigirAreaDoAdmin com o próprio endereço, antes de ler qualquer coisa", () => {
    for (const f of paginas) {
      const fonte = ler(f);
      const href = enderecoDe(f);
      const corpo = fonte.slice(fonte.indexOf("export default async function"));
      // A primeira linha do componente é a barreira.
      assert.match(corpo, new RegExp(`^export default async function \\w+\\([^)]*\\)[^{]*\\{\\s*(const \\{[^}]*\\} = )?await exigirAreaDoAdmin\\("${href.replace(/\//g, "\\/")}"\\);`), href);
      assert.doesNotMatch(fonte, /exigirSessao\(|exigirConteudo\(/, `${href}: a área não usa o portão de empresa nem só a sessão`);
    }
  });

  it("toda server action da área confere o endereço da própria página", () => {
    const acoes = arquivos.filter((f) => /\.tsx?$/.test(f) && /^\s*["']use server["']/.test(ler(f)));
    assert.deepEqual(acoes.map(enderecoDe).sort(), ["/admin/plataforma", "/admin/usuarios"]);
    for (const f of acoes) {
      const blocos = ler(f).split(/export async function /).slice(1);
      assert.ok(blocos.length > 0, f);
      for (const bloco of blocos) assert.match(bloco, new RegExp(`^\\w+\\([^)]*\\)[^{]*\\{\\s*const \\{ usuario \\} = await exigirAreaDoAdmin\\("${enderecoDe(f).replace(/\//g, "\\/")}"\\);`), bloco.slice(0, 40));
    }
  });

  it("o layout confere a entrada na área antes de desenhar a barra (COMMON_USER recebe 404)", () => {
    const layout = ler(path.join(ADMIN, "layout.tsx"));
    assert.match(layout, /export default async function \w+\([^)]*\)[^{]*\{\s*const \{ usuario \} = await exigirEntradaNaAreaDoAdmin\(\);/);
    assert.doesNotMatch(layout, /exigirConteudo|SeletorEmpresa/);
  });

  it("a página de cada endereço só abre para quem a regra deixa: COMMON_USER em nenhuma, MANAGER só em Usuários, ADMIN em todas", () => {
    const veem = (href: string) => PAPEIS.filter((papel) => podeVerNoAdmin(papel, href));
    assert.deepEqual(veem("/admin"), ["ADMIN"]);
    assert.deepEqual(veem("/admin/usuarios"), ["MANAGER", "ADMIN"]);
    assert.deepEqual(veem("/admin/plataforma"), ["ADMIN"]);
    assert.deepEqual(veem("/admin/plano"), ["ADMIN"]);
    for (const f of paginas) assert.equal(podeVerNoAdmin("COMMON_USER", enderecoDe(f)), false, enderecoDe(f));
  });

  it("MANAGER na página Usuários continua com as regras de quem altera quem (o serviço confere de novo)", () => {
    const servico = ler(path.join(APP, "..", "lib", "usuarios", "servico.ts"));
    assert.match(servico, /podeMudarAtivo/);
    assert.match(servico, /podeMudarPapel/);
  });
});

describe("avisos de admin: só para o ADMIN e levando à área do administrador", () => {
  it("o sino da aplicação só junta o aviso do certificado da plataforma para o ADMIN", () => {
    const layout = ler(path.join(APP, "(painel)", "layout.tsx"));
    // Pela função que filtra pelo papel (lib/plataforma/servidor.ts: só quem abre /admin/plataforma), nunca direto.
    assert.match(layout, /juntarAvisos\(daEmpresa, await avisosDoAdminPara\(usuario\.papel, new Date\(\)\)\)/);
    assert.equal([...layout.matchAll(/avisosDoAdmin(Para)?\(/g)].length, 1);
  });

  it("a visão geral da área é só do ADMIN (lê os avisos e o banco depois da barreira) e não cita ao leitor páginas que ele não vê", () => {
    const visao = ler(path.join(ADMIN, "page.tsx"));
    assert.ok(visao.indexOf('await exigirAreaDoAdmin("/admin")') < visao.indexOf("avisosDoAdmin(new Date())"));
    assert.ok(visao.indexOf('await exigirAreaDoAdmin("/admin")') < visao.indexOf("bancoNoAr()"));
    assert.doesNotMatch(visao, /papel === "ADMIN"|administradores veem também/);
    assert.match(visao, /paginasDoAdmin\(usuario\.papel\)/);
  });
});

describe("nada de administração na aplicação comum", () => {
  it("o painel não mostra mais o banco de dados nem o atalho do plano; a configuração não tem o atalho do certificado; a autorização não tem o quadro 'Só para administradores'", () => {
    const painel = ler(path.join(APP, "(painel)", "page.tsx"));
    assert.doesNotMatch(painel, /bancoNoAr|veAreaInterna|plano de construção/);
    const config = ler(path.join(APP, "(painel)", "config", "page.tsx"));
    assert.doesNotMatch(config, /papel === "ADMIN"|href="\/admin|href="\/config\/plataforma"|Certificado da plataforma/);
    const autorizacao = ler(path.join(APP, "(painel)", "autorizacao", "page.tsx"));
    assert.doesNotMatch(autorizacao, /Só para administradores|papel === "ADMIN"/);
    // O motivo técnico da assinatura do termo desligada foi para a situação da integração, na área.
    assert.match(ler(path.join(ADMIN, "plataforma", "page.tsx")), /<SituacaoDaIntegracao nome="Assinatura do termo de autorização" pronto=\{!motivoDoTermo\}/);
  });

  it("nenhuma página da aplicação (grupo painel) confere papel de administrador", () => {
    const painel = path.join(APP, "(painel)");
    const fontes = (readdirSync(painel, { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(painel, f));
    for (const f of fontes) {
      // O layout só decide o aviso do sino do ADMIN; o menu do usuário recebe pronto se mostra a entrada da área.
      if (/[\\/]layout\.tsx$/.test(f)) continue;
      assert.doesNotMatch(ler(f), /papel === "ADMIN"|papel !== "ADMIN"|exigirAreaDoAdmin|ehGestao/, path.relative(APP, f));
    }
  });
});

describe("o aviso do ADMIN não some entre o sino e a página Avisos", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { ListaDeAvisos } = await import("@/app/(painel)/avisos/lista");
  const { SinoVisual } = await import("@/app/(painel)/sino-visual");
  const { juntarAvisos, rotuloDosAvisos } = await import("@/lib/avisos/central");
  const { avisoDoCertificadoDaPlataforma } = await import("@/lib/plataforma/aviso");
  const agora = new Date("2026-10-21T12:00:00-03:00");
  // Certificado da plataforma vencendo em 10 dias (atenção) e 5 guias vencidas da empresa (mais graves).
  const doAdmin = avisoDoCertificadoDaPlataforma({ estado: "ok", validoAte: new Date("2026-10-31T12:00:00-03:00") }, agora);
  const daEmpresa = Array.from({ length: 5 }, (_, i) => ({ chave: `guia:${i}`, nivel: "vencida" as const, titulo: `Guia ${i} vencida`, texto: "Pague.", link: { href: "/guias", texto: "Ver guias" } }));
  const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replace(/<[^>]+>/g, " ");

  it("o sino conta o aviso do certificado da plataforma e leva à página, que o lista", () => {
    assert.equal(doAdmin.length, 1);
    const avisos = juntarAvisos(daEmpresa, doAdmin);
    const sino = renderToStaticMarkup(createElement(SinoVisual, { avisos }));
    assert.match(sino, /href="\/avisos"/);
    assert.match(sino, /aria-label="Avisos e mensagens: 6 avisos pendentes"/);
    assert.ok(html(createElement(ListaDeAvisos, { avisos, cnpj: "12345678000195", rotulo: "Avisos da empresa e da plataforma" })).includes(doAdmin[0].titulo));
  });

  it("sem empresa (cnpj null), a lista mostra só os do ADMIN", () => {
    assert.ok(html(createElement(ListaDeAvisos, { avisos: doAdmin, cnpj: null, rotulo: "Avisos da plataforma" })).includes(doAdmin[0].titulo));
  });

  it("o nome da tabela (aria-label) diz o que ela tem: da empresa, da plataforma ou os dois", () => {
    assert.equal(rotuloDosAvisos({ daEmpresa: true, daPlataforma: false }), "Avisos da empresa");
    assert.equal(rotuloDosAvisos({ daEmpresa: false, daPlataforma: true }), "Avisos da plataforma");
    assert.equal(rotuloDosAvisos({ daEmpresa: true, daPlataforma: true }), "Avisos da empresa e da plataforma");
    // Portão fechado / sem empresa: a tabela só com o do certificado da plataforma não se anuncia como "da empresa".
    const so = renderToStaticMarkup(createElement(ListaDeAvisos, { avisos: doAdmin, cnpj: null, rotulo: rotuloDosAvisos({ daEmpresa: false, daPlataforma: true }) }));
    assert.match(so, /aria-label="Avisos da plataforma"/);
    assert.doesNotMatch(so, /aria-label="Avisos da empresa"/);
    const juntos = renderToStaticMarkup(createElement(ListaDeAvisos, { avisos: juntarAvisos(daEmpresa, doAdmin), cnpj: "12345678000195", rotulo: rotuloDosAvisos({ daEmpresa: true, daPlataforma: true }) }));
    assert.match(juntos, /aria-label="Avisos da empresa e da plataforma"/);
    // A página escolhe o rótulo pelo que entra em cada tabela, e a explicação conta ao ADMIN que os da plataforma aparecem ali.
    const pagina = ler(path.join(APP, "(painel)", "avisos", "page.tsx"));
    assert.match(pagina, /<ListaDeAvisos avisos=\{doAdmin\} cnpj=\{null\} rotulo=\{rotuloDosAvisos\(\{ daEmpresa: false, daPlataforma: true \}\)\} \/>/);
    assert.match(pagina, /<ListaDeAvisos avisos=\{avisos\} cnpj=\{empresa\.cnpj\} rotulo=\{rotuloDosAvisos\(\{ daEmpresa: true, daPlataforma: doAdmin\.length > 0 \}\)\} \/>/);
    assert.match(pagina, /podeVerNoAdmin\(usuario\.papel, "\/admin\/plataforma"\)\s*\?\s*\["Como administrador, você vê aqui também os avisos da plataforma/);
    assert.doesNotMatch(ler(path.join(APP, "(painel)", "avisos", "lista.tsx")), /rotulo="Avisos da empresa"/);
  });

  it("só o ADMIN recebe os avisos de administração (quem abre /admin/plataforma)", () => {
    assert.deepEqual(PAPEIS.filter((p) => podeVerNoAdmin(p, "/admin/plataforma")), ["ADMIN"]);
    assert.match(ler(path.join(ROOT_LIB, "plataforma", "servidor.ts")), /podeVerNoAdmin\(papel, "\/admin\/plataforma"\) \? avisosDoAdmin\(agora\) : \[\]/);
  });

  it("o sino e a página /avisos usam a mesma função, e a página junta os avisos também com o portão fechado", () => {
    const pagina = ler(path.join(APP, "(painel)", "avisos", "page.tsx"));
    assert.match(ler(path.join(APP, "(painel)", "layout.tsx")), /juntarAvisos\(daEmpresa, await avisosDoAdminPara\(usuario\.papel, /);
    assert.match(pagina, /await avisosDoAdminPara\(usuario\.papel, /);
    // Buscados antes de conferir o portão, e entram na lista do portão fechado e na do liberado.
    assert.ok(pagina.indexOf("avisosDoAdminPara(") < pagina.indexOf('portao.estado !== "liberado"'));
    assert.match(pagina, /<ListaDeAvisos avisos=\{doAdmin\} cnpj=\{null\} rotulo=/);
    assert.match(pagina, /juntarAvisos\(daEmpresa, doAdmin\)/);
  });
});
