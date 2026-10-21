// Segredos da própria plataforma, informados por um ADMIN na área do administrador, /admin/plataforma (nunca pelo cliente):
// - o certificado da plataforma: o e-CNPJ A1 do PLATAFORMA_CNPJ, usado no TLS mútuo com o Serpro e para transmitir ao
//   eSocial. Diferente do certificado do cliente (que nunca sai do navegador dele), este precisa ficar no servidor sempre.
// - as chaves do contrato (consumer key e secret).
//
// Guardados na tabela plataforma_segredos, só cifrados com a PLATAFORMA_CHAVE (AES-256-GCM, IV por registro, o nome do
// segredo como dado autenticado; lib/termo/cifra.ts). O certificado é guardado JÁ ABERTO (chave PKCS#8 e certificado com
// a cadeia, em PEM) e a senha é descartada: com a senha cifrada ao lado do .pfx, quem tivesse o banco e a chave mestra
// teria o mesmo que tem aqui (a chave privada), e ainda a senha, que costuma abrir outras cópias do mesmo .pfx (o backup
// num drive, o do contador). Assim a senha nunca fica em lugar nenhum, e no uso não há abrir PKCS#12 (algoritmos
// antigos, openssl com a senha no ambiente do processo filho).
// A coluna info (titular, CNPJ, validade) fica em claro e não é autenticada: serve só para a tela, inclusive quando o
// guardado está ilegível. O que libera o uso (validade e CNPJ) sai do certificado decifrado
// (resolverCertificadoDaPlataforma), então alterar info no banco não muda nada além do que a tela mostra.
//
// Nada daqui devolve o .pfx, a chave privada ou o secret para a tela: o que a tela recebe é o resumo (resumir()). Quem
// troca e quando vai para o log do servidor (sem o conteúdo) e para a própria linha (atualizado_em e atualizado_por_id).
// Trocar a PLATAFORMA_CHAVE deixa o guardado ilegível: a tela mostra isso e pede para enviar de novo.
import { createPrivateKey, X509Certificate } from "node:crypto";
import { eq } from "drizzle-orm";
import { formatarCnpj } from "@contabilizadev/nucleo/formato";
import type { CertificadoPem } from "@contabilizadev/nucleo/http";
import { conferirAntesDeAssinar, converterParaPem, ErroCertificado, type InfoCertificado } from "@contabilizadev/nucleo/serpro/termo-autorizacao";
import type { Banco } from "@/banco";
import { plataformaSegredos, usuarios, type InfoDasChavesGuardadas, type InfoDoCertificadoGuardado, type Papel } from "@/banco/esquema";
import type { CnpjPlataforma } from "@/lib/serpro/config";
import { TAMANHO_MAXIMO_PFX } from "@/lib/arquivo";
import { cifrar, decifrar } from "@/lib/termo/cifra";

export type Ator = { id: string; email: string; papel: Papel };

// Erro com o status HTTP equivalente (400 pedido inválido, 403 sem permissão). A mensagem vai para a tela do ADMIN.
export class ErroDaPlataforma extends Error {
  constructor(
    mensagem: string,
    readonly status: 400 | 403,
  ) {
    super(mensagem);
  }
}

// Um .pfx de e-CNPJ com a cadeia tem poucos KB; mais que isto não é um certificado (o mesmo limite do campo da tela).
export { TAMANHO_MAXIMO_PFX };
const TAMANHO_MAXIMO_CHAVE = 256;

const contexto = (nome: "certificado" | "chaves") => `plataforma:${nome}`;

type Quem = { atualizadoEm: Date; atualizadoPor: string | null };
export type CertificadoGuardado = Quem & { info: InfoDoCertificadoGuardado } & ({ legivel: true; pem: CertificadoPem } | { legivel: false });
export type ChavesGuardadas = Quem & { info: InfoDasChavesGuardadas } & ({ legivel: true; consumerKey: string; consumerSecret: string } | { legivel: false });
export type Guardado = { certificado: CertificadoGuardado | null; chaves: ChavesGuardadas | null };
export const NADA_GUARDADO: Guardado = { certificado: null, chaves: null };

// Versão do que está guardado (muda a cada troca): quem monta os clientes a partir daqui só refaz quando ela muda.
export async function versaoDoGuardado(banco: Banco): Promise<string> {
  const linhas = await banco.select({ nome: plataformaSegredos.nome, em: plataformaSegredos.atualizadoEm }).from(plataformaSegredos).orderBy(plataformaSegredos.nome);
  return linhas.map((l) => `${l.nome}@${l.em.toISOString()}`).join("|");
}

