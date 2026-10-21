import { comSessao } from "@/lib/autenticacao/servidor";

// Quem está logado e a empresa ativa (para telas que precisem disso no navegador). Sem sessão: 401.
export const GET = comSessao(async ({ usuario, empresaAtiva, empresas }) =>
  Response.json({ usuario, empresaAtiva, empresas: empresas.map(({ id, razaoSocial, papel }) => ({ id, razaoSocial, papel })) }),
);
