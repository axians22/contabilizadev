// Cadastro da empresa pelo CNPJ, em dois passos:
// 1. consultarParaCadastro: confere o CNPJ e "Seus dados" (nome e CPF), pega a consulta pública do CNPJ (banco
//    primeiro: consulta-publica.ts) e confere o usuário com o quadro de sócios (qsa.ts); devolve os dados e o
//    diagnóstico para o cliente conferir, mais uma prévia assinada.
// 2. cadastrarPelaPrevia: o cliente confirma; a prévia assinada (HMAC com SESSAO_SEGREDO, presa ao usuário e com
//    prazo) garante que os dados usados são os da consulta, sem consultar de novo e sem confiar no navegador. Empresa
//    que ainda não atendemos não é cadastrada, e o quadro de sócios é conferido de novo aqui. O usuário fica com o
//    cadastro PROVISÓRIO (aguardando comprovação) até assinar o termo com o e-CNPJ em nome do CPF dele
//    (lib/termo/termo.ts); o CNPJ não fica bloqueado para outro usuário que também bata com o quadro.
//    A empresa da plataforma (PLATAFORMA_CNPJ, só por um ADMIN) nasce comprovada, com o ADMIN como DONO.
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { type Buscar, type DadosCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { diagnosticar, type Diagnostico } from "@contabilizadev/nucleo/diagnostico";
import type { Banco } from "@/banco";
import { empresas, empresaUsuarios, type Papel } from "@/banco/esquema";
import { identidadeDo } from "@/lib/usuarios/dados-pessoais";
import { exigirAcessoAoTermo, exigirAcessoEmpresa, SemAcessoEmpresa } from "./acesso";
import { VALIDADE_DA_PREVIA_MS } from "./assistente";
import { validarCnpj } from "./cnpj";
import { consultaPublica } from "./consulta-publica";
import { conferirQsa, QSA_NAO_CONFERE, type ResultadoQsa } from "./qsa";
import { hojeNoBrasil, salvarConsulta } from "./receita";
import { COMPROVADA_POR_OUTRA, cadastrarProvisorio, criarEmpresa, ErroDeEmpresa } from "./servico";

export { VALIDADE_DA_PREVIA_MS };

// Prévia vencida, de outro usuário ou adulterada: a tela pesquisa o CNPJ de novo em vez de só mostrar o erro.
export class PreviaInvalida extends ErroDeEmpresa {}

// Erro com a explicação para o tooltip (a tela mostra a frase curta e o porquê no <Explicacao>).
export class ErroComExplicacao extends ErroDeEmpresa {
  constructor(
    mensagem: string,
    readonly explicacao: { titulo: string; texto: string },
  ) {
    super(mensagem);
  }
}

// O usuário não está no quadro de sócios: o cadastro é recusado.
export class NaoConfereComQsa extends ErroComExplicacao {
  constructor() {
    super(QSA_NAO_CONFERE.curto, { titulo: QSA_NAO_CONFERE.titulo, texto: QSA_NAO_CONFERE.texto });
  }
}

// Falta "Seus dados" (o ADMIN e o MANAGER entram sem preencher, mas para cadastrar uma empresa de cliente precisam deles).
export const FALTAM_DADOS = "Para cadastrar uma empresa, preencha antes Seus dados: conferimos você no quadro de sócios da empresa.";
export class FaltamDadosPessoais extends ErroComExplicacao {
  constructor() {
    super(FALTAM_DADOS, {
      titulo: "Por que preciso dos meus dados?",
      texto: "Só quem é sócio ou administrador da empresa pode cadastrá-la: conferimos o seu nome e o seu CPF com o quadro de sócios da Receita Federal, e depois com o e-CNPJ que assina o termo de autorização.",
    });
  }
}

// qsa: "confere" (o usuário está no quadro de sócios) ou "sem-qsa" (a Receita não publica o quadro: a comprovação fica
// só pelo termo); plataforma: a empresa da própria plataforma (nasce comprovada, sem conferir o quadro).
export type Previa = { dados: DadosCnpj; diagnostico: Diagnostico; consultadaEm: string; token: string; qsa: Exclude<ResultadoQsa, "nao-confere"> | "plataforma" };
export type ResultadoConsulta = { tipo: "previa"; previa: Previa } | { tipo: "ja-cadastrada"; empresaId: string };

type Conteudo = { usuarioId: string; consultadaEm: string; dados: DadosCnpj };

const assinar = (corpo: string, segredo: string) => createHmac("sha256", `cadastro-cnpj:${segredo}`).update(corpo).digest("base64url");

export function assinarPrevia(conteudo: Conteudo, segredo: string): string {
  const corpo = Buffer.from(JSON.stringify(conteudo)).toString("base64url");
  return `${corpo}.${assinar(corpo, segredo)}`;
}

// Confere assinatura, dono e prazo. Qualquer coisa errada é o mesmo erro: "consulte de novo".
export function lerPrevia(token: string, usuarioId: string, segredo: string, agora: Date): Conteudo {
  const refazer = new PreviaInvalida("A consulta expirou ou não confere. Consulte o CNPJ de novo.");
  const ponto = typeof token === "string" ? token.lastIndexOf(".") : -1;
  if (ponto <= 0) throw refazer;
  const corpo = token.slice(0, ponto);
  const recebida = Buffer.from(token.slice(ponto + 1));
  const esperada = Buffer.from(assinar(corpo, segredo));
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) throw refazer;
  let conteudo: Conteudo;
  try {
    conteudo = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8"));
  } catch {
    throw refazer;
  }
  const idade = agora.getTime() - Date.parse(conteudo.consultadaEm);
  if (conteudo.usuarioId !== usuarioId || !(idade >= 0 && idade <= VALIDADE_DA_PREVIA_MS)) throw refazer;
  return conteudo;
}

