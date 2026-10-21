// Diagnóstico da empresa pelos dados da Receita (BrasilAPI): em que anexo ela fica, se depende do Fator R, ou por que
// ainda não atendemos. Usa a tabela de regras por CNAE (cnae.ts) no CNAE principal e em todos os secundários: a
// Receita olha todos os CNAEs do cadastro, e uma atividade fora do escopo já basta para a plataforma não servir.
import type { DadosCnpj } from "./brasilapi/cnpj.ts";
import { regraDoCnae, type Tributacao } from "./cnae.ts";
import { dataBr, formatarCnae, formatarNatureza } from "./formato.ts";

export type AnexoDiagnosticado = "III" | "III ou V";

export type AtividadeDiagnosticada = {
  cnae: string; // 7 dígitos
  descricao: string;
  principal: boolean;
  tributacao: Tributacao;
  anexo: AnexoDiagnosticado | null; // anexo do CNAE no Simples (referência); null = não atendida
  fundamento: string;
};

// Um motivo ou aviso em duas versões: `curto` fica na tela (uma linha, sem citação de lei nem lista de códigos);
// `detalhe` é o texto completo, para o tooltip, e `pergunta` é o rótulo do tooltip (o que o leitor de tela anuncia).
export type Nota = { curto: string; detalhe: string; pergunta: string };

export type Diagnostico = {
  atendido: boolean;
  impedimentos: Nota[]; // por que ainda não atendemos (vazio quando atendido)
  observacoes: Nota[]; // o que não impede, mas o cliente precisa saber
  anexo: AnexoDiagnosticado | null; // da empresa: "III ou V" se alguma atividade depende do Fator R; null fora do Simples, MEI ou com CNAE não atendido
  dependeFatorR: boolean; // false fora do Simples, MEI ou com CNAE não atendido
  atividades: AtividadeDiagnosticada[];
};

export type EntradaDiagnostico = Pick<DadosCnpj, "cnaePrincipal" | "cnaesSecundarios" | "simples" | "mei" | "situacaoCadastral" | "naturezaJuridica">;

// Naturezas jurídicas atendidas (Tabela de Natureza Jurídica da Receita/CONCLA): as formas que uma empresa de TI do
// Simples costuma ter. As outras ficam de fora; as que nem podem optar pelo Simples dizem o motivo legal.
export const NATUREZAS_ATENDIDAS: Record<string, string> = {
  "2062": "Sociedade Empresária Limitada (inclusive a unipessoal)",
  "2135": "Empresário (Individual)",
  "2232": "Sociedade Simples Pura",
  "2240": "Sociedade Simples Limitada",
  "2305": "Empresa Individual de Responsabilidade Limitada (de natureza empresária)",
  "2313": "Empresa Individual de Responsabilidade Limitada (de natureza simples)",
};

const NATUREZAS_IMPEDIDAS: Record<string, string> = {
  "2046": "sociedade por ações não pode optar pelo Simples (LC 123/2006, art. 3º, § 4º, X)",
  "2054": "sociedade por ações não pode optar pelo Simples (LC 123/2006, art. 3º, § 4º, X)",
  "2097": "sociedade por ações não pode optar pelo Simples (LC 123/2006, art. 3º, § 4º, X)",
  "2143": "cooperativa (salvo a de consumo) não pode optar pelo Simples (LC 123/2006, art. 3º, § 4º, VI)",
};

// Optante "agora": a Receita marca a opção, e uma exclusão com data até hoje já vale (exclusão futura vira aviso).
export function opcaoVigente(opcao: EntradaDiagnostico["simples"], hoje: string): boolean | null {
  if (opcao.optante === null) return null;
  return opcao.optante && !(opcao.dataExclusao && opcao.dataExclusao <= hoje);
}

