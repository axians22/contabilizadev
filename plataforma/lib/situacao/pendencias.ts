// Pendências do relatório de situação fiscal em linguagem simples (aba Situação fiscal e painel). O relatório da Receita
// (o mesmo do e-CAC) lista cada pendência com um cabeçalho ("Pendência - Débito (SIEF)", "Pendência - Omissão de DCTF",
// "Pendência - Inscrição (SIDA)"...) seguido das linhas de cada débito (código e nome do tributo, período de apuração,
// vencimento, valores). Aqui cada grupo vira um título curto e o que fazer, e cada débito de DAS ou de INSS do pró-labore
// vira { tributo, pa } para casar com as guias vencidas da plataforma (o botão de gerar a guia com juros).
// Função pura, sem banco: recebe o texto do diagnóstico guardado (situacoes_fiscais.pendencias).

export type TipoDePendencia = "debito" | "omissao" | "divida-ativa" | "parcelamento" | "processo" | "divergencia" | "outra";
export type TributoDaPendencia = "DAS" | "INSS" | "outro";

export type DebitoDaPendencia = {
  tributo: TributoDaPendencia;
  pa: string | null; // AAAA-MM
  vencimento: string | null; // AAAA-MM-DD
  saldo: number | null; // o último valor da linha (saldo devedor)
  linha: string; // a linha do relatório, como veio
};

export type PendenciaExplicada = {
  tipo: TipoDePendencia;
  titulo: string; // curto, para a tela
  oQueE: string; // linguagem simples (tooltip)
  oQueFazer: string; // (tooltip)
  cabecalho: string; // o cabeçalho do relatório, como veio
  debitos: DebitoDaPendencia[];
};

export const TIPOS_DE_PENDENCIA: Record<TipoDePendencia, { titulo: string; oQueE: string; oQueFazer: string }> = {
  debito: {
    titulo: "Imposto vencido sem pagamento",
    oQueE: "A Receita Federal tem um imposto que venceu e não foi pago (ou foi pago a menos).",
    oQueFazer: "Gere a guia nova com multa e juros para o dia em que vai pagar e pague até essa data. Se não der para pagar de uma vez, peça o parcelamento.",
  },
  omissao: {
    titulo: "Declaração em falta",
    oQueE: "Falta entregar uma declaração do período (por exemplo, o PGDAS-D do mês, a DCTFWeb ou a declaração anual).",
    oQueFazer: "Entregue a declaração do período. Depois, gere e pague a guia, se houver imposto.",
  },
  "divida-ativa": {
    titulo: "Dívida ativa na Procuradoria",
    oQueE: "Um débito não pago foi enviado à Procuradoria-Geral da Fazenda Nacional (dívida ativa). A guia já não sai pela Receita.",
    oQueFazer: "Regularize no portal Regularize da Procuradoria: pague ou parcele a inscrição.",
  },
  parcelamento: {
    titulo: "Parcelamento com parcela em atraso",
    oQueE: "Há um parcelamento com parcela vencida e não paga.",
    oQueFazer: "Emita e pague a parcela em atraso no Portal do Simples Nacional (parcelamento) ou no e-CAC.",
  },
  processo: {
    titulo: "Processo na Receita Federal",
    oQueE: "Há um processo aberto na Receita (por exemplo, uma cobrança ou uma intimação).",
    oQueFazer: "Veja as mensagens da Caixa Postal e o processo no e-CAC (Processos Digitais).",
  },
  divergencia: {
    titulo: "Valores que não batem",
    oQueE: "O que foi declarado não bate com o que foi pago (por exemplo, a declaração do INSS e as guias pagas).",
    oQueFazer: "Confira as declarações e os pagamentos do período e retifique o que estiver errado.",
  },
  outra: {
    titulo: "Outra pendência",
    oQueE: "A Receita Federal aponta uma pendência que não é de imposto em aberto nem de declaração em falta.",
    oQueFazer: "Abra o relatório em PDF para ver o detalhe e resolva no e-CAC.",
  },
};

const CABECALHO = /^pend[êe]ncia\s*[-–:]/i;