// cnpjReservado: o PLATAFORMA_CNPJ. Só um ADMIN cadastra a empresa da plataforma: como ela fica autorizada sem termo,
// quem a cadastrasse primeiro levaria os dados fiscais da plataforma e ainda impediria o administrador de cadastrá-la
// (o CNPJ é único). A própria lib/termo confere de novo (dono ADMIN), para cadastros feitos antes desta regra.
export type OpcoesCadastro = { segredo: string; agora?: Date; buscar?: Buscar; cnpjReservado?: string | null };
type Quem = { id: string; papel?: Papel };

export const CNPJ_RESERVADO = "Este CNPJ não pode ser cadastrado por esta conta. Se a empresa é sua, fale com o suporte.";
function conferirReserva(usuario: Quem, cnpj: string, cnpjReservado: string | null | undefined) {
  if (cnpjReservado && cnpj === cnpjReservado && usuario.papel !== "ADMIN") throw new ErroDeEmpresa(CNPJ_RESERVADO);
}

const ehDaPlataforma = (usuario: Quem, cnpj: string, cnpjReservado: string | null | undefined) => Boolean(cnpjReservado && cnpj === cnpjReservado && usuario.papel === "ADMIN");

// Uma consulta guardada há mais que isto, que não bate com o quadro de sócios, é refeita antes de recusar (o sócio pode
// ter entrado depois dela).
const REFAZER_SE_NAO_BATER_MS = 24 * 60 * 60 * 1000;

// O usuário bate com o quadro de sócios? A prévia só sai para "confere" ou "sem-qsa"; "nao-confere" recusa com o motivo.
async function conferirUsuarioNoQsa(banco: Banco, usuario: Quem, cnpj: string, opcoes: { agora: Date; buscar?: Buscar }) {
  const identidade = await identidadeDo(banco, usuario.id);
  if (!identidade) throw new FaltamDadosPessoais();
  let consulta = await consultaPublica(banco, cnpj, opcoes);
  let qsa = conferirQsa(consulta.dados.socios, identidade);
  if (qsa === "nao-confere" && consulta.fonte === "banco" && opcoes.agora.getTime() - consulta.consultadaEm.getTime() > REFAZER_SE_NAO_BATER_MS) {
    consulta = await consultaPublica(banco, cnpj, { ...opcoes, maisNovaQue: opcoes.agora });
    qsa = conferirQsa(consulta.dados.socios, identidade);
  }
  if (qsa === "nao-confere") throw new NaoConfereComQsa();
  return { dados: consulta.dados, qsa };
}

