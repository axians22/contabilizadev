// Prova de posse da empresa (21/10/2026), contra o Postgres de teste: o cadastro confere o usuário com o quadro de sócios,
// a empresa fica aguardando comprovação (vários provisórios do mesmo CNPJ, isolados) e o termo assinado com o e-CNPJ em
// nome do CPF do usuário é a prova (cadeia ICP-Brasil, CNPJ e CPF do responsável conferidos antes de enviar, limite de
// envios). Nada sai da máquina: a consulta de CNPJ é a gravada, o cliente do contrato é o falso e os certificados são os de
// teste (AC de teste no lugar das raízes oficiais).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { buscarExemplo, buscarFalso, respostaGravada } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { lerRespostaCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { certificadoIcpDeTeste, confiancaDeTeste, CPF_RESPONSAVEL_DE_TESTE, type OpcoesCertificadoIcp } from "@contabilizadev/nucleo/certificado-teste";
import type { Certificado } from "@contabilizadev/nucleo/http";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import type { Resposta } from "@contabilizadev/nucleo/serpro/cliente";
import { outroResponsavel } from "@contabilizadev/nucleo/serpro/conferir-termo";
import { abrirCertificado, assinarTermo, montarTermo, vigenciaPara } from "@contabilizadev/nucleo/serpro/termo-autorizacao";
import { cadastrosEncerrados, cnpjsConsultados, consultasCnpj, empresas, empresaUsuarios, enviosTermo, termosAutorizacao } from "@/banco/esquema";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import {
  AguardandoComprovacao,
  dadosDaEmpresa,
  daEmpresa,
  ehProvisorio,
  exigirAcessoAoTermo,
  exigirAcessoEmpresa,
  SemAcessoEmpresa,
  type AcessoAoTermo,
  type AcessoEmpresa,
  type AcessoProvisorio,
} from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro, FaltamDadosPessoais, NaoConfereComQsa } from "@/lib/empresas/cadastro";
import { abrirPortao, exigirAcessoAoConteudo, exigirAcessoParaOTermo } from "@/lib/empresas/portao";
import {
  cadastrosEncerradosNaoVistos,
  COMPROVADA_POR_OUTRA,
  desistirDoCadastro,
  ErroDeEmpresa,
  listarEmpresasDoUsuario,
  marcarEncerradosVistos,
} from "@/lib/empresas/servico";
import { ErroAutenticaProcurador, ErroTermo, ErroTermoAutorizacao, LIMITE_DE_ENVIOS, parametrosDoTermo, prepararAutorizacao, registrarTermo, situacaoTermo, type DependenciasTermo, type ParametrosTermo } from "@/lib/termo/termo";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil, SEGREDO } from "./apoio";
import { dadosDeSocio } from "./apoio-empresa";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const DIA = 24 * 60 * 60 * 1000;
const HORA = 60 * 60 * 1000;
const AGORA = new Date(); // o certificado de teste vale a partir de agora e o termo precisa ser do dia
const CHAVE = randomBytes(32);
const PLATAFORMA = { numero: "11444777000161", nome: "PLATAFORMA DE TESTE LTDA" };
const EMPRESA = "12345678000195"; // ti-fator-r: FULANA DE TAL EXEMPLO e BELTRANO EXEMPLO, os dois "***123456**"
const ADMINS = ["admin@plataforma.com"];
const CPF_ANA = CPF_RESPONSAVEL_DE_TESTE; // 529.123.456-34
const CPF_BETO = "11112345663";
const PERFIS = { ana: perfil("ana@a.com", "sub-ana"), beto: perfil("beto@b.com", "sub-beto"), carla: perfil("carla@c.com", "sub-carla"), admin: perfil("admin@plataforma.com", "sub-admin") };
const entrar = async (quem: keyof typeof PERFIS) => (await entrarComGoogle(depsLogin(t.banco, PERFIS, { adminEmails: ADMINS }), quem)).usuario;

const tokenRecebido = (agora: Date): Resposta => ({
  status: 200,
  dados: { autenticar_procurador_token: "token-teste", data_hora_expiracao: `${new Date(agora.getTime() + DIA).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })}T23:59:59` },
  mensagens: [{ codigo: "200", texto: "Sucesso na execução." }],
});
const recusaDaReceita: Resposta = { status: 403, dados: undefined, mensagens: [{ codigo: "[AcessoNegado-AUTENTICAPROCURADOR-013]", texto: "texto da API" }] };

