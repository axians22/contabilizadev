// A página /admin/producao (passo a passo do Coolify e conferência do ambiente) e a rota de saúde GET /api/saude.
// - A conferência do ambiente com variáveis de teste (produção x desenvolvimento, segredo ausente, conta de desenvolvimento
//   no ADMIN_EMAILS), sem nunca mostrar o valor de um segredo.
// - A rota de saúde: 200/503, pública no proxy, sem dado nenhum.
// - A página: só o ADMIN, conferido no servidor de verdade (sessão no banco de TESTE); COMMON_USER e MANAGER recebem 404.
// - O guia e o docs/producao.md com os mesmos passos e fontes; as variáveis da .env.exemplo todas cobertas.
// Nenhum serviço externo é chamado.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { NextRequest } from "next/server";
import { conferirAmbiente, type FatosDoServidor, type ItemDaConferencia } from "@/lib/producao/conferencia";
import { F, GUIA, VARIAVEIS, VARIAVEIS_PROIBIDAS } from "@/lib/producao/guia";
import { respostaDaSaude } from "@/lib/producao/saude";
import { ROTAS_PUBLICAS } from "@/lib/autenticacao/rotas";
import { assinarToken, novoToken } from "@/lib/autenticacao/cookie";
import { prepararBancoDeTeste, nomeDoBanco, urlDoBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { explicacoes, semExplicacoes, texto } from "./tela";

const exigir = createRequire(import.meta.url);
// "server-only" recusa ser carregado fora do Next; next/headers precisa da requisição: os dois trocados só aqui.
const so = exigir.resolve("server-only");
exigir.cache[so] = { id: so, filename: so, loaded: true, exports: {} } as never;
let cookieAtual: string | undefined;
let protocoloAtual: string | null = null;
const cabecalhos = exigir.resolve("next/headers");
exigir.cache[cabecalhos] = {
  id: cabecalhos,
  filename: cabecalhos,
  loaded: true,
  exports: {
    cookies: async () => ({ get: () => (cookieAtual ? { value: cookieAtual } : undefined), set() {}, delete() {} }),
    headers: async () => new Headers(protocoloAtual ? { "x-forwarded-proto": protocoloAtual } : {}),
  },
} as never;

const RAIZ = path.join(import.meta.dirname, "..", "..");
const SEGREDO = "producao-segredo-de-sessao-com-mais-de-32-caracteres";
const TOKEN = Buffer.alloc(32, 1).toString("base64");
const PLATAFORMA = Buffer.alloc(32, 2).toString("base64");
const ADMIN = "admin@producao.teste";
const AGORA = new Date("2026-10-22T12:00:00Z");

const PRODUCAO = {
  NODE_ENV: "production",
  SESSAO_SEGREDO: SEGREDO,
  TOKEN_CHAVE: TOKEN,
  PLATAFORMA_CHAVE: PLATAFORMA,
  GOOGLE_CLIENT_ID: "cliente.apps.googleusercontent.com",
  ADMIN_EMAILS: ADMIN,
  PLATAFORMA_CNPJ: "11.222.333/0001-81",
  PLATAFORMA_RAZAO_SOCIAL: "Plataforma Teste Ltda",
  DATABASE_URL: "postgres://usuario:senha-do-banco@banco:5432/contabilizadev",
};
const FATOS_OK: FatosDoServidor = {
  banco: { ok: true, aplicadas: 17, ultimaAplicada: 1792632300052 },
  migracoesDoCodigo: { total: 17, ultima: 1792632300052 },
  certificado: { pronto: true, origem: "banco", validoAte: new Date("2027-06-01T00:00:00Z") },
  chaves: "guardadas",
  protocolo: "https",
  agora: AGORA,
};

const item = (itens: ItemDaConferencia[], chave: string) => {
  const i = itens.find((x) => x.chave === chave);
  assert.ok(i, chave);
  return i;
};
const faltam = (itens: ItemDaConferencia[]) => itens.filter((i) => !i.ok).map((i) => i.chave);

describe("conferência do ambiente", () => {
  it("produção completa: todos os itens em OK", () => {
    const itens = conferirAmbiente(PRODUCAO, FATOS_OK);
    assert.deepEqual(faltam(itens), []);
    assert.equal(item(itens, "cookie-seguro").situacao, "__Host-sessao, Secure, httpOnly");
    assert.match(item(itens, "certificado").situacao, /Guardado · válido até 01\/06\/2027|Guardado · válido até 31\/05\/2027/);
    // Todos os itens pedidos estão lá.
    assert.deepEqual(itens.map((i) => i.chave), [
      "node-env", "login-desligado", "cookie-seguro", "sessao-segredo", "token-chave", "plataforma-chave", "google-client-id",
      "admin-emails", "banco", "migracoes", "certificado", "chaves", "plataforma-cnpj", "plataforma-razao", "https",
    ]);
  });

  it("nunca mostra o valor de um segredo (nem na frase nem no tooltip)", () => {
    for (const fatos of [FATOS_OK, { ...FATOS_OK, banco: { ok: false } as const }]) {
      const tudo = JSON.stringify(conferirAmbiente({ ...PRODUCAO, TOKEN_CHAVE: "curta-demais" }, fatos));
      for (const segredo of [SEGREDO, TOKEN, PLATAFORMA, "curta-demais", "senha-do-banco", PRODUCAO.GOOGLE_CLIENT_ID]) assert.ok(!tudo.includes(segredo), segredo);
    }
  });

  it("desenvolvimento: NODE_ENV, cookie, login desligado, HTTPS e conta de desenvolvimento ficam como Falta", () => {
    const env = { ...PRODUCAO, NODE_ENV: "development", AUTH_DISABLED: "true", ADMIN_EMAILS: "vyeiralucas@gmail.com,dev@contabilizadev.local" };
    const itens = conferirAmbiente(env, { ...FATOS_OK, protocolo: "http" });
    assert.deepEqual(faltam(itens), ["node-env", "login-desligado", "cookie-seguro", "admin-emails", "https"]);
    assert.match(item(itens, "node-env").situacao, /development \(não é produção\)/);
    assert.match(item(itens, "login-desligado").situacao, /Ligado/);
    assert.equal(item(itens, "cookie-seguro").situacao, "sessao, sem Secure (desenvolvimento)");
    assert.equal(item(itens, "admin-emails").situacao, "Inclui a conta de desenvolvimento");
    assert.equal(item(itens, "https").situacao, "Chegou por http");
  });

  it("AUTH_DISABLED em produção é ignorada pelo login, mas a conferência pede para retirar", () => {
    const i = item(conferirAmbiente({ ...PRODUCAO, AUTH_DISABLED: "true" }, FATOS_OK), "login-desligado");
    assert.equal(i.ok, false);
    assert.match(i.situacao, /ignorada aqui, mas retire/);
  });

  it("conta de desenvolvimento própria (DEV_USER_EMAIL) no ADMIN_EMAILS também é Falta; ADMIN_EMAILS vazio também", () => {
    assert.equal(item(conferirAmbiente({ ...PRODUCAO, DEV_USER_EMAIL: "eu@local.teste", ADMIN_EMAILS: `${ADMIN}, EU@local.teste` }, FATOS_OK), "admin-emails").ok, false);
    const vazio = item(conferirAmbiente({ ...PRODUCAO, ADMIN_EMAILS: "" }, FATOS_OK), "admin-emails");
    assert.equal(vazio.ok, false);
    assert.match(vazio.situacao, /ninguém/);
  });

  it("segredos ausentes, curtos, inválidos ou repetidos", () => {
    const semNada = conferirAmbiente({ NODE_ENV: "production" }, FATOS_OK);
    for (const c of ["sessao-segredo", "token-chave", "plataforma-chave", "google-client-id", "admin-emails", "plataforma-cnpj", "plataforma-razao"]) {
      assert.equal(item(semNada, c).ok, false, c);
    }
    assert.equal(item(semNada, "sessao-segredo").situacao, "Ausente");
    assert.equal(item(semNada, "token-chave").situacao, "Ausente");
    assert.equal(item(conferirAmbiente({ ...PRODUCAO, SESSAO_SEGREDO: "curto" }, FATOS_OK), "sessao-segredo").situacao, "Presente, mas curto (mínimo 32 caracteres)");
    assert.equal(item(conferirAmbiente({ ...PRODUCAO, TOKEN_CHAVE: "abc" }, FATOS_OK), "token-chave").situacao, "Presente, mas inválida");
    assert.equal(item(conferirAmbiente({ ...PRODUCAO, PLATAFORMA_CHAVE: TOKEN }, FATOS_OK), "plataforma-chave").situacao, "Igual à TOKEN_CHAVE");
    assert.equal(item(conferirAmbiente({ ...PRODUCAO, PLATAFORMA_CNPJ: "11.222.333/0001-82" }, FATOS_OK), "plataforma-cnpj").situacao, "Inválido");
  });

  it("banco fora do ar, migrações atrasadas e banco sem nenhuma migração", () => {
    const fora = conferirAmbiente(PRODUCAO, { ...FATOS_OK, banco: { ok: false } });
    assert.deepEqual(faltam(fora), ["banco", "migracoes"]);
    assert.equal(item(fora, "migracoes").situacao, "Sem banco, não dá para conferir");
    const atrasada = conferirAmbiente(PRODUCAO, { ...FATOS_OK, banco: { ok: true, aplicadas: 16, ultimaAplicada: 1792607174326 } });
    assert.deepEqual(faltam(atrasada), ["migracoes"]);
    assert.equal(item(atrasada, "migracoes").situacao, "16 de 17 aplicadas");
    assert.equal(item(conferirAmbiente(PRODUCAO, { ...FATOS_OK, banco: { ok: true, aplicadas: 0, ultimaAplicada: null } }), "migracoes").ok, false);
  });

  it("certificado: do ambiente, vencendo em 30 dias, vencido ou ausente é Falta; chaves do ambiente ou ilegíveis também", () => {
    const doAmbiente = item(conferirAmbiente(PRODUCAO, { ...FATOS_OK, certificado: { pronto: true, origem: "ambiente", validoAte: new Date("2027-06-01T00:00:00Z") } }), "certificado");
    assert.equal(doAmbiente.ok, false);
    assert.match(doAmbiente.situacao, /Vem do ambiente/);
    const vencendo = item(conferirAmbiente(PRODUCAO, { ...FATOS_OK, certificado: { pronto: true, origem: "banco", validoAte: new Date("2026-11-10T12:00:00Z") } }), "certificado");
    assert.equal(vencendo.ok, false);
    assert.match(vencendo.situacao, /vence em 19 dias/);
    const vencido = item(conferirAmbiente(PRODUCAO, { ...FATOS_OK, certificado: { pronto: false, vencidoEm: new Date("2026-10-01T12:00:00Z"), motivo: "venceu" } }), "certificado");
    assert.equal(vencido.situacao, "Vencido em 01/10/2026");
    assert.equal(item(conferirAmbiente(PRODUCAO, { ...FATOS_OK, certificado: { pronto: false, motivo: "falta" } }), "certificado").situacao, "Não está guardado");
    for (const chaves of ["ambiente", "ilegiveis", "faltam"] as const) assert.equal(item(conferirAmbiente(PRODUCAO, { ...FATOS_OK, chaves }), "chaves").ok, false, chaves);
  });

  it("HTTPS: o primeiro valor do x-forwarded-proto; sem cabeçalho é Falta", () => {
    assert.equal(item(conferirAmbiente(PRODUCAO, { ...FATOS_OK, protocolo: "HTTPS, http" }), "https").ok, true);
    assert.equal(item(conferirAmbiente(PRODUCAO, { ...FATOS_OK, protocolo: "http, https" }), "https").ok, false);
    assert.equal(item(conferirAmbiente(PRODUCAO, { ...FATOS_OK, protocolo: null }), "https").situacao, "Protocolo desconhecido");
  });
});

describe("rota de saúde (GET /api/saude)", () => {
  const corpo = async (r: Response) => JSON.parse(await r.text());

  it("200 {ok:true} com o banco no ar, sem nada além disso e sem cache", async () => {
    const r = await respostaDaSaude(async () => [{ "?column?": 1 }]);
    assert.equal(r.status, 200);
    assert.deepEqual(await corpo(r), { ok: true });
    assert.equal(r.headers.get("cache-control"), "no-store");
  });

  it("503 {ok:false} com o banco fora (erro, erro síncrono ou demora), sem o erro na resposta", async () => {
    const erros = console.error;
    console.error = () => {};
    try {
      for (const pingar of [
        async () => {
          throw new Error("connect ECONNREFUSED 10.0.0.5:5432 senha-do-banco");
        },
        () => {
          throw new Error("Defina DATABASE_URL");
        },
        () => new Promise(() => {}),
      ]) {
        const r = await respostaDaSaude(pingar, 20);
        assert.equal(r.status, 503);
        const t = await r.text();
        assert.deepEqual(JSON.parse(t), { ok: false });
        assert.doesNotMatch(t, /ECONNREFUSED|senha|DATABASE_URL/);
      }
    } finally {
      console.error = erros;
    }
  });

  it("é pública no proxy (sem cookie segue, sem login), e só ela entre as APIs", async () => {
    assert.ok((ROTAS_PUBLICAS as readonly string[]).includes("/api/saude"));
    process.env.SESSAO_SEGREDO = SEGREDO;
    const { proxy } = await import("@/proxy");
    for (const desligado of ["false", "true"]) {
      process.env.AUTH_DISABLED = desligado;
      assert.equal(proxy(new NextRequest("http://localhost:3001/api/saude")).headers.get("x-middleware-next"), "1", desligado);
      assert.equal(proxy(new NextRequest("http://localhost:3001/api/sessao")).status, 401, desligado);
    }
  });

  it("o route handler só responde {ok}: sem sessão, versão nem dado; não chama nada de fora", () => {
    const fonte = readFileSync(path.join(RAIZ, "plataforma", "app", "api", "saude", "route.ts"), "utf8");
    assert.match(fonte, /export async function GET\(\) \{\s*return respostaDaSaude\(\(\) => banco\(\)\.execute\(sql`select 1`\)\);\s*\}/);
    const codigo = fonte.replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(codigo, /fetch\(|version|comSessao|cookies|headers/);
  });
});

describe("guia da produção e docs/producao.md", () => {
  const doc = readFileSync(path.join(RAIZ, "docs", "producao.md"), "utf8");

  it("cada passo e cada seção do guia estão no docs/producao.md, com as fontes", () => {
    for (const s of GUIA) {
      assert.ok(doc.includes(`## ${s.titulo}`), s.titulo);
      for (const p of s.passos) {
        assert.ok(doc.includes(`- [ ] ${p.texto}`), p.id);
        assert.ok(p.fontes.length > 0, `${p.id}: sem fonte`);
        for (const f of p.fontes) assert.ok(doc.includes(f.href), `${p.id}: ${f.href}`);
      }
    }
  });

  it("as fontes são a documentação oficial do Coolify, páginas oficiais citadas ou arquivos do próprio projeto", () => {
    for (const f of Object.values(F)) {
      if (f.href.startsWith("https://")) assert.match(f.href, /^https:\/\/(coolify\.io\/docs\/|docs\.aws\.amazon\.com\/|registro\.br\/|developers\.google\.com\/)/, f.href);
      else if (f.href.startsWith("/")) assert.match(f.href, /^\/admin\//, f.href);
      else assert.ok(readFileSync(path.join(RAIZ, f.href), "utf8").length > 0, f.href);
    }
  });

  it("cada detalhe do guia está no docs/producao.md, palavra por palavra", () => {
    for (const s of GUIA) for (const p of s.passos) for (const d of p.detalhe ?? []) assert.ok(doc.includes(`  - ${d}`), `${p.id}: ${d}`);
  });

  it("os passos da conferência citam o arquivo da conferência; o que não é da documentação vem marcado como sugestão nossa", () => {
    const passo = (id: string) => GUIA.flatMap((s) => s.passos).find((p) => p.id === id)!;
    assert.deepEqual(passo("conferencia").fontes, [F.conferencia]);
    assert.deepEqual(passo("conferir-https").fontes, [F.dominios, F.conferencia]);
    assert.equal(F.conferencia.href, "plataforma/lib/producao/conferencia.ts");
    const quatroGb = (passo("requisitos").detalhe ?? []).find((d) => d.includes("4 GB"));
    assert.ok(quatroGb?.startsWith("Sugestão nossa, não da documentação"), quatroGb);
  });

  it("as nove seções pedidas, na ordem", () => {
    assert.deepEqual(GUIA.map((s) => s.id), ["servidor", "dominio", "banco", "aplicacao", "variaveis", "google", "backups", "monitoramento", "antes-de-abrir"]);
  });

  it("toda variável da .env.exemplo está na tabela ou na lista do que não entra em produção", () => {
    const doExemplo = [...readFileSync(path.join(RAIZ, ".env.exemplo"), "utf8").matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]);
    const cobertas = [...VARIAVEIS.map((v) => v.nome), ...VARIAVEIS_PROIBIDAS.flatMap((v) => v.nome.split(" e "))];
    assert.ok(doExemplo.length > 10);
    for (const v of doExemplo) assert.ok(cobertas.includes(v), v);
  });

  it("o Dockerfile ainda é o que o guia descreve (porta 3001 e migrações no CMD)", () => {
    const dockerfile = readFileSync(path.join(RAIZ, "docker", "Dockerfile"), "utf8");
    assert.match(dockerfile, /EXPOSE 3001/);
    assert.match(dockerfile, /ENV NODE_ENV=production/);
    assert.match(dockerfile, /CMD \["sh", "-c", "npm run banco:migrar -w plataforma && npm run start -w plataforma"\]/);
    assert.match(dockerfile, /FROM node:22-alpine/); // tem o wget do health check
  });
});

async function desfecho(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (e) {
    const d = String((e as { digest?: string }).digest ?? (e as Error).message);
    if (d.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return "404";
    if (d.startsWith("NEXT_REDIRECT")) return `redirect ${d.split(";")[2]}`;
    throw e;
  }
}

describe("/admin/producao: só o ADMIN, conferido no servidor", async () => {
  let t: BancoDeTeste;
  const cookies: Record<string, string> = {};
  before(async () => {
    t = await prepararBancoDeTeste();
    const url = urlDoBancoDeTeste();
    assert.ok(nomeDoBanco(url).endsWith("_teste"));
    // Ambiente de desenvolvimento, sem certificado nem chaves do contrato no ambiente (nada é lido de fora).
    for (const v of ["CERT_PFX_PATH", "CERT_PFX_SENHA", "SERPRO_CONSUMER_KEY", "SERPRO_CONSUMER_SECRET", "PLATAFORMA_CNPJ", "PLATAFORMA_RAZAO_SOCIAL", "NODE_ENV", "DEV_USER_EMAIL"]) delete process.env[v];
    Object.assign(process.env, { DATABASE_URL: url, SESSAO_SEGREDO: SEGREDO, TOKEN_CHAVE: TOKEN, PLATAFORMA_CHAVE: PLATAFORMA, ADMIN_EMAILS: ADMIN, AUTH_DISABLED: "false", GOOGLE_CLIENT_ID: "cliente-secreto.apps.googleusercontent.com" });
    await t.limpar();
    const { usuarios, sessoes } = await import("@/banco/esquema");
    const { hashDoToken } = await import("@/lib/autenticacao/cookie");
    for (const [papel, email] of [["COMMON_USER", "comum@producao.teste"], ["MANAGER", "gestor@producao.teste"], ["ADMIN", ADMIN]] as const) {
      const [u] = await t.banco.insert(usuarios).values({ email, nome: papel, provedor: "GOOGLE", provedorId: email, papel }).returning({ id: usuarios.id });
      const token = novoToken();
      await t.banco.insert(sessoes).values({ usuarioId: u.id, tokenHash: hashDoToken(token), expiraEm: new Date(Date.now() + 3_600_000) });
      cookies[papel] = assinarToken(token, SEGREDO);
    }
  });
  after(async () => {
    await t.limpar();
    await t.fechar();
    const g = globalThis as unknown as { __conexao?: { end: () => Promise<void> } };
    await g.__conexao?.end();
  });

  const como = (papel: string | undefined) => (cookieAtual = papel ? cookies[papel] : undefined);
  const pagina = async () => (await import("@/app/admin/producao/page")).default as () => Promise<ReactElement>;

  it("COMMON_USER e MANAGER recebem 404; sem sessão vai para o login", async () => {
    const Producao = await pagina();
    for (const papel of ["COMMON_USER", "MANAGER"]) {
      como(papel);
      assert.equal(await desfecho(() => Producao()), "404", papel);
    }
    como(undefined);
    assert.match(await desfecho(() => Producao()), /^redirect \/entrar/);
  });

  it("o ADMIN abre: conferência no topo (desenvolvimento honesto), rota de saúde e as nove seções com fonte", async () => {
    como("ADMIN");
    protocoloAtual = "http";
    const Producao = await pagina();
    const html = renderToStaticMarkup(await Producao());
    const visivel = texto(semExplicacoes(html));
    // A conferência vem antes do passo a passo.
    assert.ok(html.indexOf("Conferência deste ambiente") < html.indexOf("1. Servidor"));
    for (const s of GUIA) assert.ok(visivel.includes(s.titulo), s.titulo);
    assert.match(visivel, /GET \/api\/saude/);
    // Em desenvolvimento: NODE_ENV, cookie, HTTPS, certificado, chaves e CNPJ faltam; banco, migrações e segredos estão OK.
    const itens = Object.fromEntries([...html.matchAll(/<li[^>]*data-item="([^"]+)"[\s\S]*?>(OK|Falta)<\/span><\/span><\/li>/g)].map((m) => [m[1], m[2]]));
    assert.equal(itens["node-env"], "Falta");
    assert.equal(itens["cookie-seguro"], "Falta");
    assert.equal(itens["https"], "Falta");
    assert.equal(itens["certificado"], "Falta");
    assert.equal(itens["plataforma-cnpj"], "Falta");
    assert.equal(itens["banco"], "OK");
    assert.equal(itens["migracoes"], "OK");
    assert.equal(itens["sessao-segredo"], "OK");
    assert.equal(itens["token-chave"], "OK");
    assert.equal(itens["plataforma-chave"], "OK");
    assert.equal(itens["admin-emails"], "OK");
    assert.equal(Object.keys(itens).length, 15);
    // Nenhum valor de segredo na tela, nem dentro dos tooltips.
    for (const segredo of [SEGREDO, TOKEN, PLATAFORMA, "cliente-secreto"]) assert.ok(!html.includes(segredo), segredo);
    // Comandos copiáveis e as fontes como links.
    assert.match(html, /aria-label="Copiar o comando: [^"]+"/);
    assert.match(html, /href="https:\/\/coolify\.io\/docs\/start-with-self-hosted"/);
    assert.match(html, /href="\/admin\/plano\?aba=seguranca"/);
    // Explicações no tooltip, com rótulos únicos.
    const rotulos = explicacoes(html).map((e) => e.rotulo);
    assert.equal(new Set(rotulos).size, rotulos.length);
  });

  it("com x-forwarded-proto https, o item HTTPS fica OK", async () => {
    como("ADMIN");
    protocoloAtual = "https";
    const html = renderToStaticMarkup(await (await pagina())());
    assert.match(html, /data-item="https"[\s\S]*?Chegou por https[\s\S]*?>OK<\/span>/);
  });

  it("a rota de saúde de verdade responde 200 {ok:true} com o banco de teste", async () => {
    const { GET } = await import("@/app/api/saude/route");
    const r = await GET();
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(await r.text()), { ok: true });
  });

  it("a página está na lista da área, só para o ADMIN, com o nome Produção", async () => {
    const { PAGINAS_DO_ADMIN, podeVerNoAdmin } = await import("@/lib/admin");
    assert.ok(PAGINAS_DO_ADMIN.some((p) => p.href === "/admin/producao" && p.nome === "Produção"));
    assert.deepEqual((["COMMON_USER", "MANAGER", "ADMIN"] as const).filter((p) => podeVerNoAdmin(p, "/admin/producao")), ["ADMIN"]);
  });
});
