// Explicações curtas dos termos que aparecem no cadastro e nos dados da empresa, para quem não é contador. A tela mostra
// cada uma no tooltip único (ExplicacaoDoTermo, em app/explicacao.tsx). Frases curtas, sem jargão sem explicação; a fonte é
// sempre a Receita Federal.
import { LIMITE_FATOR_R, tabelaVigente, type Anexo, type Tributo } from "@contabilizadev/nucleo/simples";

// 0.28 -> "28%" (sem o resto de ponto flutuante: 0.28 * 100 = 28.000000000000004).
export const porcentagem = (x: number) => `${(x * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

const limite = porcentagem(LIMITE_FATOR_R);

// Alíquota inicial (1ª faixa) do anexo na tabela vigente no mês (AAAA-MM), da mesma tabela que o cálculo usa; null se o
// mês ainda não tem tabela cadastrada (o verbete explica sem o número).
export function aliquotaInicial(anexo: Anexo, pa: string): string | null {
  try {
    return porcentagem(tabelaVigente(anexo, pa).faixas[0].aliquota);
  } catch {
    return null;
  }
}

// Atividades de TI que ficam sempre no Anexo III (fonte única: verbete do anexo fixo e "Como o CNAE define o anexo?").
const SEMPRE_ANEXO_III = "Suporte técnico, hospedagem e portais ficam sempre no Anexo III";

// Verbete do anexo com as alíquotas do mês: "Anexo III, com alíquota inicial de 6%, ou no Anexo V, que começa em 15,5%".
// Com fixo = true (empresa só com atividades de anexo fixo), explica por que o anexo não muda, sem falar em Fator R decidindo.
export function verbeteAnexo(pa: string, fixo = false): Verbete {
  const iii = aliquotaInicial("III", pa);
  const v = aliquotaInicial("V", pa);
  const inicio = "O Simples Nacional tem cinco tabelas de alíquotas, chamadas anexos (I a V). Cada atividade cai em uma delas.";
  if (fixo) {
    return {
      titulo: "O que é o anexo do Simples?",
      texto: [
        inicio,
        `${SEMPRE_ANEXO_III}${iii ? `, com alíquota inicial de ${iii}` : ""}. Quando as atividades de TI da empresa são só dessas, o anexo não depende da folha de pagamento e não muda de um mês para outro.`,
      ],
    };
  }
  return {
    titulo: "O que é o anexo do Simples?",
    texto: [
      inicio,
      `Serviços de TI ficam no Anexo III${iii ? `, com alíquota inicial de ${iii},` : ""} ou no Anexo V${v ? `, que começa em ${v}` : ", mais caro"}. Quem decide entre os dois é o Fator R.`,
    ],
  };
}

// Mês de hoje no horário de Brasília (AAAA-MM).
const mesAtual = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);

export type Termo =
  | "cnpj"
  | "ondeCnpj"
  | "razaoSocial"
  | "nomeFantasia"
  | "situacao"
  | "natureza"
  | "endereco"
  | "abertura"
  | "socios"
  | "dadosErrados"
  | "cnae"
  | "cnaeEAnexo"
  | "simples"
  | "mei"
  | "naPratica"
  | "anexo"
  | "anexoFixo"
  | "fatorR"
  | "proLabore"
  | "termo"
  | "das"
  | "darf"
  | "irpj"
  | "csll"
  | "cpp"
  | "inssProLabore"
  | "pis"
  | "cofins"
  | "iss"
  | "cbs"
  | "ibs";

export type Verbete = { titulo: string; texto: string[]; lista?: string[] };

export const GLOSSARIO: Record<Termo, Verbete> = {
  cnpj: {
    titulo: "O que é o CNPJ?",
    texto: [
      "CNPJ é o Cadastro Nacional da Pessoa Jurídica: o \"CPF\" da empresa, dado pela Receita Federal quando ela é aberta.",
      "Tem 14 caracteres, no formato 00.000.000/0000-00. Desde julho de 2026 a Receita também dá CNPJs com letras e números (o CNPJ alfanumérico). Os antigos continuam valendo.",
    ],
  },
  ondeCnpj: {
    titulo: "Onde encontrar o CNPJ?",
    texto: ["Qualquer um destes mostra o número:"],
    lista: [
      "O Cartão CNPJ (comprovante de inscrição), que qualquer pessoa emite no site da Receita Federal.",
      "O e-CAC, o portal da Receita Federal, entrando com a sua conta gov.br.",
      "As notas fiscais que a empresa emitiu e o contrato social.",
    ],
  },
  razaoSocial: {
    titulo: "O que é a razão social?",
    texto: ["É o nome oficial da empresa, registrado na Junta Comercial ou no cartório. É o que aparece nas notas fiscais e nas guias de imposto."],
  },
  nomeFantasia: {
    titulo: "O que é o nome fantasia?",
    texto: ["É o nome comercial, se a empresa tiver um (a marca que o cliente conhece). Não muda nada nos impostos."],
  },
  situacao: {
    titulo: "O que é a situação cadastral?",
    texto: [
      "Mostra se o CNPJ está em dia com a Receita Federal. ATIVA quer dizer que a empresa pode funcionar e emitir notas.",
      "As outras são SUSPENSA e INAPTA (em geral por pendência, como declaração não entregue), BAIXADA (empresa encerrada) e NULA (cadastro anulado).",
    ],
  },
  natureza: {
    titulo: "O que é a natureza jurídica?",
    texto: [
      "É o tipo de empresa perante a lei: sociedade limitada (LTDA), empresário individual, sociedade simples, sociedade anônima e outros.",
      "Ela define quem responde pelas dívidas e se a empresa pode estar no Simples Nacional (sociedade anônima, por exemplo, não pode).",
    ],
  },
  endereco: {
    titulo: "Por que o endereço importa?",
    texto: [
      "É o endereço da sede. Ele define o município, que cobra o ISS das notas de serviço.",
      "Se estiver desatualizado, a mudança é feita na Junta Comercial (ou no cartório), e a Receita Federal atualiza depois.",
    ],
  },
  abertura: {
    titulo: "Por que a data de abertura importa?",
    texto: [
      "É o dia em que a empresa começou. Nos primeiros 12 meses, o Simples Nacional usa uma conta proporcional para achar a alíquota; a plataforma faz isso por você.",
    ],
  },
  socios: {
    titulo: "Quem são os sócios e administradores?",
    texto: [
      "São as pessoas que a Receita Federal registra no quadro de sócios da empresa, com a função de cada uma.",
      "O sócio que trabalha na empresa costuma receber pró-labore, que entra no Fator R.",
    ],
  },
  dadosErrados: {
    titulo: "Algum dado errado?",
    texto: [
      "Os dados vêm da Receita Federal. A correção é feita no registro da empresa (Junta Comercial ou cartório); depois que a Receita atualizar, é só pesquisar de novo.",
    ],
  },
  cnae: {
    titulo: "O que é o CNAE?",
    texto: [
      "CNAE é a Classificação Nacional de Atividades Econômicas: o código que diz o que a empresa faz. Exemplo: 6201-5/01 é desenvolvimento de programas de computador sob encomenda.",
      "Toda empresa tem uma atividade principal e pode ter secundárias. É pelo CNAE que se sabe em que anexo do Simples Nacional a receita é tributada.",
    ],
  },
  cnaeEAnexo: {
    titulo: "Como o CNAE define o anexo?",
    texto: [
      `Desenvolvimento de software e consultoria em TI ficam no Anexo III ou no V, conforme o Fator R. ${SEMPRE_ANEXO_III}.`,
      "A Receita olha todas as atividades do cadastro, não só a principal: por isso uma atividade fora de TI já basta para ainda não atendermos a empresa.",
    ],
  },
  simples: {
    titulo: "O que é o Simples Nacional?",
    texto: [
      "É o regime de impostos das micro e pequenas empresas (faturamento de até R$ 4,8 milhões por ano).",
      "Em vez de vários impostos separados, a empresa paga uma guia só por mês, o DAS, calculada sobre o faturamento.",
    ],
  },
  mei: {
    titulo: "O que é o MEI?",
    texto: [
      "MEI é o Microempreendedor Individual: a forma mais simples de empresa, com faturamento de até R$ 81 mil por ano e um valor fixo por mês (o DAS-MEI).",
      "Boa parte das atividades de TI, como desenvolvimento de software, não é permitida para o MEI.",
    ],
  },
  naPratica: {
    titulo: "O que muda na prática?",
    texto: [
      "No Simples, todo mês a empresa declara o que faturou e paga uma guia só, o DAS. A alíquota depende do anexo e do faturamento dos últimos 12 meses.",
      "O MEI paga um valor fixo, sem olhar o faturamento, mas tem limite baixo e não permite a maioria das atividades de TI.",
    ],
  },
  anexo: verbeteAnexo(mesAtual()),
  anexoFixo: verbeteAnexo(mesAtual(), true),
  fatorR: {
    titulo: "O que é o Fator R?",
    texto: [
      "É a folha de pagamento dos últimos 12 meses dividida pela receita dos mesmos 12 meses. A folha inclui pró-labore, salários e encargos (como o FGTS).",
      `Com ${limite} ou mais, a atividade vai para o Anexo III (mais barato). Abaixo de ${limite}, vai para o Anexo V. A conta é refeita todo mês.`,
    ],
  },
  proLabore: {
    titulo: "O que é o pró-labore?",
    texto: [
      "É a remuneração mensal do sócio que trabalha na empresa, como um salário. Tem INSS de 11%, descontado do sócio, e entra no Fator R.",
      // Lei 15.270/2025 (art. 6º-A e 16-A da Lei 9.250/1995), a partir de janeiro de 2026.
      "É diferente da distribuição de lucros, que não conta para o Fator R. Até R$ 50 mil por mês de cada empresa, o lucro não tem imposto para o sócio; acima disso, a empresa retém 10% de imposto de renda sobre o total do mês.",
      "Quem recebe mais de R$ 600 mil no ano, somando tudo, pode ainda pagar um imposto mínimo na declaração anual.",
    ],
  },
  termo: {
    titulo: "O que é o termo de autorização?",
    texto: [
      "É um documento oficial da Receita Federal que a empresa assina com o certificado digital dela (e-CNPJ A1), aqui no navegador, autorizando a plataforma a declarar, emitir guias e consultar em nome dela.",
      "Vale 1 ano (ou até o certificado vencer) e pode ser assinado de novo a qualquer momento. O arquivo do certificado e a senha não saem do seu computador.",
    ],
  },
  // Guias e impostos do mês. Na exportação de serviços não incidem ISS, PIS, COFINS, CBS e IBS (LC 123, art. 18,
  // § 4º-A, IV; LC 214/2025): sobram IRPJ, CSLL e CPP dentro do DAS.
  das: {
    titulo: "O que é o DAS?",
    texto: [
      "DAS é o Documento de Arrecadação do Simples Nacional: a guia única do mês, que paga de uma vez vários impostos (IRPJ, CSLL, INSS patronal e, conforme a receita, PIS, COFINS e ISS).",
      "O valor é a receita do mês vezes a alíquota efetiva, que depende do anexo e da receita dos últimos 12 meses. Vence no dia 20 do mês seguinte.",
    ],
  },
  darf: {
    titulo: "O que é o DARF do INSS?",
    texto: [
      "DARF é o Documento de Arrecadação de Receitas Federais. Aqui ele paga o INSS do pró-labore, que fica fora do DAS.",
      "A guia sai depois que o pró-labore do mês é enviado ao eSocial e à DCTFWeb. Vence no dia 20 do mês seguinte.",
    ],
  },
  irpj: {
    titulo: "O que é o IRPJ?",
    texto: [
      "É o Imposto de Renda da Pessoa Jurídica: o imposto de renda da empresa, cobrado pela Receita Federal.",
      "No Simples ele não tem guia própria: é uma fatia do DAS. Continua devido na exportação de serviços.",
    ],
  },
  csll: {
    titulo: "O que é a CSLL?",
    texto: [
      "É a Contribuição Social sobre o Lucro Líquido, federal, que ajuda a pagar a seguridade social (saúde, previdência e assistência).",
      "No Simples é uma fatia do DAS. Continua devida na exportação de serviços.",
    ],
  },
  cpp: {
    titulo: "O que é o INSS patronal (CPP)?",
    texto: [
      "É a Contribuição Patronal Previdenciária: o INSS que a própria empresa paga sobre a folha. Nos Anexos III e V ele vem dentro do DAS e costuma ser a maior fatia da guia.",
      "Não é o INSS do pró-labore: esse é descontado do sócio e pago à parte, no DARF.",
    ],
  },
  inssProLabore: {
    titulo: "O que é o INSS do pró-labore?",
    texto: [
      "É a contribuição do sócio ao INSS: 11% do pró-labore, limitada ao teto do INSS. Ela conta para a aposentadoria dele.",
      "Fica fora do DAS: a empresa desconta do sócio e paga no DARF, que vence no dia 20 do mês seguinte.",
    ],
  },
  pis: {
    titulo: "O que é o PIS?",
    texto: [
      "É a contribuição ao Programa de Integração Social, federal, cobrada sobre o faturamento. No Simples vem dentro do DAS.",
      "Não incide na exportação de serviços. A partir de 2027 é substituído pela CBS.",
    ],
  },
  cofins: {
    titulo: "O que é a COFINS?",
    texto: [
      "É a Contribuição para o Financiamento da Seguridade Social, federal, cobrada sobre o faturamento. No Simples vem dentro do DAS.",
      "Não incide na exportação de serviços. A partir de 2027 é substituída pela CBS.",
    ],
  },
  iss: {
    titulo: "O que é o ISS?",
    texto: [
      "É o Imposto Sobre Serviços, do município da empresa, cobrado sobre as notas de serviço. No Simples vem dentro do DAS.",
      "Não incide na exportação de serviços. Entre 2029 e 2033 é trocado aos poucos pelo IBS.",
    ],
  },
  cbs: {
    titulo: "O que é a CBS?",
    texto: [
      "É a Contribuição sobre Bens e Serviços, federal, criada pela reforma tributária para substituir o PIS e a COFINS a partir de 2027. No Simples vem dentro do DAS.",
      "Não incide na exportação de serviços.",
    ],
  },
  ibs: {
    titulo: "O que é o IBS?",
    texto: [
      "É o Imposto sobre Bens e Serviços, de estados e municípios, criado pela reforma tributária para substituir o ICMS e o ISS aos poucos, entre 2029 e 2033. No Simples vem dentro do DAS.",
      "Não incide na exportação de serviços.",
    ],
  },
};

// O verbete de cada tributo do DAS e do INSS do pró-labore (a fatia "inss" do total do mês).
export const TERMO_DO_TRIBUTO: Record<Tributo | "inss", Termo> = {
  irpj: "irpj",
  csll: "csll",
  cpp: "cpp",
  pis: "pis",
  cofins: "cofins",
  iss: "iss",
  cbs: "cbs",
  ibs: "ibs",
  inss: "inssProLabore",
};
