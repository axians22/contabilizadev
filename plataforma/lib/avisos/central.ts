// Central de avisos (Parte 8, passo 22d): um só formato para tudo o que o sino e a página Avisos mostram (situação
// fiscal, guias vencidas, prazos do PGDAS-D, da DCTFWeb, do eSocial e da declaração anual, Fator R, autorização perto de
// vencer, certificado guardado no navegador perto de vencer, mensagens não lidas da Receita), com a prioridade, o link para
// resolver e sem aviso repetido. Funções puras, sem banco, também usadas no navegador (o certificado guardado só o
// navegador conhece): quem junta as fontes do banco é coleta.ts.
import type { LinkDaExplicacao } from "@/app/explicacao";
import { estadoDoGuardado } from "@/lib/assinador/estado";
import type { CertificadoGuardado } from "@/lib/assinador/cofre";

// vencida = vermelho (urgente: algo venceu ou está errado), vence = amarelo (atenção: prazo perto), info = informativo.
export type NivelDoAviso = "vencida" | "vence" | "info";

export type AvisoDoSino = {
  chave?: string; // o mesmo assunto tem a mesma chave (ex.: "guia:DAS:2026-08"): aparece uma vez só
  nivel: NivelDoAviso;
  titulo: string;
  texto: string;
  link: LinkDaExplicacao;
  cobre?: string[]; // chaves de outros avisos que este já resolve (ex.: o eSocial do mês cobre a DCTFWeb do mês)
};

export const NIVEIS: Record<NivelDoAviso, { rotulo: string; ordem: number; explicacao: string }> = {
  vencida: { rotulo: "Urgente", ordem: 0, explicacao: "Algo venceu ou está irregular: resolva o quanto antes." },
  vence: { rotulo: "Atenção", ordem: 1, explicacao: "Um prazo está chegando ou algo pede conferência." },
  info: { rotulo: "Para saber", ordem: 2, explicacao: "Informação para planejar; nada venceu." },
};

const chaveDo = (a: AvisoDoSino) => a.chave ?? `${a.titulo}|${a.link.href}`;

// Junta as listas sem repetir: o aviso coberto por outro sai; com a mesma chave, fica o mais grave (no empate, o
// primeiro). Ordem: mais grave primeiro e, no mesmo nível, a ordem em que as fontes vieram.
export function juntarAvisos(...listas: AvisoDoSino[][]): AvisoDoSino[] {
  const todos = listas.flat();
  const cobertas = new Set(todos.flatMap((a) => (a.cobre ?? []).filter((c) => c !== chaveDo(a))));
  const escolhidos = new Map<string, { aviso: AvisoDoSino; posicao: number }>();
  todos.forEach((aviso, posicao) => {
    const chave = chaveDo(aviso);
    if (cobertas.has(chave)) return;
    const atual = escolhidos.get(chave);
    if (atual && NIVEIS[atual.aviso.nivel].ordem <= NIVEIS[aviso.nivel].ordem) return;
    escolhidos.set(chave, { aviso, posicao: atual?.posicao ?? posicao });
  });
  return [...escolhidos.values()].sort((a, b) => NIVEIS[a.aviso.nivel].ordem - NIVEIS[b.aviso.nivel].ordem || a.posicao - b.posicao).map((e) => e.aviso);
}

// O nível mais grave da lista (a cor do sino), ou null sem aviso.
export function nivelMaisGrave(avisos: AvisoDoSino[]): NivelDoAviso | null {
  return avisos.reduce<NivelDoAviso | null>((m, a) => (!m || NIVEIS[a.nivel].ordem < NIVEIS[m].ordem ? a.nivel : m), null);
}

// Dia (AAAA-MM-DD, Brasília) de uma data: o mesmo formato do último dia do certificado no termo de autorização, para o
// aviso do certificado guardado e o do termo, quando são o mesmo certificado, virarem um só.
export const diaEmBrasilia = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
export const chaveDoCertificado = (validoAte: Date | string) => `certificado:${typeof validoAte === "string" ? validoAte : diaEmBrasilia(validoAte)}`;

const LINK_DO_CERTIFICADO = { href: "/autorizacao", texto: "Trocar o certificado" };

// Aviso do certificado guardado neste navegador (só o navegador sabe; o servidor nunca vê a chave): da empresa ativa,
// vencendo em 30 dias ou menos (amarelo) ou vencido (vermelho). De outro CNPJ ou sem certificado, nada.
export function avisoDoCertificadoGuardado(registro: Pick<CertificadoGuardado, "cnpj" | "info"> | null, cnpjEmpresa: string, agora: Date): AvisoDoSino[] {
  if (!registro) return [];
  const estado = estadoDoGuardado(registro, cnpjEmpresa, agora);
  const data = registro.info.validoAte.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const chave = chaveDoCertificado(registro.info.validoAte);
  if (estado.estado === "vencido") {
    return [{ chave, nivel: "vencida", titulo: "O certificado guardado venceu", texto: `O certificado digital guardado neste navegador venceu em ${data}. Renove o e-CNPJ A1 e troque o guardado.`, link: LINK_DO_CERTIFICADO }];
  }
  if (estado.estado === "vencendo") {
    const quando = estado.dias <= 1 ? "amanhã" : `em ${estado.dias} dias`;
    return [{ chave, nivel: "vence", titulo: `Certificado guardado vence ${quando}`, texto: `O certificado digital guardado neste navegador vale até ${data}. Renove o e-CNPJ A1 antes disso e troque o guardado.`, link: LINK_DO_CERTIFICADO }];
  }
  return [];
}

// O nome da tabela de avisos (o que o leitor de tela anuncia), pelo que ela pode ter: só os da empresa, só os da
// plataforma (do ADMIN, com o portão fechado ou sem empresa) ou os dois juntos.
export function rotuloDosAvisos({ daEmpresa, daPlataforma }: { daEmpresa: boolean; daPlataforma: boolean }): string {
  if (daEmpresa && daPlataforma) return "Avisos da empresa e da plataforma";
  return daPlataforma ? "Avisos da plataforma" : "Avisos da empresa";
}
