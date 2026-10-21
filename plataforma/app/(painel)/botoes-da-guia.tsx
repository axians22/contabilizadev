import { Explicacao } from "@/app/explicacao";
import { botaoLink, botaoPrimario } from "@/app/ui";
import type { Botoes } from "@/lib/rotina/botoes-guia";

// Botões únicos da guia do mês (painel, aba Guias e Histórico), no desenho do ../fiscal (app/botoes-guias.tsx): abrir o
// PDF em nova aba e "Baixar". O que cada botão faz vem de lib/rotina/botoes-guia.ts. Quando o PDF ainda não está aqui, o
// mesmo botão busca a guia na Receita Federal ao clicar (uma vez; depois fica guardada) e o porquê vai no tooltip; sem
// serviço para o caso, o caminho no portal, com os passos no tooltip. `compacto`: os botões menores da tabela.
export function BotoesDaGuia({ botoes, nome, destaque = false, compacto = false }: { botoes: Botoes | null; nome: string; destaque?: boolean; compacto?: boolean }) {
  if (!botoes) return null;
  const leve = compacto ? `${botaoLink} h-8 px-3 text-xs` : botaoLink;
  const principal = compacto ? leve : destaque ? botaoPrimario : botaoLink;
  const explicacao = botoes.explicacao && (
    <Explicacao
      rotulo={botoes.modo === "portal" ? `Como pegar a guia do ${nome} no portal?` : `De onde vem a guia do ${nome}?`}
      texto={botoes.explicacao.texto}
      lista={botoes.explicacao.passos}
      ordenada={Boolean(botoes.explicacao.passos)}
      link={botoes.modo === "portal" ? { href: botoes.portal.url, texto: `Abrir o ${botoes.portal.nome}` } : undefined}
    />
  );
  if (botoes.modo === "portal") {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <a className={leve} href={botoes.portal.url} target="_blank" rel="noopener noreferrer">
          {botoes.rotulo}
        </a>
        {explicacao}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <a className={principal} href={botoes.abrir} target="_blank" rel="noopener" aria-label={`${botoes.rotulo} do ${nome} (abre em nova aba)`}>
        {botoes.rotulo}
      </a>
      {/* Guardada: download direto. Buscar: a busca pode falhar e a rota responde com a mensagem em linguagem simples; com
          `download` o navegador baixaria essa página. Por isso abre em nova aba (deu certo, a rota manda attachment). */}
      <a
        className={leve}
        href={botoes.baixar}
        {...(botoes.modo === "guardada" ? { download: true } : { target: "_blank", rel: "noopener" })}
        aria-label={`Baixar a guia do ${nome}`}
      >
        Baixar
      </a>
      {explicacao}
    </span>
  );
}
