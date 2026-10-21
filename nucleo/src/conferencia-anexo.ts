// Conferência do CNAE com a atividade declarada no PGDAS-D (Parte 5, passo 17): para cada mês importado, a atividade
// do extrato (código do catálogo, serpro/atividades-pgdasd.ts) tem de ser a que o diagnóstico da empresa manda usar.
// O MVP atende só receita de exportação de serviço de TI, então o certo é a atividade de exportação do CNAE
// (cnae.ts, idAtividadeExportacao): 29 (sujeita ao Fator R: 6201 a 6204) ou 30 (Anexo III fixo: 6209, 6311, 6319).
// Quem tem os dois tipos de CNAE pode usar as duas. Duas coisas são conferidas:
// - o mercado: receita lançada como serviço no Brasil (10 a 15, 16 a 18...) paga ISS, PIS e COFINS, que a exportação não paga;
// - a regra: 6201 declarado como 30 paga sempre o Anexo III, mesmo com o Fator R abaixo de 28% (o certo seria o Anexo V);
//   6209 declarado como 29 paga o Anexo V quando o Fator R fica abaixo de 28%; outra atividade (Anexo IV, comércio...)
//   tributa o mês por outro anexo ou, no mesmo Anexo III (contábil, construção, transporte), por outra regra de cálculo.
// O que fazer: retificar a declaração do mês no portal (a plataforma não retifica).
// Função pura: recebe as atividades lidas do extrato e o diagnóstico; devolve a divergência com os textos da tela.
import { idAtividadeExportacao, regraDoCnae } from "./cnae.ts";
import { atividadePgdasd, ATIVIDADES_PGDASD } from "./serpro/atividades-pgdasd.ts";
import type { Diagnostico } from "./diagnostico.ts";
import { rotuloMes } from "./meses.ts";

export type Regra = "fator-r" | "anexo-iii";

// Atividades de serviço por regra, na ordem do catálogo: [outro município, próprio município, retenção] e a do exterior.
const GRUPOS: Record<Regra, { interno: number[]; exterior: number }> = {
  "fator-r": { interno: [10, 11, 12], exterior: 29 },
  "anexo-iii": { interno: [13, 14, 15], exterior: 30 },
};

export function regraDaAtividade(id: number): Regra | "outra" {
  for (const [regra, g] of Object.entries(GRUPOS) as [Regra, (typeof GRUPOS)[Regra]][]) if (g.exterior === id || g.interno.includes(id)) return regra;
  return "outra";
}

// Natureza das atividades fora das regras 29/30 (LC 123/2006, art. 18): o anexo e o que muda no cálculo. Serve para o
// tooltip dizer a diferença real; quando o anexo é o mesmo da empresa (III), o que muda é a regra própria da atividade.
// Mercadoria (1 a 3, 4 a 6) não tem regra própria (regraPropria: null): paga ICMS no mercado interno. A atividade com IPI e ISS ao mesmo tempo (40 a 43) não é
// venda de mercadoria: a receita paga ISS, então é serviço da lista da LC 116/2003 (ex.: industrialização por encomenda),
// com regra própria: LC 123/2006, art. 18, § 4º, VI ("atividade com incidência simultânea de IPI e de ISS, que serão
// tributadas na forma do Anexo II desta Lei Complementar, deduzida a parcela correspondente ao ICMS e acrescida a parcela
// correspondente ao ISS prevista no Anexo III desta Lei Complementar") e Resolução CGSN 140/2018, art. 25, § 1º, VII
// (mesmo texto: "tributada na forma prevista no Anexo II, deduzida a parcela correspondente ao ICMS e acrescida a
// parcela correspondente ao ISS prevista no Anexo III").
type Natureza = {
  anexo: "I" | "II" | "III" | "IV";
  tipo: "mercadoria" | "servico" | "industrializacao-servico";
  nome: string;
  regraPropria: string | null;
};
const NATUREZAS: { ids: number[]; natureza: Natureza }[] = [
  { ids: [1, 2, 3], natureza: { anexo: "I", tipo: "mercadoria", nome: "revenda de mercadorias", regraPropria: null } },
  { ids: [4, 5, 6], natureza: { anexo: "II", tipo: "mercadoria", nome: "venda de mercadorias industrializadas", regraPropria: null } },
  { ids: [40, 41, 42, 43], natureza: { anexo: "II", tipo: "industrializacao-servico", nome: "industrialização com IPI e ISS ao mesmo tempo", regraPropria: "com o ISS no lugar do ICMS" } },
  { ids: [7, 8], natureza: { anexo: "III", tipo: "servico", nome: "locação de bens móveis", regraPropria: "calculada sem a parte do ISS" } },
  { ids: [9, 28], natureza: { anexo: "III", tipo: "servico", nome: "escritório de serviços contábeis", regraPropria: "com o ISS pago à parte, em valor fixo na guia do município" } },
  { ids: [16, 17, 18, 31], natureza: { anexo: "IV", tipo: "servico", nome: "serviço do Anexo IV", regraPropria: "com a contribuição previdenciária patronal paga fora do DAS" } },
  { ids: [19, 20, 21, 32], natureza: { anexo: "III", tipo: "servico", nome: "construção civil", regraPropria: "com as regras de ISS da construção civil" } },
  { ids: [22, 23, 24, 33], natureza: { anexo: "IV", tipo: "servico", nome: "construção civil", regraPropria: "com a contribuição previdenciária patronal paga fora do DAS" } },
  { ids: [25, 26, 27], natureza: { anexo: "III", tipo: "servico", nome: "transporte coletivo municipal de passageiros", regraPropria: "com regras próprias de ISS do transporte municipal" } },
  { ids: [34, 35, 36, 37, 38, 39], natureza: { anexo: "III", tipo: "servico", nome: "comunicação ou transporte intermunicipal", regraPropria: "com ICMS no lugar do ISS" } },
];
export function naturezaDaAtividade(id: number): Natureza | null {
  return NATUREZAS.find((n) => n.ids.includes(id))?.natureza ?? null;
}

