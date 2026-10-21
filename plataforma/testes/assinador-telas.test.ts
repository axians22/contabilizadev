// Telas do assinador único (app/assinador): as duas opções com a explicação no tooltip, a linha discreta do certificado
// guardado (com o aviso de vencimento e as ações), a oferta de apagar ao sair, e os três lugares que assinam (termo no
// passo 7 e em /autorizacao, DCTFWeb na rotina) usando o mesmo componente, sem formulário de certificado próprio.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EscolhaDoModo, EXPLICACAO_GUARDAR, LinhaDoGuardado } from "@/app/assinador/assinador";
import { OfertaAoSair } from "@/app/assinador/guardados";
import type { InfoCertificado } from "@contabilizadev/nucleo/serpro/termo-xml";
import { explicacoes, paragrafosVisiveis, semExplicacoes, texto } from "./tela";

const RAIZ = path.join(import.meta.dirname, "..");
const ler = (p: string) => readFileSync(path.join(RAIZ, p), "utf8");
const DIA = 24 * 60 * 60 * 1000;
const CNPJ = "98765432000198";
const AGORA = new Date("2026-10-18T13:00:00Z");
const nada = () => {};

const registro = (validoAte: Date, cnpj = CNPJ) => ({
  cnpj,
  info: {
    titular: { tipo: "PJ", numero: cnpj, nome: "SUPORTE TI LTDA" },
    validoDe: new Date("2026-01-01"),
    validoAte,
    autoassinado: false,
    icpBrasil: true,
    politica: "A1",
    emissor: "AC",
    bitsChave: 2048,
  } satisfies Omit<InfoCertificado, "certificadoBase64">,
});
const linha = (validoAte: Date, cnpj = CNPJ) =>
  renderToStaticMarkup(createElement(LinhaDoGuardado, { registro: registro(validoAte, cnpj), cnpj: CNPJ, agora: AGORA, rotulo: "Assinar e transmitir", ocupado: false, aoAssinar: nada, aoTrocar: nada, aoRemover: nada }));
const visivel = (html: string) => texto(semExplicacoes(html)).trim();

describe("as duas opções: Usar só agora (padrão) e Guardar neste navegador", () => {
  const html = renderToStaticMarkup(createElement(EscolhaDoModo, { nome: "dctf", modo: "agora", aoMudar: nada, podeGuardar: true }));

  it("na tela, só os dois nomes; Usar só agora vem marcado", () => {
    assert.equal(visivel(html), "Como usar o certificado Usar só agora Guardar neste navegador");
    assert.match(html, /<input[^>]*id="dctf-agora"[^>]*checked=""/);
    assert.doesNotMatch(html, /<input[^>]*id="dctf-guardar"[^>]*checked=""/);
  });

  it("o tooltip de Guardar explica em linguagem simples: só aqui, ninguém copia, computador pessoal, limpar apaga", () => {
    const guardar = explicacoes(html).find((e) => e.rotulo === "O que acontece ao guardar o certificado neste navegador?");
    assert.ok(guardar);
    assert.match(guardar.texto, /só neste navegador e neste computador/);
    assert.match(guardar.texto, /A senha não é guardada/);
    assert.match(guardar.texto, /Ninguém consegue copiar a chave guardada: nem você, nem a plataforma/);
    assert.match(guardar.texto, /Quem usar este computador com este perfil do navegador consegue assinar\. Use só em computador pessoal\./);
    assert.match(guardar.texto, /Limpar os dados do navegador apaga o certificado guardado/);
    assert.equal(guardar.texto.includes(EXPLICACAO_GUARDAR[0]), true);
    const agora = explicacoes(html).find((e) => e.rotulo === "O que acontece em Usar só agora?");
    assert.match(agora!.texto, /Nada fica guardado/);
  });

  it("sem cofre no navegador, só Usar só agora", () => {
    const sem = renderToStaticMarkup(createElement(EscolhaDoModo, { nome: "x", modo: "agora", aoMudar: nada, podeGuardar: false }));
    assert.doesNotMatch(visivel(sem), /Guardar/);
  });
});

