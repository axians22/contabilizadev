// Simples Nacional (LC 123/2006 e Resolução CGSN 140/2018): Anexos III e V, repartição por faixa, RBT12 e Fator R.
// Nada aqui é fixo de empresa: receitas, folhas, anexo e período de apuração (PA, "AAAA-MM") vêm por parâmetro.
// A Resolução CGSN 190/2026 muda as tabelas e as janelas de RBT12 e Fator R a partir do PA 01/2027.
import { mesValido, somarMeses } from "./meses.ts";

export type Anexo = "III" | "V";
export type Mercado = "externo" | "interno";
export type Tributo = "irpj" | "csll" | "cofins" | "pis" | "cbs" | "cpp" | "iss" | "ibs";
export const TRIBUTOS: Tributo[] = ["irpj", "csll", "cofins", "pis", "cbs", "cpp", "iss", "ibs"];

// Na exportação de serviços não incidem ISS, PIS, COFINS, CBS e IBS (LC 123, art. 18, § 4º-A, IV; LC 214/2025).
const FORA_DA_EXPORTACAO: Tributo[] = ["iss", "pis", "cofins", "cbs", "ibs"];

export type Reparticao = Partial<Record<Tributo, number>>;
export type Faixa = { ate: number; aliquota: number; deducao: number; reparticao: Reparticao };

export type Tabela = {
  anexo: Anexo;
  vigencia: { de: string; ate: string | null }; // PAs "AAAA-MM", inclusive
  faixas: Faixa[];
  tetoIss: number;
  // ISS acima do teto (5ª faixa): o ISS fica no teto e cada outro tributo = (alíquota efetiva - teto) × percentual,
  // conforme a nota do Anexo III (mesma redação até 2026 e em 2027). Sem percentuais, usa a proporção da própria faixa.
  redistribuicao: { percentuais?: Reparticao };
};

const r = (irpj: number, csll: number, cofins: number, pis: number, cpp: number, iss: number): Reparticao => ({
  irpj, csll, cofins, pis, cpp, ...(iss ? { iss } : {}),
});
const r2027 = (irpj: number, csll: number, cbs: number, cpp: number, iss: number, ibs: number): Reparticao => ({
  irpj, csll, cbs, cpp, ...(iss ? { iss } : {}), ...(ibs ? { ibs } : {}),
});

const LIMITES = [180_000, 360_000, 720_000, 1_800_000, 3_600_000, 4_800_000];
const faixas = (aliquotas: number[], deducoes: number[], reparticoes: Reparticao[]): Faixa[] =>
  LIMITES.map((ate, i) => ({ ate, aliquota: aliquotas[i], deducao: deducoes[i], reparticao: reparticoes[i] }));

const ATE_2026 = { de: "0000-01", ate: "2026-12" };
const DE_2027_A_2028 = { de: "2027-01", ate: "2028-12" };

