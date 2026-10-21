// Só para testes: respostas gravadas do histórico (PGDAS-D, pagamentos, DEFIS e situação fiscal), sem dado de
// terceiros. O extrato reproduz linha a linha o texto do extrato real de 09/2026 da empresa de referência (../fiscal),
// com o CNPJ, o nome e o município trocados por fictícios (11.222.333/0001-81, EMPRESA DE TESTE LTDA); a lista de
// declarações segue o formato do exemplo oficial (CONSDECLARACAO13), com números fictícios.
import type { Resposta } from "./cliente.ts";
import { pdfComTexto } from "./dctf-exemplo.ts";

export const CNPJ_EXEMPLO = "11222333000181";

export type OpcoesExtrato = {
  pa: string; // "AAAA-MM"
  receita: number;
  rbt12?: number;
  atividade?: string; // descrição como no extrato
  fatorR?: number | null; // null = "Não se aplica"
  tributos?: { irpj: number; csll: number; cpp: number }; // padrão: os de 09/2026
  numeroDas?: string;
  retificadora?: boolean;
  pago?: { data: string; valor: number } | null; // data "DD/MM/AAAA"
  anteriores?: Record<string, number>; // item 2.2: receita de exportação dos meses anteriores ("AAAA-MM" -> valor)
  folhas?: Record<string, number>; // item 2.3: folha de salários dos meses anteriores
};

const mesBr = (mes: string) => `${mes.slice(5, 7)}/${mes.slice(0, 4)}`;

export const ATIVIDADE_30 = "Prestação de Serviços para o exterior - Não sujeitos ao fator r e tributados pelo Anexo III";
export const ATIVIDADE_29 = "Prestação de Serviços para o exterior - Sujeitos ao fator r";

const br = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tabela = (t: { irpj: number; csll: number; cpp: number }) => {
  const total = Math.round((t.irpj + t.csll + t.cpp) * 100) / 100;
  return ["IRPJ", "CSLL", "COFINS", "PIS/Pasep", "INSS/CPP", "ICMS", "IPI", "ISS", "Total", br(t.irpj), br(t.csll), "0,00", "0,00", br(t.cpp), "0,00", "0,00", "0,00", br(total)];
};

