// Mensagens próprias para o cliente quando o termo de autorização não dá certo. Nunca a mensagem da API, códigos de
// sistema ou o nome do fornecedor por trás: o detalhe técnico fica só no log do servidor. As recusas do envio vêm
// classificadas pelo núcleo (MotivoRecusa, autentica-procurador.ts); os problemas da própria instalação, por
// MotivoPlataforma (termo.ts).
import type { MotivoRecusa } from "@contabilizadev/nucleo/serpro/autentica-procurador";

// Problemas antes de enviar, do lado da plataforma ou da empresa.
export type MotivoPlataforma =
  | "sem-plataforma" // falta PLATAFORMA_CNPJ ou a razão social da plataforma
  | "sem-chave" // falta TOKEN_CHAVE (ou inválida)
  | "sem-contrato" // falta o contrato configurado
  | "chave-trocada" // a TOKEN_CHAVE mudou: o termo guardado não abre
  | "so-dono"
  | "propria" // a empresa é a própria plataforma: não precisa de termo
  | "plataforma-reservada" // tem o CNPJ da plataforma, mas nenhum dono é administrador: nem termo nem autorização sem termo
  | "cnpj-alfanumerico"
  | "sem-termo"
  | "termo-vencido"
  | "termo-recusado"
  | "sem-dados-pessoais" // falta "Seus dados": sem o CPF, não dá para conferir o responsável pelo e-CNPJ
  | "limite-de-envios" // a empresa passou do limite de envios do termo (por hora ou por dia)
  | "comprovada-por-outra"; // enquanto este envio esperava, outra conta comprovou a empresa

// Quando o passo 7 do cadastro não abre: a empresa já está cadastrada, então a autorização fica para depois.
export const AUTORIZAR_DEPOIS = "Não deu para abrir a autorização agora. A empresa já está cadastrada: autorize depois, pela página Autorização.";

// Por que a empresa da própria plataforma não precisa de termo (tooltip da página Autorização e do passo 7 do cadastro).
export const PROPRIA_SEM_TERMO = "A plataforma já é autorizada a agir pela própria empresa na Receita Federal; o termo serve para ela agir em nome de outras empresas.";

export const MENSAGEM_GENERICA = "Não deu para concluir agora. Nada foi guardado; tente de novo mais tarde.";
const NOSSO_LADO = "Não deu para concluir agora, por um problema do nosso lado. Nada foi guardado; tente mais tarde e, se continuar, fale com o suporte.";

export const MENSAGENS_DA_PLATAFORMA: Record<MotivoPlataforma, string> = {
  "sem-plataforma": "A assinatura da autorização ainda não está disponível. Enquanto isso, use o modo guiado.",
  "sem-chave": "A assinatura da autorização ainda não está disponível. Enquanto isso, use o modo guiado.",
  "sem-contrato": "A assinatura da autorização ainda não está disponível. Enquanto isso, use o modo guiado.",
  "chave-trocada": "Não conseguimos abrir a autorização guardada. Assine de novo para renovar a autorização.",
  "so-dono": "Só o dono da empresa na plataforma pode assinar o termo de autorização.",
  propria: "Esta é a empresa da própria plataforma: já está autorizada, sem termo.",
  "plataforma-reservada": "Esta empresa é a da própria plataforma: só a administração da plataforma autoriza esta empresa. Enquanto isso, use o modo guiado.",
  "cnpj-alfanumerico": "O termo de autorização ainda não aceita CNPJ com letras. Enquanto isso, use o modo guiado.",
  "sem-termo": "Autorização pendente: a empresa ainda não assinou o termo de autorização.",
  "termo-vencido": "A autorização venceu. Assine de novo para renovar.",
  "termo-recusado": "A Receita Federal recusou a autorização guardada. Assine de novo para renovar.",
  "sem-dados-pessoais": "Para assinar o termo, preencha antes Seus dados (menu do usuário): o CPF do responsável pelo e-CNPJ precisa ser o seu.",
  "limite-de-envios": "O termo desta empresa já foi enviado muitas vezes agora (até 3 por hora e 10 por dia). Confira o certificado e tente de novo mais tarde.",
  "comprovada-por-outra": "Esta empresa foi comprovada por outra conta enquanto você assinava. Nada foi enviado.",
};

export const MENSAGENS_DO_ENVIO: Record<MotivoRecusa, string> = {
  "certificado-vencido": "A Receita Federal informou que o certificado está vencido. Renove o e-CNPJ A1 e assine de novo.",
  "certificado-revogado": "A Receita Federal informou que o certificado foi revogado. Use um e-CNPJ A1 válido e assine de novo.",
  certificado: "A Receita Federal não aceitou o certificado. Confira se é o e-CNPJ A1 da empresa, emitido pela ICP-Brasil, e assine de novo.",
  vigencia: "A Receita Federal recusou as datas do termo. Confira a data do computador, recarregue a página e assine de novo.",
  termo: "A Receita Federal recusou o termo assinado. Recarregue a página e assine de novo.",
  configuracao: NOSSO_LADO,
  indisponivel: "A Receita Federal não respondeu agora. Nada foi guardado; tente de novo em alguns minutos.",
  desconhecido: MENSAGEM_GENERICA,
};

// Qualquer valor (inclusive um motivo desconhecido vindo do banco) vira uma mensagem própria.
export function mensagemDoEnvio(motivo: string | null | undefined): string {
  return motivo && Object.hasOwn(MENSAGENS_DO_ENVIO, motivo) ? MENSAGENS_DO_ENVIO[motivo as MotivoRecusa] : MENSAGEM_GENERICA;
}