// Cada motivo e aviso do diagnóstico, num lugar só.
const NOTAS = {
  situacao: (situacao: string): Nota => ({
    pergunta: "Por que só atendemos CNPJ ativo?",
    curto: `CNPJ com situação ${situacao.toLowerCase() || "não informada"}: só atendemos CNPJ ativo.`,
    detalhe: `A situação do CNPJ na Receita é ${situacao}. Só atendemos empresa com CNPJ ativo.`,
  }),
  mei: (): Nota => ({
    pergunta: "Por que ainda não atendemos MEI?",
    curto: "A empresa é MEI: ainda não atendemos MEI.",
    detalhe: "A empresa é MEI: o imposto é o valor fixo mensal do SIMEI (DAS-MEI), que esta plataforma ainda não atende.",
  }),
  simplesDesconhecido: (): Nota => ({
    pergunta: "Por que precisamos saber se a empresa é do Simples?",
    curto: "A Receita não informa se a empresa é do Simples Nacional.",
    detalhe: "A Receita não informa se a empresa é optante do Simples Nacional. Atendemos só empresas do Simples.",
  }),
  // exclusao: data da saída já em vigor (dd/mm/aaaa), ou null.
  foraDoSimples: (exclusao: string | null): Nota => {
    const quando = exclusao ? ` (excluída em ${exclusao})` : "";
    return {
      pergunta: "Por que atendemos só empresas do Simples?",
      curto: `A empresa não está no Simples Nacional${quando}.`,
      detalhe: `A empresa não é optante do Simples Nacional${quando}. Atendemos só empresas do Simples.`,
    };
  },
  saidaDoSimples: (quando: string): Nota => ({
    pergunta: "O que muda com a saída do Simples?",
    curto: `Saída do Simples marcada para ${quando}.`,
    detalhe: `A Receita registra a exclusão do Simples Nacional a partir de ${quando}.`,
  }),
  // nome: descrição com o código ("Sociedade Anônima Fechada (205-4)"); tipo: só a descrição; impedida: o motivo legal.
  natureza: (nome: string, tipo: string, impedida: string | null): Nota =>
    impedida
      ? { pergunta: "Por que este tipo de empresa não pode estar no Simples?", curto: `Tipo de empresa que não pode estar no Simples: ${tipo}.`, detalhe: `Natureza jurídica ${nome}: ${impedida}.` }
      : {
          pergunta: "Por que este tipo de empresa não é atendido?",
          curto: `Tipo de empresa não atendido: ${tipo}.`,
          detalhe: `Natureza jurídica ${nome} não é atendida nesta versão. Atendemos sociedade limitada (inclusive a unipessoal, antiga EIRELI), empresário individual e sociedade simples.`,
        },
  atividade: (a: Pick<AtividadeDiagnosticada, "cnae" | "descricao" | "principal" | "fundamento">): Nota => ({
    pergunta: `Por que a atividade ${formatarCnae(a.cnae)} impede o cadastro?`,
    curto: `Atividade ${formatarCnae(a.cnae)}${a.principal ? " (a principal)" : ""} fora das atividades de TI atendidas.`,
    detalhe: `CNAE ${formatarCnae(a.cnae)}${a.descricao ? ` (${a.descricao})` : ""}${a.principal ? ", o principal," : ""} não é atendido: ${a.fundamento}`,
  }),
  anexosMistos: (): Nota => ({
    pergunta: "Como declarar atividades de anexos diferentes?",
    curto: "Há atividades no Anexo III fixo e outras que dependem do Fator R.",
    detalhe: "A empresa tem atividades no Anexo III fixo e atividades que dependem do Fator R: cada receita é declarada na atividade do serviço prestado.",
  }),
};