// Texto do extrato, como o textoDoPdf devolve (uma linha por trecho).
export function linhasDoExtrato(o: OpcoesExtrato): string[] {
  const [ano, mes] = o.pa.split("-");
  const t = o.tributos ?? { irpj: 78.65, csll: 68.81, cpp: 853.3 };
  const total = Math.round((t.irpj + t.csll + t.cpp) * 100) / 100;
  const numeroDas = o.numeroDas ?? `0720${ano.slice(2)}${mes}00000000001`.slice(0, 17).padEnd(17, "0");
  const numeroApuracao = `11222333${ano}${mes}${o.retificadora ? "002" : "001"}`;
  const fator = o.fatorR === undefined || o.fatorR === null ? "Não se aplica" : br(o.fatorR);
  const pago = o.pago === undefined ? { data: `13/${String(Number(mes) % 12 + 1).padStart(2, "0")}/${Number(mes) === 12 ? Number(ano) + 1 : ano}`, valor: total } : o.pago;
  return [
    "Extrato do Simples Nacional",
    "Gerado em 14/10/2026 20:20:59",
    "Apurado em 05/10/2026 13:35:43",
    o.retificadora ? "Apuração Retificadora" : "Apuração Original",
    "PGDAS-D 2018 Versão 2.2.30",
    "1) Informações do Contribuinte",
    "CNPJ Básico: 11.222.333",
    "Nome Empresarial: EMPRESA DE TESTE LTDA",
    "Data de Abertura: 11/08/2021",
    "Regime de Apuração: Competência",
    "Optante pelo Simples Nacional: Sim",
    `2) Informações da Apuração ${numeroApuracao}`,
    `Período de Apuração (PA): ${mes}/${ano}`,
    "2.1 Discriminativo de Receitas",
    "Total de Receitas Brutas (R$)",
    "Mercado Interno",
    "Mercado Externo",
    "Total",
    "Receita Bruta do PA (RPA) - Competência",
    "0,00",
    br(o.receita),
    br(o.receita),
    "Receita bruta acumulada nos doze meses anteriores ao PA",
    "(RBT12)",
    "0,00",
    br(o.rbt12 ?? 352_998.85),
    br(o.rbt12 ?? 352_998.85),
    "Receita bruta acumulada nos doze meses anteriores ao PA",
    "proporcionalizada (RBT12p)",
    "Receita bruta acumulada no ano-calendário corrente (RBA)",
    "0,00",
    "279.540,47",
    "279.540,47",
    ...(o.anteriores
      ? [
          "2.2) Receitas Brutas Anteriores (R$)",
          "2.2.1) Mercado Interno",
          ...Object.keys(o.anteriores).sort().flatMap((m) => [mesBr(m), "0,00"]),
          "2.2.2) Mercado Externo",
          ...Object.keys(o.anteriores).sort().flatMap((m) => [mesBr(m), br(o.anteriores![m])]),
        ]
      : []),
    "2.3) Folha de Salários Anteriores (R$)",
    ...(o.folhas
      ? Object.keys(o.folhas).sort().flatMap((m) => [mesBr(m), br(o.folhas![m])])
      : [o.fatorR === undefined || o.fatorR === null ? "Nenhuma" : "10/2025"]),
    "2.4) Fator r",
    `Fator r = ${fator}`,
    "2.5) Valores Fixos",
    "Não se aplica",
    "3) Informações dos Estabelecimentos - valores referentes às Receitas Informadas",
    "CNPJ Estabelecimento: 11.222.333/0001-81",
    "Município: CIDADE DE TESTE",
    "UF: GO",
    "Página 1",
    "Sublimite de Receita Anual (R$): 3.600.000,00",
    "Impedido de recolher ICMS/ISS no DAS: Não",
    "Valor do Débito por Tributo para a Atividade (R$):",
    o.atividade ?? ATIVIDADE_30,
    `Receita Bruta Informada: R$ ${br(o.receita)}`,
    ...tabela(t),
    `Parcela 1: R$ ${br(o.receita)}`,
    "Informações por Estabelecimento",
    `Valor Informado: ${br(o.receita)}`,
    "Total do Débito Declarado (exigível + suspenso)",
    ...tabela(t),
    "4) Total Geral da Empresa",
    "Total do Débito Declarado (exigível + suspenso) (R$)",
    ...tabela(t),
    "Total do Débito com Exigibilidade Suspensa (R$)",
    ...tabela({ irpj: 0, csll: 0, cpp: 0 }),
    "5) Este item não se aplica à primeira apuração do PA:",
    `6) Informações sobre DAS Gerado na apuração: ${numeroApuracao}`,
    `Número: ${numeroDas}`,
    "Data de Vencimento:",
    `20/${String(Number(mes) % 12 + 1).padStart(2, "0")}/${Number(mes) === 12 ? Number(ano) + 1 : ano}`,
    "Principal",
    br(total),
    "Multa",
    "0,00",
    "Juros",
    "0,00",
    "Total",
    br(total),
    "6.1) Discriminação dos Valores Calculados no DAS Gerado",
    "6.2) Informações da Arrecadação do DAS gerado nesta apuração",
    "Página 2",
    ...(pago ? ["Data de Pagamento", "Banco/Agência de Arrecadação", "Valor Pago", pago.data, "001/0001", br(pago.valor)] : ["Não há arrecadação para este DAS"]),
    "Página 3",
  ];
}

// O PDF (base64) com esse texto, no formato que o textoDoPdf lê.
export function pdfDoExtrato(o: OpcoesExtrato): string {
  return pdfComTexto(...linhasDoExtrato(o).map((l) => l.replace(/([()\\])/g, "\\$1"))).toString("base64");
}

export const respostaExtrato = (numeroDas: string, o: OpcoesExtrato): Resposta => ({
  status: 200,
  dados: { numeroDas, extrato: { nomeArquivo: `PGDASD-EXTRATO-${numeroDas}.pdf`, pdf: pdfDoExtrato({ ...o, numeroDas }) } },
  mensagens: [{ codigo: "Sucesso-PGDASD", texto: "Requisição efetuada com sucesso." }],
});

// Declaração do PGDAS-D (CONSDECREC15) de um mês sem DAS: o mesmo modelo do extrato (apuração, atividades, débito
// declarado), sem as partes do DAS e da arrecadação. Sem tributos = mês sem valor a pagar.
export function pdfDaDeclaracao(o: OpcoesExtrato): string {
  const linhas = linhasDoExtrato(o);
  const fim = linhas.findIndex((l) => l.startsWith("5) "));
  const declaracao = ["Declaração do Simples Nacional", ...linhas.slice(1, fim)];
  return pdfComTexto(...declaracao.map((l) => l.replace(/([()\\])/g, "\\$1"))).toString("base64");
}

