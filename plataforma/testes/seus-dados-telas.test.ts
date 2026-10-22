// Telas novas da prova de posse (21/10/2026), renderizadas no servidor sem banco: "Seus dados", os termos e o estado
// "aguardando comprovação" das abas. Regras de tela: explicação só no tooltip, nenhum fornecedor, nada de dado pessoal de
// mais ninguém.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FormularioDados } from "@/app/(conta)/meus-dados/formulario";
import { PortaoFechado } from "@/app/(painel)/portao";
import { ABAS_DA_EMPRESA } from "@/lib/abas";
import type { AcessoProvisorio } from "@/lib/empresas/acesso";
import { TEXTO_DOS_TERMOS } from "@/lib/usuarios/termos";
import { explicacoes, semExplicacoes, texto } from "./tela";

const visivel = (html: string) => texto(semExplicacoes(html));
const FORNECEDOR = /serpro|integra contador|brasil ?api/i;
const nada = async () => undefined;
const semCep = async () => ({ erro: "x" });

describe("Seus dados (formulário)", () => {
  it("primeira vez: todos os campos, o aceite com o link dos termos e 'Salvar e continuar'; nada de fornecedor", () => {
    const html = renderToStaticMarkup(createElement(FormularioDados, { inicial: null, aceitoAntes: false, identidadeTravada: false, hoje: "2026-10-21", salvar: nada, buscarCep: semCep }));
    for (const nome of ["nomeCompleto", "cpf", "dataNascimento", "whatsapp", "cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf", "aceite"]) assert.match(html, new RegExp(`name="${nome}"`), nome);
    assert.match(html, /type="date"[^>]*max="2026-10-21"|max="2026-10-21"[^>]*type="date"/);
    assert.match(html, /<a [^>]*href="\/termos"[^>]*>termos de uso e a política de privacidade<\/a>/);
    assert.match(visivel(html), /Salvar e continuar/);
    assert.match(visivel(html), /Preenchemos o endereço pelo CEP/);
    assert.doesNotMatch(html, FORNECEDOR);
    assert.ok(explicacoes(html).some((e) => e.rotulo === "Qual nome devo escrever?"));
    assert.doesNotMatch(html, /type="checkbox"[^>]*checked/);
  });

  it("editando com empresa cadastrada: os dados aparecem formatados, nome e CPF só para leitura, o aceite já marcado", () => {
    const inicial = {
      nomeCompleto: "Fulana de Tal Exemplo",
      cpf: "52912345634",
      dataNascimento: "1990-05-10",
      whatsapp: "+5548999991234",
      cep: "88010000",
      logradouro: "Rua Felipe Schmidt",
      numero: "100",
      complemento: "",
      bairro: "Centro",
      cidade: "Florianópolis",
      uf: "SC",
    };
    const html = renderToStaticMarkup(createElement(FormularioDados, { inicial, aceitoAntes: true, identidadeTravada: true, hoje: "2026-10-21", salvar: nada, buscarCep: semCep }));
    assert.match(html, /value="529\.123\.456-34"/);
    assert.match(html, /value="\(48\) 99999-1234"/);
    assert.match(html, /value="88010-000"/);
    assert.match(html, /<input[^>]*id="nomeCompleto"[^>]*readOnly=""|<input[^>]*readOnly=""[^>]*id="nomeCompleto"/i);
    assert.match(html, /<input[^>]*id="cpf"[^>]*readOnly=""|<input[^>]*readOnly=""[^>]*id="cpf"/i);
    assert.match(html, /type="checkbox"[^>]*checked=""/);
    assert.ok(explicacoes(html).some((e) => /só mudam pelo suporte/.test(e.texto)));
    assert.match(visivel(html), /Salvar/);
  });

  it("os termos provisórios não citam o fornecedor e falam da LGPD e do quadro de sócios", () => {
    assert.doesNotMatch(TEXTO_DOS_TERMOS, FORNECEDOR);
    assert.match(TEXTO_DOS_TERMOS, /LGPD/);
    assert.match(TEXTO_DOS_TERMOS, /quadro de sócios/);
    assert.match(TEXTO_DOS_TERMOS, /só aparecem para você/);
  });
});

describe("aba com a empresa aguardando comprovação", () => {
  const EMPRESA = { id: "e1", cnpj: "12345678000195", razaoSocial: "EXEMPLO SOFTWARE LTDA", papel: "PROVISORIO" as const };
  for (const aba of ABAS_DA_EMPRESA) {
    it(`${aba.href}: estado de espera curto, o porquê no tooltip e o botão para assinar o termo`, () => {
      const html = renderToStaticMarkup(createElement(PortaoFechado, { aba, portao: { estado: "aguardando", empresa: EMPRESA, termo: {} as AcessoProvisorio } }));
      const t = visivel(html);
      assert.match(t, /Esta empresa aguarda comprovação/);
      assert.match(t, /Assine o termo de autorização com o e-CNPJ da empresa para liberar esta aba\./);
      assert.match(html, /<a[^>]*href="\/autorizacao"[^>]*>Assinar o termo<\/a>/);
      assert.ok(explicacoes(html).some((e) => /emitido em nome do seu CPF/.test(e.texto)));
      assert.doesNotMatch(html, FORNECEDOR);
    });
  }
});
