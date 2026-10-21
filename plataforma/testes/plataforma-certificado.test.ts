// Certificado e chaves da plataforma guardados pelo ADMIN (lib/plataforma/segredos.ts), contra o Postgres de teste:
// só ADMIN, o que é conferido no .pfx, a cifra no banco (sem o segredo em claro, IV por registro), nada de segredo nas
// respostas, o registro de quem trocou, a PLATAFORMA_CHAVE trocada e a configuração do Serpro e do eSocial lendo daqui.
// Certificados de teste gerados na hora; nada é chamado de verdade.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { certificadoDeTeste, certificadoIcpDeTeste } from "@contabilizadev/nucleo/certificado-teste";
import { plataformaSegredos, type InfoDoCertificadoGuardado, type Papel } from "@/banco/esquema";
import { eq } from "drizzle-orm";
import { montarPlataforma } from "@/lib/plataforma/montagem";
import {
  guardarCertificado,
  guardarChaves,
  lerGuardado,
  resumir,
  resumoParaAdmin,
  versaoDoGuardado,
  type Ator,
  type DependenciasSegredos,
} from "@/lib/plataforma/segredos";
import { resolverCertificadoDaPlataforma } from "@/lib/serpro/config";
import { podeVerNoAdmin } from "@/lib/admin";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsDeLogin, perfil } from "./apoio";

const PLATAFORMA = "11444777000161";
const DIA = 24 * 60 * 60 * 1000;
const AGORA = new Date();
const CHAVE = randomBytes(32);

const icp = certificadoIcpDeTeste({ tipo: "PJ", numero: PLATAFORMA, nome: "PLATAFORMA DE TESTE LTDA", senha: "senha-da-plataforma" });

let t: BancoDeTeste;
let logs: string[];
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(async () => {
  logs = [];
  await t.limpar();
});
after(() => t.fechar());

const deps = (extra: Partial<DependenciasSegredos> = {}): DependenciasSegredos => ({
  banco: t.banco,
  chave: CHAVE,
  plataforma: { cnpj: PLATAFORMA },
  agora: () => AGORA,
  log: (m) => logs.push(m),
  ...extra,
});

async function conta(email: string, papel: Papel): Promise<Ator> {
  const r = await entrarComGoogle(depsDeLogin(t.banco, { x: perfil(email, `sub-${email}`) }, { adminEmails: papel === "ADMIN" ? [email] : [] }), "x");
  return { id: r.usuario.id, email, papel };
}

const status = (s: number) => (e: { status?: number }) => e.status === s;

describe("só ADMIN vê e troca o certificado e as chaves da plataforma", () => {
  it("COMMON_USER e MANAGER são recusados (403) ao enviar o certificado, as chaves e ao ver o resumo; nada é gravado", async () => {
    for (const papel of ["COMMON_USER", "MANAGER"] as const) {
      const ator = await conta(`${papel.toLowerCase()}@x.dev`, papel);
      await assert.rejects(guardarCertificado(deps(), ator, icp.pfx, icp.senha), status(403));
      await assert.rejects(guardarChaves(deps(), ator, "chave", "segredo"), status(403));
      await assert.rejects(resumoParaAdmin(deps(), ator), status(403));
    }
    assert.equal((await t.banco.select().from(plataformaSegredos)).length, 0);
    assert.deepEqual(logs, []);
  });

  it("a página e as ações conferem o ADMIN no servidor (exigirAreaDoAdmin, só ADMIN), não só o menu", () => {
    const pasta = path.join(import.meta.dirname, "..", "app", "admin", "plataforma");
    assert.match(readFileSync(path.join(pasta, "page.tsx"), "utf8"), /await exigirAreaDoAdmin\("\/admin\/plataforma"\)/);
    const acoes = readFileSync(path.join(pasta, "acoes.ts"), "utf8");
    for (const bloco of acoes.split(/export async function /).slice(1)) assert.match(bloco, /await exigirAreaDoAdmin\("\/admin\/plataforma"\)/, bloco.slice(0, 30));
    assert.equal(podeVerNoAdmin("ADMIN", "/admin/plataforma"), true);
    for (const papel of ["MANAGER", "COMMON_USER"] as const) assert.equal(podeVerNoAdmin(papel, "/admin/plataforma"), false, papel);
  });
});

