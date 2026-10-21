// A área do administrador (/admin): separada da aplicação do cliente, com layout próprio (app/admin/layout.tsx). Aqui fica
// tudo o que é de gestão da plataforma, e não de uma empresa. Esta lista é a única fonte de quem vê o quê: a barra lateral
// da área, o layout e cada página (exigirAreaDoAdmin, lib/autenticacao/servidor.ts) leem daqui.
//   - "gestao": MANAGER e ADMIN (os usuários, com as regras de quem altera quem em lib/autenticacao/papeis.ts);
//   - "admin": só ADMIN (a visão geral com os avisos da plataforma, certificado e chaves da plataforma, plano do projeto).
// O MANAGER vê só os usuários: a entrada da área, para ele, é /admin/usuarios (inicioDoAdmin).
// Fechado por padrão: COMMON_USER nunca entra, e um endereço fora da lista não é liberado para ninguém.
import type { Papel } from "@/banco/esquema";
import { ehGestao } from "./autenticacao/papeis";

export type QuemVe = "gestao" | "admin";
// `resumo`: a frase curta do cartão da página na visão geral da área.
export type PaginaDoAdmin = { href: string; nome: string; quemVe: QuemVe; resumo: string; exato?: boolean };

export const AREA_DO_ADMIN = "/admin";

export const PAGINAS_DO_ADMIN = [
  { href: "/admin", nome: "Visão geral", quemVe: "admin", exato: true, resumo: "O que precisa de atenção na plataforma e os atalhos da área." },
  { href: "/admin/usuarios", nome: "Usuários", quemVe: "gestao", resumo: "Quem usa a plataforma: buscar, desativar e mudar o papel." },
  { href: "/admin/plataforma", nome: "Certificado da plataforma", quemVe: "admin", resumo: "O e-CNPJ A1 e as chaves do contrato da plataforma, e a situação da integração." },
  { href: "/admin/plano", nome: "Plano do projeto", quemVe: "admin", resumo: "As partes do plano de construção, o que já foi feito e as decisões." },
] as const satisfies readonly PaginaDoAdmin[];

export type HrefDoAdmin = (typeof PAGINAS_DO_ADMIN)[number]["href"];

// Quem entra na área (vê o link "Área do administrador" no menu do usuário): MANAGER e ADMIN.
export const entraNaAreaDoAdmin = (papel: Papel) => ehGestao(papel);

// Se `papel` pode abrir a página `href` da área. Endereço desconhecido: ninguém.
export function podeVerNoAdmin(papel: Papel, href: string): boolean {
  const pagina = (PAGINAS_DO_ADMIN as readonly PaginaDoAdmin[]).find((p) => p.href === href);
  if (!pagina || !entraNaAreaDoAdmin(papel)) return false;
  return pagina.quemVe === "gestao" || papel === "ADMIN";
}

// As páginas que `papel` vê, na ordem da barra lateral da área.
export const paginasDoAdmin = (papel: Papel): PaginaDoAdmin[] => PAGINAS_DO_ADMIN.filter((p) => podeVerNoAdmin(papel, p.href));

// A primeira página que `papel` vê: para onde levam o item "Área do administrador" do menu, a marca da barra da área e
// /admin para quem não vê a visão geral (MANAGER: /admin/usuarios). Sem acesso: null.
export const inicioDoAdmin = (papel: Papel): string | null => paginasDoAdmin(papel)[0]?.href ?? null;
