// Remover a empresa com o certificado guardado neste navegador: a chave só é apagada depois de o servidor confirmar a
// remoção ({ ok }), e a volta para Dados da empresa vem depois de apagar. Com { erro } (sem permissão, sessão vencida,
// erro de banco), nada é apagado e a tela fica onde está mostrando o erro.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acaoDeRemover } from "@/app/(painel)/empresa/remover-empresa";
import type { EstadoRemocao } from "@/app/(painel)/empresa/acoes";

const CNPJ = "12345678000195";

function formulario(apagarCertificado: boolean) {
  const dados = new FormData();
  dados.set("empresaId", "00000000-0000-4000-8000-000000000001");
  dados.set("cnpj", CNPJ);
  if (apagarCertificado) dados.set("apagarCertificado", "on");
  return dados;
}

function montar(resposta: EstadoRemocao | Error) {
  const passos: string[] = [];
  const acao = acaoDeRemover(
    async () => {
      passos.push("servidor");
      if (resposta instanceof Error) throw resposta;
      return resposta;
    },
    CNPJ,
    {
      apagar: async (cnpjs) => void passos.push(`apagar ${cnpjs.join(",")}`),
      navegar: (url) => void passos.push(`navegar ${url}`),
    },
  );
  return { acao, passos };
}

describe("remover a empresa e apagar o certificado guardado", () => {
  it("com { ok } e a caixa marcada: o servidor remove, depois apaga a chave desta empresa, depois volta com ?removida=1", async () => {
    const { acao, passos } = montar({ ok: true });
    assert.deepEqual(await acao(undefined, formulario(true)), { ok: true });
    assert.deepEqual(passos, ["servidor", `apagar ${CNPJ}`, "navegar /empresa?removida=1"]);
  });

  it("com { ok } e a caixa desmarcada (ou sem certificado guardado): não apaga, só volta", async () => {
    const { acao, passos } = montar({ ok: true });
    await acao(undefined, formulario(false));
    assert.deepEqual(passos, ["servidor", "navegar /empresa?removida=1"]);
  });

  it("com { erro } do servidor: a chave continua guardada e a tela não sai do lugar", async () => {
    const { acao, passos } = montar({ erro: "Só o dono pode remover a empresa." });
    assert.deepEqual(await acao(undefined, formulario(true)), { erro: "Só o dono pode remover a empresa." });
    assert.deepEqual(passos, ["servidor"]);
  });

  it("falha inesperada no servidor (exceção): a chave continua guardada", async () => {
    const { acao, passos } = montar(new Error("banco fora do ar"));
    await assert.rejects(acao(undefined, formulario(true)), /banco fora do ar/);
    assert.deepEqual(passos, ["servidor"]);
  });
});