describe("guardar o certificado da plataforma", () => {
  it("ADMIN envia o e-CNPJ A1 do PLATAFORMA_CNPJ: guarda cifrado, sem a senha, e devolve só titular, CNPJ e validade", async () => {
    const adm = await conta("adm@x.dev", "ADMIN");
    const r = await guardarCertificado(deps(), adm, icp.pfx, icp.senha);
    assert.equal(r?.cnpj, PLATAFORMA);
    assert.equal(r?.titular, "PLATAFORMA DE TESTE LTDA");
    assert.ok(r && r.validoAte.getTime() > AGORA.getTime() + 300 * DIA);

    const [linha] = await t.banco.select().from(plataformaSegredos);
    assert.equal(linha.nome, "certificado");
    assert.equal(linha.atualizadoPorId, adm.id);
    assert.match(linha.cifrado, /^v1\./);
    const bruto = JSON.stringify(linha);
    for (const proibido of ["PRIVATE KEY", "BEGIN CERTIFICATE", icp.senha, icp.pfx.toString("base64").slice(0, 40)]) assert.ok(!bruto.includes(proibido), proibido);

    const g = await lerGuardado(t.banco, CHAVE);
    assert.ok(g.certificado?.legivel);
    assert.match(g.certificado.legivel ? g.certificado.pem.chave : "", /BEGIN PRIVATE KEY/);
    assert.equal(g.certificado.atualizadoPor, "adm");
    // Nem a senha fica no que foi guardado.
    assert.ok(!JSON.stringify(g).includes(icp.senha));
  });

  it("IV por registro: guardar o mesmo arquivo de novo gera outro cifrado", async () => {
    const adm = await conta("adm@x.dev", "ADMIN");
    await guardarCertificado(deps(), adm, icp.pfx, icp.senha);
    const [a] = await t.banco.select().from(plataformaSegredos);
    await guardarCertificado(deps(), adm, icp.pfx, icp.senha);
    const [b] = await t.banco.select().from(plataformaSegredos);
    assert.notEqual(a.cifrado, b.cifrado);
    assert.notEqual(a.cifrado.split(".")[1], b.cifrado.split(".")[1]);
  });

  it("recusa o que não é o e-CNPJ A1 ICP-Brasil da plataforma, na validade e com a senha certa (400, nada gravado)", async () => {
    const adm = await conta("adm@x.dev", "ADMIN");
    const casos: [string, Uint8Array, string, RegExp][] = [
      ["outro CNPJ", ...par(certificadoIcpDeTeste({ tipo: "PJ", numero: "11222333000181", nome: "OUTRA LTDA" })), /11\.222\.333\/0001-81.*PLATAFORMA_CNPJ \(11\.444\.777\/0001-61\)/],
      ["e-CPF", ...par(certificadoIcpDeTeste({ tipo: "PF", numero: "12345678909", nome: "FULANO" })), /e-CPF/],
      ["A3", ...par(certificadoIcpDeTeste({ tipo: "PJ", numero: PLATAFORMA, nome: "X", politica: "A3" })), /A3/],
      ["sem política ICP", ...par(certificadoIcpDeTeste({ tipo: "PJ", numero: PLATAFORMA, nome: "X", politica: null })), /não é um e-CNPJ A1/],
      ["autoassinado", ...par(certificadoIcpDeTeste({ tipo: "PJ", numero: PLATAFORMA, nome: "X", autoassinado: true })), /não é um e-CNPJ A1 da ICP-Brasil/],
      ["vencido", ...par(certificadoIcpDeTeste({ tipo: "PJ", numero: PLATAFORMA, nome: "X", validoDe: new Date(Date.now() - 400 * DIA), validoAte: new Date(Date.now() - DIA) })), /vencido/],
      ["chave de 1024 bits", ...par(certificadoIcpDeTeste({ tipo: "PJ", numero: PLATAFORMA, nome: "X", bits: 1024 })), /2048 bits/],
      ["OpenSSL comum (sem ICP)", ...par(certificadoDeTeste({ titular: `X:${PLATAFORMA}` })), /não é um e-CNPJ A1/],
      ["senha errada", icp.pfx, "errada", /confira o arquivo/],
      ["sem senha", icp.pfx, "", /senha/],
      ["arquivo vazio", new Uint8Array(), "x", /Escolha o arquivo/],
      ["arquivo que não é .pfx", Buffer.from("não sou um certificado"), "x", /confira o arquivo/],
      ["arquivo grande demais", new Uint8Array(200 * 1024), "x", /grande demais/],
    ];
    for (const [nome, arquivo, senha, mensagem] of casos) {
      await assert.rejects(guardarCertificado(deps(), adm, arquivo, senha), (e: { status?: number; message: string }) => e.status === 400 && mensagem.test(e.message), nome);
    }
    assert.equal((await t.banco.select().from(plataformaSegredos)).length, 0);
  });

  it("sem PLATAFORMA_CHAVE ou sem PLATAFORMA_CNPJ não guarda (diz o que falta)", async () => {
    const adm = await conta("adm@x.dev", "ADMIN");
    await assert.rejects(guardarCertificado(deps({ chave: null, motivoDaChave: "PLATAFORMA_CHAVE ausente: gere..." }), adm, icp.pfx, icp.senha), /PLATAFORMA_CHAVE ausente/);
    await assert.rejects(guardarCertificado(deps({ chave: null }), adm, icp.pfx, icp.senha), /Falta a PLATAFORMA_CHAVE/);
    await assert.rejects(guardarCertificado(deps({ plataforma: { cnpj: null, motivo: "Falta PLATAFORMA_CNPJ" } }), adm, icp.pfx, icp.senha), /Falta PLATAFORMA_CNPJ/);
    await assert.rejects(guardarChaves(deps({ chave: null }), adm, "k", "s"), /PLATAFORMA_CHAVE/);
  });

  it("o log diz quem trocou e quando, sem o conteúdo", async () => {
    const adm = await conta("adm@x.dev", "ADMIN");
    await guardarCertificado(deps(), adm, icp.pfx, icp.senha);
    await guardarChaves(deps(), adm, "minha-consumer-key", "meu-consumer-secret");
    assert.equal(logs.length, 2);
    assert.match(logs[0], new RegExp(`Certificado da plataforma trocado por adm@x\\.dev \\(${adm.id}\\) em ${AGORA.toISOString().replace(/\./g, "\\.")}`));
    assert.match(logs[1], /Chaves do contrato trocadas por adm@x\.dev/);
    for (const l of logs) for (const proibido of ["PRIVATE KEY", icp.senha, "minha-consumer-key", "meu-consumer-secret"]) assert.ok(!l.includes(proibido), proibido);
  });
});