function tipoDoCabecalho(cabecalho: string): TipoDePendencia {
  const c = cabecalho.toLowerCase();
  if (/omiss/.test(c)) return "omissao";
  if (/inscri|d[íi]vida ativa|pgfn|sida/.test(c)) return "divida-ativa";
  if (/parcelamento|sipade|parcsn|parcela/.test(c)) return "parcelamento";
  if (/processo/.test(c)) return "processo";
  if (/diverg/.test(c)) return "divergencia";
  if (/d[ée]bito/.test(c)) return "debito";
  return "outra";
}

const DATA = /\b(\d{2})\/(\d{2})\/(\d{4})\b/g;
const PERIODO = /(?:^|[^\d/])(0[1-9]|1[0-2])\/(\d{4})\b/;
const VALOR = /\b\d{1,3}(?:\.\d{3})*,\d{2}\b/g;

function tributoDa(linha: string, cabecalho: string): TributoDaPendencia {
  // INSS do pró-labore: DARF 1099 ou 1082 (contribuição do segurado), "CP SEGURADOS", "PREVIDENCI…".
  if (/\b(1099|1082)\b|\bCP\b|segurad|previd|\binss\b/i.test(linha)) return "INSS";
  if (/simples|\bdas\b|pgdas/i.test(`${linha} ${cabecalho}`)) return "DAS";
  return "outro";
}

function lerDebito(linha: string, cabecalho: string): DebitoDaPendencia | null {
  const datas = [...linha.matchAll(DATA)];
  const semDatas = linha.replace(DATA, " ");
  const periodo = PERIODO.exec(semDatas);
  if (!periodo && datas.length === 0) return null;
  const valores = [...linha.matchAll(VALOR)].map((m) => Number(m[0].replace(/\./g, "").replace(",", ".")));
  const [d] = datas;
  return {
    tributo: tributoDa(linha, cabecalho),
    pa: periodo ? `${periodo[2]}-${periodo[1]}` : null,
    vencimento: d ? `${d[3]}-${d[2]}-${d[1]}` : null,
    saldo: valores.length ? valores[valores.length - 1] : null,
    linha,
  };
}

// Início de um débito no relatório: o código da receita ("1082-01 - CP-SEGURADOS") ou, nas tabelas sem código, o período
// sozinho na célula ("08/2026"). Fim: a situação em maiúsculas ("DEVEDOR", "A VENCER", "SUSPENSO"...) depois dos valores.
const CODIGO_DA_RECEITA = /^\d{4}-\d{2}\b/;
const SO_O_PERIODO = /^(0[1-9]|1[0-2])\/\d{4}$/;
const SO_A_SITUACAO = /^[A-ZÀ-Ý][A-ZÀ-Ý .\-/]*$/;
const TEM_VALOR_OU_DATA = /\d,\d{2}\b|\d{2}\/\d{2}\/\d{4}/;
const SITUACAO_NO_FIM = /\d,\d{2}\s+[A-ZÀ-Ý][A-ZÀ-Ý .\-/]*$/;

// O texto vem do PDF com uma célula por linha (cada Tj/TJ vira uma linha), mas pode vir também com o débito inteiro numa
// linha. Junta as células de cada débito (do código da receita, ou do período, até a situação) numa linha só; as linhas
// soltas (cabeçalhos das colunas, "Período 07/2026"...) seguem cada uma por si.
function juntarDebitos(linhas: string[]): string[] {
  const saida: string[] = [];
  let atual: string[] | null = null;
  const fechar = () => {
    if (atual) saida.push(atual.join(" "));
    atual = null;
  };
  for (const linha of linhas) {
    if (CODIGO_DA_RECEITA.test(linha)) {
      fechar();
      atual = [linha];
      if (SITUACAO_NO_FIM.test(linha)) fechar();
    } else if (atual) {
      // Um segundo período sem código começa outro débito (tabela sem a coluna da receita e sem a situação).
      if (SO_O_PERIODO.test(linha) && atual.some((c) => SO_O_PERIODO.test(c))) {
        fechar();
        atual = [linha];
        continue;
      }
      atual.push(linha);
      if (SO_A_SITUACAO.test(linha) && atual.some((c) => TEM_VALOR_OU_DATA.test(c))) fechar();
    } else if (SO_O_PERIODO.test(linha)) {
      atual = [linha];
    } else {
      saida.push(linha);
    }
  }
  fechar();
  return saida;
}

