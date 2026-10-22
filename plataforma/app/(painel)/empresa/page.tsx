import Link from "next/link";
import { Explicacao } from "@/app/explicacao";
import { Cartao, Titulo, botaoLink } from "@/app/ui";
import { banco } from "@/banco";
import { abaDaEmpresa } from "@/lib/abas";
import { exigirConteudo } from "@/lib/empresas/portao-servidor";
import { formatarCnpj } from "@/lib/empresas/cnpj";
import { dadosDaReceita, VALIDADE_DOS_DADOS_DIAS } from "@/lib/empresas/receita";
import { atualizarDadosAcao, desistirDoCadastroAcao, removerEmpresaAcao } from "./acoes";
import { BotaoAtualizar } from "./botao-atualizar";
import { FichaReceita } from "./ficha";
import { RemoverEmpresa } from "./remover-empresa";
import { PortaoFechado } from "../portao";

export const metadata = { title: "Dados da empresa · ContabilizaDev" };

// Dados da Receita e diagnóstico da empresa ativa. Banco primeiro: a BrasilAPI só é consultada se não houver
// consulta guardada ou se ela tiver mais de 30 dias (ou pelo botão "Atualizar dados"). Sem empresa (ou sem plano), o
// portão mostra o estado vazio da aba; os dados só são lidos com o acesso que ele entrega.
// Confirmação curta depois de remover uma empresa (a ação volta para cá com ?removida=1).
function Removida() {
  return (
    <p role="status" className="text-sm font-medium text-accent-ink">
      Empresa removida.
    </p>
  );
}

export default async function DadosDaEmpresa({ searchParams }: { searchParams: Promise<{ removida?: string | string[] }> }) {
  const { portao } = await exigirConteudo();
  const removida = (await searchParams).removida === "1";
  if (portao.estado !== "liberado") {
    return (
      <>
        {removida && <Removida />}
        <PortaoFechado aba={abaDaEmpresa("/empresa")} portao={portao} />
        {/* Sem plano, o dono ainda pode remover a empresa (remover não depende da assinatura). */}
        {portao.estado === "sem-plano" && <RemoverEmpresa key={portao.empresa.id} empresa={portao.empresa} remover={removerEmpresaAcao} />}
        {/* Aguardando comprovação: dá para desistir do cadastro (só o vínculo provisório deste usuário cai). */}
        {portao.estado === "aguardando" && (
          <form action={desistirDoCadastroAcao} className="flex items-center gap-1 text-sm">
            <input type="hidden" name="empresaId" value={portao.empresa.id} />
            <button type="submit" className={`${botaoLink} cursor-pointer`}>
              Desistir deste cadastro
            </button>
            <Explicacao
              rotulo="O que acontece se eu desistir?"
              texto="A empresa sai da sua lista. Nada foi guardado dela na sua conta; se quiser, cadastre de novo depois."
            />
          </form>
        )}
      </>
    );
  }
  const { empresa, acesso } = portao;
  const { consulta, erro } = await dadosDaReceita(banco(), acesso);

  return (
    <>
      {removida && <Removida />}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Titulo sobre={`CNPJ ${formatarCnpj(empresa.cnpj)}`}>{consulta?.dados.razaoSocial ?? empresa.razaoSocial}</Titulo>
        <BotaoAtualizar empresaId={empresa.id} atualizar={atualizarDadosAcao} />
      </div>

      {erro && (
        <Cartao className="border-bad/40 px-5 py-4 text-sm">
          <b className="font-semibold text-bad">Não deu para consultar a Receita agora.</b> {erro}
          {consulta && <span className="text-muted"> Mostramos a última consulta guardada.</span>}
        </Cartao>
      )}

      {consulta ? (
        <FichaReceita dados={consulta.dados} diagnostico={consulta.diagnostico} consultadaEm={consulta.consultadaEm} />
      ) : (
        <Cartao className="px-5 py-4 text-sm text-muted">Ainda não há dados da Receita para esta empresa. Tente atualizar daqui a pouco.</Cartao>
      )}

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>
          Atualizados sozinhos a cada {VALIDADE_DOS_DADOS_DIAS} dias.{" "}
          <Explicacao
            rotulo="Quando os dados são atualizados?"
            texto={`Os dados ficam guardados e são consultados de novo na Receita Federal sozinhos depois de ${VALIDADE_DOS_DADOS_DIAS} dias. Para buscar agora, use Atualizar dados.`}
          />
        </span>
        <Link href="/empresas/nova" className="underline underline-offset-2 hover:text-fg">Cadastrar outra empresa</Link>
      </p>
      <div>
        <Link className={botaoLink} href="/">Voltar ao painel</Link>
      </div>
      <RemoverEmpresa key={empresa.id} empresa={empresa} remover={removerEmpresaAcao} />
    </>
  );
}