function abrirJson(cifrado: string, chave: Buffer | null, nome: "certificado" | "chaves"): Record<string, unknown> | null {
  if (!chave) return null;
  try {
    const valor = JSON.parse(decifrar(cifrado, chave, contexto(nome)));
    return valor && typeof valor === "object" ? (valor as Record<string, unknown>) : null;
  } catch {
    // Chave trocada ou cifrado alterado no banco: ilegível (a tela pede para enviar de novo).
    return null;
  }
}

const texto = (v: unknown) => (typeof v === "string" && v ? v : null);

// Lê e decifra o que está guardado. `chave` nula (PLATAFORMA_CHAVE ausente ou inválida) = tudo ilegível.
export async function lerGuardado(banco: Banco, chave: Buffer | null): Promise<Guardado> {
  const linhas = await banco
    .select({ nome: plataformaSegredos.nome, cifrado: plataformaSegredos.cifrado, info: plataformaSegredos.info, atualizadoEm: plataformaSegredos.atualizadoEm, por: usuarios.nome })
    .from(plataformaSegredos)
    .leftJoin(usuarios, eq(usuarios.id, plataformaSegredos.atualizadoPorId));
  const guardado: Guardado = { certificado: null, chaves: null };
  for (const l of linhas) {
    const quem = { atualizadoEm: l.atualizadoEm, atualizadoPor: l.por ?? null };
    const aberto = abrirJson(l.cifrado, chave, l.nome);
    if (l.nome === "certificado") {
      const info = l.info as InfoDoCertificadoGuardado;
      const [chavePem, certificado] = [texto(aberto?.chave), texto(aberto?.certificado)];
      guardado.certificado = chavePem && certificado ? { ...quem, info, legivel: true, pem: { chave: chavePem, certificado } } : { ...quem, info, legivel: false };
    } else {
      const info = l.info as InfoDasChavesGuardadas;
      const [consumerKey, consumerSecret] = [texto(aberto?.consumerKey), texto(aberto?.consumerSecret)];
      guardado.chaves = consumerKey && consumerSecret ? { ...quem, info, legivel: true, consumerKey, consumerSecret } : { ...quem, info, legivel: false };
    }
  }
  return guardado;
}

// O que a tela do ADMIN pode ver: nunca a chave privada, o certificado inteiro nem o secret.
export type ResumoDoGuardado = {
  certificado: (Quem & { legivel: boolean; titular: string; cnpj: string; validoAte: Date; emissor: string }) | null;
  chaves: (Quem & { legivel: boolean; finalDaChave: string }) | null;
};

export function resumir(g: Guardado): ResumoDoGuardado {
  const c = g.certificado;
  const k = g.chaves;
  return {
    certificado: c && { legivel: c.legivel, titular: c.info.titular, cnpj: c.info.cnpj, validoAte: new Date(c.info.validoAte), emissor: c.info.emissor, atualizadoEm: c.atualizadoEm, atualizadoPor: c.atualizadoPor },
    chaves: k && { legivel: k.legivel, finalDaChave: k.info.finalDaChave, atualizadoEm: k.atualizadoEm, atualizadoPor: k.atualizadoPor },
  };
}

export type DependenciasSegredos = {
  banco: Banco;
  chave: Buffer | null; // PLATAFORMA_CHAVE
  motivoDaChave?: string | null; // por que a chave falta (para a mensagem)
  plataforma: CnpjPlataforma;
  agora?: () => Date;
  log?: (mensagem: string) => void;
};

function conferirAdmin(ator: Ator) {
  if (ator.papel !== "ADMIN") throw new ErroDaPlataforma("Só um administrador da plataforma pode ver e trocar o certificado e as chaves da plataforma.", 403);
}

function chaveOuErro(deps: DependenciasSegredos): Buffer {
  if (!deps.chave) throw new ErroDaPlataforma(deps.motivoDaChave ?? "Falta a PLATAFORMA_CHAVE no plataforma/.env.local (veja o README): sem ela nada é guardado.", 400);
  return deps.chave;
}

async function gravar(deps: DependenciasSegredos, ator: Ator, nome: "certificado" | "chaves", segredo: object, info: InfoDoCertificadoGuardado | InfoDasChavesGuardadas, agora: Date) {
  const linha = { cifrado: cifrar(JSON.stringify(segredo), chaveOuErro(deps), contexto(nome)), info, atualizadoEm: agora, atualizadoPorId: ator.id };
  await deps.banco.insert(plataformaSegredos).values({ nome, ...linha }).onConflictDoUpdate({ target: plataformaSegredos.nome, set: linha });
}

const dataBr = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

