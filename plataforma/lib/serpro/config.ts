// Configuração da plataforma para falar com a Receita Federal por trás (contrato do Serpro, Integra Contador):
// - PLATAFORMA_CNPJ: o CNPJ da plataforma, contratante do Serpro e destinatário do termo de autorização que cada cliente
//   assina (lib/termo/). A tela "Autorização" precisa dele.
// - o certificado da plataforma (o e-CNPJ A1 do PLATAFORMA_CNPJ, usado no TLS mútuo com o Serpro e para transmitir ao
//   eSocial) e as chaves do contrato (consumer key e secret): primeiro o que um ADMIN guardou, cifrado, na tela interna
//   /admin/plataforma (lib/plataforma/segredos.ts); sem isso no banco, como alternativa, as variáveis CERT_PFX_PATH e
//   CERT_PFX_SENHA (o .pfx num arquivo) e SERPRO_CONSUMER_KEY e SERPRO_CONSUMER_SECRET. SERPRO_LIMITE_POR_PERIODO é
//   opcional. Sem certificado ou sem chaves a integração fica desligada: nada é chamado e as telas dizem que a assinatura
//   ainda não está disponível (sem citar o Serpro, que o cliente não vê).
// Todos os usos do certificado da plataforma (Serpro, eSocial, a assinatura da própria empresa da plataforma) passam por
// resolverCertificadoDaPlataforma.
// Os motivos abaixo são técnicos: vão para o log do servidor e para o administrador, nunca para o cliente.
import { readFileSync } from "node:fs";
import path from "node:path";
import { cnpjValido } from "@contabilizadev/nucleo/formato";
import { lerPfx, type Pem } from "@contabilizadev/nucleo/certificado";
import { lerCertificado as lerInfoDoCertificado } from "@contabilizadev/nucleo/serpro/termo-autorizacao";
import type { Certificado, CertificadoPem, CertificadoTls } from "@contabilizadev/nucleo/http";
import { NADA_GUARDADO, type Guardado } from "@/lib/plataforma/segredos";

export const LIMITE_PADRAO_POR_PERIODO = 40;

type Ambiente = Record<string, string | undefined>;

export type CnpjPlataforma = { cnpj: string } | { cnpj: null; motivo: string };

// CNPJ com ou sem pontuação (numérico ou alfanumérico), guardado só com letras maiúsculas e dígitos.
export function lerCnpjPlataforma(env: Ambiente = process.env): CnpjPlataforma {
  const bruto = env.PLATAFORMA_CNPJ?.trim();
  if (!bruto) return { cnpj: null, motivo: "Falta PLATAFORMA_CNPJ no plataforma/.env.local (o CNPJ contratante, destinatário do termo de autorização; veja o README)." };
  const cnpj = bruto.replace(/[.\-/\s]/g, "").toUpperCase();
  if (!cnpjValido(cnpj)) return { cnpj: null, motivo: `PLATAFORMA_CNPJ inválido (${bruto}): confira os dígitos.` };
  return { cnpj };
}

// Razão social da plataforma: o nome do destinatário no termo de autorização. Vem do ambiente (PLATAFORMA_RAZAO_SOCIAL);
// sem ela, usa a razão social guardada da empresa com o PLATAFORMA_CNPJ, se a plataforma estiver cadastrada
// (lib/termo/plataforma.ts). Nunca fixa no código.
export function lerRazaoPlataforma(env: Ambiente = process.env): string | null {
  const razao = env.PLATAFORMA_RAZAO_SOCIAL?.replace(/\s+/g, " ").trim();
  return razao ? razao.toUpperCase() : null;
}

// Titular e validade de um certificado (o do titular, em base64 DER) pelo mesmo critério do envio pela tela e do guardado:
// o CNPJ sai das extensões da ICP-Brasil (ou do CN "NOME:NÚMERO", como a ICP-Brasil também usa) e só um titular PJ tem
// CNPJ; um e-CPF fica com cnpj null e é recusado como certificado da plataforma.
function titularDoCertificado(certificadoBase64: string): { cnpj: string | null; validoAte: Date } {
  const info = lerInfoDoCertificado(certificadoBase64);
  return { cnpj: info.titular.tipo === "PJ" ? info.titular.numero : null, validoAte: info.validoAte };
}

