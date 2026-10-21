// O campo único de envio de arquivo (app/campo-arquivo.tsx) e a tela do certificado da plataforma (/admin/plataforma) em
// passos curtos: a área grande de arrastar ou clicar com os tipos e o tamanho à vista, o arquivo escolhido com "Trocar
// arquivo", o erro em linguagem simples, o input real por baixo (rótulo, foco, teclado); sem certificado, uma chamada (não
// um erro vermelho) com o detalhe técnico no tooltip; com certificado, o cartão com "Trocar certificado". E o mesmo campo
// em todo lugar que pede o .pfx (a tela da plataforma e o assinador do navegador: termo, DCTFWeb e eSocial).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChamadaDoCertificado, CertificadoIlegivel, SituacaoDaIntegracao } from "@/app/admin/plataforma/estado";
import { CartaoDoCertificado, CertificadoDaPlataforma, FormularioCertificado, type CertificadoMostrado } from "@/app/admin/plataforma/formularios";
import { VistaDoCampoArquivo } from "@/app/campo-arquivo";
import { CHAMADA_DO_PFX, EXTENSOES_PFX, TAMANHO_MAXIMO_PFX } from "@/lib/arquivo";
import { explicacoes, semExplicacoes, texto } from "./tela";

const RAIZ = path.join(import.meta.dirname, "..");
const ler = (p: string) => readFileSync(path.join(RAIZ, p), "utf8");
const visivel = (html: string) => texto(semExplicacoes(html)).replace(/\s+/g, " ").trim();
const nada = () => {};
const acao = async () => undefined;

const vista = (extra: Partial<Parameters<typeof VistaDoCampoArquivo>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(VistaDoCampoArquivo, {
      id: "arquivo",
      rotulo: "Arquivo do e-CNPJ A1",
      chamada: CHAMADA_DO_PFX,
      extensoes: EXTENSOES_PFX,
      tamanhoMaximo: TAMANHO_MAXIMO_PFX,
      escolhido: null,
      erro: null,
      entrada: { name: "arquivo", accept: ".pfx,.p12", required: true },
      ...extra,
    }),
  );

