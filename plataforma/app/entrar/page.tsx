import { redirect } from "next/navigation";
import { Explicacao } from "@/app/explicacao";
import { Cartao } from "@/app/ui";
import { destinoSeguro } from "@/lib/autenticacao/cookie";
import { enderecoSemSessao } from "@/lib/autenticacao/rotas";
import { configAutenticacao, sessaoAtual } from "@/lib/autenticacao/servidor";
import { BotaoGoogle } from "./botao-google";

export const metadata = { title: "Entrar · ContabilizaDev" };

// Única página aberta sem sessão (ver lib/autenticacao/rotas.ts). Só aparece com o login ligado.
export default async function Entrar({ searchParams }: { searchParams: Promise<{ de?: string | string[] }> }) {
  const { de: bruto } = await searchParams;
  const de = destinoSeguro(typeof bruto === "string" ? bruto : null);
  if (await sessaoAtual()) redirect(de);
  const config = configAutenticacao();
  // Login desligado (desenvolvimento): não há tela de login, entra sozinho com a conta de desenvolvimento.
  if (config.loginDesligado) redirect(enderecoSemSessao(true, de));

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <Cartao className="flex w-full max-w-sm flex-col items-center gap-6 px-6 py-8 text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-hero text-accent">
          <svg viewBox="0 0 16 16" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M3 13V8M8 13V3M13 13V6" />
          </svg>
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Entrar no ContabilizaDev</h1>
          <p className="text-sm text-muted">Simples Nacional para empresas de TI que exportam serviço.</p>
        </div>

        {config.googleClientId ? (
          <BotaoGoogle clientId={config.googleClientId} de={de} />
        ) : (
          <div role="status" className="flex flex-col gap-1 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-left text-sm">
            <b className="font-semibold text-warn">Login com Google não configurado.</b>
            <span>
              Defina <code>GOOGLE_CLIENT_ID</code> no <code>plataforma/.env.local</code> e reinicie o servidor.{" "}
              <Explicacao rotulo="Como criar o Client ID?" texto="O passo a passo para criar o Client ID do Google está no README do projeto." />
            </span>
          </div>
        )}
      </Cartao>
    </main>
  );
}