// O certificado da plataforma vindo do ambiente (o .pfx aberto só em memória, pelo openssl).
export function lerCertificado(certificado: Certificado): { cnpj: string | null; validoAte: Date } {
  return titularDoCertificado(lerPfx(certificado).certificadoBase64);
}

// Recusa o certificado que não é o e-CNPJ do PLATAFORMA_CNPJ (inclusive o sem CNPJ, como um e-CPF): o Serpro recusa
// contratante diferente do CNPJ do certificado (ICGERENCIADOR-016) e o eSocial, transmissor diferente.
function motivoDeOutroTitular(cnpj: string | null, cnpjPlataforma: string, origem: string, acao: string): string {
  return cnpj === null
    ? `O certificado da plataforma ${origem} não é um e-CNPJ (sem CNPJ do titular; um e-CPF, por exemplo), mas tem de ser o do PLATAFORMA_CNPJ ${cnpjPlataforma}: ${acao}`
    : `O certificado da plataforma ${origem} é do CNPJ ${cnpj}, mas PLATAFORMA_CNPJ é ${cnpjPlataforma}: precisam ser o mesmo (o contratante do Serpro e o transmissor do eSocial); ${acao}`;
}

// Onde o ADMIN informa o certificado e as chaves (vai nos motivos técnicos, para o log e para a tela do ADMIN).
export const TELA_DA_PLATAFORMA = "/admin/plataforma";

type Abrir = (c: Certificado) => { cnpj: string | null; validoAte: Date };

export type CertificadoDaPlataforma =
  | {
      pronto: true;
      origem: "banco" | "ambiente";
      tls: CertificadoTls; // para a conexão (Serpro e eSocial)
      validoAte: Date;
      pem: () => Pem; // chave e certificado do titular, para assinar como a própria plataforma
    }
  | { pronto: false; motivo: string; falha: FalhaDoCertificado };

// Por que o certificado não está em uso, para o sino do ADMIN dizer a coisa certa (o motivo em texto vai para o log e a
// tela do ADMIN): venceu (com a data), é de outro CNPJ, não abre (arquivo do ambiente com senha errada ou corrompido, ou
// falta/está errado o PLATAFORMA_CNPJ), o guardado não abre com a PLATAFORMA_CHAVE atual, ou não há nenhum.
export type FalhaDoCertificado =
  | { tipo: "vencido"; validoAte: Date }
  | { tipo: "outro-cnpj" }
  | { tipo: "invalido" }
  | { tipo: "ilegivel" }
  | { tipo: "falta" };

const dataBr = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

// O certificado do titular (o primeiro do PEM guardado; os seguintes são da cadeia).
function pemDoGuardado(p: CertificadoPem): Pem {
  const certificado = p.certificado.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0] ?? "";
  return { chave: p.chave, certificado, certificadoBase64: certificado.replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g, "") };
}

