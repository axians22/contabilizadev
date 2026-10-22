// Apoio dos testes que precisam de uma empresa já comprovada (as partes depois do cadastro): "Seus dados" de um sócio do
// exemplo gravado da consulta de CNPJ, o cadastro (provisório) e a comprovação, que no site vem do termo assinado com o
// e-CNPJ (aqui chamada direto, sem termo). Os testes do próprio cadastro e do termo não usam isto.
import { EXEMPLOS, respostaGravada } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { CPF_RESPONSAVEL_DE_TESTE } from "@contabilizadev/nucleo/certificado-teste";
import { cpfValido } from "@contabilizadev/nucleo/formato";
import type { Banco } from "@/banco";
import { eq } from "drizzle-orm";
import { dadosPessoais, empresas } from "@/banco/esquema";
import { ehProvisorio, exigirAcessoAoTermo } from "@/lib/empresas/acesso";
import { cadastrarPelaPrevia, consultarParaCadastro } from "@/lib/empresas/cadastro";
import { comprovarPosse } from "@/lib/empresas/posse";
import { VERSAO_DOS_TERMOS } from "@/lib/usuarios/validacao";

// CPF válido com os dígitos visíveis do quadro de sócios ("***123456**" -> ???123456??) e um começo diferente por conta.
let sequencia = 100;
export function cpfComMeio(meio: string, comeco = String(sequencia++ % 1000).padStart(3, "0")): string {
  const base = `${comeco}${meio}`;
  const dv = (corpo: string) => {
    const soma = [...corpo].reduce((s, d, i) => s + Number(d) * (corpo.length + 1 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base);
  const cpf = `${base}${d1}${dv(`${base}${d1}`)}`;
  if (!cpfValido(cpf) || /^(\d)\1{10}$/.test(cpf)) return cpfComMeio(meio);
  return cpf;
}

// O primeiro sócio com CPF do exemplo gravado com este CNPJ (FULANA DE TAL EXEMPLO e "***123456**" se não achar).
function socioDoExemplo(cnpj: string): { nome: string; meio: string } {
  const numero = String(cnpj).replace(/[.\-/\s]/g, "").toUpperCase();
  for (const nome of EXEMPLOS) {
    const r = respostaGravada(nome) as { cnpj?: string; qsa?: { nome_socio: string; cnpj_cpf_do_socio: string }[] };
    if (r.cnpj !== numero) continue;
    const s = r.qsa?.find((q) => /^\*{3}\d{6}\*{2}$/.test(q.cnpj_cpf_do_socio));
    if (s) return { nome: s.nome_socio, meio: s.cnpj_cpf_do_socio.slice(3, 9) };
  }
  return { nome: "FULANA DE TAL EXEMPLO", meio: "123456" };
}

// Grava "Seus dados" (completos, com o aceite da versão atual) para o usuário bater com o quadro de sócios do CNPJ.
// Devolve o CPF. Chamado de novo para o mesmo usuário, troca o nome (o CPF fica). O primeiro usuário do teste fica com o
// CPF do responsável dos e-CNPJ de teste (CPF_RESPONSAVEL_DE_TESTE), para o termo assinado com eles conferir.
export async function dadosDeSocio(banco: Banco, usuario: { id: string }, cnpj = "12345678000195", opcoes: { cpf?: string; nome?: string } = {}): Promise<string> {
  const socio = { ...socioDoExemplo(cnpj), ...(opcoes.nome ? { nome: opcoes.nome } : {}) };
  let cpf = opcoes.cpf;
  if (!cpf && socio.meio === CPF_RESPONSAVEL_DE_TESTE.slice(3, 9)) {
    const [usado] = await banco.select({ u: dadosPessoais.usuarioId }).from(dadosPessoais).where(eq(dadosPessoais.cpf, CPF_RESPONSAVEL_DE_TESTE));
    if (!usado) cpf = CPF_RESPONSAVEL_DE_TESTE;
  }
  const agora = new Date();
  const valores = {
    nomeCompleto: socio.nome,
    dataNascimento: "1990-05-10",
    whatsapp: "+5548999990000",
    cep: "88010000",
    logradouro: "Rua de Teste",
    numero: "100",
    complemento: null,
    bairro: "Centro",
    cidade: "Florianópolis",
    uf: "SC",
    termosVersao: VERSAO_DOS_TERMOS,
    termosAceitosEm: agora,
  };
  const [linha] = await banco
    .insert(dadosPessoais)
    .values({ usuarioId: usuario.id, cpf: cpf ?? cpfComMeio(socio.meio), ...valores })
    .onConflictDoUpdate({ target: dadosPessoais.usuarioId, set: { nomeCompleto: socio.nome } })
    .returning({ cpf: dadosPessoais.cpf });
  return linha.cpf;
}

// Como se o termo tivesse sido aceito: o provisório vira DONO (os outros provisórios caem). Comprovada já, não muda nada.
export async function comprovar(banco: Banco, usuario: { id: string }, empresaId: string): Promise<string> {
  const acesso = await exigirAcessoAoTermo(banco, usuario, empresaId);
  if (ehProvisorio(acesso)) {
    const [empresa] = await banco.select({ cnpj: empresas.cnpj }).from(empresas).where(eq(empresas.id, empresaId));
    await banco.transaction(async (tx) => {
      await comprovarPosse(tx as unknown as Banco, acesso, empresa.cnpj, new Date());
    });
  }
  return empresaId;
}

// consultarParaCadastro com "Seus dados" de um sócio do exemplo já gravados (o cadastro exige).
export async function consultarComDados(...args: Parameters<typeof consultarParaCadastro>): ReturnType<typeof consultarParaCadastro> {
  await dadosDeSocio(args[0], args[1], args[2]);
  return consultarParaCadastro(...args);
}

// cadastrarPelaPrevia e a comprovação: a empresa sai pronta, com o usuário como DONO (como depois do termo aceito).
export async function cadastrarComprovada(...args: Parameters<typeof cadastrarPelaPrevia>): Promise<string> {
  const id = await cadastrarPelaPrevia(...args);
  return comprovar(args[0], args[1], id);
}
