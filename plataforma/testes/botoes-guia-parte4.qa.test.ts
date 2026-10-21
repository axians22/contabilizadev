// QA da Parte 4 (rodada com os botões da guia): casos que os testes do engenheiro não cobrem.
// Pedido: "Quando o PDF da guia ainda não está no banco ..., mostre o botão mesmo assim e, ao clicar, busque ...; se não
// houver serviço para aquele caso, explique no tooltip e leve ao caminho no portal." e "'Guia original' quando vencida".
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GuiasDoMes } from "@/app/(painel)/guias-do-mes";
import { botoesDaGuia, type EntradaDosBotoes } from "@/lib/rotina/botoes-guia";
import type { GuiaDoMes } from "@/lib/rotina/guias";
import { conferirArquivo, EXTENSOES_PFX, TAMANHO_MAXIMO_PFX } from "@/lib/arquivo";
import { semExplicacoes, texto } from "./tela";

const visivel = (html: string) => texto(semExplicacoes(html)).replace(/\s+/g, " ").trim();
const entrada = (extra: Partial<EntradaDosBotoes> = {}): EntradaDosBotoes => ({
  pa: "2026-08", tipo: "DAS", situacao: "vencido", guardada: null, referencia: "98765432202608001", pagamento: null, autorizada: true, ...extra,
});
const guia = (tipo: "DAS" | "INSS", extra: Partial<GuiaDoMes> = {}): GuiaDoMes => ({
  pa: "2026-08", tipo, referencia: tipo === "DAS" ? "98765432202608001" : "50000534643844", vencimento: "2026-09-21", paga: false, pagaEm: null, vencida: true,
  original: null, atualizada: null, pagarEmSugerido: "2026-10-21", ...extra,
});

describe("QA parte 4: botões da guia", () => {
  it("vencida sem a original guardada (mês declarado fora): o botão 'Guia original' aparece mesmo assim, levando ao portal com o motivo no tooltip", () => {
    for (const tipo of ["DAS", "INSS"] as const) {
      const b = botoesDaGuia(entrada({ tipo }));
      assert.ok(b, `${tipo}: vencida sem PDF não mostra nenhum botão da guia (esperado: botão com explicação/portal)`);
      assert.ok(b.explicacao, `${tipo}: sem explicação no tooltip`);
    }
  });

  it("painel: cartão vencido de mês declarado fora mostra o botão da guia ao lado do 'Gerar guia com multa e juros'", () => {
    const html = renderToStaticMarkup(
      createElement(GuiasDoMes, {
        das: guia("DAS", { declarado: 1213.55 }),
        inss: guia("INSS"),
        dasCalculado: null,
        inssCalculado: 178.31,
        hoje: "2026-10-20",
        receitaLancada: true,
        autorizada: true,
        empresaId: "e",
        gerar: async () => undefined,
      }),
    );
    assert.match(visivel(html), /Vencido R\$\s1\.213,55/);
    assert.match(visivel(html), /Guia original/, "o cartão vencido não tem o botão 'Guia original'");
  });

  it("mês importado real (DAS e DARF pagos fora, comprovante do DAS já guardado): Ver guia e Baixar nos dois, valor pago no DARF", () => {
    const html = renderToStaticMarkup(
      createElement(GuiasDoMes, {
        das: guia("DAS", {
          pa: "2026-09", vencimento: "2026-10-20", vencida: false, paga: true, pagaEm: "2026-10-13", declarado: 1000.76,
          pagamento: { numero: "7202627851592322", valor: 1000.76 },
          comprovante: { id: "00000000-0000-0000-0000-0000000000c1", total: 1000.76, referencia: "comprovante:7202627851592322" } as never,
        }),
        inss: guia("INSS", { pa: "2026-09", vencimento: "2026-10-20", vencida: false, referencia: null, paga: true, pagaEm: "2026-10-13", pagamento: { numero: "7162627851517448", valor: 178.31 } }),
        dasCalculado: null,
        inssCalculado: null,
        hoje: "2026-10-20",
        receitaLancada: false,
        autorizada: true,
        empresaId: "e",
        gerar: async () => undefined,
      }),
    );
    const t = visivel(html);
    assert.match(t, /R\$\s1\.000,76 Pago em 13\/10\/2026 · valor declarado Ver guia Baixar/);
    assert.match(t, /R\$\s178,31 Pago em 13\/10\/2026 · valor pago Ver guia Baixar/);
    assert.match(html, /href="\/documentos\/guia\/00000000-0000-0000-0000-0000000000c1"[^>]*target="_blank"/);
    // Ajustado pelo engenheiro (item 2 do QA): no modo "buscar" o Baixar abre em nova aba sem `download`, para a falha da
    // busca mostrar a mensagem em linguagem simples; dando certo, a rota manda Content-Disposition: attachment.
    assert.match(html, /href="\/documentos\/guia-do-mes\/INSS\/2026-09\?baixar=1"[^>]*target="_blank"/);
  });
});

describe("QA parte 4: campo de arquivo (bordas)", () => {
  const regras = { extensoes: EXTENSOES_PFX, tamanhoMaximo: TAMANHO_MAXIMO_PFX };
  it("extensão em maiúsculas serve; exatamente no limite serve; 1 byte acima não", () => {
    assert.equal(conferirArquivo({ nome: "EMPRESA.PFX", tamanho: 4000 }, regras), null);
    assert.equal(conferirArquivo({ nome: "cert.P12", tamanho: TAMANHO_MAXIMO_PFX }, regras), null);
    assert.match(conferirArquivo({ nome: "cert.pfx", tamanho: TAMANHO_MAXIMO_PFX + 1 }, regras) ?? "", /limite/);
  });
  it("nome sem extensão, extensão parecida e dupla extensão enganosa são recusados", () => {
    assert.ok(conferirArquivo({ nome: "certificado", tamanho: 10 }, regras));
    assert.ok(conferirArquivo({ nome: "cert.pfxx", tamanho: 10 }, regras));
    assert.ok(conferirArquivo({ nome: "cert.pfx.pdf", tamanho: 10 }, regras));
    assert.equal(conferirArquivo({ nome: "cert.pdf.pfx", tamanho: 10 }, regras), null);
  });
});