// O certificado da plataforma: o guardado no banco (legível) primeiro; senão, o do ambiente (CERT_PFX_PATH e CERT_PFX_SENHA).
// Confere a validade e o CNPJ (o Serpro recusa contratante diferente do CNPJ do certificado, ICGERENCIADOR-016; o eSocial
// recusa transmissor diferente do certificado da conexão).
// A validade e o CNPJ do guardado saem do próprio certificado decifrado (autenticado pelo GCM), nunca da coluna info, que
// fica em claro no banco e serve só para a tela.
export function resolverCertificadoDaPlataforma(
  cnpjPlataforma: string,
  env: Ambiente = process.env,
  guardado: Guardado = NADA_GUARDADO,
  ler: (arquivo: string) => Buffer = readFileSync,
  agora = new Date(),
  abrir: Abrir = lerCertificado,
): CertificadoDaPlataforma {
  const g = guardado.certificado;
  if (g?.legivel) {
    const pem = pemDoGuardado(g.pem);
    let titular: { cnpj: string | null; validoAte: Date };
    try {
      titular = titularDoCertificado(pem.certificadoBase64);
    } catch {
      return { pronto: false, motivo: `O certificado da plataforma guardado não pôde ser lido: envie o e-CNPJ A1 de novo em ${TELA_DA_PLATAFORMA}.`, falha: { tipo: "invalido" } };
    }
    if (titular.validoAte <= agora) {
      return { pronto: false, motivo: `O certificado da plataforma guardado venceu em ${dataBr(titular.validoAte)}: envie o novo e-CNPJ A1 em ${TELA_DA_PLATAFORMA}.`, falha: { tipo: "vencido", validoAte: titular.validoAte } };
    }
    if (titular.cnpj !== cnpjPlataforma) {
      return { pronto: false, motivo: motivoDeOutroTitular(titular.cnpj, cnpjPlataforma, "guardado", `envie o e-CNPJ do PLATAFORMA_CNPJ em ${TELA_DA_PLATAFORMA}.`), falha: { tipo: "outro-cnpj" } };
    }
    return { pronto: true, origem: "banco", tls: g.pem, validoAte: titular.validoAte, pem: () => pem };
  }
  const doAmbiente = certificadoDoAmbiente(cnpjPlataforma, env, ler, agora, abrir);
  // Guardado ilegível e o ambiente também não serve: o que resolve é enviar de novo pela tela.
  if (!doAmbiente.pronto && g) {
    const ilegivel = `O certificado da plataforma guardado não abre com a PLATAFORMA_CHAVE atual (a chave foi trocada ou falta): envie o e-CNPJ A1 de novo em ${TELA_DA_PLATAFORMA}.`;
    return { pronto: false, motivo: doAmbiente.falha.tipo === "falta" ? ilegivel : `${ilegivel} Alternativa do ambiente: ${doAmbiente.motivo}`, falha: { tipo: "ilegivel" } };
  }
  return doAmbiente;
}

// A alternativa: o .pfx do ambiente (CERT_PFX_PATH e CERT_PFX_SENHA), aberto só em memória.
function certificadoDoAmbiente(cnpjPlataforma: string, env: Ambiente, ler: (arquivo: string) => Buffer, agora: Date, abrir: Abrir): CertificadoDaPlataforma {
  const faltando = ["CERT_PFX_PATH", "CERT_PFX_SENHA"].filter((v) => !env[v]?.trim());
  if (faltando.length) {
    return {
      pronto: false,
      motivo: `Falta o certificado da plataforma: envie o e-CNPJ A1 em ${TELA_DA_PLATAFORMA} (ou, como alternativa, falta ${faltando.join(", ")} no plataforma/.env.local; veja o README).`,
      falha: { tipo: "falta" },
    };
  }
  const arquivo = path.resolve(env.CERT_PFX_PATH!.trim());
  let pfx: Buffer;
  try {
    pfx = ler(arquivo);
  } catch {
    // Arquivo fora do ar (o drive desmontado): para o sino, é o mesmo que não ter certificado.
    return {
      pronto: false,
      motivo: `Não foi possível ler o certificado da plataforma em CERT_PFX_PATH (${arquivo}); envie o e-CNPJ A1 em ${TELA_DA_PLATAFORMA} para não depender do arquivo.`,
      falha: { tipo: "falta" },
    };
  }
  const certificado = { pfx, senha: env.CERT_PFX_SENHA! };
  let titular: { cnpj: string | null; validoAte: Date };
  try {
    titular = abrir(certificado);
  } catch (erro) {
    return { pronto: false, motivo: `Certificado da plataforma (CERT_PFX_PATH): ${(erro as Error).message}`, falha: { tipo: "invalido" } };
  }
  if (titular.validoAte <= agora) {
    return { pronto: false, motivo: `O certificado da plataforma (CERT_PFX_PATH) está vencido (venceu em ${dataBr(titular.validoAte)}): envie o novo e-CNPJ A1 em ${TELA_DA_PLATAFORMA}.`, falha: { tipo: "vencido", validoAte: titular.validoAte } };
  }
  // CNPJ nulo (um e-CPF) também é recusado: o mesmo critério do guardado e do envio pela tela.
  if (titular.cnpj !== cnpjPlataforma) {
    return { pronto: false, motivo: motivoDeOutroTitular(titular.cnpj, cnpjPlataforma, "(CERT_PFX_PATH)", `envie o e-CNPJ do PLATAFORMA_CNPJ em ${TELA_DA_PLATAFORMA}.`), falha: { tipo: "outro-cnpj" } };
  }
  let pem: Pem | undefined;
  return { pronto: true, origem: "ambiente", tls: certificado, validoAte: titular.validoAte, pem: () => (pem ??= lerPfx(certificado)) };
}

