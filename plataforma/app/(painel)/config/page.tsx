import Link from "next/link";
import { Explicacao } from "@/app/explicacao";
import { Cartao, Titulo, botaoLink } from "@/app/ui";
import { exigirSessao } from "@/lib/autenticacao/servidor";

export const metadata = { title: "Configuração · ContabilizaDev" };

// Configuração da conta (engrenagem da barra de cima). Página de conta, fora do portão: abre com ou sem empresa.
// Por enquanto só o aviso e os atalhos para o que já existe (cadastro de empresa e planos). O que é do administrador fica
// na área do administrador (/admin), pelo menu do usuário.
export default async function Configuracao() {
  const { usuario } = await exigirSessao();
  return (
    <>
      <Titulo
        explicacao={<Explicacao rotulo="O que vai dar para ajustar aqui?" texto="Aqui você vai ajustar a sua conta: nome, avisos por e-mail e as preferências da plataforma." />}
      >
        Configuração
      </Titulo>
      <Cartao className="flex flex-col gap-1 px-6 py-6">
        <h2 className="text-lg font-semibold tracking-tight">Em breve</h2>
        <p className="text-sm text-muted">As opções da conta {usuario.email} aparecem aqui em breve.</p>
      </Cartao>
      <div className="flex flex-wrap gap-2">
        <Link className={botaoLink} href="/empresas/nova">Cadastrar empresa</Link>
        <Link className={botaoLink} href="/planos">Planos</Link>
        <Link className={botaoLink} href="/">Voltar ao painel</Link>
      </div>
    </>
  );
}
