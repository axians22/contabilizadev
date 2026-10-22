import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exigeSeusDados } from "./portao-dos-dados";
import {
  formatarWhatsapp,
  mascararCep,
  mascararCpf,
  mascararTelefone,
  MENSAGENS,
  nomeParaComparar,
  normalizarNome,
  normalizarWhatsapp,
  validarCpf,
  validarDadosPessoais,
  validarNascimento,
} from "./validacao";

const HOJE = "2026-10-21";

describe("CPF", () => {
  it("aceita com e sem pontuação, recusa dígito errado, tamanho errado e números repetidos", () => {
    assert.equal(validarCpf("529.982.247-25"), "52998224725");
    assert.equal(validarCpf("52998224725"), "52998224725");
    assert.equal(validarCpf("529.982.247-24"), null);
    assert.equal(validarCpf("5299822472"), null);
    assert.equal(validarCpf("529982247251"), null);
    for (const d of "0123456789") assert.equal(validarCpf(d.repeat(11)), null, d);
    assert.equal(validarCpf(""), null);
  });
});

describe("WhatsApp", () => {
  it("celular e fixo brasileiros, com ou sem +55, 0, espaços e pontuação; guardado como +55DDNÚMERO", () => {
    assert.equal(normalizarWhatsapp("(48) 99999-1234"), "+5548999991234");
    assert.equal(normalizarWhatsapp("+55 48 99999-1234"), "+5548999991234");
    assert.equal(normalizarWhatsapp("5548999991234"), "+5548999991234");
    assert.equal(normalizarWhatsapp("048999991234"), "+5548999991234");
    assert.equal(normalizarWhatsapp("(11) 3333-4444"), "+551133334444");
  });

  it("recusa DDD que não existe, celular sem o 9, tamanho errado e número de outro país", () => {
    assert.equal(normalizarWhatsapp("(20) 99999-1234"), null);
    assert.equal(normalizarWhatsapp("(10) 99999-1234"), null);
    assert.equal(normalizarWhatsapp("(48) 89999-1234"), null);
    assert.equal(normalizarWhatsapp("(48) 9999-123"), null);
    assert.equal(normalizarWhatsapp("(48) 6999-1234"), null); // fixo começa de 2 a 5
    assert.equal(normalizarWhatsapp("+1 415 555 0100"), null);
    assert.equal(normalizarWhatsapp(""), null);
  });

  it("formata o guardado para a tela", () => {
    assert.equal(formatarWhatsapp("+5548999991234"), "(48) 99999-1234");
    assert.equal(formatarWhatsapp("+551133334444"), "(11) 3333-4444");
  });
});

describe("data de nascimento", () => {
  it("data que existe, no passado, depois de 1900", () => {
    assert.equal(validarNascimento("1990-05-10", HOJE), "1990-05-10");
    assert.equal(validarNascimento("2026-10-20", HOJE), "2026-10-20");
    assert.equal(validarNascimento("2026-10-21", HOJE), null, "hoje não é passado");
    assert.equal(validarNascimento("2030-01-01", HOJE), null);
    assert.equal(validarNascimento("1990-02-30", HOJE), null);
    assert.equal(validarNascimento("1899-12-31", HOJE), null);
    assert.equal(validarNascimento("10/05/1990", HOJE), null);
    assert.equal(validarNascimento("", HOJE), null);
  });
});

describe("nome completo", () => {
  it("nome e sobrenome, letras com acento, apóstrofo e hífen; espaços arrumados", () => {
    assert.equal(normalizarNome("  José   d’Ávila  "), "José d’Ávila");
    assert.equal(normalizarNome("Ana Maria Silva-Souza"), "Ana Maria Silva-Souza");
    assert.equal(normalizarNome("Ana"), null);
    assert.equal(normalizarNome("Ana 2"), null);
    assert.equal(normalizarNome("Ana S"), null);
    assert.equal(normalizarNome("R2D2 Silva"), null);
    assert.equal(normalizarNome("A".repeat(60) + " " + "B".repeat(61)), null);
  });

  it("para comparar com o quadro de sócios: sem acento, maiúsculas, um espaço", () => {
    assert.equal(nomeParaComparar("José  d’Ávila da Conceição"), "JOSE D AVILA DA CONCEICAO");
    assert.equal(nomeParaComparar("FULANA DE TAL EXEMPLO"), nomeParaComparar("Fulana de Tal Exemplo"));
  });
});

describe("formulário inteiro", () => {
  const ok = {
    nomeCompleto: "Fulana de Tal Exemplo",
    cpf: "529.982.247-25",
    dataNascimento: "1990-05-10",
    whatsapp: "(48) 99999-1234",
    cep: "88010-000",
    logradouro: "Rua Felipe Schmidt",
    numero: "s/n",
    complemento: "",
    bairro: "Centro",
    cidade: "Florianópolis",
    uf: "sc",
    aceite: "on",
  };

  it("devolve os dados na forma de guardar", () => {
    const r = validarDadosPessoais(ok, HOJE);
    assert.ok(r.ok);
    assert.deepEqual(r.dados, {
      nomeCompleto: "Fulana de Tal Exemplo",
      cpf: "52998224725",
      dataNascimento: "1990-05-10",
      whatsapp: "+5548999991234",
      cep: "88010000",
      logradouro: "Rua Felipe Schmidt",
      numero: "S/N",
      complemento: null,
      bairro: "Centro",
      cidade: "Florianópolis",
      uf: "SC",
    });
  });

  it("um erro por campo; sem o aceite não passa", () => {
    const r = validarDadosPessoais({ ...ok, cpf: "111.111.111-11", whatsapp: "123", uf: "XX", aceite: "", cep: "1234", logradouro: " " }, HOJE);
    assert.ok(!r.ok);
    assert.deepEqual(Object.keys(r.erros).sort(), ["aceite", "cep", "cpf", "logradouro", "uf", "whatsapp"]);
    assert.equal(r.erros.aceite, MENSAGENS.aceite);
    // As mensagens não repetem o que foi digitado (nada de dado pessoal no erro).
    for (const m of Object.values(r.erros)) assert.doesNotMatch(m!, /111|123|XX/);
  });

  it("vazio: todos os obrigatórios faltam (o complemento é opcional)", () => {
    const r = validarDadosPessoais({}, HOJE);
    assert.ok(!r.ok);
    assert.ok(!("complemento" in r.erros));
    assert.equal(Object.keys(r.erros).length, 11);
  });
});

describe("máscaras da tela", () => {
  it("CPF, CEP e telefone enquanto digita", () => {
    assert.equal(mascararCpf("52998224725"), "529.982.247-25");
    assert.equal(mascararCpf("5299"), "529.9");
    assert.equal(mascararCep("88010000"), "88010-000");
    assert.equal(mascararCep("880"), "880");
    assert.equal(mascararTelefone("48999991234"), "(48) 99999-1234");
    assert.equal(mascararTelefone("1133334444"), "(11) 3333-4444");
    assert.equal(mascararTelefone("4"), "(4");
  });
});

describe("portão do primeiro login (quem precisa preencher Seus dados)", () => {
  it("só o usuário comum com os dados pendentes; ADMIN e MANAGER entram direto", () => {
    assert.equal(exigeSeusDados({ papel: "COMMON_USER", dadosPendentes: true }), true);
    assert.equal(exigeSeusDados({ papel: "COMMON_USER", dadosPendentes: false }), false);
    assert.equal(exigeSeusDados({ papel: "ADMIN", dadosPendentes: true }), false);
    assert.equal(exigeSeusDados({ papel: "MANAGER", dadosPendentes: true }), false);
  });
});