// Percentuais em fração (0.04 = 4%), transcritos dos Anexos III e V da Resolução CGSN 140/2018.
export const TABELAS: Tabela[] = [
  {
    anexo: "III",
    vigencia: ATE_2026,
    faixas: faixas(
      [0.06, 0.112, 0.135, 0.16, 0.21, 0.33],
      [0, 9_360, 17_640, 35_640, 125_640, 648_000],
      [
        r(0.04, 0.035, 0.1282, 0.0278, 0.434, 0.335),
        r(0.04, 0.035, 0.1405, 0.0305, 0.434, 0.32),
        r(0.04, 0.035, 0.1364, 0.0296, 0.434, 0.325),
        r(0.04, 0.035, 0.1364, 0.0296, 0.434, 0.325),
        r(0.04, 0.035, 0.1282, 0.0278, 0.434, 0.335),
        r(0.35, 0.15, 0.1603, 0.0347, 0.305, 0),
      ],
    ),
    tetoIss: 0.05,
    redistribuicao: { percentuais: { irpj: 0.0602, csll: 0.0526, cofins: 0.1928, pis: 0.0418, cpp: 0.6526 } },
  },
  {
    anexo: "V",
    vigencia: ATE_2026,
    faixas: faixas(
      [0.155, 0.18, 0.195, 0.205, 0.23, 0.305],
      [0, 4_500, 9_900, 17_100, 62_100, 540_000],
      [
        r(0.25, 0.15, 0.141, 0.0305, 0.2885, 0.14),
        r(0.23, 0.15, 0.141, 0.0305, 0.2785, 0.17),
        r(0.24, 0.15, 0.1492, 0.0323, 0.2385, 0.19),
        r(0.21, 0.15, 0.1574, 0.0341, 0.2385, 0.21),
        r(0.23, 0.125, 0.141, 0.0305, 0.2385, 0.235),
        r(0.35, 0.155, 0.1644, 0.0356, 0.295, 0),
      ],
    ),
    tetoIss: 0.05,
    // Sem percentuais: a nota do Anexo V não traz tabela própria e o ISS nunca passa de 5% (máximo 4,9996% no topo
    // da 5ª faixa: 21,275% × 23,5%).
    redistribuicao: {},
  },
  {
    anexo: "III",
    vigencia: DE_2027_A_2028,
    faixas: faixas(
      [0.06, 0.112, 0.135, 0.16, 0.21, 0.329],
      [0, 9_360, 17_640, 35_640, 125_640, 648_000],
      [
        r2027(0.04, 0.035, 0.1543, 0.434, 0.335, 0.0017),
        r2027(0.04, 0.035, 0.1691, 0.434, 0.32, 0.0019),
        r2027(0.04, 0.035, 0.1641, 0.434, 0.325, 0.0019),
        r2027(0.04, 0.035, 0.1641, 0.434, 0.325, 0.0019),
        r2027(0.04, 0.035, 0.1543, 0.434, 0.335, 0.0017),
        r2027(0.3509, 0.1504, 0.1929, 0.3058, 0, 0),
      ],
    ),
    tetoIss: 0.05,
    redistribuicao: { percentuais: { irpj: 0.0602, csll: 0.0526, cbs: 0.232, cpp: 0.6526, ibs: 0.0026 } },
  },
  {
    anexo: "V",
    vigencia: DE_2027_A_2028,
    faixas: faixas(
      [0.155, 0.18, 0.195, 0.205, 0.23, 0.304],
      [0, 4_500, 9_900, 17_100, 62_100, 540_000],
      [
        r2027(0.25, 0.15, 0.1696, 0.2885, 0.14, 0.0019),
        r2027(0.23, 0.15, 0.1696, 0.2785, 0.17, 0.0019),
        r2027(0.24, 0.15, 0.1795, 0.2385, 0.19, 0.002),
        r2027(0.21, 0.15, 0.1894, 0.2385, 0.21, 0.0021),
        r2027(0.23, 0.125, 0.1696, 0.2385, 0.235, 0.0019),
        r2027(0.351, 0.1554, 0.1978, 0.2958, 0, 0),
      ],
    ),
    tetoIss: 0.05,
    redistribuicao: {},
  },
];

// A partir do PA 01/2027 valem as janelas novas (CGSN 190/2026): RBT12 e Fator R olham os 12 meses antecedentes
// ao mês anterior ao PA, e o começo de atividade tem regras próprias.
export const INICIO_REGRAS_2027 = "2027-01";
const regras2027 = (pa: string) => pa >= INICIO_REGRAS_2027;

// Arredonda ao centavo, meio centavo para cima. O toFixed tira o resíduo binário (447,175 vira 447,1749999...).
export const centavos = (v: number) => Math.round(Number((v * 100).toFixed(6))) / 100;

function exigirPa(pa: string) {
  if (!mesValido(pa)) throw new Error(`Período de apuração inválido: "${pa}" (use AAAA-MM).`);
}

export function tabelaVigente(anexo: Anexo, pa: string): Tabela {
  exigirPa(pa);
  const tabela = TABELAS.find((t) => t.anexo === anexo && pa >= t.vigencia.de && (t.vigencia.ate === null || pa <= t.vigencia.ate));
  if (!tabela) throw new Error(`Tabela do Anexo ${anexo} para o PA ${pa} ainda não cadastrada.`);
  return tabela;
}

// Faixa (1 a 6) pela RBT12; limites inclusivos. Acima de R$ 4,8 milhões a empresa sai do Simples.
export function faixaDaReceita(rbt12: number): number {
  if (!Number.isFinite(rbt12) || rbt12 < 0) throw new Error("RBT12 inválida.");
  const i = LIMITES.findIndex((ate) => rbt12 <= ate);
  if (i < 0) throw new Error("RBT12 acima de R$ 4,8 milhões: empresa fora do limite do Simples Nacional.");
  return i + 1;
}

