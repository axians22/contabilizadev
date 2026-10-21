// Assinatura do cliente no navegador, com o e-CNPJ A1 da empresa: um só caminho para o termo de autorização, a DCTFWeb
// e o eSocial (Parte 7). O cliente escolhe, em cada assinatura:
// - "Usar só agora" (padrão): informa o .pfx e a senha; a chave é importada no WebCrypto só em memória, não exportável,
//   e descartada no fim (assinanteDoArquivo com guardar = false);
// - "Guardar neste navegador": na primeira vez, o mesmo, e a chave não exportável vai para o cofre (cofre.ts); nas
//   próximas, basta clicar em Assinar (assinanteGuardado).
// Nos dois casos, a assinatura é RSA-SHA256 (PKCS#1 v1.5) sobre o texto que o servidor preparou (o SignedInfo canônico,
// prepararAssinaturaRemota) ou que a tela montou (o termo, assinarTermoCom); o servidor confere tudo de novo e só recebe
// o certificado público e o XML ou o valor assinado. A chave e a senha nunca saem do navegador.
// O node-forge (pelo núcleo) é carregado sob demanda e só para abrir o .pfx; com o certificado guardado, não carrega.
import { formatarCnpj } from "@contabilizadev/nucleo/formato";
import { conferirAntesDeAssinar, ErroCertificado, pemDoCertificado, type InfoCertificado } from "@contabilizadev/nucleo/serpro/termo-xml";
import type { CertificadoGuardado, Cofre } from "./cofre";
import { estadoDoGuardado } from "./estado";

export const ALGORITMO = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;
// O estado do certificado guardado (vencendo, vencido, de outro CNPJ) fica em estado.ts, sem nada do núcleo, para o sino
// (que roda em todas as páginas) não levar junto o resto do assinador.
export { AVISO_VENCIMENTO_DIAS, estadoDoGuardado, type EstadoDoGuardado } from "./estado";

export type Assinante = {
  info: InfoCertificado; // o certificado público e o que foi lido dele (titular, validade)
  guardado: boolean; // a chave está no cofre deste navegador
  assinar(texto: string): Promise<string>; // RSA-SHA256 do texto em UTF-8, em base64
};

export const dataBrasilia = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

const base64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const base64DoPem = (pem: string) => pem.replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g, "");

// Importa a chave privada (PKCS#8) como não exportável, só para assinar, e zera os bytes recebidos.
export async function importarChave(pkcs8: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey("pkcs8", pkcs8, ALGORITMO, false, ["sign"]);
  } catch {
    throw new ErroCertificado("Não foi possível usar a chave do certificado neste navegador (precisa ser RSA).");
  } finally {
    pkcs8.fill(0);
  }
}

export async function assinarComChave(chave: CryptoKey, texto: string): Promise<string> {
  return base64(new Uint8Array(await crypto.subtle.sign(ALGORITMO, chave, new TextEncoder().encode(texto))));
}

const assinante = (info: InfoCertificado, chave: CryptoKey, guardado: boolean): Assinante => ({
  info,
  guardado,
  assinar: (texto) => assinarComChave(chave, texto),
});

export const MENSAGENS_DO_ASSINADOR = {
  vencido: (validoAte: Date) => `O certificado guardado neste navegador venceu em ${dataBrasilia(validoAte)}. Troque o certificado.`,
  outroCnpj: "O certificado guardado neste navegador é de outro CNPJ. Troque o certificado.",
  vencendo: (dias: number) => `O certificado vence em ${dias} ${dias === 1 ? "dia" : "dias"}: troque quando renovar o e-CNPJ.`,
  semGuardado: "Não há certificado guardado neste navegador para esta empresa. Informe o arquivo e a senha.",
};

// "Usar só agora" e a primeira vez de "Guardar neste navegador": abre o .pfx (node-forge, carregado aqui), confere que é
// o e-CNPJ A1 válido da própria empresa, importa a chave como não exportável e, se pedido, guarda no cofre (um por CNPJ).
export async function assinanteDoArquivo(o: { pfx: Uint8Array; senha: string; cnpjEmpresa: string; agora: Date; guardar: boolean; cofre: Cofre }): Promise<Assinante> {
  const nucleo = await import("@contabilizadev/nucleo/serpro/termo-autorizacao");
  const { info, pkcs8 } = nucleo.abrirChaveDoCertificado(o.pfx, o.senha);
  try {
    conferirAntesDeAssinar(info, o.cnpjEmpresa, o.agora);
  } catch (erro) {
    pkcs8.fill(0);
    throw erro;
  }
  const chave = await importarChave(pkcs8);
  if (o.guardar) {
    const { certificadoBase64, ...resto } = info;
    await o.cofre.guardar({ cnpj: info.titular.numero, chave, certificado: pemDoCertificado(certificadoBase64), info: resto, guardadoEm: o.agora });
  }
  return assinante(info, chave, o.guardar);
}

// "Guardar neste navegador", nas próximas vezes: a chave guardada para o CNPJ da empresa ativa, se ainda serve. Sem
// certificado guardado, null; de outro CNPJ ou vencido, recusa com o que fazer (trocar o certificado).
export async function assinanteGuardado(o: { cnpjEmpresa: string; agora: Date; cofre: Cofre }): Promise<Assinante | null> {
  const registro = await o.cofre.pegar(o.cnpjEmpresa);
  if (!registro) return null;
  const estado = estadoDoGuardado(registro, o.cnpjEmpresa, o.agora);
  if (estado.estado === "outro-cnpj") throw new ErroCertificado(MENSAGENS_DO_ASSINADOR.outroCnpj);
  if (estado.estado === "vencido") throw new ErroCertificado(MENSAGENS_DO_ASSINADOR.vencido(estado.validoAte));
  const info: InfoCertificado = { ...registro.info, certificadoBase64: base64DoPem(registro.certificado) };
  conferirAntesDeAssinar(info, o.cnpjEmpresa, o.agora);
  return assinante(info, registro.chave, true);
}

// Resumo do certificado guardado para a tela: "Certificado guardado neste navegador · CNPJ … · válido até dd/mm/aaaa".
export const resumoDoGuardado = (registro: Pick<CertificadoGuardado, "cnpj" | "info">) =>
  `Certificado guardado neste navegador · CNPJ ${formatarCnpj(registro.cnpj)} · válido até ${dataBrasilia(registro.info.validoAte)}`;
