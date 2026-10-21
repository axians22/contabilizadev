import Link from "next/link";
import type { ReactNode } from "react";
import { brl, dataBr, pct } from "@contabilizadev/nucleo/formato";
import { rotuloMes } from "@contabilizadev/nucleo/meses";
import { Explicacao } from "@/app/explicacao";
import { Tabela, type Coluna, type Linha } from "@/app/tabela";
import { Cartao, Titulo, botaoLink } from "@/app/ui";
import type { LinhaDaConferencia } from "@/lib/historico/conferencia";
import { enderecoDoDocumento } from "@/lib/historico/documentos";
import type { MesDoHistorico } from "@/lib/historico/leitura";
import { SITUACOES_DO_MES } from "@/lib/historico/mensagens";
import { MESES_DO_HISTORICO } from "@/lib/historico/prazos";
import type { FonteFolha } from "@/lib/rotina/base";
import { PORTAL_SIMPLES } from "@/lib/termo/guiado";

// Histórico (aba), no desenho do ../fiscal (app/historico/page.tsx) e na mesma ordem: o título "Histórico e conferência"
// com o período, o botão de mostrar o pró-labore e o INSS, a tabela única (densa, 12 por página) com o mês, a receita
// declarada, a receita total, os 12 meses anteriores, a alíquota paga, o DAS calculado, o DAS emitido e a diferença, e a
// nota do asterisco. Diferenças do ../fiscal: os valores vêm da Receita Federal (nada se digita na tabela), cada mês traz
// a situação do DAS e o extrato em PDF, e a conferência do CNAE com a atividade declarada (aviso e marca no mês), que só
// existe aqui. As explicações que o ../fiscal deixa abertas (Nota) ficam no tooltip.
// Só apresentação: os dados chegam prontos da página (page.tsx); `atualizar`, `antes` e `depois` são as partes do servidor
// (o botão Atualizar; o modo guiado e o progresso da importação; os gráficos e o "consultado em").

export type DadosDaTela = {
  linhas: LinhaDaConferencia[]; // do mês mais antigo ao mais recente
  mostrarProLabore: boolean;
  importado: boolean; // algum mês já veio da Receita Federal
  autorizada: boolean;
};

// Cores das pílulas de situação, as das guias do ../fiscal (app/botoes-guias.tsx).
const COR: Record<MesDoHistorico["situacao"], string> = {
  pago: "bg-accent text-on-accent",
  "em-aberto": "bg-warn-soft text-warn",
  vencido: "bg-bad/15 text-bad",
  "sem-valor": "bg-raised text-muted",
  "sem-guia": "bg-warn-soft text-warn",
  "nao-declarado": "bg-bad/15 text-bad",
  "no-prazo": "bg-raised text-muted",
  "nao-importado": "bg-raised text-muted",
};

const FONTE_PROLABORE: Record<FonteFolha, string> = {
  informada: "informado aqui",
  "receita-federal": "Receita Federal",
  darf: "pelo DARF pago",
  "darf-teto": "pelo DARF (teto)",
};

