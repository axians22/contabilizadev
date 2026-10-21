// Regras de papel (portadas do horizons): quem é o quê e quem pode mudar quem.
import type { Papel } from "@/banco/esquema";

// O papel que vale nesta entrada:
//   está em ADMIN_EMAILS?        -> ADMIN   (a variável ganha sempre)
//   senão, é MANAGER no banco?   -> MANAGER (respeita a promoção feita na tela)
//   senão                        -> COMMON_USER
// Sair da lista tira o ADMIN (e cai para COMMON_USER, não para MANAGER), e ninguém vira ADMIN escrevendo na coluna.
export function papelPara(email: string, papelAtual: string | null, adminEmails: string[]): Papel {
  if (adminEmails.includes(email.trim().toLowerCase())) return "ADMIN";
  if (papelAtual === "MANAGER") return "MANAGER";
  return "COMMON_USER";
}

// "Manager opera, Admin configura": ver a lista e desligar uma conta é operar; mudar papel é configurar.
export const ehGestao = (papel: Papel) => papel === "ADMIN" || papel === "MANAGER";

type Pessoa = { id: string; papel: Papel };

// Ligar/desligar a conta de `alvo`. Uma função só, usada pela ação e pela lista (o botão nunca promete um
// gesto que a ação recusa). Recusas: em si mesmo (perderia a tela que o reativaria), manager sobre admin e
// manager sobre manager (um derrubaria o outro).
export function podeMudarAtivo(ator: Pessoa, alvo: Pessoa): boolean {
  if (ator.id === alvo.id) return false;
  if (ator.papel === "ADMIN") return true;
  if (ator.papel === "MANAGER") return alvo.papel === "COMMON_USER";
  return false;
}

// Mudar o papel de `alvo`: só o ADMIN, nunca em si mesmo, e nunca de outro ADMIN (quem decide é ADMIN_EMAILS).
export function podeMudarPapel(ator: Pessoa, alvo: Pessoa): boolean {
  return ator.papel === "ADMIN" && ator.id !== alvo.id && alvo.papel !== "ADMIN";
}
