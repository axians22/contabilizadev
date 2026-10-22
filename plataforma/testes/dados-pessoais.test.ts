// "Seus dados" (cadastro pessoal do primeiro login) e a busca do CEP, contra o Postgres de teste. Nada sai da máquina: a
// consulta de CEP é o fetch falso do núcleo.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { buscarFalso } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { ceps, dadosPessoais, empresaUsuarios } from "@/banco/esquema";
import { entrarComGoogle, resolverSessao } from "@/lib/autenticacao/servico";
import { criarEmpresa } from "@/lib/empresas/servico";
import { buscarCep, NAO_ACHADO_DE_NOVO_DIAS } from "@/lib/usuarios/cep";
import { CPF_EM_USO, ErroDadosPessoais, IDENTIDADE_TRAVADA, identidadeDo, lerDadosPessoais, salvarDadosPessoais } from "@/lib/usuarios/dados-pessoais";
import { listarUsuarios } from "@/lib/usuarios/servico";
import { VERSAO_DOS_TERMOS } from "@/lib/usuarios/validacao";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps, perfil } from "./apoio";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const PERFIS = { ana: perfil("ana@a.com", "sub-ana"), beto: perfil("beto@b.com", "sub-beto"), admin: perfil("admin@plataforma.com", "sub-admin") };
const AGORA = new Date("2026-10-21T15:00:00Z");
const HOJE = "2026-10-21";
const DIA = 24 * 60 * 60 * 1000;
const entrar = async (quem: keyof typeof PERFIS) => entrarComGoogle(deps(t.banco, PERFIS, { adminEmails: ["admin@plataforma.com"] }), quem);

const FORMULARIO = {
  nomeCompleto: "Fulana de Tal Exemplo",
  cpf: "529.123.456-34",
  dataNascimento: "1990-05-10",
  whatsapp: "(48) 99999-1234",
  cep: "88010-000",
  logradouro: "Rua Felipe Schmidt",
  numero: "100",
  complemento: "Sala 2",
  bairro: "Centro",
  cidade: "Florianópolis",
  uf: "SC",
  aceite: "on",
};

describe("salvar Seus dados", () => {
  it("grava na forma normalizada, com a versão dos termos e a data do aceite; a sessão deixa de ter dados pendentes", async () => {
    const { usuario, cookie } = await entrar("ana");
    assert.equal(usuario.dadosPendentes, true);
    assert.equal((await resolverSessao(deps(t.banco), cookie))?.usuario.dadosPendentes, true);
    await salvarDadosPessoais(t.banco, usuario.id, FORMULARIO, AGORA, HOJE);
    const d = await lerDadosPessoais(t.banco, usuario.id);
    assert.equal(d?.cpf, "52912345634");
    assert.equal(d?.whatsapp, "+5548999991234");
    assert.equal(d?.cep, "88010000");
    assert.equal(d?.termosVersao, VERSAO_DOS_TERMOS);
    assert.equal(d?.termosAceitosEm.toISOString(), AGORA.toISOString());
    assert.equal((await resolverSessao(deps(t.banco), cookie))?.usuario.dadosPendentes, false);
    assert.deepEqual(await identidadeDo(t.banco, usuario.id), { nomeCompleto: "Fulana de Tal Exemplo", cpf: "52912345634" });
  });

  it("aceite de uma versão antiga dos termos: volta a ficar pendente (e o nome e CPF deixam de valer para o cadastro)", async () => {
    const { usuario, cookie } = await entrar("ana");
    await salvarDadosPessoais(t.banco, usuario.id, FORMULARIO, AGORA, HOJE);
    await t.banco.update(dadosPessoais).set({ termosVersao: "versao-antiga" }).where(eq(dadosPessoais.usuarioId, usuario.id));
    assert.equal((await resolverSessao(deps(t.banco), cookie))?.usuario.dadosPendentes, true);
    assert.equal(await identidadeDo(t.banco, usuario.id), null);
  });

  it("campo inválido ou sem o aceite: nada é gravado e cada erro vem no seu campo", async () => {
    const { usuario } = await entrar("ana");
    await assert.rejects(salvarDadosPessoais(t.banco, usuario.id, { ...FORMULARIO, cpf: "123.456.789-00", aceite: "" }, AGORA, HOJE), (e: unknown) => {
      assert.ok(e instanceof ErroDadosPessoais);
      assert.deepEqual(Object.keys(e.erros).sort(), ["aceite", "cpf"]);
      return true;
    });
    assert.equal(await lerDadosPessoais(t.banco, usuario.id), null);
  });

  it("um CPF por conta: o mesmo CPF em outra conta é recusado, sem dizer qual", async () => {
    const ana = (await entrar("ana")).usuario;
    const beto = (await entrar("beto")).usuario;
    await salvarDadosPessoais(t.banco, ana.id, FORMULARIO, AGORA, HOJE);
    await assert.rejects(salvarDadosPessoais(t.banco, beto.id, { ...FORMULARIO, nomeCompleto: "Beltrano Exemplo" }, AGORA, HOJE), (e: unknown) => e instanceof ErroDadosPessoais && e.message === CPF_EM_USO);
    assert.equal(await lerDadosPessoais(t.banco, beto.id), null);
  });

  it("edita depois; com empresa cadastrada, o nome completo e o CPF ficam travados (o resto muda)", async () => {
    const { usuario } = await entrar("ana");
    await salvarDadosPessoais(t.banco, usuario.id, FORMULARIO, AGORA, HOJE);
    await salvarDadosPessoais(t.banco, usuario.id, { ...FORMULARIO, nomeCompleto: "Fulana de Tal Exemplo Souza" }, AGORA, HOJE);
    const empresa = await criarEmpresa(t.banco, usuario, { cnpj: "12345678000195", razaoSocial: "EXEMPLO" });
    assert.ok(empresa);
    await assert.rejects(salvarDadosPessoais(t.banco, usuario.id, { ...FORMULARIO, cpf: "111.123.456-63" }, AGORA, HOJE), (e: unknown) => e instanceof ErroDadosPessoais && e.message === IDENTIDADE_TRAVADA);
    await assert.rejects(salvarDadosPessoais(t.banco, usuario.id, { ...FORMULARIO, nomeCompleto: "Outra Pessoa" }, AGORA, HOJE), ErroDadosPessoais);
    await salvarDadosPessoais(t.banco, usuario.id, { ...FORMULARIO, nomeCompleto: "Fulana de Tal Exemplo Souza", whatsapp: "(48) 98888-0000" }, AGORA, HOJE);
    assert.equal((await lerDadosPessoais(t.banco, usuario.id))?.whatsapp, "+5548988880000");
    // Provisório também trava.
    await t.banco.update(empresaUsuarios).set({ papel: "PROVISORIO" }).where(eq(empresaUsuarios.usuarioId, usuario.id));
    await assert.rejects(salvarDadosPessoais(t.banco, usuario.id, { ...FORMULARIO, cpf: "111.123.456-63" }, AGORA, HOJE), ErroDadosPessoais);
  });

  it("a lista de usuários da área do administrador não traz CPF, nascimento, telefone nem endereço", async () => {
    const admin = (await entrar("admin")).usuario;
    const { usuario } = await entrar("ana");
    await salvarDadosPessoais(t.banco, usuario.id, FORMULARIO, AGORA, HOJE);
    const lista = await listarUsuarios(t.banco, admin, undefined, 1, ["admin@plataforma.com"]);
    const texto = JSON.stringify(lista);
    for (const dado of ["52912345634", "529.123.456-34", "1990-05-10", "99999", "88010", "Felipe Schmidt", "Fulana de Tal"]) assert.ok(!texto.includes(dado), dado);
  });
});

