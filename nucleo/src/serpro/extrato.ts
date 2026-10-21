// Leitura do extrato do DAS (PDF do PGDAS-D, "Extrato do Simples Nacional"): período, receita, RBT12, Fator R, as
// atividades declaradas (com o código do catálogo, atividades-pgdasd.ts), o débito, o DAS e o pagamento, e as receitas
// e folhas dos meses anteriores que a Receita usou na apuração (itens 2.2 e 2.3: a base da RBT12 e do Fator R do mês).
// O texto vem de textoDoPdf (pdf.ts). Conferido com o extrato real de 09/2026 da empresa de referência (../fiscal) e com o
// exemplo oficial da documentação (Integra SN, "retorno consultar extrato do DAS"), em que o gerador do PDF quebra o
// texto em pedaços: por isso a leitura procura os rótulos e os números em sequência, não linhas exatas.
// O que não der para ler fica null; o PDF continua guardado para o cliente abrir.
import { ATIVIDADES_PGDASD } from "./atividades-pgdasd.ts";

export type AtividadeDeclarada = {
  idAtividade: number | null; // null = descrição que não bate com o catálogo
  descricao: string;
  receita: number | null;
  valor: number | null; // débito da atividade (total dos tributos)
};

export type Extrato = {
  pa: string | null; // "AAAA-MM"
  apuracao: "original" | "retificadora" | null;
  numeroApuracao: string | null; // número da declaração (17 dígitos)
  receita: number | null; // receita bruta do PA (total)
  receitaExterna: number | null;
  rbt12: number | null;
  fatorR: number | null; // null = "Não se aplica"
  atividades: AtividadeDeclarada[];
  totalDebito: number | null; // total do débito declarado da empresa
  das: { numero: string | null; vencimento: string | null; total: number | null } | null;
  pagamento: { data: string; valor: number | null } | null;
  // 2.2) Receitas Brutas Anteriores, mês a mês (o extrato traz de janeiro do ano anterior até o mês anterior ao PA).
  receitasAnteriores: { mes: string; interno: number; externo: number }[];
  // 2.3) Folha de Salários Anteriores ("Nenhuma" quando a atividade não usa o Fator R).
  folhasAnteriores: { mes: string; valor: number }[];
};

const NUMERO = /^-?\d{1,3}(?:\.\d{3})*,\d{2}$|^-?\d+,\d{2}$/;
export const numeroBr = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const dataIso = (dd: string, mm: string, aaaa: string) => `${aaaa}-${mm}-${dd}`;

// Sem acento, minúsculas, sem aspas e pontuação, espaços simples: para comparar descrições.
export const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/["“”'`]/g, "")
    .replace(/[^a-z0-9/]+/g, " ")
    .trim();

// Os números (formato brasileiro) de um trecho, na ordem.
function numeros(trecho: string): number[] {
  return trecho
    .split(/\n|\s{2,}/)
    .map((l) => l.trim())
    .filter((l) => NUMERO.test(l))
    .map(numeroBr);
}

// O trecho entre um rótulo e o próximo (ou o fim).
function entre(texto: string, de: RegExp, ate?: RegExp): string | null {
  const i = texto.search(de);
  if (i < 0) return null;
  const resto = texto.slice(i).replace(de, "");
  const j = ate ? resto.search(ate) : -1;
  return j >= 0 ? resto.slice(0, j) : resto;
}

// Código do catálogo para a descrição do extrato ("Prestação de Serviços para o exterior - Não sujeitos ao fator r e
// tributados pelo Anexo III" = 30). Primeiro a descrição exata do catálogo; se o PDF trouxer o texto em pedaços (ou só
// parte dele), pelas marcas que separam as atividades de serviço: exterior ou não, sujeita ao fator r, Anexo III ou IV
// e onde o ISS é devido. Sem certeza, null (a conferência não acusa o que não leu).
export function identificarAtividade(descricao: string): number | null {
  const d = normalizar(descricao);
  if (!d) return null;
  const exata = ATIVIDADES_PGDASD.find((a) => normalizar(`${a.grupo} ${a.descricao}`) === d || (a.grupo === a.descricao && normalizar(a.grupo) === d));
  if (exata) return exata.id;
  if (!/prestacao de servicos/.test(d) || /subitens|construcao|transporte|comunicacao|contabe/.test(d)) return null;
  const exterior = /para o exterior/.test(d) && !/exceto para o exterior/.test(d);
  const tipo = /nao sujeitos ao fator r/.test(d) || (/\b(anexo )?iii\b/.test(d) && !/sujeitos ao fator r/.test(d))
    ? "iii"
    : /sujeitos ao fator r/.test(d)
      ? "fator-r"
      : /\b(anexo )?iv\b/.test(d)
        ? "iv"
        : null;
  if (!tipo) return null;
  const base = { "fator-r": exterior ? 29 : 10, iii: exterior ? 30 : 13, iv: exterior ? 31 : 16 }[tipo];
  if (exterior) return base;
  const iss = /com retencao/.test(d) ? 2 : /proprio municipio/.test(d) ? 1 : /outros? s? municipio/.test(d) ? 0 : null;
  return iss === null ? null : base + iss;
}

function lerAtividades(texto: string): AtividadeDeclarada[] {
  const partes = texto.split(/Valor do D[ée]bito por Tributo para a Atividade \(R\$\):/i).slice(1);
  return partes.map((parte) => {
    const fim = parte.search(/Receita Bruta Informada/i);
    const descricao = (fim >= 0 ? parte.slice(0, fim) : parte.split("\n").slice(0, 3).join(" "))
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+-\s+/g, " - ")
      .replace(/\s+/g, " ")
      .trim();
    const receita = /Receita Bruta Informada:\s*R\$\s*([\d.,]+)/i.exec(parte);
    const depois = fim >= 0 ? parte.slice(fim).replace(/Receita Bruta Informada:\s*R\$\s*[\d.,]+/i, "") : "";
    // IRPJ, CSLL, COFINS, PIS/Pasep, INSS/CPP, ICMS, IPI, ISS e o total, nessa ordem.
    const valores = numeros(depois).slice(0, 9);
    return {
      idAtividade: identificarAtividade(descricao),
      descricao,
      receita: receita && NUMERO.test(receita[1]) ? numeroBr(receita[1]) : null,
      valor: valores.length === 9 ? valores[8] : null,
    };
  });
}

