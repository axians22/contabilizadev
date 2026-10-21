"use client";

// Gráficos com carregamento preguiçoso (do ../fiscal, app/graficos-lazy.tsx): o Chart.js, a parte mais pesada do
// site, só é baixado quando um gráfico aparece na tela. Enquanto isso, um esqueleto do mesmo tamanho ocupa o lugar.
import dynamic from "next/dynamic";

function Esqueleto({ altura }: { altura: number }) {
  return (
    <div className="flex animate-pulse flex-col gap-4 rounded-2xl border border-line bg-surface px-5 py-4 motion-reduce:animate-none" style={{ height: altura }} aria-busy="true" aria-label="Carregando gráfico">
      <div className="h-4 w-40 rounded-full bg-raised" />
      <div className="flex-1 rounded-xl bg-raised/70" />
    </div>
  );
}

export const GraficoBarras = dynamic(() => import("@/app/grafico-barras").then((m) => m.GraficoBarras), {
  ssr: false,
  loading: () => <Esqueleto altura={340} />,
});