describe("busca do CEP: banco primeiro", () => {
  const RESPOSTA = { cep: "88010000", state: "SC", city: "Florianópolis", neighborhood: "Centro", street: "Rua Felipe Schmidt", service: "x" };

  it("consulta uma vez, guarda e depois vem do banco sem chamar nada", async () => {
    const buscar = buscarFalso({ status: 200, corpo: RESPOSTA });
    const r = await buscarCep(t.banco, "88010-000", { agora: AGORA, buscar });
    assert.deepEqual(r, { tipo: "achado", fonte: "consulta", endereco: { cep: "88010000", logradouro: "Rua Felipe Schmidt", bairro: "Centro", cidade: "Florianópolis", uf: "SC" } });
    const nada = buscarFalso();
    const deNovo = await buscarCep(t.banco, "88010000", { agora: new Date(AGORA.getTime() + 400 * DIA), buscar: nada });
    assert.equal(deNovo.tipo === "achado" && deNovo.fonte, "banco");
    assert.equal(nada.chamadas.length, 0);
    assert.equal((await t.banco.select().from(ceps)).length, 1);
  });

  it("CEP que não existe: guardado como não achado e só perguntado de novo depois do prazo", async () => {
    await buscarCep(t.banco, "99999-999", { agora: AGORA, buscar: buscarFalso({ status: 404 }) });
    const nada = buscarFalso();
    assert.equal((await buscarCep(t.banco, "99999999", { agora: new Date(AGORA.getTime() + DIA), buscar: nada })).tipo, "nao-achado");
    assert.equal(nada.chamadas.length, 0);
    const depois = buscarFalso({ status: 200, corpo: { ...RESPOSTA, cep: "99999999" } });
    assert.equal((await buscarCep(t.banco, "99999999", { agora: new Date(AGORA.getTime() + (NAO_ACHADO_DE_NOVO_DIAS + 1) * DIA), buscar: depois })).tipo, "achado");
    assert.equal(depois.chamadas.length, 1);
  });

  it("falha da consulta não guarda nada (a tela pede o endereço à mão); CEP inválido nem consulta", async () => {
    const r = await buscarCep(t.banco, "88010000", { agora: AGORA, buscar: buscarFalso({ status: 503 }) });
    assert.equal(r.tipo, "indisponivel");
    assert.equal((await t.banco.select().from(ceps)).length, 0);
    const nada = buscarFalso();
    assert.equal((await buscarCep(t.banco, "123", { buscar: nada })).tipo, "invalido");
    assert.equal(nada.chamadas.length, 0);
  });
});