describe("certificado guardado: linha discreta com tooltip, aviso de vencimento e ações", () => {
  it("pronto: 'Certificado guardado neste navegador · CNPJ · válido até', Assinar, Trocar e Remover", () => {
    const html = linha(new Date("2027-01-10T15:00:00Z"));
    assert.equal(
      visivel(html),
      "Certificado guardado neste navegador · CNPJ 98.765.432/0001-98 · válido até 10/01/2027 Assinar e transmitir Trocar certificado Remover deste navegador",
    );
    assert.match(html, /<p class="[^"]*text-xs text-muted/);
    assert.ok(explicacoes(html).some((e) => e.rotulo === "O que é o certificado guardado neste navegador?"));
  });

  it("faltando 30 dias ou menos, avisa para trocar e ainda assina", () => {
    const html = linha(new Date(AGORA.getTime() + 30 * DIA));
    assert.deepEqual(paragrafosVisiveis(html).slice(1), ["O certificado vence em 30 dias: troque quando renovar o e-CNPJ."]);
    assert.match(visivel(html), /Assinar e transmitir/);
    assert.doesNotMatch(visivel(linha(new Date(AGORA.getTime() + 31 * DIA))), /vence em/);
  });

  it("vencido ou de outro CNPJ: não oferece assinar, pede para trocar", () => {
    const vencido = linha(new Date(AGORA.getTime() - DIA));
    assert.match(visivel(vencido), /venceu em 17\/10\/2026\. Troque o certificado\./);
    assert.doesNotMatch(visivel(vencido), /Assinar e transmitir/);
    assert.match(visivel(vencido), /Trocar certificado Remover deste navegador/);
    const outro = linha(new Date(AGORA.getTime() + 90 * DIA), "12345678000195");
    assert.match(visivel(outro), /é de outro CNPJ\. Troque o certificado\./);
    assert.doesNotMatch(visivel(outro), /Assinar e transmitir/);
  });
});

describe("apagar o guardado ao sair e ao remover a empresa", () => {
  it("ao sair: pergunta com os CNPJs, a explicação no tooltip e as três saídas", () => {
    const html = renderToStaticMarkup(createElement(OfertaAoSair, { cnpjs: [CNPJ], sair: nada, cancelar: nada }));
    assert.equal(visivel(html), "Apagar o certificado guardado neste navegador? CNPJ 98.765.432/0001-98 Cancelar Sair e manter Apagar e sair");
    assert.ok(explicacoes(html).some((e) => /só neste navegador/.test(e.texto)));
  });

  it("o menu do usuário e a remoção da empresa oferecem apagar (só o navegador apaga)", () => {
    const menu = ler("app/(painel)/menu-usuario.tsx");
    assert.match(menu, /cnpjsGuardados\(\)/);
    assert.match(menu, /<OfertaAoSair /);
    const remover = ler("app/(painel)/empresa/remover-empresa.tsx");
    assert.match(remover, /useGuardado\(empresa\.cnpj\)/);
    assert.match(remover, /Apagar também o certificado guardado neste navegador/);
    assert.match(remover, /name="apagarCertificado"/);
    assert.match(remover, /acaoDeRemover\(remover, empresa\.cnpj, \{ apagar: apagarGuardados,/);
    // A ação do formulário é a do useActionState direto (sem await antes dela, fora da transição).
    assert.match(remover, /<form action=\{executar\}/);
  });
});

describe("um só assinador para o termo (passo 7 e /autorizacao) e a DCTFWeb", () => {
  const termo = ler("app/(painel)/autorizacao/assinar-termo.tsx");
  const dctf = ler("app/(painel)/roteiro/componentes.tsx");

  it("os dois usam <Assinador> e não têm formulário de certificado próprio nem o node-forge", () => {
    for (const fonte of [termo, dctf]) {
      assert.match(fonte, /<Assinador\b/);
      assert.doesNotMatch(fonte, /type="password"|type="file"|abrirCertificado|arrayBuffer\(\)/);
      assert.doesNotMatch(fonte, /nucleo\/serpro\/termo-autorizacao/);
    }
    // O passo 7 do cadastro usa o mesmo AssinarTermo da página Autorização.
    assert.match(ler("app/(painel)/empresas/nova/etapa-autorizacao.tsx"), /<AssinarTermo\b/);
    assert.match(ler("app/(painel)/autorizacao/page.tsx"), /<AssinarTermo\b/);
  });

  it("a confirmação explícita antes de transmitir continua (DCTFWeb) e o termo continua com Assinar e autorizar", () => {
    assert.match(dctf, /Confirmo a DCTFWeb/);
    assert.match(dctf, /disabled=\{!confirmado \|\| enviando\}/);
    assert.match(termo, /Assinar e autorizar/);
  });

  it("o node-forge só entra para abrir o .pfx (import sob demanda no assinador)", () => {
    const logica = ler("lib/assinador/assinador.ts");
    assert.match(logica, /await import\("@contabilizadev\/nucleo\/serpro\/termo-autorizacao"\)/);
    assert.doesNotMatch(logica, /^import .*termo-autorizacao/m);
    assert.doesNotMatch(ler("../nucleo/src/serpro/termo-xml.ts"), /^import .*(node-forge|termo-autorizacao)/m);
  });
});
