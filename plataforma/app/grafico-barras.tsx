"use client";

import { BarController, BarElement, CategoryScale, Chart as ChartJS, LinearScale, Tooltip, type ChartOptions } from "chart.js";
import { useEffect, useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";
import { brl } from "@contabilizadev/nucleo/formato";
import { Tabela } from "@/app/tabela";

ChartJS.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

// Gráfico de barras do site (generalizado do ../fiscal, app/cpf/graficos.tsx): até 3 séries em reais, empilhadas,
// com as cores dos tokens do tema (claro e escuro), legenda sempre visível e uma tabela com os mesmos números.
// Use pelo GraficoBarras de app/graficos.tsx, que só baixa o Chart.js quando o gráfico aparece.

export type SerieGrafico = { chave: string; nome: string };
export type PontoGrafico = { chave: string; rotulo: string; nome: string; valores: Record<string, number> };

const CORES = [
  { token: "--serie-1", padrao: "#2a78d6" },
  { token: "--serie-2", padrao: "#eb6834" },
  { token: "--serie-3", padrao: "#1baf7a" },
];

// Cores lidas dos tokens do tema, para o canvas acompanhar o modo claro e escuro.
function useCores() {
  const [cores, setCores] = useState({ series: CORES.map((c) => c.padrao), texto: "#0e1409", muted: "#667062", fundo: "#ffffff", linha: "#e1e5da" });
  useEffect(() => {
    const ler = () => {
      const css = getComputedStyle(document.documentElement);
      const v = (nome: string, padrao: string) => css.getPropertyValue(nome).trim() || padrao;
      setCores({
        series: CORES.map((c) => v(c.token, c.padrao)),
        texto: v("--fg", "#0e1409"),
        muted: v("--muted", "#667062"),
        fundo: v("--surface", "#ffffff"),
        linha: v("--line", "#e1e5da"),
      });
    };
    ler();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", ler);
    return () => mq.removeEventListener("change", ler);
  }, []);
  return cores;
}

export function GraficoBarras({ titulo, descricao, series, pontos }: { titulo: string; descricao: string; series: SerieGrafico[]; pontos: PontoGrafico[] }) {
  const cores = useCores();
  const lista = useMemo(() => series.slice(0, CORES.length), [series]);
  const total = (p: PontoGrafico) => lista.reduce((s, x) => s + (p.valores[x.chave] ?? 0), 0);
  const dados = useMemo(
    () => ({
      labels: pontos.map((p) => p.rotulo),
      datasets: lista.map((s, i) => ({
        label: s.nome,
        data: pontos.map((p) => p.valores[s.chave] ?? 0),
        backgroundColor: cores.series[i],
        // 2px da cor do fundo separa os segmentos empilhados.
        borderColor: cores.fundo,
        borderWidth: { top: 2, bottom: 0, left: 0, right: 0 },
        borderRadius: 4,
        borderSkipped: "bottom" as const,
        maxBarThickness: 48,
        categoryPercentage: 0.8,
        barPercentage: 0.9,
      })),
    }),
    [pontos, lista, cores],
  );
  const opcoes: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    interaction: { mode: "index", intersect: false },
    scales: {
      x: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { color: cores.muted, font: { size: 11 } } },
      y: {
        stacked: true,
        beginAtZero: true,
        border: { display: false },
        grid: { color: cores.linha },
        ticks: { color: cores.muted, font: { size: 11 }, maxTicksLimit: 5, callback: (v) => `R$ ${Number(v).toLocaleString("pt-BR")}` },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: cores.fundo,
        titleColor: cores.texto,
        bodyColor: cores.texto,
        footerColor: cores.texto,
        borderColor: cores.linha,
        borderWidth: 1,
        padding: 10,
        callbacks: {
          title: (itens) => pontos[itens[0].dataIndex]?.nome ?? "",
          label: (item) => `${item.dataset.label}: ${brl(Number(item.raw))}`,
          footer: (itens) => (lista.length > 1 && pontos[itens[0].dataIndex] ? `Total: ${brl(total(pontos[itens[0].dataIndex]))}` : ""),
        },
      },
    },
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-medium tracking-wide text-muted uppercase">{titulo}</span>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          {lista.map((s, i) => (
            <li key={s.chave} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: cores.series[i] }} aria-hidden="true" />
              {s.nome}
            </li>
          ))}
        </ul>
      </div>
      <div className="relative h-56 w-full min-w-0" role="img" aria-label={descricao}>
        <Bar data={dados} options={opcoes} />
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted hover:text-fg">Ver em tabela</summary>
        <div className="mt-2">
          <Tabela
            rotulo={titulo}
            porPagina={12}
            colunas={[
              { chave: "ponto", titulo: "Período", principal: true, classe: "first-letter:uppercase" },
              ...lista.map((x) => ({ chave: x.chave, titulo: x.nome, alinhar: "direita" as const })),
              ...(lista.length > 1 ? [{ chave: "total", titulo: "Total", alinhar: "direita" as const }] : []),
            ]}
            linhas={pontos.map((p) => ({
              chave: p.chave,
              celulas: {
                ponto: p.nome,
                ...Object.fromEntries(lista.map((x) => [x.chave, brl(p.valores[x.chave] ?? 0)])),
                total: <b className="font-semibold">{brl(total(p))}</b>,
              },
            }))}
          />
        </div>
      </details>
    </div>
  );
}
