import { Explicacao } from "@/app/explicacao";
import { Cartao } from "@/app/ui";
import { enderecoDoDocumento } from "@/lib/historico/documentos";
import type { SituacaoFiscal } from "@/lib/historico/leitura";
import { quando } from "../historico/acompanhar";

const ESTADO = {
  regular: { texto: "Regular", cor: "bg-accent text-on-accent", borda: "" },
  irregular: { texto: "Irregular", cor: "bg-bad text-white", borda: "border-bad/50 bg-bad/5" },
  indefinida: { texto: "Não deu para ler", cor: "bg-raised text-muted", borda: "" },
} as const;

// Situação fiscal da empresa na aba Situação fiscal: Regular ou Irregular em evidência (vermelho se irregular), a data da
// última consulta e o PDF do relatório (as pendências explicadas ficam em pendencias.tsx). No painel, a faixa do
// ../fiscal fica em ../situacao-fiscal.tsx.
export function CartaoSituacaoFiscal({ situacao }: { situacao: SituacaoFiscal }) {
  const atual = situacao.atual;
  if (!atual) {
    return (
      <Cartao className="flex flex-col gap-1 px-5 py-4 text-sm">
        <span className="text-xs font-medium tracking-wide text-muted uppercase">Situação fiscal</span>
        <span className="text-muted">{situacao.processando ? "Consultando a Receita Federal…" : "Ainda não consultada."}</span>
      </Cartao>
    );
  }
  const irregular = atual.regular === false;
  const e = ESTADO[atual.regular === true ? "regular" : irregular ? "irregular" : "indefinida"];
  return (
    <Cartao className={`flex flex-col gap-3 px-5 py-4 text-sm ${e.borda}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium tracking-wide text-muted uppercase">Situação fiscal</span>
        <span className={`inline-flex h-8 items-center rounded-full px-4 text-base font-semibold ${e.cor}`}>{e.texto}</span>
        <Explicacao
          rotulo="O que é a situação fiscal?"
          texto={[
            "É o relatório da Receita Federal com as pendências da empresa na Receita e na Procuradoria da Fazenda (o mesmo que a certidão negativa considera).",
            irregular
              ? "Irregular: há pendências (débito em aberto, declaração em falta ou outra). Enquanto houver, a empresa não consegue a certidão negativa e pode ser excluída do Simples."
              : atual.regular === true
                ? "Regular: nenhuma pendência encontrada."
                : "Não conseguimos ler o resultado do relatório: abra o PDF para conferir.",
          ]}
        />
      </div>
      <span className="text-muted">Consultada em {quando(atual.prontoEm)}.</span>
      {atual.temPdf && (
        <a href={enderecoDoDocumento("situacao", atual.id)} target="_blank" rel="noopener" className="w-fit font-medium underline underline-offset-2">
          Abrir o relatório (PDF)
        </a>
      )}
    </Cartao>
  );
}
