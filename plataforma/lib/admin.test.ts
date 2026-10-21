import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AREA_DO_ADMIN, entraNaAreaDoAdmin, inicioDoAdmin, PAGINAS_DO_ADMIN, paginasDoAdmin, podeVerNoAdmin } from "./admin";

const HREFS = PAGINAS_DO_ADMIN.map((p) => p.href);

describe("área do administrador: quem vê o quê (fechado por padrão)", () => {
  it("as páginas da área, na ordem, todas abaixo de /admin", () => {
    assert.deepEqual(HREFS, ["/admin", "/admin/usuarios", "/admin/plataforma", "/admin/plano"]);
    for (const h of HREFS) assert.ok(h === AREA_DO_ADMIN || h.startsWith(`${AREA_DO_ADMIN}/`), h);
  });

  it("COMMON_USER não entra em nenhuma página da área", () => {
    assert.equal(entraNaAreaDoAdmin("COMMON_USER"), false);
    for (const h of HREFS) assert.equal(podeVerNoAdmin("COMMON_USER", h), false, h);
    assert.deepEqual(paginasDoAdmin("COMMON_USER"), []);
  });

  it("MANAGER entra e vê só o que já podia: os usuários (nem a visão geral, que mostra os avisos da plataforma)", () => {
    assert.equal(entraNaAreaDoAdmin("MANAGER"), true);
    assert.deepEqual(
      HREFS.filter((h) => podeVerNoAdmin("MANAGER", h)),
      ["/admin/usuarios"],
    );
    assert.equal(podeVerNoAdmin("MANAGER", "/admin"), false);
    assert.equal(podeVerNoAdmin("MANAGER", "/admin/plataforma"), false);
    assert.equal(podeVerNoAdmin("MANAGER", "/admin/plano"), false);
    assert.deepEqual(paginasDoAdmin("MANAGER").map((p) => p.nome), ["Usuários"]);
  });

  it("ADMIN vê tudo", () => {
    assert.equal(entraNaAreaDoAdmin("ADMIN"), true);
    for (const h of HREFS) assert.equal(podeVerNoAdmin("ADMIN", h), true, h);
    assert.deepEqual(paginasDoAdmin("ADMIN").map((p) => p.nome), ["Visão geral", "Usuários", "Certificado da plataforma", "Plano do projeto"]);
  });

  it("endereço fora da lista não é liberado para ninguém (nem para o ADMIN)", () => {
    for (const papel of ["COMMON_USER", "MANAGER", "ADMIN"] as const) {
      for (const h of ["/admin/outra", "/admin/usuarios/", "/usuarios", "/config/plataforma", "/plano", "", "/"]) assert.equal(podeVerNoAdmin(papel, h), false, `${papel} ${h}`);
    }
  });

  it("início da área por papel: ADMIN na visão geral, MANAGER direto em Usuários, COMMON_USER sem entrada", () => {
    assert.equal(inicioDoAdmin("ADMIN"), "/admin");
    assert.equal(inicioDoAdmin("MANAGER"), "/admin/usuarios");
    assert.equal(inicioDoAdmin("COMMON_USER"), null);
    for (const papel of ["ADMIN", "MANAGER"] as const) assert.equal(podeVerNoAdmin(papel, inicioDoAdmin(papel)!), true, papel);
  });
});