export function diagnosticar(dados: EntradaDiagnostico, hoje: string): Diagnostico {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hoje)) throw new Error(`Data inválida: "${hoje}" (use AAAA-MM-DD).`);
  const impedimentos: Nota[] = [];
  const observacoes: Nota[] = [];

  const cnaes = [{ ...dados.cnaePrincipal, principal: true }, ...dados.cnaesSecundarios.map((c) => ({ ...c, principal: false }))];
  const atividades: AtividadeDiagnosticada[] = cnaes.map((c) => {
    const regra = regraDoCnae(c.codigo);
    const anexo: AnexoDiagnosticado | null = regra.tributacao === "fator-r" ? "III ou V" : regra.tributacao === "anexo-fixo" ? "III" : null;
    return { cnae: regra.cnae, descricao: c.descricao || regra.descricao, principal: c.principal, tributacao: regra.tributacao, anexo, fundamento: regra.fundamento };
  });

  // 1. Situação cadastral: só CNPJ ativo.
  if (dados.situacaoCadastral !== "ATIVA") impedimentos.push(NOTAS.situacao(dados.situacaoCadastral));

  // 2. MEI paga um valor fixo pelo SIMEI (DAS-MEI), não o Simples por anexo.
  const mei = opcaoVigente(dados.mei, hoje);
  if (mei) impedimentos.push(NOTAS.mei());

  // 3. Optante do Simples Nacional.
  const simples = opcaoVigente(dados.simples, hoje);
  if (simples === null) {
    impedimentos.push(NOTAS.simplesDesconhecido());
  } else if (!simples) {
    impedimentos.push(NOTAS.foraDoSimples(dados.simples.dataExclusao && dados.simples.dataExclusao <= hoje ? dataBr(dados.simples.dataExclusao) : null));
  } else if (dados.simples.dataExclusao) {
    observacoes.push(NOTAS.saidaDoSimples(dataBr(dados.simples.dataExclusao)));
  }

  // 4. Natureza jurídica.
  const natureza = dados.naturezaJuridica;
  if (!NATUREZAS_ATENDIDAS[natureza.codigo]) {
    const nome = `${natureza.descricao || "não informada"}${natureza.codigo ? ` (${formatarNatureza(natureza.codigo)})` : ""}`;
    impedimentos.push(NOTAS.natureza(nome, natureza.descricao || "não informado", NATUREZAS_IMPEDIDAS[natureza.codigo] ?? null));
  }

  // 5. Atividades: todas precisam estar na tabela de TI.
  for (const a of atividades.filter((a) => a.tributacao === "nao-atendido")) impedimentos.push(NOTAS.atividade(a));

  // Anexo e Fator R da empresa só existem para quem está no Simples agora (MEI paga o DAS-MEI fixo; fora do Simples
  // é Lucro Presumido ou Real) e quando conhecemos a tributação de todas as atividades: com um CNAE fora da tabela
  // (ex.: comércio, Anexo I) o anexo da empresa não é "III" nem "III ou V". As atividades guardam a tributação de
  // cada CNAE no Simples só como referência.
  const noSimples = simples === true && !mei;
  const todasAtendidas = atividades.every((a) => a.anexo);
  const atendidas = noSimples && todasAtendidas ? atividades : [];
  const dependeFatorR = atendidas.some((a) => a.tributacao === "fator-r");
  const anexo: AnexoDiagnosticado | null = atendidas.length === 0 ? null : dependeFatorR ? "III ou V" : "III";
  if (dependeFatorR && atendidas.some((a) => a.tributacao === "anexo-fixo")) observacoes.push(NOTAS.anexosMistos());

  return {
    atendido: impedimentos.length === 0,
    impedimentos,
    observacoes,
    anexo,
    dependeFatorR,
    atividades,
  };
}

// Diagnóstico como está no jsonb: o antigo não tem as versões curtas e pode ter campos que saíram do tipo (motivos,
// avisos e o texto do Fator R, que hoje vem só do glossário da tela).
type Guardado = Omit<Diagnostico, "impedimentos" | "observacoes"> & Partial<Pick<Diagnostico, "impedimentos" | "observacoes">>;

// Com os dados da Receita guardados junto, o melhor é refazer o diagnóstico (diagnosticar é puro): sai igual ao de quem
// cadastra hoje. `hoje` é o dia da consulta. Completo, devolve só os campos do tipo (sem os que saíram).
export function completarDiagnostico(guardado: Guardado, dados: EntradaDiagnostico, hoje: string): Diagnostico {
  const { atendido, impedimentos, observacoes, anexo, dependeFatorR, atividades } = guardado;
  if (!impedimentos || !observacoes) return diagnosticar(dados, hoje);
  return { atendido, impedimentos, observacoes, anexo, dependeFatorR, atividades };
}
