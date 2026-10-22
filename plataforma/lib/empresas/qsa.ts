// Conferência do usuário com o quadro de sócios e administradores (QSA) que vem na consulta pública do CNPJ: o primeiro
// filtro do cadastro da empresa (21/10/2026). A Receita publica o nome e só o meio do CPF ("***123456**", da 4ª à 9ª
// posição); bate quando o nome (sem acento, maiúsculas) é igual ao do usuário e os dígitos visíveis são os do CPF dele.
// Não prova a posse (o CPF aparece só em parte): quem prova é o termo assinado com o e-CNPJ (lib/termo/termo.ts).
import type { Socio } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { nomeParaComparar } from "@/lib/usuarios/validacao";

// confere: o usuário está no quadro; nao-confere: há quadro com CPF e ele não está; sem-qsa: a Receita não publica o
// quadro (vazio, como no empresário individual) ou sem os CPFs (consulta antiga), e a comprovação fica só pelo termo.
export type ResultadoQsa = "confere" | "nao-confere" | "sem-qsa";

type Pessoa = { nome: string; documento: string | null | undefined };

// O CPF mascarado tem 11 posições e pelo menos 6 dígitos à mostra (o resto, "*").
function digitosVisiveis(documento: string | null | undefined): string | null {
  const d = String(documento ?? "").replace(/[.\-/\s]/g, "");
  if (d.length !== 11 || !/^[\d*]{11}$/.test(d) || (d.match(/\d/g)?.length ?? 0) < 6) return null;
  return d;
}

const bateCpf = (mascarado: string, cpf: string) => [...mascarado].every((c, i) => c === "*" || c === cpf[i]);

export function conferirQsa(socios: Socio[] | undefined | null, usuario: { nomeCompleto: string; cpf: string }): ResultadoQsa {
  const pessoas: Pessoa[] = (socios ?? []).flatMap((s) => [{ nome: s.nome, documento: s.documento }, ...(s.representante ? [s.representante] : [])]);
  // Só quem tem CPF mascarado conta (sócio pessoa jurídica traz o CNPJ, e o representante "vazio" traz ***000000**).
  const comCpf = pessoas.flatMap((p) => {
    const d = digitosVisiveis(p.documento);
    return d && !/^\*+0+\*+$/.test(d) ? [{ nome: nomeParaComparar(p.nome), cpf: d }] : [];
  });
  if (comCpf.length === 0) return "sem-qsa";
  const nome = nomeParaComparar(usuario.nomeCompleto);
  return comCpf.some((p) => p.nome === nome && bateCpf(p.cpf, usuario.cpf)) ? "confere" : "nao-confere";
}

// Textos da tela (curto na tela; o porquê e o que fazer no tooltip). Nunca citam o fornecedor.
export const QSA_NAO_CONFERE = {
  curto: "Não encontramos você no quadro de sócios desta empresa na Receita Federal.",
  titulo: "Por que não deu para cadastrar?",
  texto:
    "Só quem está no quadro de sócios e administradores da empresa pode cadastrá-la. Conferimos o seu nome completo e a parte do CPF que a Receita Federal publica nesse quadro, e não encontramos você. O que fazer: confira em Seus dados (menu do usuário) se o nome está escrito como no seu CPF e se o CPF está certo. Se você entrou na sociedade há pouco, a Receita pode levar alguns dias para atualizar o quadro.",
} as const;

export const QSA_INDISPONIVEL = {
  curto: "A Receita Federal não publica o quadro de sócios desta empresa: a comprovação será só pelo termo de autorização.",
  titulo: "Como vamos comprovar que a empresa é sua?",
  texto:
    "Sem o quadro de sócios, não dá para conferir você agora. A empresa fica aguardando comprovação até você assinar o termo de autorização com o e-CNPJ dela, em nome do seu CPF. Enquanto isso, nenhum dado da empresa aparece.",
} as const;
