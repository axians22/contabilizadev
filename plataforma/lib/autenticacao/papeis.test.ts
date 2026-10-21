import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ehGestao, papelPara, podeMudarAtivo, podeMudarPapel } from "./papeis";

const ADMINS = ["dono@empresa.com"];

describe("papelPara (casos do horizons auth.service.spec)", () => {
  it("ADMIN_EMAILS ganha sempre, até de conta nova e de COMMON_USER no banco", () => {
    assert.equal(papelPara("dono@empresa.com", null, ADMINS), "ADMIN");
    assert.equal(papelPara("dono@empresa.com", "COMMON_USER", ADMINS), "ADMIN");
    assert.equal(papelPara("dono@empresa.com", "MANAGER", ADMINS), "ADMIN");
  });
  it("a comparação ignora caixa e espaço do e-mail", () => {
    assert.equal(papelPara(" Dono@Empresa.COM ", null, ADMINS), "ADMIN");
  });
  it("sem ADMIN_EMAILS, ninguém é admin", () => {
    assert.equal(papelPara("dono@empresa.com", null, []), "COMMON_USER");
  });
  it("o MANAGER promovido pela tela sobrevive ao login", () => {
    assert.equal(papelPara("gestor@x.dev", "MANAGER", ADMINS), "MANAGER");
    assert.equal(papelPara("gestor@x.dev", "MANAGER", []), "MANAGER");
  });
  it("ADMIN escrito na coluna, fora da variável, cai para COMMON_USER", () => {
    assert.equal(papelPara("intruso@x.dev", "ADMIN", ADMINS), "COMMON_USER");
    assert.equal(papelPara("intruso@x.dev", "ADMIN", []), "COMMON_USER");
  });
  it("sair do ADMIN_EMAILS cai para COMMON_USER, não para MANAGER", () => {
    const antes = papelPara("ex@x.dev", null, ["ex@x.dev"]);
    assert.equal(antes, "ADMIN");
    assert.equal(papelPara("ex@x.dev", antes, []), "COMMON_USER");
  });
  it("papel desconhecido no banco não é preservado", () => {
    assert.equal(papelPara("a@x.dev", "SUPERUSER", []), "COMMON_USER");
  });
});

describe("regras de gestão (horizons usuarios.service)", () => {
  const admin = { id: "a", papel: "ADMIN" as const };
  const gestor = { id: "g", papel: "MANAGER" as const };
  const outroGestor = { id: "g2", papel: "MANAGER" as const };
  const comum = { id: "c", papel: "COMMON_USER" as const };

  it("ehGestao: MANAGER e ADMIN", () => {
    assert.equal(ehGestao("ADMIN"), true);
    assert.equal(ehGestao("MANAGER"), true);
    assert.equal(ehGestao("COMMON_USER"), false);
  });
  it("ninguém se desativa, nem o admin", () => {
    assert.equal(podeMudarAtivo(admin, admin), false);
    assert.equal(podeMudarAtivo(gestor, gestor), false);
  });
  it("manager desativa só COMMON_USER", () => {
    assert.equal(podeMudarAtivo(gestor, comum), true);
    assert.equal(podeMudarAtivo(gestor, admin), false);
    assert.equal(podeMudarAtivo(gestor, outroGestor), false);
  });
  it("admin desativa manager e comum; comum não desativa ninguém", () => {
    assert.equal(podeMudarAtivo(admin, gestor), true);
    assert.equal(podeMudarAtivo(admin, comum), true);
    assert.equal(podeMudarAtivo(comum, { id: "c2", papel: "COMMON_USER" }), false);
  });
  it("só o admin muda papel, nunca o próprio nem o de outro admin", () => {
    assert.equal(podeMudarPapel(admin, comum), true);
    assert.equal(podeMudarPapel(admin, gestor), true);
    assert.equal(podeMudarPapel(admin, admin), false);
    assert.equal(podeMudarPapel(admin, { id: "a2", papel: "ADMIN" }), false);
    assert.equal(podeMudarPapel(gestor, comum), false);
    assert.equal(podeMudarPapel(comum, comum), false);
  });
});
