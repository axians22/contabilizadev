// QA (Parte 2, área do administrador, ciclo 3): a tabela completa papel × endereço do que a barreira do servidor decide.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AREA_DO_ADMIN, entraNaAreaDoAdmin, inicioDoAdmin, PAGINAS_DO_ADMIN, podeVerNoAdmin } from "@/lib/admin";
import { gruposDaAdministracao } from "@/app/barra-lateral";

// Reproduz a decisão de exigirAreaDoAdmin (lib/autenticacao/servidor.ts) sem o Next.
const decidir = (papel: "ADMIN" | "MANAGER" | "COMMON_USER", href: string) => {
  if (podeVerNoAdmin(papel, href)) return "abre";
  const inicio = inicioDoAdmin(papel);
  return href === AREA_DO_ADMIN && inicio ? `redirect ${inicio}` : "404";
};

describe("QA ciclo 3: a barreira da área por papel", () => {
  it("tabela papel × página", () => {
    const esperado: Record<string, Record<string, string>> = {
      COMMON_USER: { "/admin": "404", "/admin/usuarios": "404", "/admin/plataforma": "404", "/admin/plano": "404" },
      MANAGER: { "/admin": "redirect /admin/usuarios", "/admin/usuarios": "abre", "/admin/plataforma": "404", "/admin/plano": "404" },
      ADMIN: { "/admin": "abre", "/admin/usuarios": "abre", "/admin/plataforma": "abre", "/admin/plano": "abre" },
    };
    for (const [papel, linhas] of Object.entries(esperado))
      for (const p of PAGINAS_DO_ADMIN) assert.equal(decidir(papel as never, p.href), linhas[p.href], `${papel} ${p.href}`);
  });

  it("o redirect do MANAGER leva a uma página que ele abre (sem laço) e o COMMON_USER não ganha redirect que revele a área", () => {
    const inicio = inicioDoAdmin("MANAGER");
    assert.ok(inicio && podeVerNoAdmin("MANAGER", inicio) && inicio !== AREA_DO_ADMIN);
    assert.equal(inicioDoAdmin("COMMON_USER"), null);
    assert.equal(entraNaAreaDoAdmin("COMMON_USER"), false);
  });

  it("o início de cada papel é o primeiro item da sua barra da área (a marca e o menu levam ao mesmo lugar)", () => {
    for (const papel of ["ADMIN", "MANAGER"] as const)
      assert.equal(gruposDaAdministracao(papel).flatMap((g) => g.itens)[0]?.href, inicioDoAdmin(papel), papel);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";

describe("QA ciclo 3: o aviso do ADMIN não some entre o sino e a página Avisos", () => {
  // O sino do ADMIN junta o aviso do certificado da plataforma (app/(painel)/layout.tsx) e mostra só os 5 mais graves,
  // dizendo "E mais N na página Avisos" e "Ver todos os avisos" (/avisos). Se a página /avisos não junta o mesmo aviso
  // para o ADMIN, o aviso empurrado para fora dos 5 é contado no sino mas não aparece em lugar nenhum da aplicação.
  it("a página /avisos junta os avisos do ADMIN como o sino (ou o sino não manda o ADMIN procurá-los lá)", () => {
    const pagina = readFileSync(path.join(import.meta.dirname, "..", "app", "(painel)", "avisos", "page.tsx"), "utf8");
    assert.match(pagina, /avisosDoAdmin/);
  });
});
