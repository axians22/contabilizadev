// Cadastro da empresa pelo CNPJ, em dois passos:
// 1. consultarParaCadastro: confere o CNPJ, olha o banco primeiro (empresa já cadastrada não gasta consulta) e só
//    então consulta a BrasilAPI; devolve os dados e o diagnóstico para o cliente conferir, mais uma prévia assinada.
// 2. cadastrarPelaPrevia: o cliente confirma; a prévia assinada (HMAC com SESSAO_SEGREDO, presa ao usuário e com
//    prazo) garante que os dados gravados são os que vieram da BrasilAPI, sem consultar de novo e sem confiar no
//    navegador. Empresa que ainda não atendemos não é cadastrada (o diagnóstico é refeito aqui, com os dados assinados
//    e a data da consulta, sem confiar no navegador). Cria a empresa com o usuário como DONO e guarda a consulta pela
//    porta de acesso.
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { consultarCnpj, type Buscar, type DadosCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { diagnosticar, type Diagnostico } from "@contabilizadev/nucleo/diagnostico";
import type { Banco } from "@/banco";
import { empresas, type Papel } from "@/banco/esquema";
import { exigirAcessoEmpresa, SemAcessoEmpresa } from "./acesso";
import { VALIDADE_DA_PREVIA_MS } from "./assistente";
import { validarCnpj } from "./cnpj";
import { hojeNoBrasil, salvarConsulta } from "./receita";
import { criarEmpresa, ErroDeEmpresa } from "./servico";

export { VALIDADE_DA_PREVIA_MS };

// Prévia vencida, de outro usuário ou adulterada: a tela pesquisa o CNPJ de novo em vez de só mostrar o erro.
export class PreviaInvalida extends ErroDeEmpresa {}

export type Previa = { dados: DadosCnpj; diagnostico: Diagnostico; consultadaEm: string; token: string };
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

export async function consultarParaCadastro(banco: Banco, usuario: Quem, cnpjDigitado: string, opcoes: OpcoesCadastro): Promise<ResultadoConsulta> {
  const cnpj = validarCnpj(cnpjDigitado ?? "");
  if (!cnpj) throw new ErroDeEmpresa("CNPJ inválido: confira os números (os dígitos verificadores não batem).");

  // Banco primeiro: empresa já cadastrada não é consultada de novo. Quem tem vínculo só passa a usá-la; os outros
  // recebem a mesma resposta que criarEmpresa daria.
  const [existente] = await banco.select({ id: empresas.id }).from(empresas).where(eq(empresas.cnpj, cnpj));
  if (existente) {
    try {
      await exigirAcessoEmpresa(banco, usuario, existente.id);
      return { tipo: "ja-cadastrada", empresaId: existente.id };
    } catch (erro) {
      if (!(erro instanceof SemAcessoEmpresa)) throw erro;
    }
    throw new ErroDeEmpresa("Este CNPJ já está cadastrado. Peça acesso ao dono da empresa.");
  }
  conferirReserva(usuario, cnpj, opcoes.cnpjReservado);

  const agora = opcoes.agora ?? new Date();
  const dados = await consultarCnpj(cnpj, { buscar: opcoes.buscar });
  const consultadaEm = agora.toISOString();
  return {
    tipo: "previa",
    previa: {
      dados,
      diagnostico: diagnosticar(dados, hojeNoBrasil(agora)),
      consultadaEm,
      token: assinarPrevia({ usuarioId: usuario.id, consultadaEm, dados }, opcoes.segredo),
    },
  };
}

export const NAO_ATENDIDA = "Ainda não atendemos esta empresa, por isso ela não foi cadastrada. Veja os motivos e o que fazer.";

// Cria a empresa (DONO = quem confirmou) e guarda a consulta. Devolve o id da empresa nova.
export async function cadastrarPelaPrevia(
  banco: Banco,
  usuario: Quem,
  token: string,
  opcoes: { segredo: string; agora?: Date; cnpjReservado?: string | null },
): Promise<string> {
  const { dados, consultadaEm } = lerPrevia(token, usuario.id, opcoes.segredo, opcoes.agora ?? new Date());
  conferirReserva(usuario, dados.cnpj, opcoes.cnpjReservado);
  if (!diagnosticar(dados, hojeNoBrasil(new Date(consultadaEm))).atendido) throw new ErroDeEmpresa(NAO_ATENDIDA);
  const empresa = await criarEmpresa(banco, usuario, { cnpj: dados.cnpj, razaoSocial: dados.razaoSocial });
  const acesso = await exigirAcessoEmpresa(banco, usuario, empresa.id, { papel: "DONO" });
  await salvarConsulta(banco, acesso, dados, new Date(consultadaEm));
  return empresa.id;
}
