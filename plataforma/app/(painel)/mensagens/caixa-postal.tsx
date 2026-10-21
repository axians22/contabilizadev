import { Explicacao } from "@/app/explicacao";
import { Tabela } from "@/app/tabela";
import { banco } from "@/banco";
import { ehNova, marcarComoVistas, mensagensDaEmpresa, resumoDaCaixa } from "@/lib/caixa-postal/caixa-postal";
import { EXPLICACAO_DA_CIENCIA } from "@/lib/caixa-postal/mensagens";
import { atualizarCaixaAoAbrir } from "@/lib/caixa-postal/servidor";
import type { AcessoEmpresa } from "@/lib/empresas/acesso";
import type { EmpresaDoUsuario } from "@/lib/empresas/servico";
import { INTERVALO_MANUAL_MINUTOS } from "@/lib/historico/prazos";
import { termoDoServidor } from "@/lib/termo/servidor";
import { liberada } from "@/lib/termo/situacao";
import { situacaoTermo } from "@/lib/termo/termo";
import { FacaNoPortal } from "../faca-no-portal";
import { ConsultadoEm } from "../historico/acompanhar";
import { BotaoDeAcao } from "../roteiro/componentes";
import { abrirMensagemAcao, atualizarMensagensAcao } from "./acoes";
import { MensagemDaCaixa } from "./mensagem";

// Aba Mensagens da página Avisos e mensagens: a Caixa Postal da Receita Federal da empresa. Banco primeiro: a lista (só os
// cabeçalhos, que não registram ciência) é buscada sozinha no máximo uma vez por dia, em segundo plano, ou pelo botão
// Atualizar. O conteúdo só é buscado quando o cliente abre uma mensagem, com a confirmação da ciência; aberto, fica
// guardado. Ver a lista apaga o sino (sem registrar nada na Receita). Sem autorização, o modo guiado e o que já estava
// guardado. O portão (exigirConteudo) fica na página.
export async function CaixaPostal({ empresa, acesso }: { empresa: EmpresaDoUsuario; acesso: AcessoEmpresa }) {
  const situacao = await situacaoTermo(await termoDoServidor(), acesso);
  const autorizada = liberada(situacao);
  if (autorizada) await atualizarCaixaAoAbrir(acesso);
  const [lista, resumo] = await Promise.all([mensagensDaEmpresa(banco(), acesso), resumoDaCaixa(banco(), acesso)]);
  const novas = new Set(lista.filter(ehNova).map((m) => m.id));
  await marcarComoVistas(banco(), acesso, new Date());

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="flex items-center gap-1 text-sm text-muted">
          As mensagens da Caixa Postal da empresa no e-CAC.
          <Explicacao
            rotulo="O que aparece em Mensagens?"
            texto={[
              "As mensagens que a Receita Federal manda para a Caixa Postal da empresa no e-CAC (intimações, avisos de declaração processada, cobranças).",
              "A lista mostra só o assunto, a data e o remetente. O conteúdo é buscado só quando você abre a mensagem.",
              ...EXPLICACAO_DA_CIENCIA.slice(0, 1),
            ]}
          />
        </p>
        {autorizada && <BotaoDeAcao acao={atualizarMensagensAcao} campos={{ empresaId: empresa.id }} rotulo="Atualizar" pendente="Buscando na Receita…" />}
      </div>

      {!autorizada && <FacaNoPortal funcao="caixaPostal" situacao={situacao} />}

      {resumo.naoLidas > 0 && (
        <p className="text-sm">
          <b className="font-semibold">{resumo.naoLidas === 1 ? "1 mensagem não lida" : `${resumo.naoLidas} mensagens não lidas`}</b>{" "}
          <Explicacao rotulo="Por que a mensagem não lida não é aberta sozinha?" texto={EXPLICACAO_DA_CIENCIA} />
        </p>
      )}

      {(autorizada || lista.length > 0) && (
        <Tabela
          rotulo="Mensagens da Receita Federal"
          porPagina={10}
          vazio={autorizada ? (resumo.atualizadaEm ? "Nenhuma mensagem na Caixa Postal." : "Ainda não buscadas na Receita Federal. Recarregue em alguns segundos ou use Atualizar.") : "Nenhuma mensagem guardada."}
          colunas={[{ chave: "mensagem", titulo: "Mensagem", principal: true, classe: "w-full" }]}
          linhas={lista.map((m) => ({
            chave: m.id,
            destaque: novas.has(m.id),
            celulas: { mensagem: <MensagemDaCaixa m={m} nova={novas.has(m.id)} empresaId={empresa.id} autorizada={autorizada} abrir={abrirMensagemAcao} /> },
          }))}
        />
      )}

      <ConsultadoEm
        em={resumo.atualizadaEm}
        rotulo="Quando as mensagens são atualizadas?"
        regra={[
          "A lista fica guardada e é buscada de novo sozinha uma vez por dia, quando você abre o painel ou esta aba. Buscar a lista não abre nenhuma mensagem.",
          `Para buscar agora, use Atualizar (no máximo a cada ${INTERVALO_MANUAL_MINUTOS} minutos).`,
          "Uma mensagem aberta fica guardada aqui: abrir de novo não consulta a Receita.",
        ]}
      />
    </>
  );
}
