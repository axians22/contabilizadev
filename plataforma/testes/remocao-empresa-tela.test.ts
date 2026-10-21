// Tela da remoção da empresa (Dados da empresa): seção discreta só para o DONO, explicação no tooltip, caixa de diálogo
// acessível que pede o CNPJ para liberar "Remover definitivamente". HTML do servidor, como o navegador recebe.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { RemoverEmpresa } from "@/app/(painel)/empresa/remover-empresa";
import { explicacoes, paragrafosVisiveis, semExplicacoes, texto } from "./tela";

const EMPRESA = { id: "00000000-0000-4000-8000-000000000001", cnpj: "12345678000195", razaoSocial: "Alfa Software Ltda" };
const nada = async () => undefined;
// O componente usa o roteador (volta para Dados da empresa depois de remover): no teste, um roteador que não navega.
const roteador = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} } as never;
const tela = (papel: "DONO" | "MEMBRO") =>
  renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: roteador }, createElement(RemoverEmpresa, { empresa: { ...EMPRESA, papel }, remover: nada })));

describe("Remover empresa (tela)", () => {
  it("MEMBRO não vê nada da remoção", () => {
    assert.equal(tela("MEMBRO"), "");
  });

  it("DONO vê a seção 'Remover empresa' com uma frase curta e o botão que abre a confirmação", () => {
    const html = tela("DONO");
    const visivel = texto(semExplicacoes(html.replace(/<dialog[\s\S]*<\/dialog>/, "")));
    assert.match(visivel, /Remover empresa/);
    assert.match(html, /<button[^>]*type="button"[^>]*>Remover empresa…<\/button>/);
    for (const p of paragrafosVisiveis(html)) assert.ok(p.length <= 140, `parágrafo longo: ${p}`);
  });

  it("a explicação fica no tooltip: o que é apagado, que nada muda na Receita Federal e o termo deixa de ser usado", () => {
    const [balao, ...outros] = explicacoes(tela("DONO"));
    assert.equal(outros.length, 0);
    assert.equal(balao.rotulo, "O que acontece ao remover a empresa?");
    assert.match(balao.texto, /dados consultados na Receita Federal/);
    assert.match(balao.texto, /termo de autorização/);
    assert.match(balao.texto, /Nada é apagado nem cancelado na Receita Federal/);
    assert.match(balao.texto, /continuam lá/);
    assert.match(balao.texto, /deixa de usar o termo de autorização e apaga a cópia/);
    assert.match(balao.texto, /cadastrada de novo/);
  });

  it("a confirmação é uma caixa de diálogo acessível que pede o CNPJ e começa com o botão travado", () => {
    const html = tela("DONO");
    const dialogo = /<dialog\b[^>]*>[\s\S]*<\/dialog>/.exec(html)?.[0];
    assert.ok(dialogo, "sem <dialog>");
    const titulo = /aria-labelledby="([^"]+)"/.exec(dialogo)?.[1];
    const descricao = /aria-describedby="([^"]+)"/.exec(dialogo)?.[1];
    assert.ok(titulo && dialogo.includes(`id="${titulo}"`), "título do diálogo");
    assert.ok(descricao && dialogo.includes(`id="${descricao}"`), "descrição do diálogo");
    assert.match(texto(dialogo), /Remover Alfa Software Ltda\?/);
    // A explicação do diálogo: 1-2 frases.
    const frase = texto(new RegExp(`<p[^>]*id="${descricao}"[^>]*>([\\s\\S]*?)</p>`).exec(dialogo)?.[1] ?? "").trim();
    assert.ok(frase.split(/[.!?](\s|$)/).filter((f) => f.trim()).length <= 2, frase);
    assert.match(frase, /todos os dados dela/);
    // Campo do CNPJ com rótulo ligado e o CNPJ formatado à vista.
    const campo = /<input[^>]*name="cnpj"[^>]*>/.exec(dialogo)?.[0] ?? "";
    const idCampo = /id="([^"]+)"/.exec(campo)?.[1];
    assert.ok(idCampo && dialogo.includes(`for="${idCampo}"`), "rótulo do campo");
    assert.match(texto(dialogo), /Digite o CNPJ 12\.345\.678\/0001-95 para confirmar/);
    assert.match(dialogo, /<input type="hidden" name="empresaId" value="00000000-0000-4000-8000-000000000001"\/>/);
    assert.match(dialogo, /<button type="submit" disabled=""[^>]*>Remover definitivamente<\/button>/);
    assert.match(dialogo, /<button type="button"[^>]*>Cancelar<\/button>/);
  });

  it("a página de Dados da empresa mostra a seção (liberada e sem plano), e a ação confere no servidor e volta com a confirmação", () => {
    const raiz = path.join(import.meta.dirname, "..", "app", "(painel)", "empresa");
    const pagina = readFileSync(path.join(raiz, "page.tsx"), "utf8");
    assert.equal(pagina.match(/<RemoverEmpresa /g)?.length, 2);
    assert.match(pagina, /Empresa removida\./);
    const acoes = readFileSync(path.join(raiz, "acoes.ts"), "utf8");
    assert.match(acoes, /removerEmpresa\(banco\(\), sessao,/);
    // A ação devolve { ok } (sem redirect): o navegador apaga o certificado guardado e então volta com ?removida=1.
    assert.match(acoes, /return \{ ok: true \};/);
    assert.doesNotMatch(acoes, /redirect\(/);
    assert.match(readFileSync(path.join(raiz, "remover-empresa.tsx"), "utf8"), /navegar\("\/empresa\?removida=1"\)/);
  });
});
