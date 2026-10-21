import { dataBr } from "@contabilizadev/nucleo/formato";
import { rotuloMes } from "@contabilizadev/nucleo/meses";
import { Explicacao } from "@/app/explicacao";
import { Cartao, Secao, Titulo } from "@/app/ui";
import { banco } from "@/banco";
import { abaDaEmpresa } from "@/lib/abas";
import { exigirConteudo } from "@/lib/empresas/portao-servidor";
import { situacaoFiscalDaEmpresa } from "@/lib/historico/leitura";
import { INTERVALO_MANUAL_SITUACAO_MINUTOS, proximaSituacao } from "@/lib/historico/prazos";
import { atualizarAoAbrir } from "@/lib/historico/servidor";
import { guiasVencidas } from "@/lib/rotina/guias";
import { explicarPendencias } from "@/lib/situacao/pendencias";
import { ECAC } from "@/lib/termo/guiado";
import { termoDoServidor } from "@/lib/termo/servidor";
import { liberada } from "@/lib/termo/situacao";
import { situacaoTermo } from "@/lib/termo/termo";
import { FacaNoPortal } from "../faca-no-portal";
import { atualizarSituacaoAcao } from "../historico/acoes";
import { Acompanhar, ConsultadoEm } from "../historico/acompanhar";
import { BotaoAtualizarHistorico } from "../historico/botao-atualizar";
import { PortaoFechado } from "../portao";
import { gerarGuiaAcao } from "../roteiro/acoes";
import { GuiaAqui } from "../roteiro/guia-aqui";
import { CartaoSituacaoFiscal } from "./cartao-situacao";
import { guiaDoDebito, PendenciasExplicadas } from "./pendencias";

export const metadata = { title: "Situação fiscal · ContabilizaDev" };

const NOME = { DAS: "DAS (Simples)", INSS: "DARF do INSS" } as const;

// Situação fiscal: o relatório da Receita Federal (pendências na Receita e na Procuradoria). Banco primeiro: consultado
// sozinho a cada 2 meses (em segundo plano, ao abrir) ou pelo botão Atualizar. As pendências aparecem em linguagem simples
// e, quando a pendência é uma guia vencida da rotina do mês (DAS ou DARF do INSS), com o botão de gerar a guia nova com
// multa e juros para a data escolhida. Sem autorização, o modo guiado.
export default async function SituacaoFiscal() {
  const { portao } = await exigirConteudo();
  const aba = abaDaEmpresa("/situacao");
  if (portao.estado !== "liberado") return <PortaoFechado aba={aba} portao={portao} />;
  const { empresa, acesso } = portao;
  const situacaoDoTermo = await situacaoTermo(await termoDoServidor(), acesso);
  const autorizada = liberada(situacaoDoTermo);
  if (autorizada) await atualizarAoAbrir(acesso, ["situacao"]);
  const situacao = await situacaoFiscalDaEmpresa(banco(), acesso);
  const irregular = situacao.atual?.regular === false;
  const pendencias = irregular ? explicarPendencias(situacao.atual?.pendencias) : [];
  const vencidas = autorizada ? await guiasVencidas(banco(), acesso, new Date()) : [];
  // Guias vencidas que nenhuma pendência do relatório citou (o relatório pode ser de antes do vencimento).
  const resolvidasNasPendencias = new Set(pendencias.flatMap((p) => p.debitos.map((d) => guiaDoDebito(d, vencidas))).filter(Boolean));
  const outras = vencidas.filter((g) => !resolvidasNasPendencias.has(g));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Titulo
          sobre={empresa.razaoSocial}
          explicacao={
            <Explicacao
              rotulo="O que aparece na Situação fiscal?"
              texto="Se a empresa tem pendências na Receita Federal e na Procuradoria da Fazenda, pelo relatório de situação fiscal (o mesmo do e-CAC), com o que cada pendência quer dizer."
            />
          }
        >
          {aba.nome}
        </Titulo>
        {autorizada && <BotaoAtualizarHistorico empresaId={empresa.id} atualizar={atualizarSituacaoAcao} />}
      </div>

      {!autorizada && <FacaNoPortal funcao="situacaoFiscal" situacao={situacaoDoTermo} />}
      <Acompanhar acesso={acesso} etapas={["situacao"]} />
      {(autorizada || situacao.atual) && <CartaoSituacaoFiscal situacao={situacao} />}

      <PendenciasExplicadas pendencias={pendencias} vencidas={vencidas} empresaId={empresa.id} autorizada={autorizada} gerar={gerarGuiaAcao} />

      {irregular && (
        <Cartao className="px-5 py-4 text-sm">
          Resolva as pendências e peça um relatório novo.{" "}
          <Explicacao
            rotulo="Como resolver as pendências?"
            texto={[
              "Imposto vencido: gere a guia nova com multa e juros e pague, ou peça o parcelamento.",
              "Declaração em falta: transmita a declaração do período.",
              `O que não der para resolver aqui se resolve no ${ECAC.nome}. Depois de resolver, use Atualizar para pedir um relatório novo.`,
            ]}
            link={{ href: ECAC.url, texto: `Abrir o ${ECAC.nome}` }}
          />
        </Cartao>
      )}

      {outras.length > 0 && (
        <Secao titulo="Guias vencidas sem pagamento">
          <div className="grid gap-3 lg:grid-cols-2">
            {outras.map((g) => (
              <Cartao key={`${g.pa}-${g.tipo}`} className="flex flex-col gap-3 border-bad/40 px-5 py-4">
                <span className="text-sm font-semibold first-letter:uppercase">{`${NOME[g.tipo]} de ${rotuloMes(g.pa)} · venceu em ${dataBr(g.vencimento)}`}</span>
                <GuiaAqui guia={g} campos={{ empresaId: empresa.id, pa: g.pa }} rotulo="Gerar" gerar={gerarGuiaAcao} />
              </Cartao>
            ))}
          </div>
        </Secao>
      )}

      <ConsultadoEm
        em={situacao.atual?.prontoEm ?? null}
        rotulo="Quando a situação fiscal é atualizada?"
        regra={[
          `O relatório fica guardado e é pedido de novo sozinho a cada 2 meses${situacao.atual ? ` (o próximo em ${dataBr(proximaSituacao(situacao.atual.prontoEm))})` : ""}.`,
          `Para pedir agora, use Atualizar (no máximo a cada ${INTERVALO_MANUAL_SITUACAO_MINUTOS} minutos; o relatório leva alguns segundos para ficar pronto).`,
        ]}
      />
    </>
  );
}