// Anexo em que a atividade foi tributada: pelo Fator R do mês (28% ou mais = Anexo III), Anexo III fixo ou o da natureza.
export function anexoDaAtividadePgdasd(id: number, fatorR: number | null = null): "I" | "II" | "III" | "IV" | "V" | "III ou V" | null {
  const a = ATIVIDADES_PGDASD.find((x) => x.id === id);
  if (!a) return null;
  if (a.fatorR) return fatorR === null ? "III ou V" : fatorR >= 0.28 ? "III" : "V";
  if (regraDaAtividade(id) === "anexo-iii") return "III";
  return naturezaDaAtividade(id)?.anexo ?? null;
}

// Nome curto para a tela ("serviço para o exterior, Anexo III fixo").
export function nomeCurtoDaAtividade(id: number): string {
  const a = atividadePgdasd(id);
  const onde = ehExportacao(id) ? "serviço para o exterior" : "serviço no Brasil";
  const regra = regraDaAtividade(id);
  if (regra === "fator-r") return `${onde}, Anexo III ou V pelo Fator R`;
  if (regra === "anexo-iii") return `${onde}, Anexo III fixo`;
  return a.descricao.length > 60 ? `${a.grupo}` : `${a.grupo}: ${a.descricao}`;
}

export type Divergencia = {
  pa: string; // "AAAA-MM"
  declarada: number;
  esperada: number;
  titulo: string; // uma linha, para a tabela e o sino
  texto: string; // "Em 09/2026 a declaração usou X; pelo seu CNAE seria Y."
  explicacao: string[]; // para o tooltip: por que importa e o que fazer
};

const mmAaaa = (pa: string) => `${pa.slice(5, 7)}/${pa.slice(0, 4)}`;

// Atividade de serviço para o exterior? (29, 30, 31, 28...; "exceto para o exterior" é o mercado interno.)
export function ehExportacao(id: number): boolean {
  const a = ATIVIDADES_PGDASD.find((x) => x.id === id);
  return !!a && /para o exterior/i.test(a.grupo) && !/exceto/i.test(a.grupo);
}

// Atividades de exportação que o diagnóstico manda usar (29 e/ou 30), pela tabela de CNAEs (cnae.ts).
export function atividadesEsperadas(d: Pick<Diagnostico, "atividades" | "anexo">): number[] {
  if (!d.anexo) return [];
  const ids = new Set<number>();
  for (const a of d.atividades) {
    if (a.tributacao === "nao-atendido") continue;
    const regra = regraDoCnae(a.cnae);
    // O diagnóstico é a fonte; a tabela de CNAEs dá o código. Se divergirem (CNAE fora da tabela), vale a tributação.
    ids.add(regra.tributacao === a.tributacao ? idAtividadeExportacao(regra) : a.tributacao === "fator-r" ? GRUPOS["fator-r"].exterior : GRUPOS["anexo-iii"].exterior);
  }
  return [...ids];
}