export async function consultarParaCadastro(banco: Banco, usuario: Quem, cnpjDigitado: string, opcoes: OpcoesCadastro): Promise<ResultadoConsulta> {
  const cnpj = validarCnpj(cnpjDigitado ?? "");
  if (!cnpj) throw new ErroDeEmpresa("CNPJ inválido: confira os números (os dígitos verificadores não batem).");
  conferirReserva(usuario, cnpj, opcoes.cnpjReservado);

  // Banco primeiro: empresa em que o usuário já tem vínculo (comprovado ou provisório) não é consultada de novo, só passa
  // a ser a ativa. Empresa já comprovada por outra conta é recusada (sem dizer qual). Empresa só com provisórios de
  // outros segue como se fosse nova: a resposta não revela que alguém já começou o cadastro.
  const [existente] = await banco.select({ id: empresas.id }).from(empresas).where(eq(empresas.cnpj, cnpj));
  if (existente) {
    try {
      await exigirAcessoAoTermo(banco, usuario, existente.id);
      return { tipo: "ja-cadastrada", empresaId: existente.id };
    } catch (erro) {
      if (!(erro instanceof SemAcessoEmpresa)) throw erro;
    }
    const [comprovado] = await banco
      .select({ papel: empresaUsuarios.papel })
      .from(empresaUsuarios)
      .where(and(eq(empresaUsuarios.empresaId, existente.id), ne(empresaUsuarios.papel, "PROVISORIO")))
      .limit(1);
    if (comprovado) throw new ErroDeEmpresa(COMPROVADA_POR_OUTRA);
  }

  const agora = opcoes.agora ?? new Date();
  const { dados, qsa } = ehDaPlataforma(usuario, cnpj, opcoes.cnpjReservado)
    ? { dados: (await consultaPublica(banco, cnpj, { agora, buscar: opcoes.buscar })).dados, qsa: "plataforma" as const }
    : await conferirUsuarioNoQsa(banco, usuario, cnpj, { agora, buscar: opcoes.buscar });
  const consultadaEm = agora.toISOString();
  return {
    tipo: "previa",
    previa: {
      dados,
      diagnostico: diagnosticar(dados, hojeNoBrasil(agora)),
      consultadaEm,
      token: assinarPrevia({ usuarioId: usuario.id, consultadaEm, dados }, opcoes.segredo),
      qsa,
    },
  };
}

export const NAO_ATENDIDA = "Ainda não atendemos esta empresa, por isso ela não foi cadastrada. Veja os motivos e o que fazer.";

// Cadastra pela prévia e devolve o id da empresa: o provisório (aguardando comprovação) do usuário ou, para a empresa da
// plataforma, a empresa já comprovada com ele como DONO (com a consulta guardada pela porta de acesso).
export async function cadastrarPelaPrevia(
  banco: Banco,
  usuario: Quem,
  token: string,
  opcoes: { segredo: string; agora?: Date; cnpjReservado?: string | null },
): Promise<string> {
  const { dados, consultadaEm } = lerPrevia(token, usuario.id, opcoes.segredo, opcoes.agora ?? new Date());
  conferirReserva(usuario, dados.cnpj, opcoes.cnpjReservado);
  if (!diagnosticar(dados, hojeNoBrasil(new Date(consultadaEm))).atendido) throw new ErroDeEmpresa(NAO_ATENDIDA);
  if (ehDaPlataforma(usuario, dados.cnpj, opcoes.cnpjReservado)) {
    const empresa = await criarEmpresa(banco, usuario, { cnpj: dados.cnpj, razaoSocial: dados.razaoSocial });
    const acesso = await exigirAcessoEmpresa(banco, usuario, empresa.id, { papel: "DONO" });
    await salvarConsulta(banco, acesso, dados, new Date(consultadaEm));
    return empresa.id;
  }
  // O quadro de sócios é conferido de novo com os dados assinados e o "Seus dados" de agora.
  const identidade = await identidadeDo(banco, usuario.id);
  if (!identidade) throw new FaltamDadosPessoais();
  if (conferirQsa(dados.socios, identidade) === "nao-confere") throw new NaoConfereComQsa();
  return (await cadastrarProvisorio(banco, usuario, { cnpj: dados.cnpj, razaoSocial: dados.razaoSocial })).id;
}
