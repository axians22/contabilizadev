// Relatório de situação fiscal (SITFIS) pelo Serpro: pede um protocolo, espera o tempo indicado e emite o PDF.
// O relatório mostra pendências com a Receita e a PGFN (o mesmo que a certidão negativa considera).
// Serve para a empresa e, com procuração do CPF para o CNPJ no e-CAC, para o sócio (contribuinte tipo 1).
import { textoDoPdf } from "../pdf.ts";
import { falha, textoMensagens, type ClienteSerpro, type Contexto, type Resultado } from "./cliente.ts";

export const INTERVALO_MESES = 2;
const espera = (v: unknown) => Math.min(Math.max(Number(v) || 5000, 1000), 30_000);
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Lê o diagnóstico do relatório: o trecho entre "Diagnóstico Fiscal" e "Final do Relatório".
// regular: true sem pendências, false com pendências, null quando não deu para saber.
export function lerDiagnostico(texto: string): { regular: boolean | null; diagnostico: string } {
  const inicio = texto.search(/Diagn[óo]stico Fiscal/i);
  const fim = texto.search(/Final do Relat[óo]rio/i);
  const trecho = (inicio >= 0 ? texto.slice(inicio, fim > inicio ? fim : undefined) : texto)
    .split("\n")
    .map((l) => l.replace(/_{3,}/g, "").trim())
    .filter((l) => l && !/^Diagn[óo]stico Fiscal/i.test(l))
    .join("\n");
  if (/N[ãa]o foram detectadas pend[êe]ncias/i.test(trecho)) return { regular: true, diagnostico: trecho };
  if (/pend[êe]ncia|d[ée]bito|omiss[ãa]o|exigibilidade/i.test(trecho)) return { regular: false, diagnostico: trecho };
  return { regular: null, diagnostico: trecho };
}

// Próxima verificação automática: 2 meses depois do último relatório pronto ("AAAA-MM-DD").
export function proximaVerificacao(ultimoProntoEm: Date): string {
  const d = new Date(ultimoProntoEm);
  d.setMonth(d.getMonth() + INTERVALO_MESES);
  return d.toLocaleDateString("sv-SE");
}

export type Relatorio = { pdf: string; regular: boolean | null; diagnostico: string };

// `quem` aparece na finalidade registrada ("da empresa", "do CPF do sócio"). `esperar` é trocado nos testes.
export async function gerarRelatorio(
  cliente: ClienteSerpro,
  ctx: Contexto,
  quem: string,
  esperar: (ms: number) => Promise<void> = dormir,
): Promise<Resultado<Relatorio>> {
  try {
    const pedido = await cliente.chamar(
      "Apoiar",
      { idSistema: "SITFIS", idServico: "SOLICITARPROTOCOLO91", versaoSistema: "2.0", dados: "" },
      `Pedir o relatório de situação fiscal ${quem}`,
      ctx,
    );
    const dados = pedido.dados as { protocoloRelatorio?: string; tempoEspera?: number } | undefined;
    if (!dados?.protocoloRelatorio) return falha(textoMensagens(pedido.mensagens) || `HTTP ${pedido.status}`);
    let tempo = espera(dados.tempoEspera);
    // Até 4 tentativas, respeitando o tempo de espera devolvido pelo Serpro.
    for (let tentativa = 0; tentativa < 4; tentativa++) {
      await esperar(tempo);
      const r = await cliente.chamar(
        "Emitir",
        { idSistema: "SITFIS", idServico: "RELATORIOSITFIS92", versaoSistema: "2.0", dados: { protocoloRelatorio: dados.protocoloRelatorio } },
        `Emitir o relatório de situação fiscal ${quem}`,
        ctx,
      );
      const conteudo = r.dados as { pdf?: string; tempoEspera?: number } | undefined;
      if (conteudo?.pdf) {
        let leitura: { regular: boolean | null; diagnostico: string } = { regular: null, diagnostico: "" };
        try {
          leitura = lerDiagnostico(textoDoPdf(Buffer.from(conteudo.pdf, "base64")));
        } catch {
          // Sem leitura: o relatório continua disponível para abrir.
        }
        return { ok: true, pdf: conteudo.pdf, ...leitura, detalhe: r.mensagens.map((m) => m.texto).join(" | ") };
      }
      if (r.status !== 202 && r.status !== 204) return falha(textoMensagens(r.mensagens) || `HTTP ${r.status}`);
      tempo = espera(conteudo?.tempoEspera);
    }
    return falha("O Serpro ainda estava processando o relatório. Tente de novo em alguns minutos.");
  } catch (erro) {
    return falha((erro as Error).message);
  }
}