const dependencias = (cliente: DependenciasTermo["cliente"], agora = AGORA): DependenciasTermo => ({
  banco: t.banco,
  chave: CHAVE,
  cliente,
  contratante: PLATAFORMA,
  adminEmails: ADMINS,
  confianca: confiancaDeTeste(),
  agora: () => agora,
});

function assinarNoNavegador(certificado: Certificado, p: ParametrosTermo): string {
  const aberto = abrirCertificado(new Uint8Array(certificado.pfx), certificado.senha);
  const termo = montarTermo({ destinatario: p.contratante, assinadoPor: { numero: aberto.titular.numero, nome: p.empresa.razaoSocial }, dataAssinatura: p.dataAssinatura, vigencia: vigenciaPara(p.vigenciaMaxima, aberto) });
  return assinarTermo(termo, aberto);
}
// e-CNPJ da empresa, em nome de um responsável (OID 2.16.76.1.3.4).
const eCnpj = (cpf: string, extra: Partial<OpcoesCertificadoIcp> = {}) => certificadoIcpDeTeste({ tipo: "PJ", numero: EMPRESA, nome: "EXEMPLO SOFTWARE LTDA", responsavel: { cpf }, ...extra });

async function enviar(acesso: AcessoAoTermo, cliente: DependenciasTermo["cliente"], certificado: Certificado, agora = AGORA) {
  const d = dependencias(cliente, agora);
  return registrarTermo(d, acesso, assinarNoNavegador(certificado, await parametrosDoTermo(d, acesso)));
}

// Ana e Beto, os dois sócios do quadro do exemplo; os dois com o cadastro provisório da mesma empresa.
async function doisProvisorios() {
  const ana = await entrar("ana");
  const beto = await entrar("beto");
  await dadosDeSocio(t.banco, ana, EMPRESA, { nome: "Fulana de Tal Exemplo", cpf: CPF_ANA });
  await dadosDeSocio(t.banco, beto, EMPRESA, { nome: "Beltrano Exemplo", cpf: CPF_BETO });
  const opcoes = { segredo: SEGREDO, agora: AGORA };
  const pa = await consultarParaCadastro(t.banco, ana, EMPRESA, { ...opcoes, buscar: buscarExemplo("ti-fator-r") });
  const pb = await consultarParaCadastro(t.banco, beto, EMPRESA, { ...opcoes, buscar: buscarFalso() });
  assert.ok(pa.tipo === "previa" && pb.tipo === "previa");
  const empresaId = await cadastrarPelaPrevia(t.banco, ana, pa.previa.token, opcoes);
  assert.equal(await cadastrarPelaPrevia(t.banco, beto, pb.previa.token, opcoes), empresaId);
  const deAna = await exigirAcessoAoTermo(t.banco, ana, empresaId);
  const deBeto = await exigirAcessoAoTermo(t.banco, beto, empresaId);
  assert.ok(ehProvisorio(deAna) && ehProvisorio(deBeto));
  return { ana, beto, empresaId, deAna: deAna as AcessoProvisorio, deBeto: deBeto as AcessoProvisorio };
}

const contar = async (tabela: typeof enviosTermo | typeof termosAutorizacao | typeof consultasCnpj) => (await t.banco.select().from(tabela)).length;