export const respostaDeclaracaoRecibo = (numeroDeclaracao: string, o: OpcoesExtrato): Resposta => ({
  status: 200,
  dados: {
    numeroDeclaracao,
    recibo: { nomeArquivo: `PGDASD-RECIBO-${numeroDeclaracao}.pdf`, pdf: pdfComTexto("Recibo de Entrega da Apuração do Simples Nacional").toString("base64") },
    declaracao: { nomeArquivo: `PGDASD-DECLARACAO-${numeroDeclaracao}.pdf`, pdf: pdfDaDeclaracao(o) },
  },
  mensagens: [{ codigo: "Sucesso-PGDASD", texto: "Requisição efetuada com sucesso." }],
});

export type PeriodoExemplo = {
  pa: string; // "AAAA-MM"
  declaracoes?: { numero: string; quando: string; retificadora?: boolean }[]; // quando = AAAAMMDDHHMMSS
  das?: { numero: string; quando: string; pago?: boolean }[];
};

// Resposta do CONSDECLARACAO13 no formato oficial (dados já lidos pelo cliente do núcleo).
export function respostaDeclaracoes(ano: number, periodos: PeriodoExemplo[]): Resposta {
  return {
    status: 200,
    dados: {
      anoCalendario: ano,
      periodos: periodos.map((p) => ({
        periodoApuracao: Number(p.pa.replace("-", "")),
        operacoes: [
          ...(p.declaracoes ?? []).map((d) => ({
            tipoOperacao: d.retificadora ? "Retificadora" : "Original",
            indiceDeclaracao: { numeroDeclaracao: d.numero, dataHoraTransmissao: d.quando, malha: "" },
            indiceDas: null,
          })),
          ...(p.das ?? []).map((d) => ({
            tipoOperacao: "Geração de DAS",
            indiceDeclaracao: null,
            indiceDas: { numeroDas: d.numero, datahoraEmissaoDas: d.quando, dasPago: d.pago ?? false },
          })),
        ],
      })),
      mensagens: null,
    },
    mensagens: [{ codigo: "Sucesso-PGDASD", texto: "Requisição efetuada com sucesso." }],
  };
}

// Pagamentos (PAGTOWEB) no formato lido por pagamentos.ts.
export const respostaPagamentos = (documentos: { numero: string; pa: string; data: string; valor: number }[]): Resposta => ({
  status: 200,
  dados: documentos.map((d) => ({
    numeroDocumento: d.numero,
    tipo: { codigo: 9, descricao: "DAS - Documento de Arrecadação do Simples Nacional" },
    periodoApuracao: `${d.pa}-01`,
    dataArrecadacao: `${d.data}T00:00:00`,
    valorPrincipal: d.valor,
    valorTotal: d.valor,
  })),
  mensagens: [],
});

export const respostaDefis = (pdf: string | null): Resposta =>
  pdf ? { status: 200, dados: [{ idDefis: "00000000202500001", declaracao: pdf, recibo: pdf }], mensagens: [] } : { status: 404, dados: null, mensagens: [] };

// Situação fiscal: protocolo e relatório (o PDF com o diagnóstico).
export const respostaProtocolo: Resposta = { status: 200, dados: { protocoloRelatorio: "PROTOCOLO-TESTE", tempoEspera: 1000 }, mensagens: [] };
// Cada item vira um Tj (uma linha do texto), como no PDF real; as tabelas de débito vêm com uma célula por item.
export function respostaRelatorio(pendencias: string[] = []): Resposta {
  const linhas = pendencias.length ? pendencias : ["Não foram detectadas pendências/exigibilidades suspensas nos controles da Receita Federal e da Procuradoria-Geral da Fazenda Nacional."];
  const escapadas = ["Diagnóstico Fiscal", ...linhas, "Final do Relatório"].map((l) => l.replace(/([()\\])/g, "\\$1"));
  return { status: 200, dados: { pdf: pdfComTexto(...escapadas).toString("base64") }, mensagens: [{ codigo: "OK", texto: "Relatório emitido" }] };
}
