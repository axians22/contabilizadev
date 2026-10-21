// Termo de autorização da empresa (Parte 4 do plano, "Autorização"): o cliente assina no navegador, com o
// e-CNPJ A1 da própria empresa, o termo do Autentica Procurador; aqui o servidor confere o termo, envia
// (AUTENTICAPROCURADOR / ENVIOXMLASSINADO81) e guarda o termo e o token só cifrados. Nada depende do Next: banco,
// chave, cliente do contrato e relógio entram por parâmetro (servidor.ts monta as do Next).
//
// Validade (documentação oficial do Autentica Procurador, páginas "Introdução" e "Cache"): o token vale até a
// meia-noite do dia seguinte (Brasília). O que dura é o termo, até a vigência (1 ano, limitada pela validade do
// certificado). Regra de consulta, banco primeiro: token guardado e válido é usado sem chamar nada; expirado, o termo
// guardado é reenviado para pegar outro (com 304 vem o mesmo token); termo vencido ou recusado, o cliente assina de
// novo. Sem margem antes da expiração: até a meia-noite a resposta seria 304 com o mesmo token, e reenviar antes só
// gastaria a cota do contrato (cada envio conta no limite do período).
//
// Empresa da própria plataforma (CNPJ = PLATAFORMA_CNPJ e um dono ADMIN): é o contratante, então é autora dos próprios
// pedidos e não precisa de termo nem de token (o termo existe para o contratante agir em nome de outro). Só o CNPJ não
// basta: qualquer um pode cadastrar um CNPJ válido, e a autorização sem termo daria a esse usuário os dados fiscais da
// plataforma. Sem dono ADMIN, a empresa com o PLATAFORMA_CNPJ fica no modo guiado e não assina nada ("reservada").
import { randomUUID } from "node:crypto";
import { eq, isNull } from "drizzle-orm";
import { isoDeCompacta } from "@contabilizadev/nucleo/formato";
import { enviarTermo, ErroAutenticaProcurador, type MotivoRecusa, type TokenProcurador } from "@contabilizadev/nucleo/serpro/autentica-procurador";
import { cnpj, type ClienteSerpro, type Contexto } from "@contabilizadev/nucleo/serpro/cliente";
import { conferirTermo, ErroTermo } from "@contabilizadev/nucleo/serpro/conferir-termo";
import { dataEmBrasilia, vigenciaPadrao, type PessoaJuridica } from "@contabilizadev/nucleo/serpro/termo-autorizacao";
import type { Banco } from "@/banco";
import { empresas, termosAutorizacao } from "@/banco/esquema";
import { dadosDaEmpresa, daEmpresa, SemAcessoEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { cifrar, decifrar, ErroDeCifra } from "./cifra";
import { MENSAGENS_DA_PLATAFORMA, type MotivoPlataforma } from "./mensagens";
import { donoEhAdmin } from "./plataforma";
import { situacaoDa, type Linha, type Situacao } from "./situacao";

export { ErroAutenticaProcurador, ErroTermo };

// Problema da instalação ou da empresa, antes de enviar (a mensagem já é a própria, para a tela).
export class ErroTermoAutorizacao extends Error {
  readonly motivo: MotivoPlataforma;
  constructor(motivo: MotivoPlataforma) {
    super(MENSAGENS_DA_PLATAFORMA[motivo]);
    this.motivo = motivo;
  }
}

export type DependenciasTermo = {
  banco: Banco;
  chave: Buffer | null; // TOKEN_CHAVE (null = ausente ou inválida: nada é guardado nem enviado)
  cliente: ClienteSerpro | null; // null = contrato não configurado (nada é enviado)
  // A plataforma: PLATAFORMA_CNPJ e a razão social (null = sem CNPJ; nome vazio = sem razão social, não dá para assinar).
  contratante: PessoaJuridica | null;
  // ADMIN_EMAILS: a empresa com o PLATAFORMA_CNPJ só é a da plataforma se um dono dela for ADMIN.
  adminEmails: readonly string[];
  agora?: () => Date;
};

// Recusas que valem para o termo guardado (renovar de novo daria o mesmo erro): ele fica marcado e o cliente assina
// outro. Indisponibilidade, configuração e respostas desconhecidas não marcam nada (tenta de novo depois).
const RECUSA_DEFINITIVA = new Set<MotivoRecusa>(["certificado-vencido", "certificado-revogado", "certificado", "vigencia", "termo"]);

const relogio = (deps: DependenciasTermo) => (deps.agora ?? (() => new Date()))();
const contexto = (linha: { id: string; empresaId: string }, campo: "termo" | "token") => `termo-autorizacao:${linha.empresaId}:${linha.id}:${campo}`;
// O termo exige o CNPJ só com dígitos (14 posições); o CNPJ alfanumérico ainda não cabe nele.
const cnpjNumerico = (v: string) => /^\d{14}$/.test(v);
const tokenValido = (linha: Linha, agora: Date) => Boolean(linha.tokenCifrado && linha.tokenExpiraEm && linha.tokenExpiraEm > agora);

function exigirConfig(deps: DependenciasTermo): { cliente: ClienteSerpro; chave: Buffer; contratante: PessoaJuridica } {
  if (!deps.contratante?.nome.trim()) throw new ErroTermoAutorizacao("sem-plataforma");
  if (!deps.chave) throw new ErroTermoAutorizacao("sem-chave");
  if (!deps.cliente) throw new ErroTermoAutorizacao("sem-contrato");
  return { cliente: deps.cliente, chave: deps.chave, contratante: deps.contratante };
}

async function empresaDo(banco: Banco, acesso: AcessoEmpresa) {
  dadosDaEmpresa(banco, acesso); // confere o acesso
  const [empresa] = await banco.select({ cnpj: empresas.cnpj, razaoSocial: empresas.razaoSocial }).from(empresas).where(eq(empresas.id, acesso.empresaId));
  if (!empresa) throw new SemAcessoEmpresa();
  return empresa;
}

// "propria": a empresa da plataforma (autorizada sem termo); "reservada": tem o PLATAFORMA_CNPJ mas nenhum dono ADMIN
// (nem termo nem autorização: só o modo guiado); "cliente": as demais, que assinam o termo.
async function tipoDaEmpresa(deps: DependenciasTermo, acesso: AcessoEmpresa, cnpjEmpresa: string): Promise<"propria" | "reservada" | "cliente"> {
  if (deps.contratante?.numero !== cnpjEmpresa) return "cliente";
  return (await donoEhAdmin(deps.banco, acesso.empresaId, deps.adminEmails)) ? "propria" : "reservada";
}

// Parâmetros e envio do termo: a empresa da plataforma não precisa, e a reservada não pode.
async function exigirCliente(deps: DependenciasTermo, acesso: AcessoEmpresa, cnpjEmpresa: string) {
  const tipo = await tipoDaEmpresa(deps, acesso, cnpjEmpresa);
  if (tipo === "propria") throw new ErroTermoAutorizacao("propria");
  if (tipo === "reservada") throw new ErroTermoAutorizacao("plataforma-reservada");
}

// O termo que vale: o não substituído, feito para o contratante atual (se o PLATAFORMA_CNPJ mudou, não vale mais).
const ativo = (acesso: AcessoEmpresa, contratante: string | null) =>
  daEmpresa(acesso, termosAutorizacao, isNull(termosAutorizacao.substituidoEm), contratante ? eq(termosAutorizacao.contratante, contratante) : undefined);

// Situação da autorização da empresa (painel, sino, página Autorização). Só banco: não chama nada.
export async function situacaoTermo(deps: DependenciasTermo, acesso: AcessoEmpresa): Promise<Situacao> {
  const empresa = await empresaDo(deps.banco, acesso);
  const tipo = await tipoDaEmpresa(deps, acesso, empresa.cnpj);
  if (tipo === "propria") return { estado: "propria" };
  if (tipo === "reservada") return { estado: "ausente" };
  const [linha] = await deps.banco.select().from(termosAutorizacao).where(ativo(acesso, deps.contratante?.numero ?? null));
  return situacaoDa(linha, relogio(deps));
}

export type ParametrosTermo = {
  contratante: PessoaJuridica;
  empresa: { cnpj: string; razaoSocial: string };
  dataAssinatura: string; // AAAAMMDD (hoje em Brasília)
  vigenciaMaxima: string; // AAAAMMDD (1 ano; o navegador limita à validade do certificado)
};

// O que o navegador precisa para montar o termo: o destinatário (a plataforma), a empresa e as datas (do servidor,
// em Brasília, para não depender do relógio do computador do cliente).
export async function parametrosDoTermo(deps: DependenciasTermo, acesso: AcessoEmpresa): Promise<ParametrosTermo> {
  const empresa = await empresaDo(deps.banco, acesso);
  const { contratante } = exigirConfig(deps);
  await exigirCliente(deps, acesso, empresa.cnpj);
  if (!cnpjNumerico(empresa.cnpj)) throw new ErroTermoAutorizacao("cnpj-alfanumerico");
  const hoje = dataEmBrasilia(relogio(deps));
  return { contratante, empresa, dataAssinatura: hoje, vigenciaMaxima: vigenciaPadrao(hoje) };
}

// O que a página Autorização e o passo 7 do cadastro precisam: a situação e, se a empresa pode assinar agora, os
// parâmetros do termo; senão, o motivo (configuração incompleta, CNPJ com letras, não é o dono). A empresa da própria
// plataforma não assina nada. Só banco: não chama nada.
export type PreparoAutorizacao = { situacao: Situacao; parametros: ParametrosTermo | null; bloqueio: string | null };

export async function prepararAutorizacao(deps: DependenciasTermo, acesso: AcessoEmpresa): Promise<PreparoAutorizacao> {
  const situacao = await situacaoTermo(deps, acesso);
  if (situacao.estado === "propria") return { situacao, parametros: null, bloqueio: null };
  if (acesso.papel !== "DONO") return { situacao, parametros: null, bloqueio: new ErroTermoAutorizacao("so-dono").message };
  try {
    return { situacao, parametros: await parametrosDoTermo(deps, acesso), bloqueio: null };
  } catch (erro) {
    if (!(erro instanceof ErroTermoAutorizacao)) throw erro;
    return { situacao, parametros: null, bloqueio: erro.message };
  }
}

function valoresDoToken(novo: TokenProcurador, linha: { id: string; empresaId: string }, chave: Buffer, agora: Date) {
  if (novo.expiraEm <= agora) throw new ErroAutenticaProcurador("desconhecido", `Token devolvido já expirado (${novo.expiraEm.toISOString()}).`, null);
  return { tokenCifrado: cifrar(novo.token, chave, contexto(linha, "token")), tokenExpiraEm: novo.expiraEm, tokenObtidoEm: agora, recusadoEm: null, recusaMotivo: null };
}

// Trava a linha da empresa até o fim da transação e confere que ela ainda existe. FOR NO KEY UPDATE, não FOR UPDATE: o
// registro da chamada ao Serpro (outra conexão, lib/serpro/registro.ts) confere a chave estrangeira de
// serpro_chamadas.empresa_id nesta linha, e com FOR UPDATE ficaria esperando esta transação. Uma remoção em andamento
// (lib/empresas/remocao.ts) trava a mesma linha: quem chega depois espera e, se a empresa foi apagada, não encontra
// a linha e para com "Empresa não encontrada.".
async function travarEmpresa(banco: Banco, acesso: AcessoEmpresa) {
  const [linha] = await banco.select({ id: empresas.id }).from(empresas).where(eq(empresas.id, acesso.empresaId)).for("no key update");
  if (!linha) throw new SemAcessoEmpresa();
}

export type ResultadoRegistro = { situacao: Situacao; enviado: boolean };

// Recebe o termo assinado no navegador (só o XML: certificado e senha nunca chegam aqui), confere e envia. Só o dono
// da empresa assina. A empresa fica travada (FOR NO KEY UPDATE) do início ao fim: dois envios juntos (duplo clique, duas
// abas) entram um depois do outro, e o segundo com o mesmo termo e o token ainda válido não chama de novo. Se o envio
// falhar, nada é guardado.
export async function registrarTermo(deps: DependenciasTermo, acesso: AcessoEmpresa, xml: string): Promise<ResultadoRegistro> {
  const empresa = await empresaDo(deps.banco, acesso);
  if (acesso.papel !== "DONO") throw new ErroTermoAutorizacao("so-dono");
  const { cliente, chave, contratante } = exigirConfig(deps);
  await exigirCliente(deps, acesso, empresa.cnpj);
  if (!cnpjNumerico(empresa.cnpj)) throw new ErroTermoAutorizacao("cnpj-alfanumerico");
  const agora = relogio(deps);
  const termo = conferirTermo(typeof xml === "string" ? xml : "", { contratante, contribuinte: empresa.cnpj }, agora);

  return deps.banco.transaction(async (tx) => {
    const banco = tx as unknown as Banco;
    // Se esperou a trava de uma remoção da empresa, ela já não existe: para aqui, antes do envio (pago) e da gravação.
    await travarEmpresa(banco, acesso);
    const porta = dadosDaEmpresa(banco, acesso);
    const [atual] = await banco.select().from(termosAutorizacao).where(ativo(acesso, contratante.numero));
    const mesmo = atual && atual.xmlHash === termo.hash ? atual : null;
    if (mesmo && !mesmo.recusadoEm && tokenValido(mesmo, agora)) return { situacao: situacaoDa(mesmo, agora), enviado: false };

    const finalidade = `Enviar o termo de autorização assinado pela empresa (vigência até ${isoDeCompacta(termo.vigencia)}) para obter o token de procurador`;
    const novo = await enviarTermo(cliente, xml, cnpj(empresa.cnpj), finalidade);
    if (mesmo) {
      const [linha] = await porta.alterar(termosAutorizacao, valoresDoToken(novo, mesmo, chave, agora), eq(termosAutorizacao.id, mesmo.id));
      return { situacao: situacaoDa(linha, agora), enviado: true };
    }
    const chaves = { id: randomUUID(), empresaId: acesso.empresaId };
    const token = valoresDoToken(novo, chaves, chave, agora);
    await porta.alterar(termosAutorizacao, { substituidoEm: agora }, isNull(termosAutorizacao.substituidoEm));
    const [linha] = await porta.inserir(termosAutorizacao, {
      id: chaves.id,
      contratante: contratante.numero,
      enviadoPorId: acesso.usuarioId,
      enviadoEm: agora,
      dataAssinatura: isoDeCompacta(termo.dataAssinatura),
      vigencia: isoDeCompacta(termo.vigencia),
      certificadoValidoAte: termo.certificado.validoAte,
      signatarioCnpj: termo.assinadoPor.numero,
      signatarioNome: termo.assinadoPor.nome,
      xmlHash: termo.hash,
      termoCifrado: cifrar(xml, chave, contexto(chaves, "termo")),
      ...token,
    });
    return { situacao: situacaoDa(linha, agora), enviado: true };
  });
}

// Contexto das chamadas em nome da empresa (para as Partes 5 em diante): contribuinte, autor do pedido (a própria
// empresa, que assinou o termo) e o token. Banco primeiro: token válido não chama nada; expirado, reenvia o termo
// guardado (com a linha travada, para duas requisições juntas não pedirem dois tokens). Sem termo, vencido ou
// recusado, ErroTermoAutorizacao pedindo para assinar. A empresa da própria plataforma (dono ADMIN) não precisa de termo.
export async function contextoSerpro(deps: DependenciasTermo, acesso: AcessoEmpresa): Promise<Contexto> {
  const empresa = await empresaDo(deps.banco, acesso);
  const contribuinte = cnpj(empresa.cnpj);
  const tipo = await tipoDaEmpresa(deps, acesso, empresa.cnpj);
  if (tipo === "propria") return { contribuinte };
  if (tipo === "reservada") throw new ErroTermoAutorizacao("plataforma-reservada");
  const { cliente, chave, contratante } = exigirConfig(deps);
  const agora = relogio(deps);
  const resultado = await deps.banco.transaction(async (tx): Promise<Contexto | { recusa: ErroAutenticaProcurador }> => {
    const banco = tx as unknown as Banco;
    // A empresa primeiro (a mesma ordem da remoção, sem impasse): removida enquanto esperava, não renova nada.
    await travarEmpresa(banco, acesso);
    const [linha] = await banco.select().from(termosAutorizacao).where(ativo(acesso, contratante.numero)).for("update");
    if (!linha) throw new ErroTermoAutorizacao("sem-termo");
    const situacao = situacaoDa(linha, agora);
    if (situacao.estado === "vencida") throw new ErroTermoAutorizacao("termo-vencido");
    if (situacao.estado === "recusada") throw new ErroTermoAutorizacao("termo-recusado");
    const base = { contribuinte, autorPedidoDados: contribuinte };
    try {
      if (tokenValido(linha, agora)) return { ...base, tokenProcurador: decifrar(linha.tokenCifrado!, chave, contexto(linha, "token")) };
      const termo = decifrar(linha.termoCifrado, chave, contexto(linha, "termo"));
      const finalidade = `Renovar o token de procurador com o termo de autorização guardado (vigência até ${linha.vigencia})`;
      let novo: TokenProcurador;
      try {
        novo = await enviarTermo(cliente, termo, contribuinte, finalidade);
      } catch (erro) {
        if (!(erro instanceof ErroAutenticaProcurador) || !RECUSA_DEFINITIVA.has(erro.motivo)) throw erro;
        // Marca o termo como recusado (a autorização deixa de valer e o sino avisa) e só então devolve o erro, fora da
        // transação, para a marca não ser desfeita.
        await dadosDaEmpresa(banco, acesso).alterar(
          termosAutorizacao,
          { recusadoEm: agora, recusaMotivo: erro.motivo, tokenCifrado: null, tokenExpiraEm: null },
          eq(termosAutorizacao.id, linha.id),
        );
        return { recusa: erro };
      }
      await dadosDaEmpresa(banco, acesso).alterar(termosAutorizacao, valoresDoToken(novo, linha, chave, agora), eq(termosAutorizacao.id, linha.id));
      return { ...base, tokenProcurador: novo.token };
    } catch (erro) {
      // A TOKEN_CHAVE mudou (ou o dado foi alterado): o termo guardado não abre; o cliente assina de novo.
      if (erro instanceof ErroDeCifra) throw new ErroTermoAutorizacao("chave-trocada");
      throw erro;
    }
  });
  if ("recusa" in resultado) throw resultado.recusa;
  return resultado;
}