function Situacao({ mes }: { mes: MesDoHistorico }) {
  const s = SITUACOES_DO_MES[mes.situacao];
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className="inline-flex items-center gap-1">
        <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold whitespace-nowrap ${COR[mes.situacao]}`}>{s.rotulo}</span>
        <Explicacao rotulo={`O que quer dizer "${s.rotulo}" em ${rotuloMes(mes.pa)}?`} texto={[s.explicacao, `Vencimento: ${dataBr(mes.vencimento)}.`]} />
      </span>
      {mes.pagoEm && <span className="text-xs text-muted">em {dataBr(mes.pagoEm)}</span>}
    </span>
  );
}

const valor = (v: number | null) => (v !== null ? brl(v) : "—");

export function TelaDoHistorico({ dados, atualizar, antes, depois }: { dados: DadosDaTela; atualizar?: ReactNode; antes?: ReactNode; depois?: ReactNode }) {
  const { linhas, mostrarProLabore } = dados;
  const divergentes = linhas.filter((l) => l.mes.divergencia);
  const incompleta = linhas.some((l) => l.rbt12Incompleta);
  const temValores = linhas.some((l) => l.receitaTotal !== null || l.mes.valorDas !== null);
  const mostrarTabela = dados.importado || dados.autorizada || temValores;

  // Com pró-labore e INSS abertos, todas as colunas ficam com fonte e espaços menores para caber sem cortar (../fiscal).
  const classe = `whitespace-nowrap ${mostrarProLabore ? "px-1.5! text-xs" : ""}`;
  const coluna = (chave: string, titulo: string): Coluna => ({ chave, titulo, alinhar: "direita", classe });
  const colunas: Coluna[] = [
    { chave: "mes", titulo: "Mês", principal: true, classe: `${classe} font-medium` },
    coluna("declarada", "Receita declarada"),
    coluna("receita", "Receita total"),
    coluna("rbt12", "12 meses anteriores"),
    coluna("aliquota", "Alíquota paga"),
    coluna("calculado", "DAS calculado"),
    coluna("emitido", "DAS emitido"),
    coluna("diferenca", "Diferença"),
    { chave: "situacao", titulo: "Situação", classe },
    { chave: "extrato", titulo: "Extrato", classe },
  ];
  const colunasProLabore = [coluna("prolabore", "Pró-labore"), coluna("inss", "INSS (DARF)")];

  const tabela: Linha[] = [...linhas].reverse().map((l) => {
    const m = l.mes;
    const cor = l.diferenca === null ? "" : Math.abs(l.diferenca) < 0.005 ? "text-accent-ink" : "text-bad";
    return {
      chave: m.pa,
      destaque: m.divergencia ? "alerta" : false, // erro de CNAE: tom de alerta, não o verde de "tudo certo"
      celulas: {
        // inline-block para o first-letter funcionar também no título do cartão do celular.
        mes: (
          <span className="flex flex-col">
            <span className="inline-block first-letter:uppercase">{rotuloMes(m.pa)}</span>
            {m.declaracao?.tipo === "retificadora" && <span className="text-xs font-normal text-muted">Retificada</span>}
            {m.divergencia && <span className="text-xs font-semibold text-bad">Atividade não bate com o CNAE</span>}
          </span>
        ),
        declarada: valor(m.receita),
        receita: (
          <span>
            {valor(l.receitaTotal)}
            {l.fonteReceita === "lancada" && <span className="block text-xs text-muted">lançada aqui</span>}
          </span>
        ),
        rbt12: l.rbt12 !== null ? `${brl(l.rbt12)}${l.rbt12Incompleta ? " *" : ""}` : "—",
        aliquota: l.aliquotaPaga !== null ? pct(l.aliquotaPaga) : "—",
        calculado: valor(l.dasCalculado),
        emitido: valor(m.valorDas),
        diferenca: <span className={cor}>{valor(l.diferenca)}</span>,
        situacao: <Situacao mes={m} />,
        extrato: m.extrato ? (
          <a href={enderecoDoDocumento("extrato", m.extrato.id)} target="_blank" rel="noopener" className="font-medium underline underline-offset-2">
            {m.extrato.origem === "declaracao" ? "Declaração (PDF)" : "PDF"}
          </a>
        ) : (
          "—"
        ),
        prolabore: (
          <span>
            {valor(l.prolabore)}
            {l.fonteProlabore && <span className="block text-xs text-muted">{FONTE_PROLABORE[l.fonteProlabore]}</span>}
          </span>
        ),
        inss: valor(l.inss),
      },
    };
  });

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Titulo
          sobre={`Últimos ${MESES_DO_HISTORICO} meses`}
          explicacao={
            <Explicacao
              rotulo="O que aparece no Histórico?"
              texto={[
                "As declarações mensais do Simples (PGDAS-D) e os pagamentos dos últimos 12 meses, trazidos da Receita Federal, com o extrato de cada declaração em PDF.",
                "A conferência: o DAS que a plataforma calcula com a receita de cada mês, ao lado do DAS emitido. A diferença mostra se o cálculo bate.",
                "Também conferimos se a atividade usada em cada declaração bate com as atividades (CNAE) da empresa.",
              ]}
            />
          }
        >
          Histórico e conferência
        </Titulo>
        {atualizar}
      </div>

      {antes}

      {divergentes.map((l) => (
        <Cartao key={l.mes.pa} className="flex flex-col gap-1 border-bad/40 px-5 py-4 text-sm">
          <b className="font-semibold text-bad">{l.mes.divergencia!.titulo}</b>
          <span>
            {l.mes.divergencia!.texto}{" "}
            <Explicacao rotulo={`Por que a atividade de ${rotuloMes(l.mes.pa)} não bate e o que fazer?`} texto={l.mes.divergencia!.explicacao} />
          </span>
          <a href={PORTAL_SIMPLES.url} target="_blank" rel="noopener noreferrer" className="w-fit font-semibold text-accent-ink underline underline-offset-2">
            Retificar no {PORTAL_SIMPLES.nome} ↗
          </a>
        </Cartao>
      ))}

      {mostrarTabela ? (
        <>
          <div className="flex flex-wrap justify-end gap-2">
            <Link className={botaoLink} href={mostrarProLabore ? "/historico" : "/historico?prolabore=1"} scroll={false}>
              {mostrarProLabore ? "− Ocultar pró-labore e INSS" : "+ Mostrar pró-labore e INSS"}
            </Link>
          </div>
          <Tabela densa colunas={mostrarProLabore ? [...colunas, ...colunasProLabore] : colunas} linhas={tabela} porPagina={12} rotulo="Histórico mensal" />
          {incompleta && (
            <p className="flex flex-wrap items-center gap-x-1 text-sm text-muted">
              * Faltam receitas nos 12 meses anteriores.
              <Explicacao
                rotulo="O que quer dizer o asterisco?"
                texto={[
                  "Há meses sem receita conhecida entre os 12 anteriores: eles contam como zero, então a alíquota desse mês está subestimada.",
                  "Com a autorização, as declarações vêm da Receita Federal; sem ela, lance a receita desses meses no painel.",
                ]}
              />
            </p>
          )}
        </>
      ) : (
        <Cartao className="px-5 py-4 text-sm text-muted">Nada importado ainda.</Cartao>
      )}

      {depois}
    </>
  );
}
