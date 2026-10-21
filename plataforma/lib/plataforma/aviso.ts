// Aviso no sino do ADMIN sobre o certificado da plataforma (o e-CNPJ que liga a plataforma à Receita Federal e ao
// eSocial): vence em 30 dias ou menos (amarelo), venceu, não abre com a chave atual ou não está disponível (vermelho).
// Só para o ADMIN (o layout confere); o texto não cita fornecedor, como todo o sino.
import type { AvisoDoSino } from "@/lib/avisos/central";
import type { CertificadoDaPlataforma } from "@/lib/serpro/config";

export const AVISO_DIAS_PLATAFORMA = 30;
const DIA = 24 * 60 * 60 * 1000;

// "recusado": o certificado (guardado ou do ambiente) abre, mas não é usado (é de outro CNPJ, o arquivo do ambiente não
// abre, ou falta/está errado o PLATAFORMA_CNPJ); o motivo técnico fica no log e na tela do ADMIN, o sino só aponta para lá.
// Por isso o texto do sino é neutro quanto à origem: não fala de "guardado", que pode nem existir.
export type EstadoDoCertificadoDaPlataforma =
  | { estado: "ok"; validoAte: Date }
  | { estado: "ilegivel" }
  | { estado: "recusado" }
  | { estado: "indisponivel" };

// O estado do certificado que vale, tirado só do que resolverCertificadoDaPlataforma decidiu (vale igual para o guardado
// e para o alternativo do ambiente); o guardado não é relido aqui. O vencido continua "ok" com a data, para o sino dizer
// "venceu em" (a data vem da falha, então não se perde quando a montagem é refeita).
export function estadoDoCertificado({ certificado: c }: { certificado: CertificadoDaPlataforma }): EstadoDoCertificadoDaPlataforma {
  if (c.pronto) return { estado: "ok", validoAte: c.validoAte };
  switch (c.falha.tipo) {
    case "vencido":
      return { estado: "ok", validoAte: c.falha.validoAte };
    case "outro-cnpj":
    case "invalido":
      return { estado: "recusado" };
    case "ilegivel":
      return { estado: "ilegivel" };
    case "falta":
      return { estado: "indisponivel" };
  }
}

// Dias de calendário em Brasília entre hoje e a data (0 = hoje, 1 = amanhã), sem arredondar horas.
const diaEmBrasilia = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
function diasDeCalendario(de: Date, ate: Date): number {
  return Math.round((Date.parse(`${diaEmBrasilia(ate)}T00:00:00Z`) - Date.parse(`${diaEmBrasilia(de)}T00:00:00Z`)) / DIA);
}

const LINK = { href: "/admin/plataforma", texto: "Trocar o certificado da plataforma" };
const CHAVE = "plataforma:certificado";
const dataBr = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export function avisoDoCertificadoDaPlataforma(e: EstadoDoCertificadoDaPlataforma, agora: Date): AvisoDoSino[] {
  if (e.estado === "ilegivel") {
    return [{ chave: CHAVE, nivel: "vencida", titulo: "Envie de novo o certificado da plataforma", texto: "O certificado guardado não abre com a chave atual do servidor. Até enviar de novo, nada é consultado nem transmitido.", link: LINK }];
  }
  if (e.estado === "recusado") {
    return [{ chave: CHAVE, nivel: "vencida", titulo: "O certificado da plataforma não está em uso", texto: "O certificado configurado não pode ser usado pela plataforma. Até resolver, nada é consultado nem transmitido. O motivo está na tela do certificado.", link: LINK }];
  }
  if (e.estado === "indisponivel") {
    return [{ chave: CHAVE, nivel: "vencida", titulo: "Falta o certificado da plataforma", texto: "Sem ele, nada é consultado nem transmitido para nenhuma empresa. Envie o e-CNPJ A1 da plataforma.", link: { ...LINK, texto: "Enviar o certificado da plataforma" } }];
  }
  const data = dataBr(e.validoAte);
  if (agora >= e.validoAte) {
    return [{ chave: CHAVE, nivel: "vencida", titulo: "O certificado da plataforma venceu", texto: `O e-CNPJ da plataforma venceu em ${data}. Até enviar o novo, nada é consultado nem transmitido.`, link: LINK }];
  }
  const dias = diasDeCalendario(agora, e.validoAte);
  if (dias > AVISO_DIAS_PLATAFORMA) return [];
  const quando = dias <= 0 ? "hoje" : dias === 1 ? "amanhã" : `em ${dias} dias`;
  return [{ chave: CHAVE, nivel: "vence", titulo: `Certificado da plataforma vence ${quando}`, texto: `O e-CNPJ da plataforma vale até ${data}. Renove e envie o novo antes disso.`, link: LINK }];
}
