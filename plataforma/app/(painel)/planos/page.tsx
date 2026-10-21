import Link from "next/link";
import { Explicacao } from "@/app/explicacao";
import { Cartao, Titulo, botaoLink } from "@/app/ui";
import { exigirSessao } from "@/lib/autenticacao/servidor";

export const metadata = { title: "Planos · ContabilizaDev" };

// Escolha do plano da assinatura (página de conta, fora do portão). Por enquanto só o aviso: a cobrança chega na
// Parte 9 do plano, junto com a exigência de plano ativo no portão (lib/empresas/portao.ts, planoAtivo).
export default async function Planos() {
  await exigirSessao();
  return (
    <>
      <Titulo explicacao={<Explicacao rotulo="O que a assinatura libera?" texto="A assinatura libera o conteúdo das abas da sua empresa: cálculo, declarações, guias e avisos." />}>
        Planos
      </Titulo>
      <Cartao className="flex flex-col gap-1 px-6 py-6">
        <h2 className="text-lg font-semibold tracking-tight">Em breve</h2>
        <p className="text-sm text-muted">Os planos e a forma de pagamento aparecem aqui em breve.</p>
      </Cartao>
      <div>
        <Link className={botaoLink} href="/">Voltar ao painel</Link>
      </div>
    </>
  );
}
