// O que as abas de empresa mostram com o portão fechado (HTML do servidor, como o navegador recebe) e a ligação de
// cada aba com o portão, conferida no código: toda aba do menu tem página, a página passa por exigirConteudo, mostra o
// estado vazio em vez de redirecionar, e só lê dado da empresa pelo acesso que o portão entrega.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PortaoFechado } from "@/app/(painel)/portao";
import { gruposDaAdministracao, gruposDaBarra } from "@/app/barra-lateral";
import { ABAS_DA_EMPRESA, GRUPOS_DE_ABAS, abaDaEmpresa, abasDoGrupo } from "@/lib/abas";
import { avisoDoCertificadoDaPlataforma } from "@/lib/plataforma/aviso";
import { REDIRECIONAMENTOS } from "@/lib/redirecionamentos";
import { TELA_DA_PLATAFORMA } from "@/lib/serpro/config";

const APP = path.join(import.meta.dirname, "..", "app");
// A página de um endereço: dentro do grupo (painel) (a aplicação) ou fora dele (a área do administrador, app/admin).
const paginaDa = (href: string) => {
  const partes = href.split("?")[0].split("/").filter(Boolean);
  return partes[0] === "admin" ? path.join(APP, ...partes, "page.tsx") : path.join(APP, "(painel)", ...partes, "page.tsx");
};
// Os fontes de app/ e lib/ (menos a lista de redirecionamentos e os testes), para procurar links antigos.
const fontes = () =>
  ["app", "lib"].flatMap((d) =>
    (readdirSync(path.join(APP, "..", d), { recursive: true }) as string[])
      .filter((f) => /\.tsx?$/.test(f) && !/redirecionamentos\.ts$|\.test\.ts$/.test(f))
      .map((f) => path.join(APP, "..", d, f)),
  );

const texto = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const EMPRESA = { id: "00000000-0000-0000-0000-000000000001", cnpj: "12345678000195", razaoSocial: "Alfa Software Ltda", papel: "DONO" as const };

describe("estado vazio das abas (PortaoFechado)", () => {
  it("sem empresa: título da aba, o que ela vai mostrar e o botão 'Cadastrar empresa' para o assistente", () => {
    for (const aba of ABAS_DA_EMPRESA) {
      const html = renderToStaticMarkup(createElement(PortaoFechado, { aba, portao: { estado: "sem-empresa" } }));
      const t = texto(html);
      assert.ok(html.includes(`>${aba.nome}</h1>`), `${aba.href}: título da aba`);
      assert.ok(t.includes(aba.descricao), `${aba.href}: o que a aba vai mostrar`);
      assert.match(t, /Cadastre sua empresa para ver esta aba/);
      assert.match(html, /<a [^>]*href="\/empresas\/nova"[^>]*>Cadastrar empresa<\/a>/);
      assert.doesNotMatch(html, /href="\/planos"/);
    }
  });

  it("sem plano: explica a assinatura e leva à escolha do plano (/planos), com o nome da empresa", () => {
    const aba = abaDaEmpresa("/guias");
    const html = renderToStaticMarkup(createElement(PortaoFechado, { aba, portao: { estado: "sem-plano", empresa: EMPRESA } }));
    const t = texto(html);
    assert.ok(html.includes(">Guias</h1>"));
    assert.match(t, /Alfa Software Ltda/);
    assert.match(t, /Escolha um plano para ver esta aba/);
    assert.ok(t.includes(aba.descricao));
    assert.match(html, /<a [^>]*href="\/planos"[^>]*>Escolher um plano<\/a>/);
    assert.doesNotMatch(html, /href="\/empresas\/nova"/);
  });

  it("o painel inicial usa a saudação acima do título da aba", () => {
    const html = renderToStaticMarkup(createElement(PortaoFechado, { aba: abaDaEmpresa("/"), portao: { estado: "sem-empresa" }, sobre: "Olá, Ana" }));
    assert.match(texto(html), /Olá, Ana Painel do mês/);
  });
});

