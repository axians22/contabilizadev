import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "ContabilizaDev",
  description: "Simples Nacional para empresas de TI que exportam serviço: calcule, declare e pague você mesmo.",
};

// Só o esqueleto da página. O painel (barra lateral, barra de cima, sessão) fica em (painel)/layout.tsx; a
// tela de entrada fica fora dele.
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="bg-bg font-sans text-fg antialiased">
        {/* Aplica a barra lateral recolhida antes de pintar a página, para não piscar. Fica aqui, e não no layout do
            painel, porque o layout raiz não é renderizado de novo no navegador (o React não executa script nesse caso). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("barra-lateral")==="fechada")document.documentElement.dataset.barra="fechada"}catch(e){}`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