// Cabeçalho e rodapé de página que o PDF repete no meio das tabelas quando o relatório tem mais de uma página. O
// cabeçalho termina com "CNPJ:" e "<raiz do CNPJ> - <NOME DA EMPRESA>" (as duas numa linha ou cada uma na sua): sem
// descartá-las, o nome da empresa entraria no débito cortado pela quebra (e "SEGURADORA" ou "PREVIDÊNCIA" no nome
// fariam um DAS virar INSS).
const QUEBRA_DE_PAGINA =
  /^(P[áa]gina:|\d+$|MINIST[ÉE]RIO D|SECRETARIA ESPECIAL DA RECEITA|PROCURADORIA-GERAL DA FAZENDA NACIONAL$|Por meio d|Autor pedido:|INFORMA[ÇC][ÕO]ES DE APOIO|\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}(:\d{2})?$|CNPJ:(\s*\d{2}\.\d{3}\.\d{3}\b.*)?$|\d{2}\.\d{3}\.\d{3}(\/\d{4}-\d{2})?\s+[-–]\s)/i;

// Agrupa as linhas pelos cabeçalhos "Pendência - …". Linhas antes do primeiro cabeçalho (texto sem o formato esperado)
// entram numa pendência "outra", para nada se perder.
export function explicarPendencias(texto: string | null | undefined): PendenciaExplicada[] {
  const linhas = (texto ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !QUEBRA_DE_PAGINA.test(l));
  const grupos: { cabecalho: string; linhas: string[] }[] = [];
  for (const linha of linhas) {
    if (CABECALHO.test(linha)) grupos.push({ cabecalho: linha, linhas: [] });
    else if (grupos.length) grupos[grupos.length - 1].linhas.push(linha);
    else grupos.push({ cabecalho: linha, linhas: [] });
  }
  return grupos.map((g) => {
    const tipo = CABECALHO.test(g.cabecalho) ? tipoDoCabecalho(g.cabecalho) : "outra";
    const debitos =
      tipo === "debito" || tipo === "omissao"
        ? juntarDebitos(g.linhas).map((l) => lerDebito(l, g.cabecalho)).filter((d): d is DebitoDaPendencia => d !== null)
        : [];
    return { tipo, ...TIPOS_DE_PENDENCIA[tipo], cabecalho: g.cabecalho, debitos };
  });
}

// Os débitos de DAS e de INSS (com o mês) que uma guia vencida da plataforma resolve: { tributo, pa } sem repetição.
export function debitosComGuia(pendencias: PendenciaExplicada[]): { tributo: "DAS" | "INSS"; pa: string }[] {
  const vistos = new Set<string>();
  const lista: { tributo: "DAS" | "INSS"; pa: string }[] = [];
  for (const p of pendencias) {
    if (p.tipo !== "debito") continue;
    for (const d of p.debitos) {
      if (d.tributo === "outro" || !d.pa) continue;
      const chave = `${d.tributo}:${d.pa}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      lista.push({ tributo: d.tributo, pa: d.pa });
    }
  }
  return lista;
}

// Os meses do botão "Gerar novas guias" (como no ../fiscal, situacao-fiscal.tsx): os das guias vencidas que resolvem um
// débito da pendência; se o relatório não diz o mês de nenhum débito, todas as vencidas (o fiscal mostra todas).
export function mesesComGuiaVencida(pendencias: PendenciaExplicada[], vencidas: { tipo: string; pa: string }[]): string[] {
  const debitos = debitosComGuia(pendencias);
  const meses = debitos.length
    ? debitos.filter((d) => vencidas.some((g) => g.tipo === d.tributo && g.pa === d.pa)).map((d) => d.pa)
    : pendencias.length
      ? vencidas.map((g) => g.pa)
      : [];
  return [...new Set(meses)].sort();
}