// Pares "MM/AAAA" seguidos do valor (formato dos itens 2.2 e 2.3), em ordem.
function valoresPorMes(trecho: string | null): { mes: string; valor: number }[] {
  if (!trecho) return [];
  const linhas = trecho.split(/\n|\s{2,}/).map((l) => l.trim()).filter(Boolean);
  const lista: { mes: string; valor: number }[] = [];
  for (let i = 0; i < linhas.length - 1; i++) {
    const mes = /^(\d{2})\/(\d{4})$/.exec(linhas[i]);
    if (mes && NUMERO.test(linhas[i + 1])) {
      lista.push({ mes: `${mes[2]}-${mes[1]}`, valor: numeroBr(linhas[i + 1]) });
      i++;
    }
  }
  return lista;
}

function lerReceitasAnteriores(texto: string): Extrato["receitasAnteriores"] {
  const interno = valoresPorMes(entre(texto, /2\.2\.1\)\s*Mercado Interno/i, /2\.2\.2\)/i));
  const externo = valoresPorMes(entre(texto, /2\.2\.2\)\s*Mercado Externo/i, /2\.3\)|2\.4\)/i));
  const meses = [...new Set([...interno, ...externo].map((v) => v.mes))].sort();
  return meses.map((mes) => ({
    mes,
    interno: interno.find((v) => v.mes === mes)?.valor ?? 0,
    externo: externo.find((v) => v.mes === mes)?.valor ?? 0,
  }));
}

export function lerExtrato(texto: string): Extrato {
  const pa = /Per[íi]odo de Apura[çc][ãa]o \(PA\):\s*(\d{2})\/(\d{4})/i.exec(texto);
  const apuracao = /Apura[çc][ãa]o\s+(Original|Retificadora)/i.exec(texto);
  const numeroApuracao = (entre(texto, /Informa[çc][õo]es da Apura[çc][ãa]o/i, /Per[íi]odo de Apura[çc][ãa]o/i) ?? "").replace(/\D/g, "");
  const rpa = numeros(entre(texto, /Receita Bruta do PA \(RPA\)/i, /Receita bruta acumulada/i) ?? "");
  const rbt12 = numeros(entre(texto, /\(RBT12\)/i, /RBT12p|Receita bruta acumulada no ano/i) ?? "");
  const fator = /Fator r\s*=\s*(\d+(?:,\d+)?)/i.exec(texto);
  const geral = numeros(entre(texto, /Total Geral da Empresa/i, /Exigibilidade Suspensa/i) ?? "");
  const secaoDas = entre(texto, /Informa[çc][õo]es sobre DAS Gerado/i, /Informa[çc][õo]es da Arrecada[çc][ãa]o|Discrimina[çc][ãa]o dos Valores/i);
  const numeroDas = secaoDas ? /N[úu]mero:\s*(\d{17})/i.exec(secaoDas)?.[1] ?? null : null;
  const vencimento = secaoDas ? /Data de Vencimento:\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(secaoDas) : null;
  const totalDas = secaoDas ? /\bTotal\s*\n\s*([\d.]+,\d{2})/i.exec(secaoDas) : null;
  const arrecadacao = entre(texto, /Informa[çc][õo]es da Arrecada[çc][ãa]o do DAS/i);
  const pago = arrecadacao ? /Valor Pago\s*\n\s*(\d{2})\/(\d{2})\/(\d{4})(?:\s*\n\s*[^\n]*)?\s*\n\s*([\d.]+,\d{2})/i.exec(arrecadacao) : null;
  return {
    pa: pa ? `${pa[2]}-${pa[1]}` : null,
    apuracao: apuracao ? (apuracao[1].toLowerCase() as "original" | "retificadora") : null,
    numeroApuracao: numeroApuracao.length === 17 ? numeroApuracao : null,
    receita: rpa.length >= 3 ? rpa[2] : null,
    receitaExterna: rpa.length >= 3 ? rpa[1] : null,
    rbt12: rbt12.length >= 3 ? rbt12[2] : null,
    fatorR: fator ? numeroBr(fator[1].includes(",") ? fator[1] : `${fator[1]},00`) : null,
    atividades: lerAtividades(texto),
    totalDebito: geral.length >= 9 ? geral[8] : null,
    das: secaoDas ? { numero: numeroDas, vencimento: vencimento ? dataIso(vencimento[1], vencimento[2], vencimento[3]) : null, total: totalDas ? numeroBr(totalDas[1]) : null } : null,
    pagamento: pago ? { data: dataIso(pago[1], pago[2], pago[3]), valor: numeroBr(pago[4]) } : null,
    receitasAnteriores: lerReceitasAnteriores(texto),
    folhasAnteriores: valoresPorMes(entre(texto, /2\.3\)\s*Folha de Sal[áa]rios Anteriores(?: \(R\$\))?/i, /2\.4\)/i)),
  };
}