// Por que a atividade declarada muda o imposto, pelo que foi declarado (mercado e anexo) e pelo que seria o certo.
function explicarDiferenca(declarada: number, esperada: number): string[] {
  const textos: string[] = [];
  const natureza = naturezaDaAtividade(declarada);
  if (natureza?.tipo === "mercadoria") {
    textos.push(
      `Essa atividade é de ${natureza.nome}, não de prestação de serviço: a receita foi lançada como venda de mercadoria (Anexo ${natureza.anexo}${ehExportacao(declarada) ? "" : ", com ICMS"}), e a empresa presta serviço para o exterior, que não paga ISS, PIS nem COFINS. O valor do imposto sai diferente do devido (e a nota fiscal de exportação não bate com a declaração).`,
    );
    return textos;
  }
  if (!ehExportacao(declarada)) {
    textos.push(
      `A receita foi lançada no mercado interno, ${natureza ? `como ${natureza.nome} no Brasil` : "como se o serviço fosse prestado no Brasil"}. Serviço exportado não paga ISS, PIS nem COFINS no Simples Nacional; lançado no mercado interno, o mês pagou esses tributos a mais (e a nota fiscal de exportação não bate com a declaração).`,
    );
  }
  const regraDeclarada = regraDaAtividade(declarada);
  const regraCerta = regraDaAtividade(esperada);
  if (regraDeclarada === regraCerta) return textos;
  if (regraDeclarada === "anexo-iii") {
    textos.push(
      "Com essa atividade o mês foi tributado sempre pelo Anexo III, mesmo quando o Fator R fica abaixo de 28% (aí o certo é o Anexo V, com imposto maior): isso pode gerar cobrança da diferença com multa e juros.",
    );
  } else if (regraDeclarada === "fator-r") {
    textos.push(
      "Com essa atividade o mês vai para o Anexo V quando o Fator R fica abaixo de 28%, e a empresa paga mais imposto do que deve: a atividade da empresa é sempre do Anexo III.",
    );
  } else if (natureza?.tipo === "industrializacao-servico") {
    // Regra própria (art. 18, § 4º, VI): Anexo II sem o ICMS e com o ISS do Anexo III. Não é venda de mercadoria.
    const certo = regraCerta === "fator-r" ? "o Anexo III ou o V, conforme o Fator R" : "o Anexo III";
    textos.push(
      `Essa atividade é de ${natureza.nome}, tributada pelo Anexo ${natureza.anexo}, ${natureza.regraPropria}. Não é a atividade da empresa (o certo é ${certo}): o valor do imposto sai diferente do devido.`,
    );
  } else if (natureza) {
    const daAtividade = `Essa atividade é de ${natureza.nome}${natureza.regraPropria ? `, ${natureza.regraPropria}` : ""}`;
    if (natureza.anexo === "III" && regraCerta === "anexo-iii") {
      // Mesmo anexo da empresa: a diferença é a natureza e a regra própria da atividade, não o anexo.
      textos.push(`${daAtividade}. É do mesmo Anexo III da empresa, mas não é a atividade que ela exerce: o cálculo segue outra regra e o valor do imposto pode sair diferente do devido.`);
    } else if (natureza.anexo === "III") {
      textos.push(
        `${daAtividade}, tributada sempre pelo Anexo III, sem o Fator R: quando o Fator R fica abaixo de 28% o certo é o Anexo V, com imposto maior, e isso pode gerar cobrança da diferença com multa e juros.`,
      );
    } else {
      const certo = regraCerta === "fator-r" ? "o Anexo III ou o V, conforme o Fator R" : "o Anexo III";
      textos.push(`${daAtividade}. Com ela o mês foi tributado pelo Anexo ${natureza.anexo}, que não é o das atividades da empresa (o certo é ${certo}): o valor do imposto sai diferente do devido.`);
    }
  }
  return textos;
}

// Confere as atividades declaradas no mês com o diagnóstico. Atividade não identificada no extrato não é acusada.
export function conferirAtividades(pa: string, declaradas: (number | null)[], diagnostico: Pick<Diagnostico, "atividades" | "anexo">): Divergencia | null {
  const esperadas = atividadesEsperadas(diagnostico);
  if (esperadas.length === 0) return null;
  const principal = diagnostico.atividades.find((a) => a.principal);
  for (const id of declaradas) {
    if (id === null || !ATIVIDADES_PGDASD.some((a) => a.id === id)) continue;
    if (esperadas.includes(id)) continue;
    // Qual seria a certa: a de exportação da mesma regra, se a empresa tem CNAE dessa regra (11 -> 29, 14 -> 30);
    // senão, com uma só possível, ela; com as duas, a do CNAE principal.
    const regra = regraDaAtividade(id);
    const mesmaRegra = regra === "outra" ? undefined : esperadas.find((e) => e === GRUPOS[regra].exterior);
    const esperada =
      mesmaRegra ??
      (esperadas.length === 1 ? esperadas[0] : principal?.tributacao === "anexo-fixo" ? GRUPOS["anexo-iii"].exterior : GRUPOS["fator-r"].exterior);
    const usou = nomeCurtoDaAtividade(id);
    const seria = nomeCurtoDaAtividade(esperada);
    return {
      pa,
      declarada: id,
      esperada,
      titulo: `Atividade declarada em ${mmAaaa(pa)} não bate com o CNAE`,
      texto: `Em ${mmAaaa(pa)} a declaração usou ${usou}; pelo seu CNAE seria ${seria}.`,
      explicacao: [
        `Na declaração de ${rotuloMes(pa)} a receita foi lançada na atividade ${id} (${usou}). Pelas atividades (CNAE) da empresa, que exporta serviço, o certo é a atividade ${esperada} (${seria}).`,
        ...explicarDiferenca(id, esperada),
        "O que fazer: retifique a declaração desse mês no PGDAS-D, no Portal do Simples Nacional, trocando a atividade. Se a retificação mudar o valor, gere a guia nova (ou peça a restituição do que pagou a mais).",
      ],
    };
  }
  return null;
}
