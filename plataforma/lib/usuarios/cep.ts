// Busca do endereço pelo CEP para "Seus dados". Regra das consultas externas: banco primeiro (tabela ceps, dado público
// igual para todos); a consulta externa só para CEP que ainda não está guardado, e o resultado é guardado. CEP que a
// consulta não achou também fica guardado e só é perguntado de novo depois de NAO_ACHADO_DE_NOVO_DIAS (CEP novo pode
// aparecer depois). Falha da consulta não guarda nada: a tela pede o endereço à mão.
import { eq } from "drizzle-orm";
import { consultarCep, ErroConsultaCep, normalizarCep, type EnderecoDoCep } from "@contabilizadev/nucleo/brasilapi/cep";
import type { Buscar } from "@contabilizadev/nucleo/brasilapi/cnpj";
import type { Banco } from "@/banco";
import { ceps } from "@/banco/esquema";

export const NAO_ACHADO_DE_NOVO_DIAS = 30;
const DIA_MS = 24 * 60 * 60 * 1000;

export type ResultadoCep = { tipo: "achado"; endereco: EnderecoDoCep; fonte: "banco" | "consulta" } | { tipo: "nao-achado" | "invalido" | "indisponivel"; mensagem: string };

const NAO_ACHADO = "Não achamos este CEP. Confira o número ou preencha o endereço à mão.";

export async function buscarCep(banco: Banco, cepDigitado: string, opcoes: { agora?: Date; buscar?: Buscar } = {}): Promise<ResultadoCep> {
  const cep = normalizarCep(cepDigitado);
  if (!cep) return { tipo: "invalido", mensagem: "CEP inválido: são 8 números." };
  const agora = opcoes.agora ?? new Date();
  const [guardado] = await banco.select().from(ceps).where(eq(ceps.cep, cep));
  if (guardado?.encontrado && guardado.cidade && guardado.uf) {
    return { tipo: "achado", fonte: "banco", endereco: { cep, logradouro: guardado.logradouro, bairro: guardado.bairro, cidade: guardado.cidade, uf: guardado.uf } };
  }
  if (guardado && !guardado.encontrado && agora.getTime() - guardado.consultadoEm.getTime() < NAO_ACHADO_DE_NOVO_DIAS * DIA_MS) return { tipo: "nao-achado", mensagem: NAO_ACHADO };

  let endereco: EnderecoDoCep;
  try {
    endereco = await consultarCep(cep, { buscar: opcoes.buscar });
  } catch (erro) {
    if (!(erro instanceof ErroConsultaCep)) throw erro;
    if (erro.motivo === "nao-encontrado") {
      const linha = { cep, encontrado: false, logradouro: null, bairro: null, cidade: null, uf: null, consultadoEm: agora };
      await banco.insert(ceps).values(linha).onConflictDoUpdate({ target: ceps.cep, set: linha });
      return { tipo: "nao-achado", mensagem: NAO_ACHADO };
    }
    return { tipo: erro.motivo === "cep-invalido" ? "invalido" : "indisponivel", mensagem: erro.message };
  }
  const linha = { cep, encontrado: true, logradouro: endereco.logradouro, bairro: endereco.bairro, cidade: endereco.cidade, uf: endereco.uf, consultadoEm: agora };
  await banco.insert(ceps).values(linha).onConflictDoUpdate({ target: ceps.cep, set: linha });
  return { tipo: "achado", fonte: "consulta", endereco: { ...endereco, cep } };
}