describe("chaves do contrato", () => {
  it("guarda as duas cifradas; o resumo mostra só o fim da key e a data, nunca o secret", async () => {
    const adm = await conta("adm@x.dev", "ADMIN");
    const r = await guardarChaves(deps(), adm, "  minha-consumer-key-abcd ", " meu-consumer-secret ");
    assert.deepEqual({ ...r, atualizadoEm: undefined }, { legivel: true, finalDaChave: "abcd", atualizadoEm: undefined, atualizadoPor: null });
    const [linha] = await t.banco.select().from(plataformaSegredos);
    assert.ok(!JSON.stringify(linha).includes("meu-consumer-secret") && !JSON.stringify(linha).includes("minha-consumer-key"));
    const g = await lerGuardado(t.banco, CHAVE);
    assert.ok(g.chaves?.legivel && g.chaves.consumerKey === "minha-consumer-key-abcd" && g.chaves.consumerSecret === "meu-consumer-secret");
    const resumo = await resumoParaAdmin(deps(), adm);
    assert.ok(!JSON.stringify(resumo).includes("meu-consumer-secret") && !JSON.stringify(resumo).includes("minha-consumer"));
  });

  it("as duas juntas, sem espaço no meio e de tamanho razoável", async () => {
    const adm = await conta("adm@x.dev", "ADMIN");
    await assert.rejects(guardarChaves(deps(), adm, "só-a-key", " "), status(400));
    await assert.rejects(guardarChaves(deps(), adm, "com espaço", "s"), status(400));
    await assert.rejects(guardarChaves(deps(), adm, "k", "s".repeat(300)), status(400));
  });
});