describe("campo de envio de arquivo", () => {
  it("vazio: a área grande com a chamada, o ícone de documento, os tipos e o tamanho aceitos", () => {
    const html = vista();
    assert.equal(visivel(html), "Arquivo do e-CNPJ A1 Arraste o arquivo .pfx aqui ou clique para escolher Arquivo .pfx ou .p12 · até 100 KB");
    assert.match(html, /data-estado="vazio"/);
    assert.match(html, /border-dashed/);
    assert.match(html, /<span aria-hidden="true"[^>]*><svg viewBox="0 0 24 24"/); // o ícone de documento
  });

  it("acessível: input de arquivo de verdade dentro do label, com nome, descrição, accept, required e foco visível na área", () => {
    const html = vista();
    const input = html.match(/<input[^>]*>/)![0];
    assert.match(input, /type="file"/);
    assert.match(input, /name="arquivo"/);
    assert.match(input, /accept="\.pfx,\.p12"/);
    assert.match(input, /required=""/);
    assert.match(input, /class="sr-only"/); // escondido só da vista: o Tab chega nele e Enter/Espaço abrem o seletor
    const rotulo = input.match(/aria-labelledby="([^"]+)"/)![1];
    assert.match(html, new RegExp(`id="${rotulo}"[^>]*>Arquivo do e-CNPJ A1<`));
    const descricao = input.match(/aria-describedby="([^"]+)"/)![1];
    assert.match(html, new RegExp(`id="${descricao}"[^>]*>Arquivo \\.pfx ou \\.p12 · até 100 KB<`));
    assert.match(html, /<label[^>]*data-campo-arquivo=""[^>]*has-\[input:focus-visible\]:outline-2/);
    assert.ok(html.indexOf("<label") < html.indexOf("<input") && html.indexOf("<input") < html.indexOf("</label>"));
  });

  it("escolhido: o nome e o tamanho do arquivo e Trocar arquivo", () => {
    const html = vista({ escolhido: { nome: "empresa-2026.pfx", tamanho: 3_584 } });
    assert.equal(visivel(html), "Arquivo do e-CNPJ A1 empresa-2026.pfx Arquivo escolhido, 3,5 KB Trocar arquivo");
    assert.match(html, /data-estado="escolhido"/);
    assert.doesNotMatch(html, /Arraste o arquivo/);
  });

  it("erro: a mensagem simples em alerta, ligada ao campo", () => {
    const html = vista({ erro: "“contrato.pdf” não é um arquivo .pfx ou .p12. Escolha o arquivo certo." });
    assert.match(html, /data-estado="erro"/);
    const alerta = html.match(/<p id="([^"]+)" role="alert"[^>]*>([^<]+)</)!;
    assert.equal(alerta[2], "“contrato.pdf” não é um arquivo .pfx ou .p12. Escolha o arquivo certo.");
    assert.match(html.match(/<input[^>]*>/)![0], new RegExp(`aria-describedby="[^"]*${alerta[1]}"`));
  });

  it("rotuloPor: o título do passo dá nome ao campo (sem repetir o rótulo acima da área)", () => {
    const html = vista({ rotulo: undefined, rotuloPor: "titulo-do-passo" });
    assert.match(html.match(/<input[^>]*>/)![0], /aria-labelledby="titulo-do-passo"/);
    assert.equal(visivel(html), "Arraste o arquivo .pfx aqui ou clique para escolher Arquivo .pfx ou .p12 · até 100 KB");
  });

  it("desligado: não abre e mostra que não dá", () => {
    const html = vista({ disabled: true });
    assert.match(html.match(/<input[^>]*>/)![0], /disabled=""/);
    assert.match(html, /cursor-not-allowed/);
  });

  it("é o único input de arquivo do site: a tela da plataforma e o assinador (termo, DCTFWeb e eSocial) usam o mesmo campo", () => {
    const arquivos: string[] = [];
    const andar = (dir: string) => {
      for (const nome of readdirSync(path.join(RAIZ, dir))) {
        const p = path.join(dir, nome);
        if (statSync(path.join(RAIZ, p)).isDirectory()) andar(p);
        else if (p.endsWith(".tsx")) arquivos.push(p);
      }
    };
    andar("app");
    const comFile = arquivos.filter((p) => /type="file"|type=\{?["']file/.test(ler(p)));
    assert.deepEqual(comFile, [path.join("app", "campo-arquivo.tsx")]);
    assert.match(ler("app/admin/plataforma/formularios.tsx"), /<CampoArquivo/);
    assert.match(ler("app/assinador/assinador.tsx"), /<CampoArquivo/);
    for (const p of ["app/(painel)/autorizacao/assinar-termo.tsx", "app/(painel)/roteiro/componentes.tsx", "app/(painel)/esocial/componentes.tsx"]) {
      assert.match(ler(p), /<Assinador\b/, p);
    }
  });
});

const CERT: CertificadoMostrado = { titular: "SUPORTE TI LTDA", cnpj: "98.765.432/0001-98", emissor: "AC SERASA RFB v5", validoAte: "18/10/2027", vencido: false, enviado: "20/10/2026 por Ana" };

describe("tela do certificado da plataforma", () => {
  it("sem certificado: uma chamada clara para enviar (não erro vermelho); o motivo técnico fica no tooltip", () => {
    const motivo = "Falta o certificado da plataforma: envie em /admin/plataforma ou defina CERT_PFX_PATH no plataforma/.env.local (veja o README).";
    const html = renderToStaticMarkup(createElement(ChamadaDoCertificado, { doAmbiente: false, motivo }));
    assert.equal(visivel(html), "Envie o certificado da plataforma para ligar a integração.");
    assert.doesNotMatch(html, /text-bad|role="alert"/);
    assert.doesNotMatch(visivel(html), /CERT_PFX_PATH|\.env\.local|README|\/admin\/plataforma/);
    const [dica] = explicacoes(html);
    assert.match(dica.texto, /CERT_PFX_PATH/);
    assert.match(dica.texto, /Falta o certificado da plataforma/);
  });

  it("certificado do ambiente em uso: diz e convida a guardar aqui, sem alerta", () => {
    const html = renderToStaticMarkup(createElement(ChamadaDoCertificado, { doAmbiente: true }));
    assert.match(visivel(html), /Em uso o certificado do ambiente do servidor/);
    assert.doesNotMatch(html, /text-bad|role="alert"/);
  });

  it("guardado que não abre: frase curta em alerta, a explicação técnica no tooltip", () => {
    const html = renderToStaticMarkup(createElement(CertificadoIlegivel, { quando: "01/10/2026" }));
    assert.equal(visivel(html), "O certificado guardado não abre mais. Envie o e-CNPJ A1 de novo.");
    assert.match(explicacoes(html)[0].texto, /PLATAFORMA_CHAVE/);
  });

  it("integração desligada: 'Desligada' sem vermelho, com o motivo no tooltip", () => {
    const html = renderToStaticMarkup(createElement(SituacaoDaIntegracao, { nome: "eSocial", pronto: false, motivo: "Falta CERT_PFX_PATH." }));
    assert.equal(visivel(html), "eSocial Desligada");
    assert.doesNotMatch(html, /text-bad/);
    assert.match(explicacoes(html)[0].texto, /Falta CERT_PFX_PATH\./);
    assert.equal(visivel(renderToStaticMarkup(createElement(SituacaoDaIntegracao, { nome: "eSocial", pronto: true }))), "eSocial Pronta");
  });

  it("formulário em três passos curtos: o arquivo (o campo de arrastar), a senha e Enviar certificado", () => {
    const html = renderToStaticMarkup(createElement(FormularioCertificado, { acao, trocar: false })).replace(/<script[\s\S]*?<\/script>/g, "");
    assert.equal(
      visivel(html),
      "1 Escolha o arquivo do e-CNPJ A1 Arraste o arquivo .pfx aqui ou clique para escolher Arquivo .pfx ou .p12 · até 100 KB 2 Digite a senha do certificado 3 Envie o certificado Enviar certificado",
    );
    assert.match(html, /<ol[^>]*aria-label="Como enviar o certificado"/);
    assert.match(html.match(/<input[^>]*type="file"[^>]*>/)![0], /aria-labelledby="arquivo-titulo"/);
    assert.match(html, /<label for="senha"[^>]*>Digite a senha do certificado</);
    assert.match(html, /<input[^>]*id="senha"[^>]*type="password"/);
  });

  it("com certificado guardado: o cartão com titular, CNPJ, emissor, validade e Trocar certificado (o formulário só ao trocar)", () => {
    const html = renderToStaticMarkup(createElement(CertificadoDaPlataforma, { acao, certificado: CERT }));
    assert.equal(visivel(html), "Titular SUPORTE TI LTDA CNPJ 98.765.432/0001-98 Emissor AC SERASA RFB v5 Válido até 18/10/2027 Enviado 20/10/2026 por Ana Trocar certificado");
    assert.doesNotMatch(html, /type="file"/);
    const vencido = visivel(renderToStaticMarkup(createElement(CartaoDoCertificado, { certificado: { ...CERT, vencido: true }, aoTrocar: nada })));
    assert.match(vencido, /Válido até 18\/10\/2027 \(vencido\)/);
    // Sem certificado, o formulário direto.
    assert.match(renderToStaticMarkup(createElement(CertificadoDaPlataforma, { acao, certificado: null })), /type="file"/);
  });

  it("a página não mostra mais o texto técnico em vermelho nem 'Nenhum certificado guardado'", () => {
    const pagina = ler("app/admin/plataforma/page.tsx");
    assert.doesNotMatch(pagina, /Nenhum certificado guardado/);
    assert.match(pagina, /<ChamadaDoCertificado/);
    assert.match(pagina, /<CertificadoDaPlataforma/);
  });
});
