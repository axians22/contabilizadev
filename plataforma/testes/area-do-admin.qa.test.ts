// QA (Parte 2, área do administrador): bordas que os testes do engenheiro não cobrem.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { gruposDaAdministracao, gruposDaBarra } from "@/app/barra-lateral";
import { entraNaAreaDoAdmin, PAGINAS_DO_ADMIN, podeVerNoAdmin } from "@/lib/admin";
import { REDIRECIONAMENTOS } from "@/lib/redirecionamentos";

const RAIZ = path.join(import.meta.dirname, "..", "..");
const APP = path.join(import.meta.dirname, "..", "app");
const ler = (f: string) => readFileSync(f, "utf8");

describe("QA: área do administrador", () => {
  it("papel inesperado (string fora do enum) não entra em nada", () => {
    for (const papel of ["", "admin", "Admin", "ADMIN ", "ROOT"]) {
      assert.equal(entraNaAreaDoAdmin(papel as never), false, papel);
      for (const p of PAGINAS_DO_ADMIN) assert.equal(podeVerNoAdmin(papel as never, p.href), false, `${papel} ${p.href}`);
    }
  });

  it("variações de endereço não liberam nada (barra no fim, maiúsculas, query, subpasta)", () => {
    for (const h of ["/admin/", "/ADMIN", "/admin/Usuarios", "/admin/usuarios?q=a", "/admin/plano/x", "/admin/plataforma#a"]) {
      for (const papel of ["MANAGER", "ADMIN"] as const) assert.equal(podeVerNoAdmin(papel, h), false, `${papel} ${h}`);
    }
  });

  it("barra da aplicação: nenhum item aponta para /admin nem para as URLs antigas, e nenhum grupo se chama Plataforma/Administração", () => {
    const grupos = gruposDaBarra();
    for (const g of grupos) {
      assert.ok(!/plataforma|administra/i.test(g.titulo ?? ""), g.titulo);
      for (const i of g.itens) assert.ok(!i.href.startsWith("/admin") && !["/usuarios", "/plano", "/config/plataforma"].includes(i.href), i.href);
    }
  });

  it("barra da área: COMMON_USER fica sem nenhum item; MANAGER sem plataforma/plano", () => {
    assert.deepEqual(gruposDaAdministracao("COMMON_USER").flatMap((g) => g.itens), []);
    const manager = gruposDaAdministracao("MANAGER").flatMap((g) => g.itens.map((i) => i.href));
    assert.deepEqual(manager, ["/admin/usuarios"]);
  });

  it("os endereços antigos não têm mais página (o redirect não fica sombreado) e cada destino existe", () => {
    for (const antigo of ["usuarios", "plano", path.join("config", "plataforma")]) assert.equal(existsSync(path.join(APP, "(painel)", antigo, "page.tsx")), false, antigo);
    for (const r of REDIRECIONAMENTOS.filter((r) => r.destination.startsWith("/admin"))) {
      assert.equal(r.permanent, true);
      assert.ok(existsSync(path.join(APP, ...r.destination.split("/").filter(Boolean), "page.tsx")), r.destination);
    }
  });

  it("o layout da área não monta seletor de empresa nem sino", () => {
    const layout = ler(path.join(APP, "admin", "layout.tsx"));
    assert.doesNotMatch(layout, /SeletorEmpresa|sino=|empresa=/);
  });

  it("a documentação de configuração (.env.exemplo) aponta para a tela nova, não para /config/plataforma", () => {
    const exemplo = ler(path.join(RAIZ, ".env.exemplo"));
    assert.doesNotMatch(exemplo, /\/config\/plataforma/);
  });
});
