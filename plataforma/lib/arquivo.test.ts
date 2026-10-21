import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACEITA_PFX, CHAMADA_DO_PFX, conferirArquivo, EXTENSOES_PFX, formatarTamanho, listarExtensoes, TAMANHO_MAXIMO_PFX } from "./arquivo";

const regras = { extensoes: EXTENSOES_PFX, tamanhoMaximo: TAMANHO_MAXIMO_PFX };

describe("campo de envio de arquivo: regras puras", () => {
  it("tamanho como a pessoa entende", () => {
    assert.equal(formatarTamanho(1), "1 byte");
    assert.equal(formatarTamanho(820), "820 bytes");
    assert.equal(formatarTamanho(1024), "1 KB");
    assert.equal(formatarTamanho(1536), "1,5 KB");
    assert.equal(formatarTamanho(TAMANHO_MAXIMO_PFX), "100 KB");
    assert.equal(formatarTamanho(2.3 * 1024 * 1024), "2,3 MB");
    assert.equal(formatarTamanho(-1), "");
    assert.equal(formatarTamanho(Number.NaN), "");
  });

  it("lista de extensões em português", () => {
    assert.equal(listarExtensoes([".pfx"]), ".pfx");
    assert.equal(listarExtensoes(EXTENSOES_PFX), ".pfx ou .p12");
    assert.equal(listarExtensoes([".pdf", ".png", ".jpg"]), ".pdf, .png ou .jpg");
    assert.equal(listarExtensoes([]), "");
  });

  it("aceita o .pfx e o .p12 (maiúsculas também) dentro do limite", () => {
    for (const nome of ["empresa.pfx", "EMPRESA.PFX", "e-cnpj 2026.p12", "a.b.pfx"]) assert.equal(conferirArquivo({ nome, tamanho: 3_000 }, regras), null, nome);
    assert.equal(conferirArquivo({ nome: "x.pfx", tamanho: TAMANHO_MAXIMO_PFX }, regras), null);
  });

  it("tipo errado, vazio ou grande demais: mensagem simples com o nome do arquivo e o que fazer", () => {
    assert.equal(conferirArquivo({ nome: "contrato.pdf", tamanho: 3_000 }, regras), "“contrato.pdf” não é um arquivo .pfx ou .p12. Escolha o arquivo certo.");
    assert.match(conferirArquivo({ nome: "pfx", tamanho: 3_000 }, regras)!, /não é um arquivo \.pfx ou \.p12/);
    assert.match(conferirArquivo({ nome: ".pfx", tamanho: 3_000 }, regras)!, /não é um arquivo/);
    assert.equal(conferirArquivo({ nome: "a.pfx", tamanho: 0 }, regras), "“a.pfx” está vazio. Escolha o arquivo de novo.");
    assert.equal(conferirArquivo({ nome: "foto.pfx", tamanho: 2 * 1024 * 1024 }, regras), "“foto.pfx” tem 2 MB, mais do que o limite de 100 KB. Confira se é o arquivo certo.");
  });

  it("o seletor do sistema filtra pelo .pfx/.p12 e a chamada é a mesma em todo lugar", () => {
    assert.equal(ACEITA_PFX, ".pfx,.p12,application/x-pkcs12");
    assert.equal(CHAMADA_DO_PFX, "Arraste o arquivo .pfx aqui ou clique para escolher");
  });
});