export type ChavesDoContrato = { pronto: true; origem: "banco" | "ambiente"; consumerKey: string; consumerSecret: string } | { pronto: false; motivo: string };

// As chaves do contrato: as guardadas no banco primeiro; senão, SERPRO_CONSUMER_KEY e SERPRO_CONSUMER_SECRET.
export function resolverChavesDoContrato(env: Ambiente = process.env, guardado: Guardado = NADA_GUARDADO): ChavesDoContrato {
  const g = guardado.chaves;
  if (g?.legivel) return { pronto: true, origem: "banco", consumerKey: g.consumerKey, consumerSecret: g.consumerSecret };
  const faltando = ["SERPRO_CONSUMER_KEY", "SERPRO_CONSUMER_SECRET"].filter((v) => !env[v]?.trim());
  if (!faltando.length) return { pronto: true, origem: "ambiente", consumerKey: env.SERPRO_CONSUMER_KEY!.trim(), consumerSecret: env.SERPRO_CONSUMER_SECRET!.trim() };
  if (g) return { pronto: false, motivo: `As chaves do contrato guardadas não abrem com a PLATAFORMA_CHAVE atual (a chave foi trocada ou falta): informe de novo em ${TELA_DA_PLATAFORMA}.` };
  return { pronto: false, motivo: `Faltam as chaves do contrato: informe em ${TELA_DA_PLATAFORMA} (ou, como alternativa, falta ${faltando.join(", ")} no plataforma/.env.local; veja o README).` };
}

export type ConfigSerproPronta = {
  pronto: true;
  consumerKey: string;
  consumerSecret: string;
  certificado: CertificadoTls;
  pem: () => Pem;
  contratante: string; // = PLATAFORMA_CNPJ
  limitePorPeriodo: number;
};
export type ConfigSerpro = ConfigSerproPronta | { pronto: false; motivo: string };

// Monta a configuração do contrato a partir do certificado já resolvido (resolverCertificadoDaPlataforma, uma vez por
// montagem em lib/plataforma/montagem.ts): aqui não se lê nem abre o certificado de novo.
export function lerConfigSerpro(plataforma: CnpjPlataforma, certificado: CertificadoDaPlataforma, guardado: Guardado = NADA_GUARDADO, env: Ambiente = process.env): ConfigSerpro {
  if (plataforma.cnpj === null) return { pronto: false, motivo: plataforma.motivo };
  const limite = env.SERPRO_LIMITE_POR_PERIODO?.trim() ? Number(env.SERPRO_LIMITE_POR_PERIODO) : LIMITE_PADRAO_POR_PERIODO;
  if (!Number.isInteger(limite) || limite < 1) return { pronto: false, motivo: "SERPRO_LIMITE_POR_PERIODO precisa ser um número inteiro positivo." };
  const chaves = resolverChavesDoContrato(env, guardado);
  const motivos = [chaves, certificado].flatMap((r) => (r.pronto ? [] : [r.motivo]));
  if (!chaves.pronto || !certificado.pronto) return { pronto: false, motivo: `Integração com o Serpro não configurada. ${motivos.join(" ")}` };
  return {
    pronto: true,
    consumerKey: chaves.consumerKey,
    consumerSecret: chaves.consumerSecret,
    certificado: certificado.tls,
    pem: certificado.pem,
    contratante: plataforma.cnpj,
    limitePorPeriodo: limite,
  };
}