// (RBT12 × alíquota nominal - parcela a deduzir) / RBT12. RBT12 zero conta como R$ 1,00 (CGSN 140, art. 21, par. único).
export function aliquotaEfetiva(rbt12: number, faixa: Faixa): number {
  const base = rbt12 > 0 ? rbt12 : 1;
  return (base * faixa.aliquota - faixa.deducao) / base;
}

// Percentual efetivo de cada tributo (alíquota efetiva × repartição), com o ISS limitado ao teto e o excedente
// transferido aos demais tributos.
export function percentuaisEfetivos(efetiva: number, faixa: Faixa, tabela: Tabela): Record<Tributo, number> {
  const base = Object.fromEntries(TRIBUTOS.map((t) => [t, efetiva * (faixa.reparticao[t] ?? 0)])) as Record<Tributo, number>;
  if (base.iss <= tabela.tetoIss) return base;

  const outros = TRIBUTOS.filter((t) => t !== "iss" && (faixa.reparticao[t] ?? 0) > 0);
  const somaOutros = outros.reduce((s, t) => s + (faixa.reparticao[t] ?? 0), 0);
  const peso = (t: Tributo) => tabela.redistribuicao.percentuais?.[t] ?? (faixa.reparticao[t] ?? 0) / somaOutros;
  const resultado = { ...base, iss: tabela.tetoIss };
  for (const t of outros) {
    resultado[t] = (efetiva - tabela.tetoIss) * peso(t);
  }
  return resultado;
}

export type Das = {
  pa: string;
  anexo: Anexo;
  mercado: Mercado;
  faixa: number;
  aliquotaNominal: number;
  aliquotaEfetiva: number;
  aliquotaPaga: number; // soma dos percentuais efetivos dos tributos que entram no DAS
  percentuais: Record<Tributo, number>;
  tributos: Record<Tributo, number>; // valores em reais, arredondados ao centavo
  total: number;
};

export function calcularDas(p: { pa: string; receita: number; rbt12: number; anexo: Anexo; mercado: Mercado }): Das {
  if (!Number.isFinite(p.receita) || p.receita < 0) throw new Error("Receita do mês inválida.");
  const tabela = tabelaVigente(p.anexo, p.pa);
  const n = faixaDaReceita(p.rbt12);
  // Na 6ª faixa o ISS e o IBS seguem fórmula própria e há o sublimite estadual/municipal: fora do MVP.
  if (n === 6) throw new Error("RBT12 acima de R$ 3,6 milhões (6ª faixa): ainda não atendido.");
  const faixa = tabela.faixas[n - 1];
  const efetiva = aliquotaEfetiva(p.rbt12, faixa);
  const percentuais = percentuaisEfetivos(efetiva, faixa, tabela);
  const devidos = TRIBUTOS.filter((t) => !(p.mercado === "externo" && FORA_DA_EXPORTACAO.includes(t)));
  // Arredondamento igual ao PGDAS-D, em todas as faixas, anexos e mercados: cada tributo = receita × percentual
  // efetivo com todas as casas decimais, arredondado ao centavo; o total do DAS é a soma dos tributos já arredondados,
  // e não receita × alíquota efetiva. Fonte: Manual do PGDAS-D 2018 v4, exemplos de cálculo (ex. 6: tributos somam
  // 9.935,02 com 100.000 × 9,935% = 9.935,00; ex. 4 e 5: 39,888 vira 39,89 e 261,398 vira 261,40)
  // https://www8.receita.fazenda.gov.br/SimplesNacional/Arquivos/manual/MANUAL_PGDAS-D_2018_V4.pdf
  // e o extrato real de 09/2026: total 1.000,76 = 78,65 + 68,81 + 853,30, enquanto 23.000 × alíquota paga daria 1.000,77.
  // O Serpro só transmite se os valores por tributo forem idênticos aos dele (TRANSDECLARACAO11, regra f).
  const tributos = Object.fromEntries(
    TRIBUTOS.map((t) => [t, devidos.includes(t) ? centavos(p.receita * percentuais[t]) : 0]),
  ) as Record<Tributo, number>;
  return {
    pa: p.pa,
    anexo: p.anexo,
    mercado: p.mercado,
    faixa: n,
    aliquotaNominal: faixa.aliquota,
    aliquotaEfetiva: efetiva,
    aliquotaPaga: devidos.reduce((s, t) => s + percentuais[t], 0),
    percentuais,
    tributos,
    total: centavos(TRIBUTOS.reduce((s, t) => s + tributos[t], 0)), // soma dos tributos arredondados
  };
}

