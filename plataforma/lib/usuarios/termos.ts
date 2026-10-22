// Texto PROVISÓRIO dos termos de uso e da política de privacidade (21/10/2026), até a versão definitiva da Parte 9
// (plano.txt, passo 24). A versão aceita fica guardada com a data (dados_pessoais.termos_versao e termos_aceitos_em):
// trocar este texto pede trocar VERSAO_DOS_TERMOS (lib/usuarios/validacao.ts), e todos aceitam de novo no próximo acesso.
// Para o cliente, a fonte dos dados é sempre a Receita Federal.
import { VERSAO_DOS_TERMOS } from "./validacao";

export { VERSAO_DOS_TERMOS };

export type SecaoDosTermos = { titulo: string; paragrafos: string[] };

export const DATA_DOS_TERMOS = "21/10/2026";

export const TERMOS_DE_USO: SecaoDosTermos[] = [
  {
    titulo: "O que é o ContabilizaDev",
    paragrafos: [
      "Uma ferramenta para a própria empresa calcular, declarar e pagar o Simples Nacional. Quem declara e transmite é você: cada transmissão pede a sua confirmação. Não fazemos orientação contábil personalizada.",
    ],
  },
  {
    titulo: "Sua conta",
    paragrafos: [
      "A conta é pessoal: entre com a sua conta Google e preencha os seus dados verdadeiros. Um CPF serve para uma conta só.",
      "Só quem está no quadro de sócios e administradores da empresa na Receita Federal pode cadastrá-la. O cadastro fica aguardando comprovação até o termo de autorização ser assinado com o e-CNPJ da empresa em nome do seu CPF; antes disso, nenhum dado da empresa aparece.",
    ],
  },
  {
    titulo: "Responsabilidades",
    paragrafos: [
      "Você confere os valores antes de confirmar cada declaração ou guia. Os cálculos seguem a lei e os dados da Receita Federal, mas a declaração é da empresa.",
      "Não use a plataforma para empresa que não é sua nem com certificado de outra pessoa. Tentativas assim são recusadas e podem levar ao bloqueio da conta.",
    ],
  },
  {
    titulo: "Versão provisória",
    paragrafos: ["Estes termos são provisórios. Quando a versão definitiva sair (junto com os planos de assinatura), pediremos o seu aceite de novo."],
  },
];

export const POLITICA_DE_PRIVACIDADE: SecaoDosTermos[] = [
  {
    titulo: "Que dados guardamos",
    paragrafos: [
      "Da conta Google: nome, e-mail e foto. Seus dados: nome completo, CPF, data de nascimento, WhatsApp e endereço.",
      "Da empresa: os dados públicos da Receita Federal (razão social, atividades, quadro de sócios) e o que você lança aqui. O termo de autorização assinado fica guardado cifrado. O seu certificado digital nunca vem para o servidor: ele fica no seu computador.",
    ],
  },
  {
    titulo: "Para que usamos",
    paragrafos: [
      "Para identificar quem é o responsável pela empresa (o nome e o CPF são conferidos com o quadro de sócios e com o e-CNPJ que assina o termo), para prevenir fraude e para falar com você sobre a sua conta.",
      "As bases legais são a execução do contrato com você, o cumprimento de obrigação legal e o legítimo interesse na prevenção à fraude (LGPD, art. 7º, incisos II, V e IX).",
    ],
  },
  {
    titulo: "Quem vê",
    paragrafos: [
      "CPF, data de nascimento, telefone e endereço só aparecem para você. Não vendemos nem compartilhamos seus dados; as consultas da empresa são feitas na Receita Federal, em nome dela, com a autorização que você assina.",
    ],
  },
  {
    titulo: "Seus direitos",
    paragrafos: [
      "Você pode ver e corrigir seus dados a qualquer momento em Seus dados (menu do usuário) e pedir a exclusão da conta ao suporte (LGPD, art. 18). O nome completo e o CPF só mudam pelo suporte depois que você cadastra uma empresa.",
    ],
  },
];

// Todo o texto, para o teste de nomes de fornecedor e para quem precisar comparar versões.
export const TEXTO_DOS_TERMOS = [...TERMOS_DE_USO, ...POLITICA_DE_PRIVACIDADE].flatMap((s) => [s.titulo, ...s.paragrafos]).join("\n");
