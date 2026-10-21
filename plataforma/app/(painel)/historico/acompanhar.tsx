import { Explicacao } from "@/app/explicacao";
import { banco } from "@/banco";
import type { EtapaImportacao } from "@/banco/esquema";
import type { AcessoEmpresa } from "@/lib/empresas/acesso";
import { importacaoDaEmpresa } from "@/lib/historico/leitura";
import { NOMES_DAS_ETAPAS } from "@/lib/historico/mensagens";
import { ProgressoImportacao } from "./progresso";

// Data e hora em Brasília ("18/10/2026 às 14:05").
export const quando = (d: Date) =>
  `${d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} às ${d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}`;

// Progresso (ou o resultado com falha) da importação, só das etapas desta aba.
export async function Acompanhar({ acesso, etapas }: { acesso: AcessoEmpresa; etapas: EtapaImportacao["id"][] }) {
  const importacao = await importacaoDaEmpresa(banco(), acesso, new Date());
  if (!importacao) return null;
  const daAba = importacao.etapas.filter((e) => etapas.includes(e.id)).map((e) => ({ ...e, nome: NOMES_DAS_ETAPAS[e.id] }));
  if (daAba.length === 0) return null;
  return <ProgressoImportacao key={importacao.id} rodando={importacao.rodando} etapas={daAba} />;
}

// Rodapé "consultado em", com a regra de atualização no tooltip.
export function ConsultadoEm({ em, regra, rotulo }: { em: Date | null; regra: string[]; rotulo: string }) {
  return (
    <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted">
      {em ? `Fonte: Receita Federal · consultado em ${quando(em)}.` : "Ainda não consultado na Receita Federal."}
      <Explicacao rotulo={rotulo} texto={regra} />
    </p>
  );
}
