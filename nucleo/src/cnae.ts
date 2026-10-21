// Regras por CNAE de TI (MVP): em que anexo a atividade é tributada, se depende do Fator R ou se ainda não atendemos.
// Base: Resolução CGSN 140/2018, art. 25, § 1º. Inciso III (Anexo III, sem Fator R): "g" instalação, reparos e
// manutenção em geral; "m" outros serviços que não sejam atividade intelectual. Inciso V (Anexo III ou V pelo Fator R):
// "d" elaboração de programas, "e" licenciamento de programas, "f" páginas eletrônicas, "u" consultoria.
import { type Anexo, type FatorR } from "./simples.ts";

export type Tributacao = "anexo-fixo" | "fator-r" | "nao-atendido";

export type RegraCnae = {
  cnae: string; // subclasse, só dígitos (7)
  descricao: string;
  tributacao: Tributacao;
  anexo?: Anexo; // só em "anexo-fixo"
  fundamento: string;
};

const fixoIII = (cnae: string, descricao: string, fundamento: string): RegraCnae => ({
  cnae, descricao, tributacao: "anexo-fixo", anexo: "III", fundamento,
});
const fatorR = (cnae: string, descricao: string, fundamento: string): RegraCnae => ({
  cnae, descricao, tributacao: "fator-r", fundamento,
});

export const REGRAS_CNAE: RegraCnae[] = [
  fatorR("6201501", "Desenvolvimento de programas de computador sob encomenda", "CGSN 140, art. 25, § 1º, V, d"),
  fatorR("6201502", "Web design", "CGSN 140, art. 25, § 1º, V, f"),
  fatorR("6202300", "Desenvolvimento e licenciamento de programas de computador customizáveis", "CGSN 140, art. 25, § 1º, V, d e e"),
  fatorR("6203100", "Desenvolvimento e licenciamento de programas de computador não customizáveis", "CGSN 140, art. 25, § 1º, V, e"),
  fatorR("6204000", "Consultoria em tecnologia da informação", "CGSN 140, art. 25, § 1º, V, u"),
  fixoIII("6209100", "Suporte técnico, manutenção e outros serviços em tecnologia da informação", "CGSN 140, art. 25, § 1º, III, g"),
  fixoIII("6311900", "Tratamento de dados, provedores de serviços de aplicação e serviços de hospedagem na internet", "CGSN 140, art. 25, § 1º, III, m"),
  fixoIII("6319400", "Portais, provedores de conteúdo e outros serviços de informação na internet", "CGSN 140, art. 25, § 1º, III, m"),
];

// CNAEs conferidos na fonte e deixados fora desta versão de propósito, com o motivo (o resto cai no motivo genérico).
// REGRAS_CNAE fica só com o que atendemos.
export const CNAES_FORA_DO_ESCOPO: RegraCnae[] = [
  // Comum no cadastro de quem presta serviço de TI ao exterior, mas não é TI.
  {
    cnae: "7490104",
    descricao: "Atividades de intermediação e agenciamento de serviços e negócios em geral, exceto imobiliários",
    tributacao: "nao-atendido",
    fundamento:
      "Intermediação de negócios (Anexo III ou V pelo Fator R, CGSN 140, art. 25, § 1º, V, s) não é atividade de TI e fica fora desta versão.",
  },
];

// Aceita "6209-1/00", "6209100" ou número.
export const normalizarCnae = (cnae: string | number) => String(cnae).replace(/\D/g, "").padStart(7, "0");

export function regraDoCnae(cnae: string | number): RegraCnae {
  const codigo = normalizarCnae(cnae);
  if (codigo.length !== 7) throw new Error(`CNAE inválido: "${cnae}".`);
  return (
    REGRAS_CNAE.find((r) => r.cnae === codigo) ??
    CNAES_FORA_DO_ESCOPO.find((r) => r.cnae === codigo) ?? {
      cnae: codigo,
      descricao: "",
      tributacao: "nao-atendido",
      fundamento: "Fora dos CNAEs de TI atendidos nesta versão (6201, 6202, 6203, 6204, 6209, 6311 e 6319).",
    }
  );
}

// Anexo do mês para a atividade: o fixo, ou o que o Fator R do PA indicar.
export function anexoDaAtividade(regra: RegraCnae, fator?: FatorR): Anexo {
  if (regra.tributacao === "nao-atendido") throw new Error(`CNAE ${regra.cnae} ainda não atendido.`);
  if (regra.tributacao === "anexo-fixo") return regra.anexo!;
  if (!fator) throw new Error(`O CNAE ${regra.cnae} depende do Fator R: informe a folha e a receita.`);
  return fator.anexo;
}

// Código da atividade no PGDAS-D (campo idAtividade da declaração), pelo catálogo oficial do Serpro
// (serpro/atividades-pgdasd.ts). Prestação de serviços para o exterior: 29 = sujeitos ao fator r (6201 a 6204),
// 30 = não sujeitos ao fator r e tributados pelo Anexo III (6209, 6311, 6319; confirmado no extrato real).
export const ATIVIDADE_PGDASD_EXPORTACAO_FATOR_R = 29;
export const ATIVIDADE_PGDASD_EXPORTACAO_ANEXO_III = 30;

export function idAtividadeExportacao(regra: RegraCnae): number {
  if (regra.tributacao === "fator-r") return ATIVIDADE_PGDASD_EXPORTACAO_FATOR_R;
  if (regra.tributacao === "anexo-fixo" && regra.anexo === "III") return ATIVIDADE_PGDASD_EXPORTACAO_ANEXO_III;
  throw new Error(`CNAE ${regra.cnae} ainda não atendido.`);
}

// Mercado interno (exceto exterior), pelo mesmo catálogo: o código depende de onde o ISS é devido.
// Sujeitos ao fator r: 10 (outro município), 11 (próprio município), 12 (com retenção/substituição de ISS).
// Não sujeitos ao fator r, Anexo III: 13, 14 e 15, na mesma ordem.
export type IssDevido = "outro-municipio" | "proprio-municipio" | "retencao";
const ORDEM_ISS: IssDevido[] = ["outro-municipio", "proprio-municipio", "retencao"];

export function idAtividadeInterno(regra: RegraCnae, iss: IssDevido): number {
  const i = ORDEM_ISS.indexOf(iss);
  if (i < 0) throw new Error(`Situação do ISS inválida: "${iss}".`);
  if (regra.tributacao === "fator-r") return 10 + i;
  if (regra.tributacao === "anexo-fixo" && regra.anexo === "III") return 13 + i;
  throw new Error(`CNAE ${regra.cnae} ainda não atendido.`);
}
