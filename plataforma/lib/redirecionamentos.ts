// Endereços antigos que mudaram de nome: o next.config redireciona para o novo, com 308 (permanente), para links
// salvos e favoritos não quebrarem. Fica fora do next.config para o teste conferir a lista (testes/portao-telas.test.ts).
export type Redirecionamento = { source: string; destination: string; permanent: true };

export const REDIRECIONAMENTOS: Redirecionamento[] = [
  // "Ligar o automático" virou "Autorização" (outubro de 2026).
  { source: "/automatico", destination: "/autorizacao", permanent: true },
  { source: "/automatico/:resto*", destination: "/autorizacao/:resto*", permanent: true },
  // O que era de gestão foi para a área do administrador (/admin, outubro de 2026). Quem não tem acesso cai no 404 de lá.
  { source: "/usuarios", destination: "/admin/usuarios", permanent: true },
  { source: "/config/plataforma", destination: "/admin/plataforma", permanent: true },
  { source: "/plano", destination: "/admin/plano", permanent: true },
];