describe("cadastro: quadro de sócios (QSA)", () => {
  it("quem não está no quadro é recusado com o motivo no tooltip; nada é criado", async () => {
    const carla = await entrar("carla");
    await dadosDeSocio(t.banco, carla, EMPRESA, { nome: "Carla Outra Pessoa", cpf: "52998224725" });
    await assert.rejects(consultarParaCadastro(t.banco, carla, EMPRESA, { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-fator-r") }), (e: unknown) => {
      assert.ok(e instanceof NaoConfereComQsa);
      assert.match(e.message, /Não encontramos você no quadro de sócios/);
      assert.match(e.explicacao.texto, /O que fazer: confira em Seus dados/);
      return true;
    });
    assert.equal((await t.banco.select().from(empresas)).length, 0);
  });

  it("o nome certo com o CPF de outra pessoa também é recusado (os dígitos visíveis não batem)", async () => {
    const carla = await entrar("carla");
    await dadosDeSocio(t.banco, carla, EMPRESA, { nome: "FULANA DE TAL EXEMPLO", cpf: "52998224725" });
    await assert.rejects(consultarParaCadastro(t.banco, carla, EMPRESA, { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-fator-r") }), NaoConfereComQsa);
  });

  it("a prévia assinada não salva quem saiu do quadro: o cadastro confere de novo com os dados de agora", async () => {
    const ana = await entrar("ana");
    await dadosDeSocio(t.banco, ana, EMPRESA, { nome: "Fulana de Tal Exemplo", cpf: CPF_ANA });
    const r = await consultarParaCadastro(t.banco, ana, EMPRESA, { segredo: SEGREDO, agora: AGORA, buscar: buscarExemplo("ti-fator-r") });
    assert.ok(r.tipo === "previa");
    await dadosDeSocio(t.banco, ana, EMPRESA, { nome: "Outro Nome Qualquer" });
    await assert.rejects(cadastrarPelaPrevia(t.banco, ana, r.previa.token, { segredo: SEGREDO, agora: AGORA }), NaoConfereComQsa);
  });

  it("consulta guardada que não bate e tem mais de um dia é refeita antes de recusar (o sócio pode ter entrado depois)", async () => {
    const ana = await entrar("ana");
    await dadosDeSocio(t.banco, ana, EMPRESA, { nome: "Fulana de Tal Exemplo", cpf: CPF_ANA });
    const antiga = lerRespostaCnpj({ ...respostaGravada("ti-fator-r"), qsa: [{ nome_socio: "OUTRO SOCIO", cnpj_cpf_do_socio: "***999999**" }] });
    await t.banco.insert(cnpjsConsultados).values({ cnpj: EMPRESA, dados: antiga, consultadoEm: new Date(AGORA.getTime() - 2 * DIA) });
    const buscar = buscarExemplo("ti-fator-r");
    const r = await consultarParaCadastro(t.banco, ana, EMPRESA, { segredo: SEGREDO, agora: AGORA, buscar });
    assert.equal(r.tipo === "previa" && r.previa.qsa, "confere");
    assert.equal(buscar.chamadas.length, 1);
    // Guardada há menos de um dia: não consulta de novo, recusa.
    await t.banco.update(cnpjsConsultados).set({ dados: antiga, consultadoEm: AGORA });
    const nada = buscarFalso();
    await assert.rejects(consultarParaCadastro(t.banco, ana, EMPRESA, { segredo: SEGREDO, agora: AGORA, buscar: nada }), NaoConfereComQsa);
    assert.equal(nada.chamadas.length, 0);
  });

  it("quadro vazio: segue com o aviso de que a comprovação será só pelo termo, e fica provisório", async () => {
    const ana = await entrar("ana");
    await dadosDeSocio(t.banco, ana, EMPRESA, { nome: "Fulana de Tal Exemplo", cpf: CPF_ANA });
    const semQuadro = { ...respostaGravada("ti-fator-r"), qsa: [] };
    const r = await consultarParaCadastro(t.banco, ana, EMPRESA, { segredo: SEGREDO, agora: AGORA, buscar: buscarFalso({ status: 200, corpo: semQuadro }) });
    assert.ok(r.tipo === "previa");
    assert.equal(r.previa.qsa, "sem-qsa");
    const id = await cadastrarPelaPrevia(t.banco, ana, r.previa.token, { segredo: SEGREDO, agora: AGORA });
    assert.ok(ehProvisorio(await exigirAcessoAoTermo(t.banco, ana, id)));
  });

  it("sem Seus dados não cadastra (o ADMIN entra sem preencher, mas para empresa de cliente precisa): nada é consultado", async () => {
    const admin = await entrar("admin");
    const nada = buscarFalso();
    await assert.rejects(consultarParaCadastro(t.banco, admin, EMPRESA, { segredo: SEGREDO, agora: AGORA, buscar: nada, cnpjReservado: PLATAFORMA.numero }), FaltamDadosPessoais);
    assert.equal(nada.chamadas.length, 0);
  });

  it("empresa da plataforma (ADMIN e PLATAFORMA_CNPJ): nasce comprovada, sem Seus dados nem quadro de sócios", async () => {
    const admin = await entrar("admin");
    const resposta = { ...respostaGravada("ti-fator-r"), cnpj: PLATAFORMA.numero, razao_social: PLATAFORMA.nome, qsa: [] };
    const opcoes = { segredo: SEGREDO, agora: AGORA, cnpjReservado: PLATAFORMA.numero };
    const r = await consultarParaCadastro(t.banco, admin, PLATAFORMA.numero, { ...opcoes, buscar: buscarFalso({ status: 200, corpo: resposta }) });
    assert.ok(r.tipo === "previa");
    assert.equal(r.previa.qsa, "plataforma");
    const id = await cadastrarPelaPrevia(t.banco, admin, r.previa.token, opcoes);
    const acesso = await exigirAcessoEmpresa(t.banco, admin, id, { papel: "DONO" });
    assert.equal(await contar(consultasCnpj), 1);
    assert.equal((await prepararAutorizacao(dependencias(clienteFalso()), acesso)).situacao.estado, "propria");
  });
});

describe("aguardando comprovação: provisórios do mesmo CNPJ isolados", () => {
  it("nenhum dos dois vê conteúdo: a porta única recusa, o portão mostra o estado de espera e o termo não lê nada", async () => {
    const { ana, beto, empresaId, deAna, deBeto } = await doisProvisorios();
    for (const [usuario, acesso] of [[ana, deAna], [beto, deBeto]] as const) {
      await assert.rejects(exigirAcessoEmpresa(t.banco, usuario, empresaId), AguardandoComprovacao);
      await assert.rejects(exigirAcessoAoConteudo(t.banco, usuario, empresaId), AguardandoComprovacao);
      // O acesso provisório não serve na porta dos dados (nem forçando o tipo).
      assert.throws(() => dadosDaEmpresa(t.banco, acesso as unknown as AcessoEmpresa), SemAcessoEmpresa);
      assert.throws(() => daEmpresa(acesso as unknown as AcessoEmpresa, consultasCnpj), SemAcessoEmpresa);
      const [lista] = await listarEmpresasDoUsuario(t.banco, usuario);
      assert.equal(lista.papel, "PROVISORIO");
      const portao = await abrirPortao(t.banco, usuario, lista);
      assert.equal(portao.estado, "aguardando");
      assert.deepEqual(await situacaoTermo(dependencias(clienteFalso()), acesso), { estado: "ausente" });
      // Pode assinar o termo (é a prova): parâmetros só com o CNPJ e a razão social.
      const preparo = await prepararAutorizacao(dependencias(clienteFalso()), acesso);
      assert.ok(preparo.parametros);
      assert.equal((await exigirAcessoParaOTermo(t.banco, usuario, empresaId)).papel, "PROVISORIO");
    }
    // Nada da empresa foi gravado por nenhum dos dois.
    assert.equal(await contar(consultasCnpj), 0);
    assert.equal(await contar(termosAutorizacao), 0);
  });

  it("um acesso provisório copiado ou montado à mão não passa", async () => {
    const { deAna } = await doisProvisorios();
    const copia = { ...deAna } as AcessoProvisorio;
    await assert.rejects(situacaoTermo(dependencias(clienteFalso()), copia), SemAcessoEmpresa);
  });

  it("desistir: tira só o próprio vínculo; o último a sair apaga a empresa (vazia)", async () => {
    const { ana, beto, empresaId, deAna, deBeto } = await doisProvisorios();
    await desistirDoCadastro(t.banco, deAna);
    assert.deepEqual(await listarEmpresasDoUsuario(t.banco, ana), []);
    assert.equal((await listarEmpresasDoUsuario(t.banco, beto)).length, 1);
    await desistirDoCadastro(t.banco, deBeto);
    assert.equal((await t.banco.select().from(empresas).where(eq(empresas.id, empresaId))).length, 0);
  });
});

describe("prova pelo termo, antes de enviar (nenhuma chamada paga à toa)", () => {
  it("e-CNPJ em nome de outro responsável: recusa com o CPF mascarado, sem enviar nem contar", async () => {
    const { deBeto } = await doisProvisorios();
    const cliente = clienteFalso(tokenRecebido(AGORA));
    await assert.rejects(enviar(deBeto, cliente, eCnpj(CPF_ANA)), (e: unknown) => {
      assert.ok(e instanceof ErroTermo);
      assert.equal(e.message, outroResponsavel(CPF_ANA));
      assert.equal(e.message, "Este e-CNPJ está em nome de outro responsável (CPF ***.123.456-**). Quem assina o termo precisa entrar com a própria conta.");
      return true;
    });
    assert.equal(cliente.chamadas.length, 0);
    assert.equal(await contar(enviosTermo), 0);
  });

  it("cadeia forjada, autoassinada ou com AC vencida e e-CNPJ de outro CNPJ: recusa, sem enviar nem contar", async () => {
    const { deAna } = await doisProvisorios();
    const cliente = clienteFalso();
    await assert.rejects(enviar(deAna, cliente, eCnpj(CPF_ANA, { cadeia: "forjada" })), /não chega a uma AC raiz oficial/);
    await assert.rejects(enviar(deAna, cliente, eCnpj(CPF_ANA, { autoassinado: true })), /autoassinado/);
    await assert.rejects(enviar(deAna, cliente, eCnpj(CPF_ANA, { cadeia: "intermediaria-vencida" })), /fora da validade/);
    await assert.rejects(enviar(deAna, cliente, eCnpj(CPF_ANA, { numero: "11222333000181" })), /outro CNPJ/);
    // Sem a confiança de teste (as raízes oficiais da ICP-Brasil), o certificado de teste não passa.
    const d = { ...dependencias(cliente), confianca: undefined };
    await assert.rejects(registrarTermo(d, deAna, assinarNoNavegador(eCnpj(CPF_ANA), await parametrosDoTermo(d, deAna))), /não chega a uma AC raiz oficial/);
    assert.equal(cliente.chamadas.length, 0);
    assert.equal(await contar(enviosTermo), 0);
  });

  it("sem Seus dados não assina (o ADMIN dono de uma empresa de cliente, por exemplo)", async () => {
    const { deAna } = await doisProvisorios();
    await t.banco.update(empresaUsuarios).set({ papel: "DONO" }).where(eq(empresaUsuarios.usuarioId, deAna.usuarioId));
    const dona = await exigirAcessoEmpresa(t.banco, { id: deAna.usuarioId }, deAna.empresaId);
    const { dadosPessoais } = await import("@/banco/esquema");
    await t.banco.delete(dadosPessoais).where(eq(dadosPessoais.usuarioId, deAna.usuarioId));
    const preparo = await prepararAutorizacao(dependencias(clienteFalso()), dona);
    assert.equal(preparo.parametros, null);
    assert.match(preparo.bloqueio!, /preencha antes Seus dados/);
    await assert.rejects(registrarTermo(dependencias(clienteFalso()), dona, "<x/>"), (e: unknown) => e instanceof ErroTermoAutorizacao && e.motivo === "sem-dados-pessoais");
  });
});

describe("termo aceito: o provisório vira DONO e os outros provisórios caem", () => {
  it("promove, tira os outros (que veem só que outra conta comprovou), e a consulta do cadastro vira dado da empresa", async () => {
    const { ana, beto, empresaId, deAna, deBeto } = await doisProvisorios();
    const cliente = clienteFalso(tokenRecebido(AGORA));
    const r = await enviar(deAna, cliente, eCnpj(CPF_ANA));
    assert.equal(cliente.chamadas.length, 1);
    assert.equal(r.situacao.estado, "vigente");
    assert.equal(r.acesso.papel, "DONO");
    assert.equal((await exigirAcessoEmpresa(t.banco, ana, empresaId)).papel, "DONO");
    assert.equal(await contar(consultasCnpj), 1);
    assert.equal(await contar(termosAutorizacao), 1);
    assert.equal(await contar(enviosTermo), 1);

    // Beto: sem vínculo, com o aviso (CNPJ e razão social, nunca quem comprovou).
    assert.deepEqual(await listarEmpresasDoUsuario(t.banco, beto), []);
    const avisos = await cadastrosEncerradosNaoVistos(t.banco, beto);
    assert.equal(avisos.length, 1);
    assert.deepEqual([avisos[0].cnpj, avisos[0].razaoSocial], [EMPRESA, "EXEMPLO SOFTWARE LTDA"]);
    const [linha] = await t.banco.select().from(cadastrosEncerrados);
    assert.doesNotMatch(JSON.stringify(linha), new RegExp(`${ana.id}|ana@a.com|${CPF_ANA}`));
    await marcarEncerradosVistos(t.banco, beto, AGORA);
    assert.deepEqual(await cadastrosEncerradosNaoVistos(t.banco, beto), []);
    assert.deepEqual(await cadastrosEncerradosNaoVistos(t.banco, ana), []);

    // O termo velho do Beto (assinado antes) não envia nada; um cadastro novo dele é recusado.
    const outro = clienteFalso(tokenRecebido(AGORA));
    await assert.rejects(enviar(deBeto, outro, eCnpj(CPF_BETO)), (e: unknown) => e instanceof ErroTermoAutorizacao && e.motivo === "comprovada-por-outra");
    assert.equal(outro.chamadas.length, 0);
    await assert.rejects(consultarParaCadastro(t.banco, beto, EMPRESA, { segredo: SEGREDO, agora: AGORA, buscar: buscarFalso() }), (e: unknown) => e instanceof ErroDeEmpresa && e.message === COMPROVADA_POR_OUTRA);
  });

  it("dois provisórios enviando ao mesmo tempo: um comprova; o outro para antes de enviar ('comprovada por outra conta')", async () => {
    const { deAna, deBeto } = await doisProvisorios();
    const cliente = clienteFalso(tokenRecebido(AGORA), tokenRecebido(AGORA));
    const d = dependencias(cliente);
    const [xmlA, xmlB] = [assinarNoNavegador(eCnpj(CPF_ANA), await parametrosDoTermo(d, deAna)), assinarNoNavegador(eCnpj(CPF_BETO), await parametrosDoTermo(d, deBeto))];
    const resultados = await Promise.allSettled([registrarTermo(d, deAna, xmlA), registrarTermo(d, deBeto, xmlB)]);
    assert.equal(resultados.filter((r) => r.status === "fulfilled").length, 1);
    const falha = resultados.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.ok(falha.reason instanceof ErroTermoAutorizacao && falha.reason.motivo === "comprovada-por-outra");
    assert.equal(cliente.chamadas.length, 1);
    const vinculos = await t.banco.select().from(empresaUsuarios);
    assert.deepEqual(vinculos.map((v) => v.papel), ["DONO"]);
  });
});

describe("limite de envios do termo por empresa (registrados no banco)", () => {
  it(`até ${LIMITE_DE_ENVIOS.porHora} por hora: o seguinte é recusado sem chamar nada; uma hora depois, volta`, async () => {
    const { deAna } = await doisProvisorios();
    const cliente = clienteFalso(recusaDaReceita, recusaDaReceita, recusaDaReceita, tokenRecebido(AGORA));
    for (let i = 0; i < LIMITE_DE_ENVIOS.porHora; i++) await assert.rejects(enviar(deAna, cliente, eCnpj(CPF_ANA)), ErroAutenticaProcurador);
    assert.equal(await contar(enviosTermo), LIMITE_DE_ENVIOS.porHora, "a tentativa que falhou na Receita também fica registrada");
    await assert.rejects(enviar(deAna, cliente, eCnpj(CPF_ANA)), (e: unknown) => e instanceof ErroTermoAutorizacao && e.motivo === "limite-de-envios");
    assert.equal(cliente.chamadas.length, LIMITE_DE_ENVIOS.porHora);
    // Uma hora depois (mesmo dia), passa.
    const depois = new Date(AGORA.getTime() + HORA + 60_000);
    if (depois.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) === AGORA.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })) {
      const r = await enviar(deAna, cliente, eCnpj(CPF_ANA), depois);
      assert.equal(r.acesso.papel, "DONO");
    }
  });

  it(`até ${LIMITE_DE_ENVIOS.porDia} por dia, somando os envios de todos os provisórios da empresa`, async () => {
    const { deAna, deBeto } = await doisProvisorios();
    const antes = (h: number) => new Date(AGORA.getTime() - h * HORA);
    await t.banco.insert(enviosTermo).values(Array.from({ length: LIMITE_DE_ENVIOS.porDia }, (_, i) => ({ empresaId: deAna.empresaId, usuarioId: i % 2 ? deAna.usuarioId : deBeto.usuarioId, enviadoEm: antes(2 + i) })));
    const cliente = clienteFalso();
    await assert.rejects(enviar(deAna, cliente, eCnpj(CPF_ANA)), (e: unknown) => e instanceof ErroTermoAutorizacao && /3 por hora e 10 por dia/.test(e.message));
    assert.equal(cliente.chamadas.length, 0);
    // Os de mais de 24 horas não contam.
    await t.banco.update(enviosTermo).set({ enviadoEm: antes(30) });
    const ok = clienteFalso(tokenRecebido(AGORA));
    assert.equal((await enviar(deAna, ok, eCnpj(CPF_ANA))).acesso.papel, "DONO");
  });
});