describe("nenhuma resposta traz o .pfx, a chave privada ou o secret", () => {
  it("o resumo do ADMIN (o que vai para a tela) só tem dados públicos", async () => {
    const adm = await conta("adm@x.dev", "ADMIN");
    const doEnvio = await guardarCertificado(deps(), adm, icp.pfx, icp.senha);
    await guardarChaves(deps(), adm, "minha-consumer-key", "meu-consumer-secret");
    const resumo = await resumoParaAdmin(deps(), adm);
    const texto = JSON.stringify([resumo, doEnvio]);
    for (const proibido of ["PRIVATE KEY", "BEGIN CERTIFICATE", icp.senha, "meu-consumer-secret", "minha-consumer-key", icp.pfx.toString("base64").slice(0, 40)]) assert.ok(!texto.includes(proibido), proibido);
    assert.deepEqual(Object.keys(resumo.certificado ?? {}).sort(), ["atualizadoEm", "atualizadoPor", "cnpj", "emissor", "legivel", "titular", "validoAte"]);
    assert.deepEqual(Object.keys(resumo.chaves ?? {}).sort(), ["atualizadoEm", "atualizadoPor", "finalDaChave", "legivel"]);
  });
});

describe("PLATAFORMA_CHAVE trocada", () => {
  it("o guardado fica ilegível (a tela pede para enviar de novo); enviar de novo com a chave nova volta a valer", async () => {
    const adm = await conta("adm@x.dev", "ADMIN");
    await guardarCertificado(deps(), adm, icp.pfx, icp.senha);
    await guardarChaves(deps(), adm, "k", "s");
    const nova = randomBytes(32);
    const ilegivel = await lerGuardado(t.banco, nova);
    assert.equal(ilegivel.certificado?.legivel, false);
    assert.equal(ilegivel.chaves?.legivel, false);
    const resumo = resumir(ilegivel);
    assert.equal(resumo.certificado?.legivel, false);
    assert.equal(resumo.certificado?.cnpj, PLATAFORMA, "o que é público continua aparecendo");
    // Sem chave nenhuma, também ilegível (nunca derruba).
    assert.equal((await lerGuardado(t.banco, null)).certificado?.legivel, false);
    // A configuração diz o que fazer (e não usa nada do que não abre).
    const config = montarPlataforma({ PLATAFORMA_CNPJ: PLATAFORMA }, ilegivel, new Date(), () => assert.fail("sem arquivo")).serpro;
    assert.match(config.pronto ? "" : config.motivo, /não abre com a PLATAFORMA_CHAVE atual.*\/admin\/plataforma/);
    await guardarCertificado(deps({ chave: nova }), adm, icp.pfx, icp.senha);
    assert.equal((await lerGuardado(t.banco, nova)).certificado?.legivel, true);
  });

  it("dado alterado no banco também não abre", async () => {
    const adm = await conta("adm@x.dev", "ADMIN");
    await guardarChaves(deps(), adm, "k", "s");
    const [linha] = await t.banco.select().from(plataformaSegredos);
    const partes = linha.cifrado.split(".");
    partes[3] = Buffer.from("{}").toString("base64url");
    await t.banco.update(plataformaSegredos).set({ cifrado: partes.join(".") });
    assert.equal((await lerGuardado(t.banco, CHAVE)).chaves?.legivel, false);
  });
});