describe("cada aba de empresa passa pelo portão", () => {
  it("a lista tem as abas do menu, sem repetição, cada uma com descrição de 1-2 frases", () => {
    const hrefs = ABAS_DA_EMPRESA.map((a) => a.href);
    assert.deepEqual(hrefs, ["/", "/roteiro", "/guias", "/historico", "/situacao", "/defis", "/avisos", "/empresa", "/autorizacao", "/esocial"]);
    for (const a of ABAS_DA_EMPRESA) {
      const frases = a.descricao.split(/[.!?](\s|$)/).filter((f) => f.trim()).length;
      assert.ok(frases >= 1 && frases <= 2, `${a.href}: ${frases} frases`);
    }
  });

  it("barra lateral (20/10/2026): 'Empresa' só com as do dia a dia e 'Configuração' no fim; o grupo 'Plataforma' saiu (virou a área /admin)", () => {
    const nomes = gruposDaBarra().map((g) => [g.titulo, g.itens.map((i) => i.nome)]);
    assert.deepEqual(nomes, [
      ["Empresa", ["Painel do mês", "Roteiro", "Guias", "Histórico", "Situação fiscal", "Declaração anual"]],
      ["Configuração", ["Dados da empresa", "Autorização", "eSocial"]],
    ]);
    // Nada de administração na barra da aplicação, para nenhum papel (a barra da aplicação nem recebe o papel).
    for (const h of gruposDaBarra().flatMap((g) => g.itens.map((i) => i.href))) {
      assert.ok(!h.startsWith("/admin") && !["/usuarios", "/config/plataforma", "/plano"].includes(h), h);
    }
    // O Roteiro continua sendo uma aba própria (não foi juntado com Guias), e o eSocial é só configuração.
    assert.ok(abasDoGrupo("empresa").some((a) => a.href === "/roteiro"));
    assert.equal(abaDaEmpresa("/esocial").grupo, "configuracao");
    assert.match(abaDaEmpresa("/esocial").descricao, /configuração do eSocial/);
    assert.match(abaDaEmpresa("/esocial").descricao, /envio de cada mês fica no Roteiro/);
    // Toda aba da lista está em exatamente um grupo, e os grupos juntos são a lista, na mesma ordem.
    assert.deepEqual(GRUPOS_DE_ABAS.flatMap((g) => abasDoGrupo(g.grupo)), [...ABAS_DA_EMPRESA]);
    // O painel do mês só fica ativo na própria página (não em toda rota que começa com "/").
    assert.equal(gruposDaBarra()[0].itens[0].exato, true);
    // Cada item tem ícone (a barra recolhida mostra só os ícones), nas duas áreas.
    for (const g of [...gruposDaBarra(), ...gruposDaAdministracao("ADMIN")]) for (const i of g.itens) assert.ok(i.svg, i.href);
  });

  it("barra da área do administrador: grupo 'Administração'; MANAGER só vê os usuários, ADMIN tudo, COMMON_USER nada", () => {
    const itens = (papel: "ADMIN" | "MANAGER" | "COMMON_USER") => gruposDaAdministracao(papel).flatMap((g) => g.itens.map((i) => i.href));
    assert.deepEqual(gruposDaAdministracao("ADMIN").map((g) => g.titulo), ["Administração"]);
    assert.deepEqual(itens("ADMIN"), ["/admin", "/admin/usuarios", "/admin/plataforma", "/admin/custos", "/admin/plano"]);
    assert.deepEqual(gruposDaAdministracao("ADMIN")[0].itens.map((i) => i.nome), ["Visão geral", "Usuários", "Certificado da plataforma", "Custos", "Plano do projeto"]);
    assert.deepEqual(itens("MANAGER"), ["/admin/usuarios"]);
    assert.deepEqual(itens("COMMON_USER"), []);
    // A visão geral só fica ativa na própria página.
    assert.equal(gruposDaAdministracao("ADMIN")[0].itens[0].exato, true);
    // Sem seletor de empresa, sino e engrenagem; com o título "Administração", a faixa de cor e "Voltar para a aplicação".
    const barra = readFileSync(path.join(APP, "barra-lateral.tsx"), "utf8");
    assert.match(barra, /const grupos = naAdministracao \? gruposDaAdministracao\(administracao\) : gruposDaBarra\(\);/);
    assert.match(barra, /naAdministracao \? \(\s*<span[\s\S]*?Administração<\/span>[\s\S]*?\) : \(\s*empresa\s*\)/);
    assert.match(barra, /\{!naAdministracao && sino\}/);
    assert.match(barra, /\{!naAdministracao && \(\s*<Link\s+href="\/config"/);
    assert.match(barra, /\{naAdministracao && \(\s*<Link\s+href="\/"[\s\S]*?Voltar para a aplicação/);
    assert.match(barra, /data-\[area=administracao\]:border-t-warn/);
    const layout = readFileSync(path.join(APP, "admin", "layout.tsx"), "utf8");
    assert.match(layout, /await exigirEntradaNaAreaDoAdmin\(\)/);
    assert.match(layout, /<BarraLateral\s+administracao=\{usuario\.papel\}/);
    assert.match(layout, /<MenuUsuario [^>]*naAdministracao/);
    assert.doesNotMatch(layout, /SeletorEmpresa|Sino|exigirConteudo|empresa=/);
  });

  it("a barra lateral monta os grupos com as abas da lista (menos as foraDoMenu, abertas pelo sininho), sem filtrar por empresa; a larga, a recolhida e a do celular usam a mesma lista", () => {
    const barra = readFileSync(path.join(APP, "barra-lateral.tsx"), "utf8");
    assert.match(barra, /abasDoGrupo\(grupo\)\s*\.filter\(\(a\) => !a\.foraDoMenu\)\s*\.map\(daAba\)/);
    // O único filtro é o foraDoMenu: Avisos e mensagens fica fora da barra e é aberta pelo sininho.
    assert.deepEqual(ABAS_DA_EMPRESA.filter((a) => "foraDoMenu" in a && a.foraDoMenu).map((a) => a.href), ["/avisos"]);
    assert.ok(!gruposDaBarra().some((g) => g.itens.some((i) => i.href === "/avisos")));
    assert.doesNotMatch(barra, /ABAS_DA_EMPRESA\.filter/);
    // Um só lugar desenha os itens (a gaveta do celular e a barra larga/recolhida são o mesmo <Itens>), com os grupos na ordem.
    assert.equal([...barra.matchAll(/<Itens /g)].length, 1);
    assert.match(barra, /\{grupos\.map\(\(g\) =>/);
    // Recolhida: o título de cada grupo vira uma linha, e cada item mostra só o ícone (o nome fica no title).
    assert.match(barra, /lg:in-data-\[barra=fechada\]:block" aria-hidden="true"/);
    assert.match(barra, /title=\{i\.nome\}/);
    // A barra não recebe nada sobre ter empresa ou plano: o que ela mostra não depende disso. Na aplicação, nem o papel.
    assert.doesNotMatch(barra, /export function BarraLateral\(\{[^}]*(empresaAtiva|portao|plano|gestao|interno|admin\b)/);
    const layout = readFileSync(path.join(APP, "(painel)", "layout.tsx"), "utf8");
    assert.match(layout, /<BarraLateral\s+sino=/);
    assert.doesNotMatch(layout, /administracao=|admin=/);
  });

  it("todo link fixo da barra lateral, da barra de cima, do menu do usuário e da área do administrador tem página (nada de 404)", () => {
    for (const rel of ["barra-lateral.tsx", "(painel)/menu-usuario.tsx", "(painel)/config/page.tsx"]) {
      const fonte = readFileSync(path.join(APP, rel), "utf8");
      const hrefs = [...fonte.matchAll(/href[=:] ?"(\/[^"]*)"/g)].map((m) => m[1]);
      assert.ok(hrefs.length > 0, rel);
      for (const href of hrefs) assert.ok(existsSync(paginaDa(href)), `${rel}: ${href} sem página`);
    }
    // Os itens dos grupos (abas de lib/abas.ts e as páginas da área do administrador) também.
    for (const g of [...gruposDaBarra(), ...gruposDaAdministracao("ADMIN")]) for (const i of g.itens) assert.ok(existsSync(paginaDa(i.href)), `${g.titulo}: ${i.href} sem página`);
    // A engrenagem (Configuração) da barra de cima, que antes caía em 404.
    assert.ok(readFileSync(path.join(APP, "barra-lateral.tsx"), "utf8").includes('href="/config"'));
    assert.ok(existsSync(paginaDa("/config")));
    // Os avisos do certificado da plataforma e os motivos técnicos levam à área do administrador.
    const avisos = (["ilegivel", "recusado", "indisponivel"] as const).flatMap((estado) => avisoDoCertificadoDaPlataforma({ estado }, new Date()));
    assert.ok(avisos.length > 0);
    for (const href of [TELA_DA_PLATAFORMA, ...avisos.map((a) => a.link.href)]) {
      assert.equal(href, "/admin/plataforma");
      assert.ok(existsSync(paginaDa(href)), href);
    }
  });

  it("o menu do usuário: 'Área do administrador' só para quem entra na área (MANAGER e ADMIN); dentro dela, 'Voltar para a aplicação'", () => {
    const menu = readFileSync(path.join(APP, "(painel)", "menu-usuario.tsx"), "utf8");
    assert.match(menu, /areaDoAdmin && \(\s*<Link role="menuitem" href=\{inicioDoAdmin\(usuario\.papel\) \?\? "\/"\}[\s\S]*?>\s*Área do administrador/);
    assert.match(menu, /naAdministracao \? \(\s*<Link role="menuitem" href="\/"[\s\S]*?>\s*Voltar para a aplicação/);
    assert.doesNotMatch(menu, /href="\/usuarios"/);
    const layout = readFileSync(path.join(APP, "(painel)", "layout.tsx"), "utf8");
    assert.match(layout, /areaDoAdmin=\{entraNaAreaDoAdmin\(usuario\.papel\)\}/);
  });

  for (const aba of ABAS_DA_EMPRESA) {
    it(`${aba.href}: existe, usa exigirConteudo, mostra o estado vazio, não redireciona e lê dados só pelo acesso do portão`, () => {
      const arquivo = paginaDa(aba.href);
      assert.ok(existsSync(arquivo), arquivo);
      const fonte = readFileSync(arquivo, "utf8");
      assert.match(fonte, /await exigirConteudo\(\)/);
      assert.ok(fonte.includes(`abaDaEmpresa("${aba.href}")`), "o estado vazio é o desta aba");
      assert.doesNotMatch(fonte, /\bredirect\(/, "nada de redirecionar para o cadastro");
      assert.doesNotMatch(fonte, /exigirAcessoEmpresa|exigirSessao\(/, "o acesso aos dados vem só do portão");
      // O estado vazio vem antes de qualquer leitura de dado da empresa.
      const fechado = fonte.indexOf('portao.estado !== "liberado"');
      assert.ok(fechado > 0);
      for (const leitura of ["dadosDaReceita(", "ultimaConsulta(", "situacaoTermo(", "parametrosDoTermo(", "prepararAutorizacao("]) {
        const i = fonte.indexOf(leitura);
        if (i >= 0) assert.ok(i > fechado, `${leitura} depois do portão`);
      }
    });
  }

  it("/automatico virou /autorizacao: redirect permanente no next.config, a página antiga não existe e nenhum link aponta para ela", () => {
    assert.deepEqual(REDIRECIONAMENTOS.find((r) => r.source === "/automatico"), { source: "/automatico", destination: "/autorizacao", permanent: true });
    assert.ok(REDIRECIONAMENTOS.some((r) => r.source === "/automatico/:resto*" && r.destination === "/autorizacao/:resto*" && r.permanent));
    for (const r of REDIRECIONAMENTOS) assert.ok(existsSync(paginaDa(r.destination.replace(/\/:resto\*$/, ""))), r.destination);
    assert.ok(!existsSync(paginaDa("/automatico")), "a pasta antiga saiu");
    const config = readFileSync(path.join(APP, "..", "next.config.ts"), "utf8");
    assert.match(config, /redirects: async \(\) => REDIRECIONAMENTOS/);
    // Nenhum link (href) em app/ ou lib/ aponta para o endereço antigo.
    for (const f of fontes()) assert.doesNotMatch(readFileSync(f, "utf8"), /["'`]\/automatico\b/, f);
  });

  it("o que era de gestão foi para a área do administrador: redirect permanente das URLs antigas, páginas antigas fora e nenhum link para elas", () => {
    const antigas = { "/usuarios": "/admin/usuarios", "/config/plataforma": "/admin/plataforma", "/plano": "/admin/plano" };
    for (const [source, destination] of Object.entries(antigas)) {
      assert.deepEqual(REDIRECIONAMENTOS.find((r) => r.source === source), { source, destination, permanent: true });
      assert.ok(!existsSync(paginaDa(source)), `${source}: a página antiga saiu`);
      assert.ok(existsSync(paginaDa(destination)), destination);
    }
    // /planos (os planos de assinatura do cliente) não é pego pelo redirect de /plano, e /config continua na aplicação.
    assert.ok(!REDIRECIONAMENTOS.some((r) => r.source.startsWith("/planos") || r.source === "/config"));
    assert.ok(existsSync(paginaDa("/planos")));
    assert.ok(existsSync(paginaDa("/config")));
    for (const f of fontes()) assert.doesNotMatch(readFileSync(f, "utf8"), /["'`]\/(usuarios|config\/plataforma|plano)(?![\w-])/, f);
  });

  it("as ações que leem ou gravam dado da empresa conferem vínculo e plano pelo portão", () => {
    for (const rel of ["(painel)/empresa/acoes.ts", "(painel)/autorizacao/acoes.ts"]) {
      const fonte = readFileSync(path.join(APP, rel), "utf8");
      assert.match(fonte, /exigirAcessoAoConteudo\(/, rel);
      assert.doesNotMatch(fonte, /exigirAcessoEmpresa\(/, rel);
    }
  });

  it("o layout só calcula o aviso do sino (dado da empresa) com o portão liberado", () => {
    const fonte = readFileSync(path.join(APP, "(painel)", "layout.tsx"), "utf8");
    assert.match(fonte, /await exigirConteudo\(\)/);
    // Parte 8: a central de avisos (lib/avisos/coleta.ts) junta tudo, só com o portão liberado.
    assert.match(fonte, /portao\.estado === "liberado"\s*\? await avisosDaEmpresa\(banco\(\), portao\.acesso, new Date\(\), \{ termo: await situacaoTermo\(await termoDoServidor\(\), portao\.acesso\) \}\)\s*: \[\]/);
    assert.doesNotMatch(fonte, /exigirAcessoEmpresa/);
  });
});
