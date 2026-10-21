// QA (Parte 6, assinador): remoção da empresa com o certificado guardado neste navegador.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const RAIZ = path.join(import.meta.dirname, "..");
const fonte = readFileSync(path.join(RAIZ, "app/(painel)/empresa/remover-empresa.tsx"), "utf8");

describe("QA: remover a empresa e apagar o certificado guardado", () => {
  it("a ação de remover (useActionState) não é disparada depois de um await fora de startTransition", () => {
    // Depois de um await, o React 19 já não está na transição do <form action>: chamar o dispatch do useActionState
    // ali gera o erro "An async function with useActionState was called outside of a transition" e o `pendente` não
    // liga (o botão "Remover definitivamente" fica ativo durante a remoção e aceita clique duplo).
    const acao = fonte.slice(fonte.indexOf("action={async"), fonte.indexOf("className=\"flex flex-col gap-4\""));
    const depoisDoAwait = acao.slice(acao.indexOf("await") === -1 ? acao.length : acao.indexOf("await"));
    assert.ok(!/\bexecutar\(/.test(depoisDoAwait) || /startTransition\(/.test(depoisDoAwait), "executar(dados) é chamado depois de await, fora de startTransition");
  });

  it("o certificado guardado só é apagado depois de o servidor remover a empresa", () => {
    // Hoje é apagado antes de o pedido sair: se a remoção falhar no servidor (sem permissão, erro), a chave já se foi.
    const acao = fonte.slice(fonte.indexOf("action={async"), fonte.indexOf("className=\"flex flex-col gap-4\""));
    assert.ok(acao.indexOf("apagarGuardados") === -1 || acao.indexOf("apagarGuardados") > acao.indexOf("executar("), "apagarGuardados roda antes de a remoção ser confirmada pelo servidor");
  });
});
