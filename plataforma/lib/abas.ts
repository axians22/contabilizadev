// As abas de conteúdo da empresa, na ordem da barra lateral: o grupo "Empresa" (as do dia a dia) e, no fim, o grupo
// "Configuração" (os cadastros que as outras usam). Ficam sempre visíveis no menu; o conteúdo de cada uma passa pelo
// portão (lib/empresas/portao.ts), e a descrição abaixo é o que a aba mostra enquanto ele está fechado ("aqui você vai
// ver..."). Aba nova de empresa entra nesta lista, no grupo certo (configuração nova vai para "configuracao", nunca no
// meio das de uso), e a página dela usa exigirConteudo (testes/portao-telas.test.ts confere).
// As páginas de conta (cadastro de empresa, planos, configuração) não estão aqui: seguem as próprias regras. O que é de
// gestão da plataforma (usuários, certificado da plataforma, plano do projeto) fica na área do administrador (lib/admin.ts).

export type GrupoDeAba = "empresa" | "configuracao";
// `foraDoMenu`: página da empresa (com portão) que não aparece na barra lateral — Avisos e mensagens, aberta pelo sininho.
export type AbaDaEmpresa = { href: string; grupo: GrupoDeAba; nome: string; descricao: string; exato?: boolean; foraDoMenu?: boolean };

// Os grupos da barra lateral da aplicação, na ordem (nada de administração aqui: isso é a área /admin, lib/admin.ts).
export const GRUPOS_DE_ABAS: { grupo: GrupoDeAba; titulo: string }[] = [
  { grupo: "empresa", titulo: "Empresa" },
  { grupo: "configuracao", titulo: "Configuração" },
];

export const ABAS_DA_EMPRESA = [
  {
    href: "/",
    grupo: "empresa",
    nome: "Painel do mês",
    exato: true,
    descricao: "O resumo do mês da sua empresa: o que declarar, a guia a pagar e o que ainda falta fazer, com os dados da Receita Federal.",
  },
  {
    href: "/roteiro",
    grupo: "empresa",
    nome: "Roteiro",
    descricao: "A rotina do mês, na ordem: lançar a receita, conferir o cálculo, declarar (PGDAS-D e DCTFWeb) e gerar as guias.",
  },
  {
    href: "/guias",
    grupo: "empresa",
    nome: "Guias",
    descricao: "As guias de pagamento da empresa (DAS do Simples e DARF do INSS), inclusive as vencidas com multa e juros, prontas para pagar.",
  },
  {
    href: "/historico",
    grupo: "empresa",
    nome: "Histórico",
    descricao: "As declarações e os pagamentos dos últimos meses, trazidos da Receita Federal.",
  },
  {
    href: "/situacao",
    grupo: "empresa",
    nome: "Situação fiscal",
    descricao: "Se a empresa tem pendências na Receita Federal, o que cada uma quer dizer e a guia para resolver a que for de imposto vencido.",
  },
  {
    href: "/defis",
    grupo: "empresa",
    nome: "Declaração anual",
    descricao: "A declaração anual do Simples Nacional (DEFIS): o prazo, se já foi entregue e os valores do ano já reunidos para entregar.",
  },
  {
    // Uma página com duas abas: Avisos (a central do sino) e Mensagens (a Caixa Postal da Receita Federal). Só pelo sininho.
    href: "/avisos",
    grupo: "empresa",
    nome: "Avisos e mensagens",
    foraDoMenu: true,
    descricao:
      "Os avisos da empresa num lugar só (situação fiscal, guias vencidas, prazos das declarações, Fator R, autorização) e as mensagens da Receita Federal na Caixa Postal, com o conteúdo aberto só quando você pedir.",
  },
  {
    href: "/empresa",
    grupo: "configuracao",
    nome: "Dados da empresa",
    descricao: "Os dados da empresa na Receita Federal (atividades, sócios, Simples Nacional) e o diagnóstico: em que anexo ela fica e se depende do Fator R.",
  },
  {
    href: "/autorizacao",
    grupo: "configuracao",
    nome: "Autorização",
    descricao: "A autorização da empresa para declarar e gerar guias daqui mesmo: o termo assinado com o certificado digital da empresa e a validade dele.",
  },
  {
    href: "/esocial",
    grupo: "configuracao",
    nome: "eSocial",
    descricao: "A configuração do eSocial da empresa: o sócio (categoria e matrícula), a lotação, as rubricas do pró-labore e do INSS e o dia do pagamento. O envio de cada mês fica no Roteiro.",
  },
] as const satisfies readonly AbaDaEmpresa[];

export type HrefDeAba = (typeof ABAS_DA_EMPRESA)[number]["href"];

// A aba Mensagens da página Avisos e mensagens (o antigo /mensagens leva para cá).
export const ENDERECO_DAS_MENSAGENS = "/avisos?aba=mensagens";

export function abaDaEmpresa(href: HrefDeAba): AbaDaEmpresa {
  return ABAS_DA_EMPRESA.find((a) => a.href === href)!;
}

// As abas de um grupo da barra lateral, na ordem da lista.
export const abasDoGrupo = (grupo: GrupoDeAba): AbaDaEmpresa[] => ABAS_DA_EMPRESA.filter((a) => a.grupo === grupo);