// Os tributos que entram no DAS (pelo mercado e pelo percentual, não pelo valor: com receita zero a lista é a mesma).
export function tributosDoDas(das: Pick<Das, "mercado" | "percentuais">): Tributo[] {
  return TRIBUTOS.filter((t) => !(das.mercado === "externo" && FORA_DA_EXPORTACAO.includes(t)) && das.percentuais[t] > 0);
}

// Receitas ou folhas por mês ("AAAA-MM" -> valor). Mês ausente vale zero.
export type ValoresPorMes = Record<string, number>;

function valorDoMes(valores: ValoresPorMes, mes: string): number {
  const v = valores[mes] ?? 0;
  if (!Number.isFinite(v) || v < 0) throw new Error(`Valor inválido em ${mes}.`);
  return v;
}

const soma = (valores: ValoresPorMes, meses: string[]) => meses.reduce((s, m) => s + valorDoMes(valores, m), 0);
const intervalo = (de: string, ate: string) => {
  const meses: string[] = [];
  for (let m = de; m <= ate; m = somarMeses(m, 1)) meses.push(m);
  return meses;
};

// Mês de atividade do PA: 1 no mês de início, 2 no seguinte...
function mesDeAtividade(pa: string, inicioAtividade?: string): number | null {
  if (!inicioAtividade) return null;
  exigirPa(inicioAtividade);
  if (pa < inicioAtividade) throw new Error(`O PA ${pa} é anterior ao início de atividade (${inicioAtividade}).`);
  return intervalo(inicioAtividade, pa).length;
}

// Os 12 meses que formam a RBT12 e a FS12 do PA, do mais antigo para o mais recente.
export function janelaDoze(pa: string): string[] {
  exigirPa(pa);
  const recuo = regras2027(pa) ? 13 : 12;
  return Array.from({ length: 12 }, (_, i) => somarMeses(pa, i - recuo));
}

export type Rbt12 = {
  valor: number;
  meses: string[]; // meses somados (ou usados na média)
  regra: "doze-meses" | "inicio-mes-x12" | "inicio-media-x12" | "inicio-primeira-faixa";
};

// RBT12 para a alíquota (CGSN 140, arts. 21 e 22). `inicioAtividade` ("AAAA-MM") liga as regras de começo de atividade.
export function rbt12(pa: string, receitas: ValoresPorMes, inicioAtividade?: string): Rbt12 {
  exigirPa(pa);
  const n = mesDeAtividade(pa, inicioAtividade);
  if (regras2027(pa)) {
    // 1º e 2º mês: primeira faixa. Do 3º ao 13º: média dos meses antecedentes ao mês anterior × 12.
    if (n !== null && n <= 2) return { valor: 0, meses: [], regra: "inicio-primeira-faixa" };
    if (n !== null && n <= 13) {
      const meses = intervalo(inicioAtividade!, somarMeses(pa, -2));
      return { valor: (soma(receitas, meses) / meses.length) * 12, meses, regra: "inicio-media-x12" };
    }
  } else {
    // 1º mês: receita do próprio mês × 12. Nos 11 meses seguintes: média dos meses anteriores × 12.
    if (n === 1) return { valor: valorDoMes(receitas, pa) * 12, meses: [pa], regra: "inicio-mes-x12" };
    if (n !== null && n <= 12) {
      const meses = intervalo(inicioAtividade!, somarMeses(pa, -1));
      return { valor: (soma(receitas, meses) / meses.length) * 12, meses, regra: "inicio-media-x12" };
    }
  }
  const meses = janelaDoze(pa);
  return { valor: soma(receitas, meses), meses, regra: "doze-meses" };
}

export const LIMITE_FATOR_R = 0.28;

export type FatorR = { valor: number; folha: number; receita: number; anexo: Anexo; regra: string; meses: string[] };

export type RegraFatorR = "inicio-dois-primeiros-meses" | "inicio-mes-do-pa" | "doze-meses";

