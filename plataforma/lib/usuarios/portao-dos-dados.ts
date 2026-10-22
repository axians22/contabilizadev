// Portão do primeiro login (21/10/2026): o usuário comum (COMMON_USER) preenche "Seus dados" antes de qualquer coisa. Sem
// eles (ou com o aceite de uma versão antiga dos termos), toda página, ação e rota do servidor manda para /meus-dados
// (exigirSessao, lib/autenticacao/servidor.ts); só ficam livres /entrar, sair e a própria tela de dados (com os termos).
// ADMIN e MANAGER (papéis internos, inclusive a conta de desenvolvimento) entram direto; para cadastrar empresa de cliente
// ou assinar o termo eles também precisam dos dados, pedidos nessa hora (lib/empresas/cadastro.ts, lib/termo/termo.ts).
import type { Papel } from "@/banco/esquema";

export const ROTA_SEUS_DADOS = "/meus-dados";

export const exigeSeusDados = (usuario: { papel: Papel; dadosPendentes: boolean }) => usuario.papel === "COMMON_USER" && usuario.dadosPendentes;

export const PREENCHA_SEUS_DADOS = "Preencha seus dados para continuar.";
