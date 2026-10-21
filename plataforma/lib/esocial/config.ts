// Configuração da plataforma como transmissora no eSocial: o PLATAFORMA_CNPJ e o e-CNPJ da plataforma (o mesmo do contrato,
// resolvido uma vez por resolverCertificadoDaPlataforma: o guardado pelo ADMIN em /admin/plataforma primeiro,
// CERT_PFX_PATH e CERT_PFX_SENHA como alternativa), usado na conexão TLS. O eSocial compara o ideTransmissor do lote com o
// certificado da conexão (MOD v1.16 §7.5.9): o CNPJ do certificado tem de ser o PLATAFORMA_CNPJ, o que
// resolverCertificadoDaPlataforma já garante (recusa qualquer outro titular). Só o transmissor consulta
// o resultado do lote (§7.6.13), então enviar e consultar usam sempre este certificado.
// Os motivos abaixo são técnicos: vão para o log do servidor e para a tela do ADMIN, nunca para o cliente.
import type { CertificadoTls } from "@contabilizadev/nucleo/http";
import type { CertificadoDaPlataforma, CnpjPlataforma } from "@/lib/serpro/config";

export type ConfigEsocial = { pronto: true; certificado: CertificadoTls; transmissor: string } | { pronto: false; motivo: string };

// A partir do certificado já resolvido (lib/plataforma/montagem.ts): aqui não se lê nem abre o certificado de novo.
export function lerConfigEsocial(plataforma: CnpjPlataforma, c: CertificadoDaPlataforma): ConfigEsocial {
  if (plataforma.cnpj === null) return { pronto: false, motivo: plataforma.motivo };
  if (!c.pronto) return { pronto: false, motivo: `Envio ao eSocial desligado. ${c.motivo}` };
  return { pronto: true, certificado: c.tls, transmissor: plataforma.cnpj };
}
