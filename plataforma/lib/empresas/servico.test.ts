import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escolherAtiva, type EmpresaDoUsuario } from "./servico";

const A: EmpresaDoUsuario = { id: "a", cnpj: "11222333000181", razaoSocial: "Alfa", papel: "DONO" };
const B: EmpresaDoUsuario = { id: "b", cnpj: "12ABC34501DE35", razaoSocial: "Beta", papel: "MEMBRO" };

describe("escolherAtiva", () => {
  it("usa a escolhida na sessão quando o usuário tem acesso a ela", () => {
    assert.equal(escolherAtiva([A, B], "b"), B);
  });
  it("sem escolha, a primeira da lista", () => {
    assert.equal(escolherAtiva([A, B], null), A);
  });
  it("escolha de empresa fora da lista (sem vínculo) é ignorada", () => {
    assert.equal(escolherAtiva([A, B], "de-outro"), A);
  });
  it("sem empresas, nenhuma", () => {
    assert.equal(escolherAtiva([], "a"), null);
  });
});