describe("Serpro e eSocial leem o certificado guardado pela mesma função", () => {
  it("sem nada do contrato no ambiente (drive desmontado), o guardado deixa os dois prontos; a versão muda a cada troca", async () => {
    const adm = await conta("adm@x.dev", "ADMIN");
    const env = { PLATAFORMA_CNPJ: PLATAFORMA, CERT_PFX_PATH: "/mnt/f/nao-montado.pfx", CERT_PFX_SENHA: "x" };
    const semArquivo = () => {
      throw new Error("ENOENT");
    };
    const antes = await lerGuardado(t.banco, CHAVE);
    assert.match((montarPlataforma(env, antes, new Date(), semArquivo).serpro as { motivo: string }).motivo, /Não foi possível ler o certificado.*envie o e-CNPJ A1 em \/admin\/plataforma/);
    const v0 = await versaoDoGuardado(t.banco);

    await guardarCertificado(deps(), adm, icp.pfx, icp.senha);
    await guardarChaves(deps(), adm, "k", "s");
    const v1 = await versaoDoGuardado(t.banco);
    assert.notEqual(v0, v1);
    const g = await lerGuardado(t.banco, CHAVE);
    const { serpro, esocial } = montarPlataforma(env, g, new Date(), semArquivo);
    assert.ok(serpro.pronto && esocial.pronto);
    assert.deepEqual(serpro.certificado, esocial.certificado);
    assert.equal(serpro.contratante, PLATAFORMA);
    assert.equal(esocial.transmissor, PLATAFORMA);
    // A assinatura como a própria plataforma (DCTFWeb e eSocial da empresa dela) usa o mesmo certificado.
    assert.match(serpro.pem().certificado, /BEGIN CERTIFICATE/);
  });

  it("a validade e o CNPJ que liberam o uso saem do certificado decifrado: alterar a coluna info (em claro) não muda nada", async () => {
    const adm = await conta("adm@x.dev", "ADMIN");
    await guardarCertificado(deps(), adm, icp.pfx, icp.senha);
    const semArquivo = () => assert.fail("o guardado vale; não lê o ambiente");
    const antes = resolverCertificadoDaPlataforma(PLATAFORMA, {}, await lerGuardado(t.banco, CHAVE), semArquivo);
    assert.ok(antes.pronto);
    const [linha] = await t.banco.select().from(plataformaSegredos).where(eq(plataformaSegredos.nome, "certificado"));
    const info = linha.info as InfoDoCertificadoGuardado;

    // Validade empurrada para frente num certificado vencido: continua vencido (a data é a do certificado).
    const daqui2Anos = new Date(Date.now() + 2 * 365 * DIA);
    await t.banco.update(plataformaSegredos).set({ info: { ...info, validoAte: new Date(Date.now() + 5 * 365 * DIA).toISOString() } }).where(eq(plataformaSegredos.nome, "certificado"));
    const adiado = resolverCertificadoDaPlataforma(PLATAFORMA, {}, await lerGuardado(t.banco, CHAVE), semArquivo, daqui2Anos);
    assert.ok(!adiado.pronto && adiado.falha.tipo === "vencido");
    assert.equal(adiado.falha.tipo === "vencido" && adiado.falha.validoAte.getTime(), antes.validoAte.getTime());

    // Validade puxada para trás e CNPJ trocado: o certificado continua valendo, com os dados dele.
    await t.banco.update(plataformaSegredos).set({ info: { ...info, cnpj: "11222333000181", validoAte: "2020-01-01T00:00:00.000Z" } }).where(eq(plataformaSegredos.nome, "certificado"));
    const g = await lerGuardado(t.banco, CHAVE);
    assert.equal(g.certificado?.info.cnpj, "11222333000181", "a tela mostra o que está na coluna");
    const depois = resolverCertificadoDaPlataforma(PLATAFORMA, {}, g, semArquivo);
    assert.ok(depois.pronto);
    assert.equal(depois.validoAte.getTime(), antes.validoAte.getTime());
    // E o contrário: info dizendo que é o PLATAFORMA_CNPJ não faz um certificado de outro CNPJ passar.
    assert.equal(resolverCertificadoDaPlataforma("11222333000181", {}, g, semArquivo).pronto, false);
  });
});

function par(c: { pfx: Buffer; senha: string }): [Uint8Array, string] {
  return [c.pfx, c.senha];
}