// Confere o e-CNPJ A1 da plataforma: ICP-Brasil, do PLATAFORMA_CNPJ, na validade, chave de 2048 bits ou mais e a senha que
// abre o arquivo. Devolve o certificado já aberto em PEM.
export function conferirCertificadoDaPlataforma(arquivo: Uint8Array, senha: string, cnpj: string, agora: Date): { info: InfoCertificado; pem: CertificadoPem } {
  if (!arquivo.length) throw new ErroDaPlataforma("Escolha o arquivo do certificado (.pfx ou .p12).", 400);
  if (arquivo.length > TAMANHO_MAXIMO_PFX) throw new ErroDaPlataforma("Este arquivo é grande demais para um certificado (.pfx ou .p12).", 400);
  if (!senha) throw new ErroDaPlataforma("Informe a senha do certificado.", 400);
  try {
    const { info, chave, certificado } = converterParaPem(arquivo, senha);
    if (info.titular.tipo === "PJ" && info.titular.numero !== cnpj) {
      throw new ErroCertificado(`Este é o e-CNPJ do CNPJ ${formatarCnpj(info.titular.numero)}; o certificado da plataforma tem de ser o do PLATAFORMA_CNPJ (${formatarCnpj(cnpj)}).`);
    }
    if (info.autoassinado || !info.icpBrasil) throw new ErroCertificado("Este certificado não é um e-CNPJ A1 da ICP-Brasil.");
    conferirAntesDeAssinar(info, cnpj, agora);
    // A conexão TLS usa o OpenSSL do Node: a chave tem de abrir aqui e ser a do certificado.
    const x509 = new X509Certificate(certificado);
    if (!x509.checkPrivateKey(createPrivateKey(chave))) throw new ErroCertificado("A chave do arquivo não é a do certificado.");
    return { info, pem: { chave, certificado } };
  } catch (erro) {
    if (erro instanceof ErroCertificado) throw new ErroDaPlataforma(erro.message, 400);
    throw erro;
  }
}

// Guarda (ou troca) o certificado da plataforma. A senha só serve para abrir o arquivo aqui; não é guardada.
export async function guardarCertificado(deps: DependenciasSegredos, ator: Ator, arquivo: Uint8Array, senha: string): Promise<ResumoDoGuardado["certificado"]> {
  conferirAdmin(ator);
  chaveOuErro(deps);
  if (deps.plataforma.cnpj === null) throw new ErroDaPlataforma(deps.plataforma.motivo, 400);
  const agora = deps.agora?.() ?? new Date();
  const { info, pem } = conferirCertificadoDaPlataforma(arquivo, senha, deps.plataforma.cnpj, agora);
  const guardar: InfoDoCertificadoGuardado = {
    titular: info.titular.nome,
    cnpj: info.titular.numero,
    validoDe: info.validoDe.toISOString(),
    validoAte: info.validoAte.toISOString(),
    emissor: info.emissor,
  };
  await gravar(deps, ator, "certificado", pem, guardar, agora);
  (deps.log ?? console.info)(
    `[plataforma] Certificado da plataforma trocado por ${ator.email} (${ator.id}) em ${agora.toISOString()}: e-CNPJ ${guardar.cnpj}, válido até ${dataBr(info.validoAte)}.`,
  );
  return resumir({ certificado: { info: guardar, legivel: true, pem, atualizadoEm: agora, atualizadoPor: null }, chaves: null }).certificado;
}

// Guarda (ou troca) as chaves do contrato. As duas juntas: o secret nunca volta para a tela, então trocar uma pede a outra.
export async function guardarChaves(deps: DependenciasSegredos, ator: Ator, consumerKey: string, consumerSecret: string): Promise<ResumoDoGuardado["chaves"]> {
  conferirAdmin(ator);
  chaveOuErro(deps);
  const [key, secret] = [consumerKey.trim(), consumerSecret.trim()];
  if (!key || !secret) throw new ErroDaPlataforma("Informe a consumer key e o consumer secret (os dois).", 400);
  if (/\s/.test(key) || /\s/.test(secret) || key.length > TAMANHO_MAXIMO_CHAVE || secret.length > TAMANHO_MAXIMO_CHAVE) {
    throw new ErroDaPlataforma("Confira a consumer key e o consumer secret: copie da área do cliente do contrato, sem espaços.", 400);
  }
  const agora = deps.agora?.() ?? new Date();
  const info: InfoDasChavesGuardadas = { finalDaChave: key.slice(-4) };
  await gravar(deps, ator, "chaves", { consumerKey: key, consumerSecret: secret }, info, agora);
  (deps.log ?? console.info)(`[plataforma] Chaves do contrato trocadas por ${ator.email} (${ator.id}) em ${agora.toISOString()}.`);
  return { legivel: true, finalDaChave: info.finalDaChave, atualizadoEm: agora, atualizadoPor: null };
}

// O resumo para a tela do ADMIN (o servidor confere o papel aqui também, além da página).
export async function resumoParaAdmin(deps: Pick<DependenciasSegredos, "banco" | "chave">, ator: Ator): Promise<ResumoDoGuardado> {
  conferirAdmin(ator);
  return resumir(await lerGuardado(deps.banco, deps.chave));
}