// Meses cuja folha (e receita) entram no fator r do PA. É a mesma lista que vai em folhasSalario na declaração do
// PGDAS-D, para a Receita calcular o mesmo fator r:
// - a partir de 2027, nos dois primeiros meses de atividade, nenhum: o fator r é 0,28 (CGSN 190/2026);
// - até 2026, no mês de abertura, o próprio PA: "Para o cálculo do fator r do mês de abertura da empresa será
//   considerada a folha de salários do PA (FSPA) e a receita bruta do PA (RPA)" (manual do PGDAS-D 2018 v4, 8.2.1);
// - nos demais, os 12 meses de janelaDoze, sem os anteriores ao início de atividade (não existem e somariam zero).
export function mesesDoFatorR(pa: string, inicioAtividade?: string): { regra: RegraFatorR; meses: string[] } {
  exigirPa(pa);
  const n = mesDeAtividade(pa, inicioAtividade);
  if (regras2027(pa) && n !== null && n <= 2) return { regra: "inicio-dois-primeiros-meses", meses: [] };
  if (!regras2027(pa) && n === 1) return { regra: "inicio-mes-do-pa", meses: [pa] };
  const meses = janelaDoze(pa).filter((m) => !inicioAtividade || m >= inicioAtividade);
  return { regra: "doze-meses", meses };
}

// Fator r = folha de salários com encargos (pró-labore, salários, FGTS, CPP) ÷ receita bruta (CGSN 140, art. 26).
// O PGDAS-D trunca o fator r em duas casas (manual 2018 v4: 0,2774 vira 0,27); truncar e comparar com 0,28 dá o
// mesmo anexo que comparar o valor exato, por isso a comparação abaixo é feita sem truncar.
// `folhas` já deve trazer a folha de cada mês com os encargos. Receitas do mercado interno e externo juntas.
export function fatorR(pa: string, folhas: ValoresPorMes, receitas: ValoresPorMes, inicioAtividade?: string): FatorR {
  const { regra, meses } = mesesDoFatorR(pa, inicioAtividade);
  if (regra === "inicio-dois-primeiros-meses") return { valor: LIMITE_FATOR_R, folha: 0, receita: 0, anexo: "III", regra, meses };
  // No mês de abertura (até 2026) são a FSPA e a RPA (§ 6º); ambos zero não está previsto e fica 0,01.
  const folha = soma(folhas, meses);
  const receita = soma(receitas, meses);
  const valor = razao(folha, receita);
  // Com folha e receita, compara em centavos inteiros: 28% exato não pode cair no Anexo V por ponto flutuante.
  const atinge = folha > 0 && receita > 0 ? Math.round(folha * 100) * 100 >= Math.round(receita * 100) * 28 : valor >= LIMITE_FATOR_R;
  return { valor, folha, receita, anexo: atinge ? "III" : "V", regra, meses };
}

// Casos de zero do § 7º: só folha -> 0,28; só receita ou nada -> 0,01; os dois -> divisão.
function razao(folha: number, receita: number): number {
  if (folha > 0 && receita > 0) return folha / receita;
  if (folha > 0) return LIMITE_FATOR_R;
  return 0.01;
}

// INSS descontado do sócio sobre o pró-labore (contribuinte individual, 11%), limitado ao teto quando informado.
export function inssProLabore(proLabore: number, teto?: number): number {
  if (!Number.isFinite(proLabore) || proLabore < 0) throw new Error("Pró-labore inválido.");
  const base = teto !== undefined ? Math.min(proLabore, teto) : proLabore;
  return centavos(base * 0.11);
}

// Teto do salário de contribuição do INSS por ano (portaria interministerial MPS/MF de janeiro de cada ano; 2026:
// Portaria Interministerial MPS/MF nº 13, de 9/1/2026). Acima dele, o INSS do sócio (11%) é cobrado no teto, tanto no
// eSocial quanto na DCTFWeb.
export const TETO_INSS: Readonly<Record<number, number>> = {
  2017: 5_531.31,
  2018: 5_645.8,
  2019: 5_839.45,
  2020: 6_101.06,
  2021: 6_433.57,
  2022: 7_087.22,
  2023: 7_507.49,
  2024: 7_786.02,
  2025: 8_157.41,
  2026: 8_475.55,
};

// Teto do mês ("AAAA-MM"). Ano ainda sem portaria na tabela: o último publicado (o teto só sobe, então o INSS esperado
// fica no máximo um pouco abaixo até a tabela ser atualizada); ano antes da tabela: o mais antigo.
export function tetoInss(mes: string): number {
  const ano = Number(mes.slice(0, 4));
  if (TETO_INSS[ano] !== undefined) return TETO_INSS[ano];
  const anos = Object.keys(TETO_INSS).map(Number).sort((a, b) => a - b);
  return TETO_INSS[ano > anos.at(-1)! ? anos.at(-1)! : anos[0]];
}

// INSS do sócio sobre o pró-labore do mês, no teto do ano.
export const inssProLaboreDoMes = (mes: string, proLabore: number) => inssProLabore(proLabore, tetoInss(mes));
